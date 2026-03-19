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
  DeliberateInput,
  DeliberateOutput,
  GenerationParams,
  ModelSwap,
  Round,
  SharedContext,
  TeamComposition,
  TeamMember,
  TokenUsage,
  WorkerResponse,
} from "./types";
import { assignWorkerRole } from "./prompts";
import {
  createSharedContext,
  addRound,
} from "./shared-context";
import { extractProvider } from "./provider-util";
import { findLLMClientError, type CooldownManager } from "./cooldown";

import type { RoundInfo } from "./prompts";

// Re-export ChatResult from canonical location for backward compatibility
export type { ChatResult } from "../axis/types";
import type { ChatResult } from "../axis/types";

// -- Constants --

/**
 * Minimum character length for a valid worker response.
 * Responses shorter than this are treated as degenerate (empty, provider failure, etc.)
 * and excluded. Workers are instructed of this requirement in their prompts.
 */
export const MIN_WORKER_RESPONSE_LENGTH = 200;

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
  /** Mark failure with provider-level propagation (all models from same provider cooled). */
  markFailed(modelId: string, reason: string): void;
}

/**
 * Dependencies for fallback during deliberation.
 */
export interface FallbackDeps {
  readonly pool: FallbackPool;
}

/**
 * @deprecated Use FallbackDeps instead. Kept for backward compatibility with wrappers.ts.
 */
export interface RetryDeps {
  readonly cooldown: CooldownManager;
  readonly getModels: () => ModelInfo[];
  readonly maxRetries?: number;
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
  ) => ChatMessage[];
  /** Debate protocol: worker messages include all previous responses. */
  readonly buildDebateWorkerMessages?: (
    ctx: SharedContext,
    instructions?: string,
    roundInfo?: RoundInfo,
    workerIndex?: number,
  ) => ChatMessage[];
  /** Cold join: replacement worker joining debate mid-round with full transcript. */
  readonly buildColdJoinMessages?: (
    ctx: SharedContext,
    instructions?: string,
    roundInfo?: RoundInfo,
    workerIndex?: number,
  ) => ChatMessage[];
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

const DEFAULT_CONFIG: EngineConfig = {
  maxRounds: 1,
};

// -- FallbackPool Implementation --

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
    markFailed(modelId: string, reason: string): void {
      cooldown.add(modelId, reason);
      cooldown.addProvider(modelId, reason);
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
}

/**
 * Call a worker with per-worker fallback on failure.
 * Tries the original model, then falls back to pool candidates until one succeeds or pool exhausts.
 */
async function callWithFallback(
  participant: TeamMember,
  workerIndex: number,
  ctx: SharedContext,
  roundNumber: number,
  deps: EngineDeps,
  config: EngineConfig,
  input: DeliberateInput,
  pool: FallbackPool | undefined,
): Promise<WorkerCallResult> {
  const roundInfo: RoundInfo = { current: roundNumber, max: config.maxRounds };
  const useDebateBuilder = config.protocol === "debate" && deps.buildDebateWorkerMessages && roundNumber > 1;
  const swaps: ModelSwap[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  // Build messages for the original worker
  const buildMessages = (isColdJoin: boolean): ChatMessage[] => {
    if (isColdJoin && deps.buildColdJoinMessages) {
      return deps.buildColdJoinMessages(ctx, input.workerInstructions, roundInfo, workerIndex);
    }
    if (useDebateBuilder) {
      return deps.buildDebateWorkerMessages!(ctx, input.workerInstructions, roundInfo, workerIndex);
    }
    return deps.buildWorkerMessages(ctx, input.workerInstructions, roundInfo, workerIndex);
  };

  // Try original model
  let currentModel = participant.model;
  let isColdJoin = false; // Original worker is never cold join

  // Attempt loop: original → fallback1 → fallback2 → ...
  const excludeIds = new Set<string>();
  while (true) {
    try {
      const messages = buildMessages(isColdJoin);
      const result = await deps.chat(currentModel, messages, config.workerGenParams);
      totalInput += result.inputTokens;
      totalOutput += result.outputTokens;

      const role = assignWorkerRole(workerIndex);
      const isDegenerate = result.content.trim().length < MIN_WORKER_RESPONSE_LENGTH;

      if (isDegenerate && pool) {
        // Degenerate = quality issue. Treat like an error for fallback purposes:
        // try the next model from the pool instead of returning a useless response.
        const degenerateMsg = `degenerate response (below ${MIN_WORKER_RESPONSE_LENGTH} chars)`;
        // Don't propagate to provider level — degenerate is model-specific, not provider-wide.
        excludeIds.add(currentModel);

        const teamExclude = new Set([
          ...excludeIds,
          ...ctx.team.workers.map((w) => w.model),
        ]);
        const next = pool.getNext(teamExclude);

        swaps.push({
          original: currentModel,
          replacement: next?.id,
          round: roundNumber,
          error: degenerateMsg,
        });

        if (!next) {
          // Pool exhausted — return degenerate as-is
          return {
            response: { model: currentModel, content: result.content, role, workerIndex },
            failed: false,
            degenerate: true,
            swaps,
            tokens: { input: totalInput, output: totalOutput },
          };
        }

        currentModel = next.id;
        isColdJoin = roundNumber > 1;
        continue; // retry with fallback model
      }

      return {
        response: { model: currentModel, content: result.content, role, workerIndex },
        failed: false,
        degenerate: isDegenerate,
        swaps,
        tokens: { input: totalInput, output: totalOutput },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const llmError = findLLMClientError(error);

      // No pool → can't fallback
      if (!pool) {
        swaps.push({
          original: currentModel,
          round: roundNumber,
          error: errorMsg,
          ...(llmError ? { httpStatus: llmError.status } : {}),
        });
        return { failed: true, swaps, tokens: { input: totalInput, output: totalOutput } };
      }

      // Mark failed model — always propagates to provider level.
      // Any error from a provider likely affects all models from that provider
      // (spending cap, auth failure, service down, model not found, etc.)
      pool.markFailed(currentModel, errorMsg);
      excludeIds.add(currentModel);

      // Try next from pool
      // Exclude all current team workers to avoid replacing A with B
      const teamExclude = new Set([
        ...excludeIds,
        ...ctx.team.workers.map((w) => w.model),
      ]);
      const next = pool.getNext(teamExclude);

      swaps.push({
        original: currentModel,
        replacement: next?.id,
        round: roundNumber,
        error: errorMsg,
        ...(llmError ? { httpStatus: llmError.status } : {}),
      });

      if (!next) {
        // Pool exhausted — empty slot
        return { failed: true, swaps, tokens: { input: totalInput, output: totalOutput } };
      }

      // Swap to next model
      currentModel = next.id;
      // Cold join: swap in R2+ debate
      isColdJoin = roundNumber > 1 && config.protocol === "debate" && !!deps.buildColdJoinMessages;
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
): Promise<{ round: Round; tokens: TokenUsage; modelSwaps: ModelSwap[] }> {
  const divergeParticipants = [...ctx.team.workers];

  // All workers run in parallel, each with its own fallback chain
  const results = await Promise.allSettled(
    divergeParticipants.map((participant, index) =>
      callWithFallback(participant, index, ctx, roundNumber, deps, config, input, pool),
    ),
  );

  // Collect results
  const responses: WorkerResponse[] = [];
  const failedWorkers: { model: string; error: string }[] = [];
  const allSwaps: ModelSwap[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  for (let idx = 0; idx < results.length; idx++) {
    const result = results[idx]!;
    if (result.status === "fulfilled") {
      const wr = result.value;
      totalInput += wr.tokens.input;
      totalOutput += wr.tokens.output;
      allSwaps.push(...wr.swaps);
      if (wr.response && !wr.degenerate) {
        responses.push(wr.response);
      } else if (wr.response && wr.degenerate) {
        // Degenerate = quality issue, not error. Include in failedWorkers for tracking
        // but don't trigger fallback.
        failedWorkers.push({
          model: wr.response.model,
          error: `degenerate response (below ${MIN_WORKER_RESPONSE_LENGTH} chars)`,
        });
      } else {
        // All fallbacks exhausted → empty slot
        const lastSwap = wr.swaps[wr.swaps.length - 1];
        failedWorkers.push({
          model: divergeParticipants[idx]!.model,
          error: lastSwap?.error ?? "unknown error",
        });
      }
    } else {
      // callWithFallback itself shouldn't throw, but handle defensively
      const model = divergeParticipants[idx]!.model;
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failedWorkers.push({ model, error: reason });
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

  for (let i = 1; i <= cfg.maxRounds; i++) {
    const roundResult = await executeRound(
      ctx, ctx.rounds.length + 1, deps, cfg, input, fallbackDeps?.pool,
    );

    accTokens = {
      input: accTokens.input + roundResult.tokens.input,
      output: accTokens.output + roundResult.tokens.output,
    };
    allModelSwaps.push(...roundResult.modelSwaps);

    // Update team from actual round responses — the response's model is the FINAL
    // model that succeeded (after all fallback hops). This correctly handles multi-hop
    // swap chains (A→B→C→D) where the swap map would only resolve to the first hop.
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
      if (teamChanged) {
        currentTeam = { workers: updatedWorkers };
        const prevRounds = [...ctx.rounds];
        ctx = createSharedContext(input.task, currentTeam, input.taskNature);
        for (const prevRound of prevRounds) {
          ctx = addRound(ctx, prevRound);
        }
      }
    }

    ctx = addRound(ctx, roundResult.round);

    // Accumulate metadata
    allRounds.push(roundResult.round);
    allLLMCalls += roundResult.round.responses.length + (roundResult.round.failedWorkers?.length ?? 0);
    for (const resp of roundResult.round.responses) allModels.add(resp.model);
  }

  // -- Assemble output --
  const roundsSummary = allRounds.map((r, idx) => ({
    number: idx + 1,
    responses: r.responses.map((resp) => ({ model: resp.model, content: resp.content, role: resp.role })),
    ...(r.failedWorkers?.length ? { failedWorkers: r.failedWorkers } : {}),
  }));

  const usedModelsList = [...allModels];
  const providers = new Set(usedModelsList.map(extractProvider));
  const warnings: string[] = [];
  if (providers.size < 2 && usedModelsList.length >= 2) {
    warnings.push(`provider_diversity_low: ${providers.size} provider(s) — minimum 2 recommended`);
  }

  return {
    roundsExecuted: allRounds.length,
    totalTokens: accTokens,
    totalLLMCalls: allLLMCalls,
    modelsUsed: usedModelsList,
    rounds: roundsSummary,
    ...(allModelSwaps.length > 0 ? { modelSwaps: allModelSwaps } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
