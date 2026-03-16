/**
 * Deliberation Engine — Leaderless multi-model execution loop.
 *
 * Exported functions:
 *   executeRound — single round: workers respond in parallel
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
import { selectTopModel, SELECTION_DIMS } from "./team-composer";
import { extractProvider } from "./provider-util";
import { classifyError, type CooldownManager } from "./cooldown";

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
 * Error thrown by executeRound when a worker's LLM call fails.
 */
export class RoundExecutionError extends Error {
  constructor(
    public readonly role: "worker",
    public readonly modelId: string,
    public override readonly cause: unknown,
    /** Tokens consumed before the error occurred. */
    public readonly tokensConsumed?: TokenUsage,
  ) {
    super(
      `${role} (${modelId}) failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "RoundExecutionError";
  }
}

/**
 * Optional retry dependencies for automatic team recomposition on failure.
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
    workerModel?: string,
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

// -- Round Execution --

/**
 * Execute a single deliberation round:
 *   1. Workers respond independently in parallel (Promise.allSettled)
 *   2. Collect responses, track failures
 *
 * Worker errors produce fallback exclusion.
 */
export async function executeRound(
  ctx: SharedContext,
  roundNumber: number,
  deps: EngineDeps,
  config: EngineConfig,
  input: DeliberateInput,
): Promise<{ round: Round; tokens: TokenUsage }> {
  const roundInfo: RoundInfo = { current: roundNumber, max: config.maxRounds };
  let totalInput = 0;
  let totalOutput = 0;

  // 1. Diverge phase — all workers respond in parallel
  const useDebateBuilder = config.protocol === "debate" && deps.buildDebateWorkerMessages && roundNumber > 1;

  const divergeParticipants = [...ctx.team.workers];

  // Per-worker messages: each worker gets role-specific prompts via workerIndex.
  const workerPromises = divergeParticipants.map(async (participant, index) => {
    const messages = useDebateBuilder
      ? deps.buildDebateWorkerMessages!(ctx, input.workerInstructions, roundInfo, participant.model, index)
      : deps.buildWorkerMessages(ctx, input.workerInstructions, roundInfo, index);
    const result = await deps.chat(participant.model, messages, config.workerGenParams);
    totalInput += result.inputTokens;
    totalOutput += result.outputTokens;
    const role = assignWorkerRole(index);
    return { model: participant.model, content: result.content, role, workerIndex: index } as WorkerResponse;
  });

  const settled = await Promise.allSettled(workerPromises);

  // If ALL participants failed, treat as a hard error
  if (
    divergeParticipants.length > 0 &&
    settled.every((r) => r.status === "rejected")
  ) {
    const firstFailure = settled[0] as PromiseRejectedResult;
    const failedModel = divergeParticipants[0]!.model;
    throw new RoundExecutionError("worker", failedModel, firstFailure.reason);
  }

  // Collect successful responses and track failures
  const responses: WorkerResponse[] = [];
  const failedWorkers: { model: string; error: string }[] = [];
  for (let idx = 0; idx < settled.length; idx++) {
    const result = settled[idx]!;
    if (result.status === "fulfilled") {
      // Filter degenerate responses (empty, whitespace-only, below minimum length).
      if (result.value.content.trim().length < MIN_WORKER_RESPONSE_LENGTH) {
        const model = divergeParticipants[idx]!.model;
        failedWorkers.push({ model, error: "degenerate response (below minimum length)" });
      } else {
        responses.push(result.value);
      }
    } else {
      const model = divergeParticipants[idx]!.model;
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failedWorkers.push({ model, error: reason });
    }
  }

  // Guard: all workers produced degenerate responses
  if (responses.length === 0 && failedWorkers.length > 0) {
    throw new RoundExecutionError(
      "worker",
      failedWorkers[0]!.model,
      new Error(`All ${failedWorkers.length} worker(s) produced degenerate responses (below ${MIN_WORKER_RESPONSE_LENGTH} chars)`),
      { input: totalInput, output: totalOutput },
    );
  }

  return {
    round: {
      number: roundNumber,
      responses,
      ...(failedWorkers.length > 0 ? { failedWorkers } : {}),
    },
    tokens: { input: totalInput, output: totalOutput },
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
 * @param retryDeps - Optional retry dependencies for automatic recomposition on failure.
 */
export async function deliberate(
  team: TeamComposition,
  input: DeliberateInput,
  deps: EngineDeps,
  config?: EngineConfig,
  retryDeps?: RetryDeps,
): Promise<DeliberateOutput> {
  const cfg = config ?? DEFAULT_CONFIG;
  const maxRetries = retryDeps?.maxRetries ?? 1;
  let currentTeam = team;
  let ctx = createSharedContext(input.task, currentTeam, input.taskNature);
  let accTokens: TokenUsage = { input: 0, output: 0 };
  // Accumulate all rounds independently of ctx (survives context resets)
  const allRounds: Round[] = [];
  const allModels = new Set<string>();
  let allLLMCalls = 0;

  for (let i = 1; i <= cfg.maxRounds; i++) {
    let roundResult: { round: Round; tokens: TokenUsage };

    try {
      roundResult = await executeRound(ctx, ctx.rounds.length + 1, deps, cfg, input);
    } catch (error) {
      if (retryDeps && error instanceof RoundExecutionError) {
        // Accumulate tokens consumed before the failure
        if (error.tokensConsumed) {
          accTokens = {
            input: accTokens.input + error.tokensConsumed.input,
            output: accTokens.output + error.tokensConsumed.output,
          };
        }
        // Cooldown the failed model with error-type-aware TTL
        const errorType = classifyError(error.cause);
        retryDeps.cooldown.add(error.modelId, error.message, errorType);
        // For rate limits, propagate cooldown to all models from the same provider
        if (errorType === "rate_limit") {
          retryDeps.cooldown.addProvider(error.modelId, error.message);
        }
        let retried = false;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          // All workers failed — cool down and replace the entire worker set.
          for (const w of currentTeam.workers) {
            retryDeps.cooldown.add(w.model, "worker-failure", errorType);
          }
          const usedIds = new Set([
            ...retryDeps.cooldown.getCooledDownIds(),
          ]);
          const newWorkers: TeamMember[] = [];
          for (let wi = 0; wi < currentTeam.workers.length; wi++) {
            const replacement = selectTopModel(
              retryDeps.getModels(),
              SELECTION_DIMS,
              usedIds,
            );
            if (!replacement) break;
            newWorkers.push({ model: replacement.id, role: "worker" as const });
            usedIds.add(replacement.id);
          }
          if (newWorkers.length === 0) break;
          currentTeam = { workers: newWorkers };

          // Rebuild context with updated team.
          // Full retry = all workers failed, so no successful responses to preserve.
          // Drop all rounds in debate (no cross-examination possible).
          const previousRounds = cfg.protocol === "debate" ? [] : [...ctx.rounds];
          ctx = createSharedContext(input.task, currentTeam, input.taskNature);
          for (const prevRound of previousRounds) {
            ctx = addRound(ctx, prevRound);
          }

          try {
            // When debate rounds were dropped, use sequential number from fresh context
            const retryRoundNumber = ctx.rounds.length + 1;
            roundResult = await executeRound(ctx, retryRoundNumber, deps, cfg, input);
            retried = true;
            break;
          } catch (retryError) {
            if (retryError instanceof RoundExecutionError) {
              const retryErrorType = classifyError(retryError.cause);
              retryDeps.cooldown.add(retryError.modelId, retryError.message, retryErrorType);
            }
          }
        }

        if (!retried) throw error;
      } else {
        throw error;
      }
    }

    accTokens = {
      input: accTokens.input + roundResult!.tokens.input,
      output: accTokens.output + roundResult!.tokens.output,
    };
    ctx = addRound(ctx, roundResult!.round);

    // Accumulate metadata independently of ctx
    allRounds.push(roundResult!.round);
    allLLMCalls += roundResult!.round.responses.length + (roundResult!.round.failedWorkers?.length ?? 0);
    for (const resp of roundResult!.round.responses) allModels.add(resp.model);

    // Proactive worker replacement: swap out workers that failed this round
    // so the next round has a better chance of success (only for multi-round)
    if (retryDeps && roundResult!.round.failedWorkers?.length && i < cfg.maxRounds) {
      const failedIds = new Set(roundResult!.round.failedWorkers.map((f) => f.model));
      for (const fid of failedIds) {
        retryDeps.cooldown.add(fid, "partial-failure", "degenerate");
      }
      const usedIds = new Set([
        ...retryDeps.cooldown.getCooledDownIds(),
        ...currentTeam.workers.map((w) => w.model),
      ]);
      const newWorkers = currentTeam.workers.map((w) => {
        if (!failedIds.has(w.model)) return w;
        const replacement = selectTopModel(retryDeps.getModels(), SELECTION_DIMS, usedIds);
        if (!replacement) return w; // keep original if no replacement available
        usedIds.add(replacement.id);
        return { model: replacement.id, role: "worker" as const };
      });
      currentTeam = { workers: newWorkers };
      // In debate mode: keep only successful responses (filter out failed workers)
      // so replacement workers can cross-examine surviving positions.
      // In diverge-synth: preserve all rounds as-is (prompts don't reference them).
      const prevRounds = cfg.protocol === "debate"
        ? ctx.rounds.map((r) => ({
            ...r,
            responses: r.responses.filter((resp) => !failedIds.has(resp.model)),
          })).filter((r) => r.responses.length > 0)
        : [...ctx.rounds];
      ctx = createSharedContext(input.task, currentTeam, input.taskNature);
      for (const prevRound of prevRounds) {
        ctx = addRound(ctx, prevRound);
      }
    }
  }

  // -- Assemble output (from accumulated metadata, not ctx which may have been reset) --
  const roundsSummary = allRounds.map((r, idx) => ({
    number: idx + 1,
    responses: r.responses.map((resp) => ({ model: resp.model, content: resp.content, role: resp.role })),
    ...(r.failedWorkers?.length ? { failedWorkers: r.failedWorkers } : {}),
  }));

  // Provider diversity warning
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
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
