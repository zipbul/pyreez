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
  ModelSwap,
  Protocol,
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
  /** Get next available model from a specific provider. Claimed on return. */
  getNextByProvider(provider: string, excludeIds: Set<string>): ModelInfo | undefined;
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
  /** Build R1 messages for a protocol. */
  readonly buildR1Messages: (
    ctx: SharedContext,
    instructions?: string,
    roundInfo?: RoundInfo,
    workerIndex?: number,
  ) => ChatMessage[];
  /** Build R2+ messages with other workers' responses (full rebuild). */
  readonly buildR2Messages?: (
    ctx: SharedContext,
    otherResponses: readonly WorkerResponse[],
    ownPrevious: WorkerResponse | undefined,
    instructions?: string,
    roundInfo?: RoundInfo,
    workerIndex?: number,
  ) => ChatMessage[];
  /** Build follow-up message for session continuation in R2+. */
  readonly buildFollowUp?: (
    ctx: SharedContext,
    otherResponses: readonly WorkerResponse[],
    instructions?: string,
    roundInfo?: RoundInfo,
    workerIndex?: number,
  ) => ChatMessage;
}

/**
 * Engine configuration.
 */
export interface EngineConfig {
  readonly maxRounds: number;
  readonly protocol: Protocol;
  /** Generation params for worker LLM calls. */
  readonly workerGenParams?: GenerationParams;
}

/** Default convergence threshold for early termination. */
const CONVERGENCE_THRESHOLD = 0.15;

const DEFAULT_CONFIG: EngineConfig = {
  maxRounds: 1,
  protocol: "shared_convergence",
};

// -- Confidence Parsing --

/**
 * Parse explicit confidence markers from worker response text.
 * Only matches explicit markers — does not infer from hedging language.
 */
export function parseConfidence(text: string): "high" | "medium" | "low" | undefined {
  const normalized = text.toLowerCase();
  // Match patterns: "HIGH confidence", "confidence: HIGH", "HIGH:", "[HIGH]", "**HIGH**",
  // Korean labels: "신뢰도: HIGH" (confidence-related Korean labels only)
  const pattern = /\b(high|medium|low)\s*(?:confidence|:)|\bconfidence\s*:\s*(high|medium|low)\b|\[(high|medium|low)\]|\*\*(high|medium|low)\*\*|신뢰도\s*:\s*(high|medium|low)\b/gi;
  const counts = { high: 0, medium: 0, low: 0 };
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    const level = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5])!.toLowerCase() as "high" | "medium" | "low";
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
/**
 * Compute R1 diversity score: average pairwise Levenshtein change rate across
 * all worker responses. 0.0 = identical, 1.0 = maximally different.
 * Returns null when fewer than 2 responses or all responses are empty.
 *
 * Demystifying MAD (arXiv 2601.19921, Jan 2026): initial answer diversity
 * correlates with debate success. Low R1 diversity is a leading indicator that
 * heterogeneous models converged before debate even started — usually because
 * the question pre-determined the answer. Host should reframe (see
 * HOST_QUESTIONING_DEPTH Rule 2).
 */
export function computeR1Diversity(round: Round): number | null {
  const responses = round.responses;
  if (responses.length < 2) return null;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < responses.length; i++) {
    for (let j = i + 1; j < responses.length; j++) {
      const a = responses[i]!.content;
      const b = responses[j]!.content;
      const maxLen = Math.max(a.length, b.length);
      if (maxLen === 0) continue;
      sum += levenshteinDistance(a, b) / maxLen;
      pairs++;
    }
  }
  if (pairs === 0) return null;
  return sum / pairs;
}

/**
 * Detect minority dissent — when N-1 workers cluster on the same answer and
 * one outlier disagrees with HIGH confidence, surface the outlier so the host
 * doesn't auto-trust the majority.
 *
 * Defense against debate hacking (arXiv 2510.20963) and the "majority pressure
 * suppresses correct minority" failure documented in arXiv 2509.11035 (ConfMAD)
 * and "Can LLM Agents Really Debate?" (arXiv 2511.07784).
 *
 * Heuristic: requires N≥3. Compute each response's average distance to peers.
 * If exactly one response has avg distance > 0.50 AND all the rest cluster
 * (avg pairwise distance < 0.30) AND the outlier reports HIGH confidence,
 * emit a warning naming the dissenter.
 */
export function detectMinorityDissent(round: Round): string | null {
  const responses = round.responses;
  if (responses.length < 3) return null;

  const avgDistTo = (i: number): number => {
    let sum = 0;
    let count = 0;
    for (let j = 0; j < responses.length; j++) {
      if (i === j) continue;
      const a = responses[i]!.content;
      const b = responses[j]!.content;
      const maxLen = Math.max(a.length, b.length);
      if (maxLen === 0) continue;
      sum += levenshteinDistance(a, b) / maxLen;
      count++;
    }
    return count === 0 ? 0 : sum / count;
  };

  const distances = responses.map((_, i) => avgDistTo(i));
  // Find the response with the highest avg distance to peers
  let outlierIdx = 0;
  for (let i = 1; i < distances.length; i++) {
    if (distances[i]! > distances[outlierIdx]!) outlierIdx = i;
  }
  if (distances[outlierIdx]! < 0.50) return null;

  // Check the rest cluster tightly
  const rest = responses.filter((_, i) => i !== outlierIdx);
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      const a = rest[i]!.content;
      const b = rest[j]!.content;
      const maxLen = Math.max(a.length, b.length);
      if (maxLen === 0) continue;
      const rate = levenshteinDistance(a, b) / maxLen;
      if (rate >= 0.30) return null; // rest don't cluster
    }
  }

  const outlier = responses[outlierIdx]!;
  if (outlier.confidence !== "high") return null;

  return `minority_dissent: worker ${outlier.model} (HIGH confidence) disagrees with the majority cluster — review the dissent before adopting the majority position. Majority pressure can suppress correct minority answers (ConfMAD arXiv 2509.11035, debate hacking arXiv 2510.20963).`;
}

/**
 * Detect R1 conformity — all workers report HIGH confidence AND their responses
 * are textually similar (Levenshtein change rate < 0.30 between every pair).
 *
 * Signal of the failure mode in arXiv 2509.14034 (ConfMAD): when most agents
 * agree confidently in R1, debate may be locked in even if the consensus is wrong.
 * Returns a warning string for the host, or null when the signal is absent.
 */
export function detectConformity(round: Round): string | null {
  const responses = round.responses;
  if (responses.length < 2) return null;
  if (!responses.every((r) => r.confidence === "high")) return null;

  const CONFORMITY_THRESHOLD = 0.30;
  let pairs = 0;
  for (let i = 0; i < responses.length; i++) {
    for (let j = i + 1; j < responses.length; j++) {
      const a = responses[i]!.content;
      const b = responses[j]!.content;
      const maxLen = Math.max(a.length, b.length);
      if (maxLen === 0) continue;
      const rate = levenshteinDistance(a, b) / maxLen;
      if (rate >= CONFORMITY_THRESHOLD) return null;
      pairs++;
    }
  }
  if (pairs === 0) return null;
  return `r1_conformity_suspected: all ${responses.length} workers reported HIGH confidence with textually similar answers — verify minority dissent was not suppressed (ConfMAD arXiv 2509.14034).`;
}

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
          remaining.delete(model);
          return model;
        }
      }
      return undefined;
    },
    getNextByProvider(provider: string, excludeIds: Set<string>): ModelInfo | undefined {
      for (const model of remaining) {
        if (model.provider === provider && !excludeIds.has(model.id) && !cooldown.isOnCooldown(model.id)) {
          remaining.delete(model);
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
  /** Provider of the failed model — prefer same provider first. */
  failedProvider?: string,
): FallbackResult | undefined {
  const teamIds = new Set(ctx.team.workers.map((w) => w.model));
  const teamExclude = new Set([...excludeIds, ...teamIds]);

  // Phase 1: same provider, not on team (preserve provider diversity)
  if (failedProvider) {
    const sameProvider = pool.getNextByProvider(failedProvider, teamExclude);
    if (sameProvider) return sameProvider;
  }

  // Phase 2: any unique model not on team
  const unique = pool.getNext(teamExclude);
  if (unique) return unique;

  // Phase 3: team-duplicate from pool (only exclude failed models)
  const duplicate = pool.getNext(excludeIds);
  if (duplicate) return duplicate;

  // Phase 4: reuse alive team member directly (pool exhausted)
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
): Promise<WorkerCallResult> {
  const roundInfo: RoundInfo = { current: roundNumber, max: config.maxRounds };
  const isR2Plus = roundNumber > 1;
  const swaps: ModelSwap[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  // Session history — invalidated when model changes (replacement can't continue another model's session)
  let activeHistory = previousHistory;

  // Build messages — session continuation if history exists and model unchanged, full rebuild otherwise
  const buildMessages = (): ChatMessage[] => {
    // Session continuation: append follow-up to existing history (only if same model)
    if (isR2Plus && activeHistory && deps.buildFollowUp) {
      const lastRound = ctx.rounds[ctx.rounds.length - 1];
      // Sparse sharing for session continuation
      const otherResponses = sparseSelect(lastRound?.responses ?? [], workerIndex, 2);
      const followUp = deps.buildFollowUp(ctx, otherResponses, input.workerInstructions, roundInfo, workerIndex);
      return [...activeHistory, followUp];
    }
    // Full rebuild: cold join, model swapped, or R2+ without session
    if (isR2Plus && deps.buildR2Messages) {
      const lastRound = ctx.rounds[ctx.rounds.length - 1];
      // Sparse sharing: each worker sees at most 2 others (GroupDebate-inspired)
      const otherResponses = sparseSelect(lastRound?.responses ?? [], workerIndex, 2);
      const ownPrevious = lastRound
        ? lastRound.responses.find((r) => r.workerIndex === workerIndex)
        : undefined;
      return deps.buildR2Messages(ctx, otherResponses, ownPrevious, input.workerInstructions, roundInfo, workerIndex);
    }
    return deps.buildR1Messages(ctx, input.workerInstructions, roundInfo, workerIndex);
  };

  // Try original model
  let currentModel = participant.model;

  // Attempt loop: original → fallback1 → fallback2 → ...
  const excludeIds = new Set<string>();

  // #10: If the original model is already on cooldown (e.g., failed in previous round),
  // skip directly to fallback without wasting an API call.
  if (pool?.isOnCooldown(currentModel)) {
    excludeIds.add(currentModel);
    const next = findFallbackModel(pool, excludeIds, ctx, extractProvider(currentModel));

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

      // Empty response = model returned nothing useful. Treat as failure for fallback.
      if (!result.content.trim()) {
        throw new Error(`empty response from ${currentModel}`);
      }

      // Build conversation history for session continuation in next round
      const fullHistory = [...messages, { role: "assistant" as const, content: result.content }];

      return {
        response: {
          model: currentModel,
          content: result.content,
          workerIndex,
          ...(result.truncated ? { truncated: true } : {}),
        },
        failed: false,
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
      // Model-scoped (404, timeout) → only this model cooled.
      pool.markFailed(currentModel, errorMsg, errorType);
      excludeIds.add(currentModel);

      // Try next from pool — same provider first, then unique, then team duplicate
      const next = findFallbackModel(pool, excludeIds, ctx, extractProvider(currentModel));

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

// -- Protocol-Specific Round Execution --

type RoundResult = { round: Round; tokens: TokenUsage; modelSwaps: ModelSwap[]; histories: Map<number, ChatMessage[]> };

/**
 * Execute sequential refinement: workers run one at a time, each building on the previous.
 * Worker order: input.workerOrder or default [0, 1, 2, ...].
 */
async function executeSequentialRound(
  ctx: SharedContext,
  roundNumber: number,
  deps: EngineDeps,
  config: EngineConfig,
  input: DeliberateInput,
  pool?: FallbackPool,
): Promise<RoundResult> {
  const participants = [...ctx.team.workers];
  const order = input.workerOrder ?? participants.map((_, i) => i);
  const responses: WorkerResponse[] = [];
  const failedWorkers: FailedWorker[] = [];
  const allSwaps: ModelSwap[] = [];
  const histories = new Map<number, ChatMessage[]>();
  let totalInput = 0;
  let totalOutput = 0;
  let previousOutput: string | undefined;

  const { buildSequentialRefinementMessages } = await import("./prompts");

  for (const workerIdx of order) {
    const participant = participants[workerIdx];
    if (!participant) continue;

    // Override deps to inject sequential messages
    const seqDeps: EngineDeps = {
      ...deps,
      buildR1Messages: (seqCtx, instructions) =>
        buildSequentialRefinementMessages(seqCtx, previousOutput, instructions),
    };

    const wr = await callWithFallback(
      participant, workerIdx, ctx, roundNumber, seqDeps, config, input, pool,
    );

    totalInput += wr.tokens.input;
    totalOutput += wr.tokens.output;
    allSwaps.push(...wr.swaps);
    if (wr.history) histories.set(workerIdx, wr.history);

    if (wr.response) {
      responses.push(wr.response);
      previousOutput = wr.response.content;
    } else {
      const lastSwap = wr.swaps[wr.swaps.length - 1];
      failedWorkers.push({
        model: participant.model,
        error: lastSwap?.error ?? "unknown error",
        errorCode: lastSwap?.errorCode,
        retryable: lastSwap?.retryable,
      });
      // Sequential: skip failed worker, next worker uses last successful output
    }
  }

  if (responses.length === 0 && participants.length > 0) {
    throw new RoundExecutionError(
      "worker",
      failedWorkers[0]?.model ?? participants[0]!.model,
      new Error(`All ${participants.length} worker(s) failed in sequential refinement`),
      { input: totalInput, output: totalOutput },
      allSwaps,
    );
  }

  return {
    round: { number: roundNumber, responses, ...(failedWorkers.length > 0 ? { failedWorkers } : {}) },
    tokens: { input: totalInput, output: totalOutput },
    modelSwaps: allSwaps,
    histories,
  };
}

/**
 * Execute host interrogation: each worker gets a different question, workers isolated.
 */
async function executeInterrogationRound(
  ctx: SharedContext,
  roundNumber: number,
  deps: EngineDeps,
  config: EngineConfig,
  input: DeliberateInput,
  pool?: FallbackPool,
): Promise<RoundResult> {
  const participants = [...ctx.team.workers];
  const questions = input.questions ?? [];
  const { buildHostInterrogationMessages } = await import("./prompts");

  // Each worker gets a question with fallback support
  const results = await Promise.allSettled(
    participants.map((participant, index) => {
      const question = questions[index % Math.max(questions.length, 1)] ?? input.task;
      const prevExchanges = input.previousExchanges?.[index];

      // Override deps to inject interrogation messages
      const interrogDeps: EngineDeps = {
        ...deps,
        buildR1Messages: () => buildHostInterrogationMessages(ctx.task, question, prevExchanges),
      };

      return callWithFallback(participant, index, ctx, roundNumber, interrogDeps, config, input, pool);
    }),
  );

  return collectRoundResults(results, participants, roundNumber);
}

/**
 * Execute evaluation scoring: workers evaluate independently + aggregation.
 */
async function executeEvaluationRound(
  ctx: SharedContext,
  roundNumber: number,
  deps: EngineDeps,
  config: EngineConfig,
  input: DeliberateInput,
  pool?: FallbackPool,
): Promise<RoundResult> {
  const participants = [...ctx.team.workers];
  const criteria = input.criteria ?? "Evaluate the quality, correctness, and completeness.";
  const subject = input.subject ?? ctx.task;
  const { buildEvaluationScoringMessages } = await import("./prompts");

  const results = await Promise.allSettled(
    participants.map((participant, index) => {
      const evalDeps: EngineDeps = {
        ...deps,
        buildR1Messages: () => buildEvaluationScoringMessages(ctx.task, criteria, subject, input.workerInstructions),
      };
      return callWithFallback(participant, index, ctx, roundNumber, evalDeps, config, input, pool);
    }),
  );

  return collectRoundResults(results, participants, roundNumber);
}

/**
 * Execute red team: generators run first, then attackers receive generator outputs.
 * Odd rounds = generate, even rounds = attack.
 */
async function executeRedTeamRound(
  ctx: SharedContext,
  roundNumber: number,
  deps: EngineDeps,
  config: EngineConfig,
  input: DeliberateInput,
  pool?: FallbackPool,
): Promise<RoundResult> {
  const participants = [...ctx.team.workers];
  const roles = input.roles;
  const { buildRedTeamGeneratorMessages, buildRedTeamAttackerMessages } = await import("./prompts");

  const getRole = (idx: number): "generator" | "attacker" => {
    if (roles?.[idx]) return roles[idx]!;
    return idx < Math.ceil(participants.length / 2) ? "generator" : "attacker";
  };

  const isAttackRound = roundNumber % 2 === 0;
  const lastRound = ctx.rounds[ctx.rounds.length - 1];

  if (!isAttackRound || !lastRound) {
    // Generator round: only generators produce, attackers always skip
    const previousAttack = lastRound
      ? lastRound.responses.filter((r) => getRole(r.workerIndex) === "attacker").map((r) => r.content).join("\n\n---\n\n")
      : undefined;

    const results = await Promise.allSettled(
      participants.map((participant, index) => {
        if (getRole(index) === "attacker") {
          return Promise.resolve({ response: undefined, failed: false, swaps: [] as ModelSwap[], tokens: { input: 0, output: 0 } } as WorkerCallResult);
        }
        const genDeps: EngineDeps = {
          ...deps,
          buildR1Messages: () => buildRedTeamGeneratorMessages(ctx.task, input.workerInstructions, previousAttack || undefined),
        };
        return callWithFallback(participant, index, ctx, roundNumber, genDeps, config, input, pool);
      }),
    );

    return collectRoundResults(results, participants, roundNumber);
  } else {
    // Attack round: attackers analyze with fallback, generators skip
    const generatorOutputs = lastRound.responses
      .filter((r) => getRole(r.workerIndex) === "generator")
      .map((r) => r.content);

    const results = await Promise.allSettled(
      participants.map((participant, index) => {
        if (getRole(index) === "generator") {
          return Promise.resolve({ response: undefined, failed: false, swaps: [] as ModelSwap[], tokens: { input: 0, output: 0 } } as WorkerCallResult);
        }
        const atkDeps: EngineDeps = {
          ...deps,
          buildR1Messages: () => buildRedTeamAttackerMessages(ctx.task, generatorOutputs, input.workerInstructions),
        };
        return callWithFallback(participant, index, ctx, roundNumber, atkDeps, config, input, pool);
      }),
    );

    return collectRoundResults(results, participants, roundNumber);
  }
}

// -- Sparse Sharing --

/**
 * Select a sparse subset of other workers' responses for sharing.
 * GroupDebate-inspired: each worker sees at most `groupSize` others.
 */
function sparseSelect(
  allResponses: readonly WorkerResponse[],
  workerIndex: number,
  groupSize: number = 2,
): WorkerResponse[] {
  const others = allResponses.filter((r) => r.workerIndex !== workerIndex);
  if (others.length <= groupSize) return [...others];
  // Deterministic selection based on workerIndex to ensure reproducibility
  const selected: WorkerResponse[] = [];
  for (let i = 0; i < groupSize; i++) {
    const idx = (workerIndex + i + 1) % others.length;
    selected.push(others[idx]!);
  }
  return selected;
}

// -- Aggregation --

/**
 * Aggregate evaluation scoring results.
 */
function aggregateEvaluationResults(
  responses: readonly WorkerResponse[],
  method: import("./types").AggregationMethod,
) {
  const parsed = responses.map((r) => {
    const scoreMatch = r.content.match(/(?:score|rating|점수|overall)\s*[:=]?\s*(\d+(?:\.\d+)?)/i)
      ?? r.content.match(/(\d+(?:\.\d+)?)\s*(?:\/\s*10|out of 10)/i)
      ?? r.content.match(/\*\*(\d+(?:\.\d+)?)\*\*\s*\/\s*10/i);
    // Skip table rows (starting with |) — models sometimes emit tables after "verdict:"
    const verdictMatch = r.content.match(/(?:verdict|결론|판정)\s*[:=]?\s*([^|\n].+?)(?:\n|$)/i);
    const confidence = parseConfidence(r.content);
    return {
      model: r.model,
      score: scoreMatch ? parseFloat(scoreMatch[1]!) : undefined,
      verdict: verdictMatch ? verdictMatch[1]!.trim() : undefined,
      confidence,
    };
  });

  switch (method) {
    case "confidence_weighted": {
      // Weight scores by confidence level: HIGH=1.0, MEDIUM=0.6, LOW=0.3
      const weights: Record<string, number> = { high: 1.0, medium: 0.6, low: 0.3 };
      const withScores = parsed.filter((p) => p.score != null);
      if (withScores.length > 0) {
        const weightedSum = withScores.reduce((sum, p) => {
          const w = weights[p.confidence ?? "medium"] ?? 0.6;
          return sum + p.score! * w;
        }, 0);
        const totalWeight = withScores.reduce((sum, p) => {
          return sum + (weights[p.confidence ?? "medium"] ?? 0.6);
        }, 0);
        const weightedAvg = totalWeight > 0 ? weightedSum / totalWeight : 0;
        return {
          method,
          results: parsed.map((p) => ({
            model: p.model,
            ...(p.score != null ? { score: p.score } : {}),
            ...(p.verdict ? { verdict: p.verdict } : {}),
            ...(p.confidence ? { confidence: p.confidence } : {}),
          })),
          weightedScore: Math.round(weightedAvg * 100) / 100,
        };
      }
      break;
    }
    case "consensus": {
      // Check if all verdicts agree
      const verdicts = parsed.filter((p) => p.verdict).map((p) => p.verdict!.toLowerCase());
      const unique = new Set(verdicts);
      const consensusReached = unique.size === 1 && verdicts.length > 0;
      return {
        method,
        results: parsed.map((p) => ({
          model: p.model,
          ...(p.score != null ? { score: p.score } : {}),
          ...(p.verdict ? { verdict: p.verdict } : {}),
          ...(p.confidence ? { confidence: p.confidence } : {}),
        })),
        ...(consensusReached ? { consensus: verdicts[0] } : { consensus: undefined }),
      };
    }
    case "voting":
    default: {
      // Majority voting on verdicts
      const verdictCounts = new Map<string, number>();
      for (const p of parsed) {
        if (p.verdict) {
          const v = p.verdict.toLowerCase();
          verdictCounts.set(v, (verdictCounts.get(v) ?? 0) + 1);
        }
      }
      let topVerdict: string | undefined;
      let topCount = 0;
      for (const [v, c] of verdictCounts) {
        if (c > topCount) { topVerdict = v; topCount = c; }
      }
      return {
        method,
        results: parsed.map((p) => ({
          model: p.model,
          ...(p.score != null ? { score: p.score } : {}),
          ...(p.verdict ? { verdict: p.verdict } : {}),
          ...(p.confidence ? { confidence: p.confidence } : {}),
        })),
        ...(topVerdict ? { majorityVerdict: topVerdict, voteCount: topCount } : {}),
      };
    }
  }

  // Fallback (shouldn't reach here)
  return {
    method,
    results: parsed.map((p) => ({
      model: p.model,
      ...(p.score != null ? { score: p.score } : {}),
      ...(p.verdict ? { verdict: p.verdict } : {}),
      ...(p.confidence ? { confidence: p.confidence } : {}),
    })),
  };
}

// -- Result Collection Helper --

/**
 * Collect round results from Promise.allSettled of callWithFallback calls.
 * Shared by interrogation, evaluation, and red_team protocols.
 */
function collectRoundResults(
  results: PromiseSettledResult<WorkerCallResult>[],
  participants: readonly TeamMember[],
  roundNumber: number,
): RoundResult {
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
      if (wr.history) histories.set(idx, wr.history);
      if (wr.response) {
        responses.push(wr.response);
      } else if (wr.failed) {
        const lastSwap = wr.swaps[wr.swaps.length - 1];
        failedWorkers.push({
          model: participants[idx]!.model,
          error: lastSwap?.error ?? "unknown error",
          errorCode: lastSwap?.errorCode,
          retryable: lastSwap?.retryable,
        });
      }
      // else: skipped worker (e.g., red_team role mismatch) — not failed, just inactive
    } else {
      const model = participants[idx]!.model;
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failedWorkers.push({ model, error: normalizeErrorMessage(reason) });
    }
  }

  if (responses.length === 0 && participants.length > 0) {
    throw new RoundExecutionError(
      "worker",
      failedWorkers[0]?.model ?? participants[0]!.model,
      new Error(`All ${participants.length} worker(s) failed in round ${roundNumber}`),
      { input: totalInput, output: totalOutput },
      allSwaps,
    );
  }

  return {
    round: { number: roundNumber, responses, ...(failedWorkers.length > 0 ? { failedWorkers } : {}) },
    tokens: { input: totalInput, output: totalOutput },
    modelSwaps: allSwaps,
    histories,
  };
}

// -- Standard Round Execution --

/**
 * Execute a single deliberation round (parallel, with sparse sharing for R2+):
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
): Promise<{ round: Round; tokens: TokenUsage; modelSwaps: ModelSwap[]; histories: Map<number, ChatMessage[]> }> {
  const divergeParticipants = [...ctx.team.workers];

  // All workers run in parallel, each with its own fallback chain
  const results = await Promise.allSettled(
    divergeParticipants.map((participant, index) =>
      callWithFallback(participant, index, ctx, roundNumber, deps, config, input, pool,
        workerHistories?.get(index)),
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
      if (wr.history) histories.set(idx, wr.history);
      if (wr.response) {
        responses.push(wr.response);
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
  let ctx = createSharedContext(input.task, currentTeam, input.taskNature);
  let accTokens: TokenUsage = { input: 0, output: 0 };
  const allRounds: Round[] = [];
  const allModels = new Set<string>();
  const allModelSwaps: ModelSwap[] = [];
  let allLLMCalls = 0;
  const originalTeamSize = team.workers.length;
  const minViable = minViableTeamSize(originalTeamSize);
  let workerHistories: Map<number, ChatMessage[]> | undefined;

  // Convergence detection: active for shared_convergence, disabled for others
  const convergenceEnabled = cfg.protocol === "shared_convergence";

  for (let i = 1; i <= cfg.maxRounds; i++) {
    // Protocol-specific round execution
    let roundResult: RoundResult;
    switch (cfg.protocol) {
      case "sequential_refinement":
        roundResult = await executeSequentialRound(ctx, ctx.rounds.length + 1, deps, cfg, input, fallbackDeps?.pool);
        break;
      case "host_interrogation":
        roundResult = await executeInterrogationRound(ctx, ctx.rounds.length + 1, deps, cfg, input, fallbackDeps?.pool);
        break;
      case "evaluation_scoring":
        roundResult = await executeEvaluationRound(ctx, ctx.rounds.length + 1, deps, cfg, input, fallbackDeps?.pool);
        break;
      case "red_team":
        roundResult = await executeRedTeamRound(ctx, ctx.rounds.length + 1, deps, cfg, input, fallbackDeps?.pool);
        break;
      default:
        // shared_convergence, adversarial_debate: parallel with fallback
        roundResult = await executeRound(ctx, ctx.rounds.length + 1, deps, cfg, input, fallbackDeps?.pool, workerHistories);
        break;
    }
    // Update worker histories for session continuation in next round
    workerHistories = roundResult.histories;

    accTokens = {
      input: accTokens.input + roundResult.tokens.input,
      output: accTokens.output + roundResult.tokens.output,
    };
    allModelSwaps.push(...roundResult.modelSwaps);

    // Replenishment: if slots are empty and replenish callback exists, fill from alive providers.
    // Skip for red_team — intentional partial participation per round.
    const activeCount = roundResult.round.responses.length;
    const emptySlots = originalTeamSize - activeCount;
    let replenishedResponses: WorkerResponse[] = [];
    if (cfg.protocol !== "red_team" && emptySlots > 0 && fallbackDeps?.replenish && i === 1) {
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
          if (repResult.status === "fulfilled" && repResult.value.response) {
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
    // Skip for red_team — by design, each round uses a subset of workers.
    const finalActiveCount = roundResult.round.responses.length;
    if (cfg.protocol !== "red_team" && originalTeamSize >= 3 && finalActiveCount > 0 && finalActiveCount < minViable) {
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
        ctx = createSharedContext(input.task, currentTeam, input.taskNature);
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

    // Notify listener if streaming callback provided
    if (input.onRound) {
      input.onRound({
        number: i,
        protocol: cfg.protocol,
        responses: roundWithConfidence.responses.map((resp) => ({
          model: resp.model,
          content: resp.content,
          ...(resp.confidence ? { confidence: resp.confidence } : {}),
        })),
        ...(roundWithConfidence.failedWorkers?.length
          ? { failedWorkers: roundWithConfidence.failedWorkers }
          : {}),
      });
    }

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
    protocol: cfg.protocol,
    responses: r.responses.map((resp) => ({
      model: resp.model,
      content: resp.content,
      ...(resp.confidence ? { confidence: resp.confidence } : {}),
      ...(resp.truncated ? { truncated: true } : {}),
    })),
    ...(r.failedWorkers?.length ? { failedWorkers: r.failedWorkers } : {}),
  }));

  const usedModelsList = [...allModels];
  const providers = new Set(usedModelsList.map(extractProvider));
  const warnings: string[] = [];
  if (providers.size < 2 && usedModelsList.length >= 2) {
    warnings.push(`provider_diversity_low: ${providers.size} provider(s) — minimum 2 recommended`);
  }

  // R1 conformity + diversity signals — only meaningful for protocols that share positions
  const r1 = allRounds[0];
  let r1Diversity: number | null | undefined = undefined;
  if (r1 && r1.responses.length >= 2 && (cfg.protocol === "shared_convergence" || cfg.protocol === "adversarial_debate")) {
    const conformityWarning = detectConformity(r1);
    if (conformityWarning) warnings.push(conformityWarning);

    r1Diversity = computeR1Diversity(r1);
    if (r1Diversity !== null && r1Diversity < 0.20) {
      warnings.push(`r1_diversity_low: score=${r1Diversity.toFixed(2)} — heterogeneous models converged before debate. Reframe the task to ask for failure conditions or boundaries (HOST_QUESTIONING_DEPTH Rule 2).`);
    }

    const dissentWarning = detectMinorityDissent(r1);
    if (dissentWarning) warnings.push(dissentWarning);
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

  // Aggregation for evaluation_scoring
  const aggregation = cfg.protocol === "evaluation_scoring" && allRounds.length > 0
    ? aggregateEvaluationResults(
        allRounds[allRounds.length - 1]!.responses,
        input.aggregation ?? "voting",
      )
    : undefined;

  return {
    roundsExecuted: allRounds.length,
    totalTokens: accTokens,
    totalLLMCalls: allLLMCalls,
    modelsUsed: usedModelsList,
    protocol: cfg.protocol,
    rounds: roundsSummary,
    ...(allModelSwaps.length > 0 ? { modelSwaps: allModelSwaps } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(degradation ? { degradation } : {}),
    ...(aggregation ? { aggregation } : {}),
    ...(r1Diversity !== undefined ? { r1Diversity } : {}),
  };
}
