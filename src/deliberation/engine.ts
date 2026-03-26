/**
 * Deliberation Engine — multi-model execution loop with per-worker fallback.
 *
 * Exported functions:
 *   executeRound — single round: workers respond in parallel with per-worker fallback
 *   deliberate — multi-round loop
 *   RoundExecutionError — identifies which role failed
 *
 * DI: all LLM calls and prompt building injected via EngineDeps.
 * @module Deliberation Engine
 */

import type { ChatMessage } from "../llm/types";
import type { ModelInfo } from "../model/types";
import type {
  Degradation,
  DeliberateInput,
  DeliberateOutput,
  FailedWorker,
  GenerationParams,
  InteractionTechnique,
  ModelSwap,
  Round,
  SharedContext,
  TeamComposition,
  TeamMember,
  TokenUsage,
  WorkerResponse,
} from "./types";
// No role assignment — diversity comes from heterogeneous models
import {
  createSharedContext,
  addRound,
} from "./shared-context";
import { extractProvider } from "./provider-util";
import { classifyError, findLLMClientError, isRetryableError, normalizeErrorMessage, type CooldownEntry, type CooldownErrorType, type CooldownManager } from "./cooldown";

import type { RoundInfo } from "./prompts";

// Re-export ChatResult from canonical location for backward compatibility
export type { ChatResult } from "../axis/types";
import type { ChatResult } from "../axis/types";

// -- Constants --

/**
 * Minimum character length for a valid worker response.
 * Responses shorter than this are treated as degenerate (empty, provider failure, etc.)
 * and trigger fallback to next model. Safety net for truly broken responses,
 * not a quality bar — worker prompts do not specify this limit.
 */
export const MIN_WORKER_RESPONSE_LENGTH = 200;

/** Minimum viable team size: at least 3, or 60% of requested. */
export function minViableTeamSize(requested: number): number {
  return Math.max(3, Math.ceil(requested * 0.6));
}

/**
 * Error thrown when the team degrades below minimum viable size.
 */
export class TeamDegradedError extends Error {
  constructor(
    public readonly originalSize: number,
    public readonly activeSize: number,
    public readonly lostSlots: readonly { model: string; reason: string }[],
    public readonly tokensConsumed?: TokenUsage,
    public readonly modelSwaps?: readonly ModelSwap[],
    /** Partial round with successful responses — not discarded despite degradation. */
    public readonly partialRound?: Round,
  ) {
    super(`Team degraded below minimum viable size (${activeSize}/${originalSize}, min ${minViableTeamSize(originalSize)})`);
    this.name = "TeamDegradedError";
  }
}

// -- Public Interfaces --

/**
 * Error thrown by executeRound when all workers (including fallbacks) fail.
 */
export class RoundExecutionError extends Error {
  constructor(
    public readonly role: "worker",
    public readonly modelId: string,
    public override readonly cause: unknown,
    /** Tokens consumed before the error occurred. */
    public readonly tokensConsumed?: TokenUsage,
    /** Model swaps attempted before total failure. */
    public readonly modelSwaps?: readonly ModelSwap[],
  ) {
    super(
      `${role} (${modelId}) failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "RoundExecutionError";
  }
}

/**
 * Fallback pool for per-worker model replacement.
 * Uses claim semantics: getNext() removes the model from the pool (D12).
 */
export interface FallbackPool {
  /** Get next available model. Claimed on return — removed from pool. */
  getNext(excludeIds: Set<string>): ModelInfo | undefined;
  /** Mark failure with error-type-scoped cooldown (provider or model level). */
  markFailed(modelId: string, reason: string, errorType: CooldownErrorType): void;
  /** Check if a model is currently on cooldown. */
  isOnCooldown(modelId: string): boolean;
  /** Get the cooldown entry for a model. */
  getEntry(modelId: string): CooldownEntry | undefined;
}

/**
 * Dependencies for fallback during deliberation.
 */
export interface FallbackDeps {
  readonly pool: FallbackPool;
  /**
   * Replenishment callback: given alive provider names, number of empty slots,
   * and models that already responded, return additional team members to fill.
   */
  readonly replenish?: (aliveProviders: ReadonlySet<string>, emptySlots: number, respondedModels: ReadonlySet<string>) => TeamMember[];
}

/**
 * Dependency injection for the engine.
 * All LLM I/O and prompt construction is injected.
 */
export interface EngineDeps {
  readonly chat: (
    model: string,
    messages: ChatMessage[],
    params?: GenerationParams,
  ) => Promise<ChatResult>;
  readonly buildWorkerMessages: (
    ctx: SharedContext,
    instructions?: string,
    roundInfo?: RoundInfo,
    workerIndex?: number,
    technique?: InteractionTechnique,
  ) => ChatMessage[];
  /** Debate protocol: full rebuild for cold join or first debate round. */
  readonly buildDebateWorkerMessages?: (
    ctx: SharedContext,
    instructions?: string,
    roundInfo?: RoundInfo,
    workerIndex?: number,
    technique?: InteractionTechnique,
  ) => ChatMessage[];
  /** Debate follow-up: append-only user message for session continuation in R2+. */
  readonly buildDebateFollowUp?: (
    ctx: SharedContext,
    otherResponses: readonly WorkerResponse[],
    roundInfo?: RoundInfo,
    instructions?: string,
    technique?: InteractionTechnique,
  ) => ChatMessage;
}

/**
 * Engine configuration.
 */
export interface EngineConfig {
  readonly maxRounds: number;
  readonly protocol?: "diverge-synth" | "debate";
  /** Generation params for worker LLM calls. */
  readonly workerGenParams?: GenerationParams;
}

/** Default convergence threshold for early termination. */
const CONVERGENCE_THRESHOLD = 0.15;

const DEFAULT_CONFIG: EngineConfig = {
  maxRounds: 1,
};

// -- Confidence Parsing --

/**
 * Parse explicit confidence markers from worker response text.
 * Only matches explicit markers — does not infer from hedging language.
 */
export function parseConfidence(text: string): "high" | "medium" | "low" | undefined {
  const normalized = text.toLowerCase();
  // Match patterns: "HIGH confidence", "confidence: HIGH", "HIGH:", "[HIGH]"
  const pattern = /\b(high|medium|low)\s*(?:confidence|:)|\bconfidence\s*:\s*(high|medium|low)\b|\[(high|medium|low)\]/gi;
  const counts = { high: 0, medium: 0, low: 0 };
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    const level = (match[1] ?? match[2] ?? match[3])!.toLowerCase() as "high" | "medium" | "low";
    counts[level]++;
  }
  const total = counts.high + counts.medium + counts.low;
  if (total === 0) return undefined;
  // Return the most frequent confidence level
  if (counts.low >= counts.high && counts.low >= counts.medium) return "low";
  if (counts.medium >= counts.high) return "medium";
  return "high";
}

// -- Convergence Detection --

/**
 * Levenshtein distance between two strings.
 * Direct implementation — no external packages (Bun-first).
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use single-row optimization: O(n) space instead of O(m*n)
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,      // deletion
        curr[j - 1]! + 1,  // insertion
        prev[j - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * Check if all workers have converged (change rate below threshold).
 * Returns true if convergence detected.
 */
function checkConvergence(
  currentRound: Round,
  previousRound: Round,
  threshold: number,
): boolean {
  for (const current of currentRound.responses) {
    const previous = previousRound.responses.find(
      (r) => r.workerIndex === current.workerIndex,
    );
    if (!previous) return false; // New worker — not converged
    const maxLen = Math.max(current.content.length, previous.content.length);
    if (maxLen === 0) continue;
    const distance = levenshteinDistance(current.content, previous.content);
    const changeRate = distance / maxLen;
    if (changeRate >= threshold) return false;
  }
  return currentRound.responses.length > 0;
}

// -- Per-Round Technique Resolution --

/**
 * Resolve technique for a given round index.
 * Single value: same for all rounds. Array: per-round, last repeats on exhaustion.
 * Empty array or undefined: no technique.
 */
function resolveTechnique(
  technique: InteractionTechnique | readonly InteractionTechnique[] | undefined,
  roundIndex: number,
): InteractionTechnique | undefined {
  if (!technique) return undefined;
  if (typeof technique === "string") return technique;
  if (technique.length === 0) return undefined;
  return roundIndex < technique.length
    ? technique[roundIndex]
    : technique[technique.length - 1];
}

// -- FallbackPool Implementation --

/**
 * Provider-scoped error types: failures likely affect all models from the same provider.
 */
function isProviderScopedError(errorType: CooldownErrorType): boolean {
  return errorType === "rate_limit" || errorType === "auth_error" || errorType === "server_error";
}

/**
 * Create a FallbackPool from a set of candidate models and a CooldownManager.
 * Claim semantics: getNext() removes claimed model from candidates.
 */
export function createFallbackPool(
  candidates: ModelInfo[],
  cooldown: CooldownManager,
): FallbackPool {
  const remaining = new Set(candidates);

  return {
    getNext(excludeIds: Set<string>): ModelInfo | undefined {
      for (const model of remaining) {
        if (!excludeIds.has(model.id) && !cooldown.isOnCooldown(model.id)) {
          remaining.delete(model); // Claim — prevents concurrent double-assignment
          return model;
        }
      }
      return undefined;
    },
    markFailed(modelId: string, reason: string, errorType: CooldownErrorType): void {
      cooldown.add(modelId, reason, errorType);
      if (isProviderScopedError(errorType)) {
        cooldown.addProvider(modelId, reason);
      }
    },
    isOnCooldown(modelId: string): boolean {
      return cooldown.isOnCooldown(modelId);
    },
    getEntry(modelId: string): CooldownEntry | undefined {
      return cooldown.getEntry(modelId);
    },
  };
}

// -- Per-Worker Fallback --

interface WorkerCallResult {
  response?: WorkerResponse;
  failed: boolean;
  degenerate?: boolean;
  swaps: ModelSwap[];
  tokens: TokenUsage;
  /** Full message history (sent messages + assistant response) for session continuation. */
  history?: ChatMessage[];
}

/**
 * Call a worker with per-worker fallback on failure.
 * Tries the original model, then falls back to pool candidates until one succeeds or pool exhausts.
 */
interface FallbackResult {
  readonly id: string;
}

/**
 * 3-phase fallback model lookup:
 * 1. Unique model from pool (prefer diversity)
 * 2. Team-duplicate model from pool (allow reuse)
 * 3. Alive team member directly (bypass pool, last resort for when pool is exhausted)
 */
function findFallbackModel(
  pool: FallbackPool,
  excludeIds: Set<string>,
  ctx: SharedContext,
): FallbackResult | undefined {
  // Phase 1: unique model (exclude team members)
  const teamExclude = new Set([
    ...excludeIds,
    ...ctx.team.workers.map((w) => w.model),
  ]);
  const unique = pool.getNext(teamExclude);
  if (unique) return unique;

  // Phase 2: team-duplicate from pool (only exclude failed models)
  const duplicate = pool.getNext(excludeIds);
  if (duplicate) return duplicate;

  // Phase 3: reuse alive team member directly (pool exhausted)
  // Find any team model that isn't failed and isn't on cooldown
  for (const worker of ctx.team.workers) {
    if (!excludeIds.has(worker.model) && !pool.isOnCooldown(worker.model)) {
      return { id: worker.model };
    }
  }

  return undefined;
}

async function callWithFallback(
  participant: TeamMember,
  workerIndex: number,
  ctx: SharedContext,
  roundNumber: number,
  deps: EngineDeps,
  config: EngineConfig,
  input: DeliberateInput,
  pool: FallbackPool | undefined,
  /** Previous message history for session continuation in R2+. */
  previousHistory?: ChatMessage[],
  /** Technique for this round (resolved by caller). */
  technique?: InteractionTechnique,
): Promise<WorkerCallResult> {
  const roundInfo: RoundInfo = { current: roundNumber, max: config.maxRounds };
  const isDebateR2 = config.protocol === "debate" && roundNumber > 1;
  const swaps: ModelSwap[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  // Session history — invalidated when model changes (replacement can't continue another model's session)
  let activeHistory = previousHistory;

  // Build messages — session continuation if history exists and model unchanged, full rebuild otherwise
  const buildMessages = (): ChatMessage[] => {
    // Session continuation: append follow-up to existing history (only if same model)
    if (isDebateR2 && activeHistory && deps.buildDebateFollowUp) {
      const lastRound = ctx.rounds[ctx.rounds.length - 1];
      const otherResponses = lastRound
        ? lastRound.responses.filter((r) => r.workerIndex !== workerIndex)
        : [];
      const followUp = deps.buildDebateFollowUp(ctx, otherResponses, roundInfo, input.workerInstructions, technique);
      return [...activeHistory, followUp];
    }
    // Full rebuild: cold join, model swapped, or no history available
    if (isDebateR2 && deps.buildDebateWorkerMessages) {
      return deps.buildDebateWorkerMessages(ctx, input.workerInstructions, roundInfo, workerIndex, technique);
    }
    return deps.buildWorkerMessages(ctx, input.workerInstructions, roundInfo, workerIndex, technique);
  };

  // Try original model
  let currentModel = participant.model;

  // Attempt loop: original → fallback1 → fallback2 → ...
  const excludeIds = new Set<string>();

  // #10: If the original model is already on cooldown (e.g., failed in previous round),
  // skip directly to fallback without wasting an API call.
  if (pool?.isOnCooldown(currentModel)) {
    excludeIds.add(currentModel);
    const next = findFallbackModel(pool, excludeIds, ctx);

    const priorEntry = pool.getEntry(currentModel);
    swaps.push({
      original: currentModel,
      replacement: next?.id,
      round: roundNumber,
      error: priorEntry?.reason ?? "model on cooldown from previous round",
      errorCode: priorEntry?.errorType ?? "unknown",
      retryable: priorEntry ? isRetryableError(priorEntry.errorType) : false,
    });

    if (!next) {
      return { failed: true, swaps, tokens: { input: totalInput, output: totalOutput } };
    }

    currentModel = next.id;
    activeHistory = undefined; // Model changed — can't continue another model's session
  }

  while (true) {
    try {
      const messages = buildMessages();
      const result = await deps.chat(currentModel, messages, config.workerGenParams);
      totalInput += result.inputTokens;
      totalOutput += result.outputTokens;

      const isDegenerate = result.content.trim().length < MIN_WORKER_RESPONSE_LENGTH;

      if (isDegenerate && pool) {
        // Degenerate = quality issue. Treat like an error for fallback purposes:
        // try the next model from the pool instead of returning a useless response.
        const degenerateMsg = `degenerate response (below ${MIN_WORKER_RESPONSE_LENGTH} chars)`;
        // Don't propagate to provider level — degenerate is model-specific, not provider-wide.
        excludeIds.add(currentModel);

        const next = findFallbackModel(pool, excludeIds, ctx);

        swaps.push({
          original: currentModel,
          replacement: next?.id,
          round: roundNumber,
          error: degenerateMsg,
        });

        if (!next) {
          // Pool exhausted — return degenerate as-is
          return {
            response: { model: currentModel, content: result.content, workerIndex },
            failed: false,
            degenerate: true,
            swaps,
            tokens: { input: totalInput, output: totalOutput },
          };
        }

        currentModel = next.id;
        activeHistory = undefined; // Model changed — cold join via debate builder
        continue; // retry with fallback model
      }

      // Build conversation history for session continuation in next round
      const fullHistory = [...messages, { role: "assistant" as const, content: result.content }];

      return {
        response: { model: currentModel, content: result.content, workerIndex },
        failed: false,
        degenerate: isDegenerate,
        swaps,
        tokens: { input: totalInput, output: totalOutput },
        history: fullHistory,
      };
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      const errorMsg = normalizeErrorMessage(rawMsg);
      const llmError = findLLMClientError(error);
      const errorType = classifyError(error);
      const retryable = isRetryableError(errorType);

      // No pool → can't fallback
      if (!pool) {
        swaps.push({
          original: currentModel,
          round: roundNumber,
          error: errorMsg,
          errorCode: errorType,
          retryable,
          ...(llmError ? { httpStatus: llmError.status } : {}),
        });
        return { failed: true, swaps, tokens: { input: totalInput, output: totalOutput } };
      }

      // Scope cooldown by error type.
      // Provider-scoped (429, 401, 5xx) → all models from provider cooled.
      // Model-scoped (404, timeout, degenerate) → only this model cooled.
      pool.markFailed(currentModel, errorMsg, errorType);
      excludeIds.add(currentModel);

      // Try next from pool — prefer unique, allow team duplicate, last resort reuse alive team member
      const next = findFallbackModel(pool, excludeIds, ctx);

      swaps.push({
        original: currentModel,
        replacement: next?.id,
        round: roundNumber,
        error: errorMsg,
        errorCode: errorType,
        retryable,
        ...(llmError ? { httpStatus: llmError.status } : {}),
      });

      if (!next) {
        // Pool exhausted — empty slot
        return { failed: true, swaps, tokens: { input: totalInput, output: totalOutput } };
      }

      // Swap to next model — invalidate session, cold join via debate builder
      currentModel = next.id;
      activeHistory = undefined;
    }
  }
}

// -- Round Execution --

/**
 * Execute a single deliberation round:
 *   1. Workers respond in parallel with per-worker fallback (callWithFallback)
 *   2. Collect responses, track failures and swaps
 */
export async function executeRound(
  ctx: SharedContext,
  roundNumber: number,
  deps: EngineDeps,
  config: EngineConfig,
  input: DeliberateInput,
  pool?: FallbackPool,
  /** Per-worker message histories from previous rounds for session continuation. */
  workerHistories?: ReadonlyMap<number, ChatMessage[]>,
  /** Technique for this round (resolved by caller). */
  technique?: InteractionTechnique,
): Promise<{ round: Round; tokens: TokenUsage; modelSwaps: ModelSwap[]; histories: Map<number, ChatMessage[]> }> {
  const divergeParticipants = [...ctx.team.workers];

  // All workers run in parallel, each with its own fallback chain
  const results = await Promise.allSettled(
    divergeParticipants.map((participant, index) =>
      callWithFallback(participant, index, ctx, roundNumber, deps, config, input, pool,
        workerHistories?.get(index), technique),
    ),
  );

  // Collect results
  const responses: WorkerResponse[] = [];
  const failedWorkers: FailedWorker[] = [];
  const allSwaps: ModelSwap[] = [];
  const histories = new Map<number, ChatMessage[]>();
  let totalInput = 0;
  let totalOutput = 0;

  for (let idx = 0; idx < results.length; idx++) {
    const result = results[idx]!;
    if (result.status === "fulfilled") {
      const wr = result.value;
      totalInput += wr.tokens.input;
      totalOutput += wr.tokens.output;
      allSwaps.push(...wr.swaps);
      // Store history for session continuation (skip degenerate — broken context)
      if (wr.history && !wr.degenerate) histories.set(idx, wr.history);
      if (wr.response && !wr.degenerate) {
        responses.push(wr.response);
      } else if (wr.response && wr.degenerate) {
        // Degenerate = quality issue, not error. Include in failedWorkers for tracking
        // but don't trigger fallback.
        failedWorkers.push({
          model: wr.response.model,
          error: `degenerate response (below ${MIN_WORKER_RESPONSE_LENGTH} chars)`,
          errorCode: "degenerate",
          retryable: false,
        });
      } else {
        // All fallbacks exhausted → empty slot
        const lastSwap = wr.swaps[wr.swaps.length - 1];
        failedWorkers.push({
          model: divergeParticipants[idx]!.model,
          error: lastSwap?.error ?? "unknown error",
          errorCode: lastSwap?.errorCode,
          retryable: lastSwap?.retryable,
        });
      }
    } else {
      // callWithFallback itself shouldn't throw, but handle defensively
      const model = divergeParticipants[idx]!.model;
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failedWorkers.push({ model, error: normalizeErrorMessage(reason) });
    }
  }

  // Guard: all workers produced no responses
  if (responses.length === 0 && divergeParticipants.length > 0) {
    throw new RoundExecutionError(
      "worker",
      failedWorkers[0]?.model ?? divergeParticipants[0]!.model,
      new Error(`All ${divergeParticipants.length} worker(s) failed after fallback exhaustion`),
      { input: totalInput, output: totalOutput },
      allSwaps,
    );
  }

  return {
    round: {
      number: roundNumber,
      responses,
      ...(failedWorkers.length > 0 ? { failedWorkers } : {}),
    },
    tokens: { input: totalInput, output: totalOutput },
    modelSwaps: allSwaps,
    histories,
  };
}

// -- Main Entry Point --

/**
 * Run the full multi-round deliberation loop.
 *
 * @param team - Pre-composed team (workers only).
 * @param input - Task, optional instructions.
 * @param deps - Injected LLM chat + prompt builders.
 * @param config - Optional engine config (defaults: maxRounds=1).
 * @param fallbackDeps - Optional fallback pool for per-worker model replacement.
 */
export async function deliberate(
  team: TeamComposition,
  input: DeliberateInput,
  deps: EngineDeps,
  config?: EngineConfig,
  fallbackDeps?: FallbackDeps,
): Promise<DeliberateOutput> {
  const cfg = config ?? DEFAULT_CONFIG;
  let currentTeam = team;
  let ctx = createSharedContext(input.task, currentTeam, input.taskNature, input.domain);
  let accTokens: TokenUsage = { input: 0, output: 0 };
  const allRounds: Round[] = [];
  const allModels = new Set<string>();
  const allModelSwaps: ModelSwap[] = [];
  let allLLMCalls = 0;
  const originalTeamSize = team.workers.length;
  const minViable = minViableTeamSize(originalTeamSize);
  let workerHistories: Map<number, ChatMessage[]> | undefined;

  // Determine if convergence detection should be active
  // Disabled when per-round technique array is specified (host's sequence is intentional)
  const isPerRoundTechniqueArray = Array.isArray(input.technique) && input.technique.length > 0;
  const convergenceEnabled = !isPerRoundTechniqueArray;

  for (let i = 1; i <= cfg.maxRounds; i++) {
    const roundTechnique = resolveTechnique(input.technique, i - 1);

    let roundResult = await executeRound(
      ctx, ctx.rounds.length + 1, deps, cfg, input, fallbackDeps?.pool,
      workerHistories, roundTechnique,
    );
    // Update worker histories for session continuation in next round
    workerHistories = roundResult.histories;

    accTokens = {
      input: accTokens.input + roundResult.tokens.input,
      output: accTokens.output + roundResult.tokens.output,
    };
    allModelSwaps.push(...roundResult.modelSwaps);

    // Replenishment: if slots are empty and replenish callback exists, fill from alive providers.
    const activeCount = roundResult.round.responses.length;
    const emptySlots = originalTeamSize - activeCount;
    let replenishedResponses: WorkerResponse[] = [];
    if (emptySlots > 0 && fallbackDeps?.replenish && i === 1) {
      const aliveProviders = new Set(
        roundResult.round.responses.map((r) => extractProvider(r.model)),
      );
      const respondedModels = new Set(
        roundResult.round.responses.map((r) => r.model),
      );
      const replacements = fallbackDeps.replenish(aliveProviders, emptySlots, respondedModels);
      if (replacements.length > 0) {
        const replenishResults = await Promise.allSettled(
          replacements.map((member, idx) =>
            callWithFallback(
              member, originalTeamSize + idx, ctx, ctx.rounds.length + 1,
              deps, cfg, input, fallbackDeps?.pool,
            ),
          ),
        );
        for (const repResult of replenishResults) {
          if (repResult.status === "fulfilled" && repResult.value.response && !repResult.value.degenerate) {
            replenishedResponses.push(repResult.value.response);
            accTokens = {
              input: accTokens.input + repResult.value.tokens.input,
              output: accTokens.output + repResult.value.tokens.output,
            };
            allModelSwaps.push(...repResult.value.swaps);
            // Store replenishment history for session continuation in R2+
            if (repResult.value.history && workerHistories) {
              workerHistories.set(repResult.value.response.workerIndex, repResult.value.history);
            }
          }
        }
      }
    }

    // Merge replenished responses into round result + expand team
    if (replenishedResponses.length > 0) {
      roundResult = {
        ...roundResult,
        round: {
          ...roundResult.round,
          responses: [...roundResult.round.responses, ...replenishedResponses],
        },
      };
    }

    // Check team viability: abort if active workers < min_viable
    // Only enforce for teams of 3+; smaller teams use existing all-fail guard.
    const finalActiveCount = roundResult.round.responses.length;
    if (originalTeamSize >= 3 && finalActiveCount > 0 && finalActiveCount < minViable) {
      const lostSlots = (roundResult.round.failedWorkers ?? []).map((fw) => ({
        model: fw.model,
        reason: fw.error,
      }));
      throw new TeamDegradedError(
        originalTeamSize, finalActiveCount, lostSlots, accTokens, allModelSwaps,
        roundResult.round,
      );
    }

    // Update team from actual round responses — the response's model is the FINAL
    // model that succeeded (after all fallback hops). This correctly handles multi-hop
    // swap chains (A→B→C→D) where the swap map would only resolve to the first hop.
    // Also incorporates replenished workers into the team for subsequent rounds.
    {
      let teamChanged = false;
      const updatedWorkers = currentTeam.workers.map((w, idx) => {
        const resp = roundResult.round.responses.find((r) => r.workerIndex === idx);
        if (resp && resp.model !== w.model) {
          teamChanged = true;
          return { model: resp.model, role: "worker" as const };
        }
        return w;
      });

      // Add replenished workers to team (workerIndex >= originalTeamSize)
      for (const resp of replenishedResponses) {
        updatedWorkers.push({ model: resp.model, role: "worker" as const });
        teamChanged = true;
      }

      if (teamChanged) {
        currentTeam = { workers: updatedWorkers };
        const prevRounds = [...ctx.rounds];
        ctx = createSharedContext(input.task, currentTeam, input.taskNature, input.domain);
        for (const prevRound of prevRounds) {
          ctx = addRound(ctx, prevRound);
        }
      }
    }

    // Parse confidence from worker responses
    const responsesWithConfidence = roundResult.round.responses.map((resp) => ({
      ...resp,
      confidence: parseConfidence(resp.content),
    }));
    const roundWithConfidence: Round = {
      ...roundResult.round,
      responses: responsesWithConfidence,
    };

    ctx = addRound(ctx, roundWithConfidence);

    // Accumulate metadata
    allRounds.push(roundWithConfidence);
    allLLMCalls += roundWithConfidence.responses.length + (roundWithConfidence.failedWorkers?.length ?? 0);
    for (const resp of roundWithConfidence.responses) allModels.add(resp.model);

    // Convergence detection (early termination)
    if (convergenceEnabled && i > 1 && i < cfg.maxRounds) {
      const previousRound = allRounds[allRounds.length - 2];
      if (previousRound && checkConvergence(roundWithConfidence, previousRound, CONVERGENCE_THRESHOLD)) {
        break;
      }
    }
  }

  // -- Assemble output --
  const roundsSummary = allRounds.map((r, idx) => ({
    number: idx + 1,
    responses: r.responses.map((resp) => ({
      model: resp.model,
      content: resp.content,
      ...(resp.confidence ? { confidence: resp.confidence } : {}),
    })),
    ...(r.failedWorkers?.length ? { failedWorkers: r.failedWorkers } : {}),
  }));

  const usedModelsList = [...allModels];
  const providers = new Set(usedModelsList.map(extractProvider));
  const warnings: string[] = [];
  if (providers.size < 2 && usedModelsList.length >= 2) {
    warnings.push(`provider_diversity_low: ${providers.size} provider(s) — minimum 2 recommended`);
  }

  // Build degradation metadata if team shrank
  const lastRound = allRounds[allRounds.length - 1];
  const finalActiveCount = lastRound ? lastRound.responses.length : 0;
  const degradation: Degradation | undefined =
    finalActiveCount < originalTeamSize
      ? {
          originalTeamSize,
          activeTeamSize: finalActiveCount,
          lostSlots: (lastRound?.failedWorkers ?? []).map((fw) => ({
            model: fw.model,
            reason: fw.error,
          })),
        }
      : undefined;

  if (degradation) {
    warnings.push(`team_degraded: ${degradation.activeTeamSize}/${degradation.originalTeamSize} workers active`);
  }

  return {
    roundsExecuted: allRounds.length,
    totalTokens: accTokens,
    totalLLMCalls: allLLMCalls,
    modelsUsed: usedModelsList,
    rounds: roundsSummary,
    ...(allModelSwaps.length > 0 ? { modelSwaps: allModelSwaps } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(degradation ? { degradation } : {}),
  };
}
