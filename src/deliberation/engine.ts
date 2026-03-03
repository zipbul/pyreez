/**
 * Deliberation Engine — Diverge-Synth execution loop.
 *
 * Exported functions:
 *   parseSynthesis — LLM response parser for leader output (consensus mode)
 *   executeRound — single round: workers (parallel) → leader (synthesis)
 *   deliberate — multi-round loop
 *   RoundExecutionError — identifies which role failed
 *
 * DI: all LLM calls and prompt building injected via EngineDeps.
 * @module Deliberation Engine
 */

import type { ChatMessage } from "../llm/types";
import type { ModelInfo } from "../model/types";
import type {
  ConsensusMode,
  DeliberateInput,
  DeliberateOutput,
  Round,
  SharedContext,
  TeamComposition,
  TeamMember,
  TokenUsage,
  WorkerResponse,
} from "./types";
import {
  createSharedContext,
  addRound,
  totalLLMCalls,
  modelsUsed,
} from "./shared-context";
import { selectTopModel, LEADER_DIMS } from "./team-composer";
import type { CooldownManager } from "./cooldown";

import type { RoundInfo } from "./prompts";

// -- Public Interfaces --

/**
 * Result of a single LLM call, including token usage.
 */
export interface ChatResult {
  readonly content: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Error thrown by executeRound when a specific role's LLM call fails.
 */
export class RoundExecutionError extends Error {
  constructor(
    public readonly role: "worker" | "leader",
    public readonly modelId: string,
    public override readonly cause: unknown,
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
  ) => Promise<ChatResult>;
  readonly buildWorkerMessages: (
    ctx: SharedContext,
    instructions?: string,
    roundInfo?: RoundInfo,
  ) => ChatMessage[];
  readonly buildLeaderMessages: (
    ctx: SharedContext,
    instructions?: string,
    roundInfo?: RoundInfo,
    consensus?: ConsensusMode,
  ) => ChatMessage[];
}

/**
 * Engine configuration.
 */
export interface EngineConfig {
  readonly maxRounds: number;
  readonly consensus?: ConsensusMode;
}

const DEFAULT_CONFIG: EngineConfig = {
  maxRounds: 1,
};

// -- Internal Helpers --

/**
 * Strip markdown JSON code-block wrappers (```json ... ```).
 */
function stripJsonWrapping(text: string): string {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("```json") && lower.endsWith("```")) {
    return trimmed.slice(7, -3).trim();
  }
  if (lower.startsWith("```") && lower.endsWith("```")) {
    return trimmed.slice(3, -3).trim();
  }
  return text;
}

// -- Parsers --

/**
 * Parse leader LLM response into Synthesis.
 * When consensus mode is enabled, attempts to extract a JSON decision field.
 * Falls back to plain text content with no decision.
 */
export function parseSynthesis(
  _model: string,
  response: string,
  consensus?: ConsensusMode,
): { content: string; decision?: "continue" | "approve" } {
  if (!consensus) {
    return { content: response };
  }

  const cleaned = stripJsonWrapping(response);
  const VALID_DECISIONS = ["continue", "approve"];
  try {
    const parsed = JSON.parse(cleaned);
    const decision = VALID_DECISIONS.includes(parsed.decision)
      ? (parsed.decision as "continue" | "approve")
      : undefined;
    return {
      content: parsed.result ?? parsed.content ?? response,
      decision,
    };
  } catch {
    return { content: response };
  }
}

// -- Round Execution --

/**
 * Execute a single deliberation round:
 *   1. Workers respond independently in parallel (Promise.allSettled)
 *   2. Leader synthesizes all worker responses
 *
 * Worker errors produce fallback exclusion. Leader errors propagate.
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

  // 1. Workers — all parallel
  const workerMessages = deps.buildWorkerMessages(
    ctx,
    input.workerInstructions,
    roundInfo,
  );

  const workerPromises = ctx.team.workers.map(async (worker) => {
    const result = await deps.chat(worker.model, workerMessages);
    totalInput += result.inputTokens;
    totalOutput += result.outputTokens;
    return { model: worker.model, content: result.content } as WorkerResponse;
  });

  const settled = await Promise.allSettled(workerPromises);

  // If ALL workers failed, treat as a hard error
  if (
    ctx.team.workers.length > 0 &&
    settled.every((r) => r.status === "rejected")
  ) {
    const firstFailure = settled[0] as PromiseRejectedResult;
    const failedModel = ctx.team.workers[0]!.model;
    throw new RoundExecutionError("worker", failedModel, firstFailure.reason);
  }

  // Collect successful responses and track failures
  const responses: WorkerResponse[] = [];
  const failedWorkers: { model: string; error: string }[] = [];
  for (let idx = 0; idx < settled.length; idx++) {
    const result = settled[idx]!;
    if (result.status === "fulfilled") {
      responses.push(result.value);
    } else {
      const workerModel = ctx.team.workers[idx]!.model;
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failedWorkers.push({ model: workerModel, error: reason });
    }
  }

  // 2. Leader — sees current round's worker responses
  const partialRound: Round = { number: roundNumber, responses };
  const ctxForLeader = addRound(ctx, partialRound);
  const leaderMessages = deps.buildLeaderMessages(
    ctxForLeader,
    input.leaderInstructions,
    roundInfo,
    config.consensus,
  );
  let leaderResult: ChatResult;
  try {
    leaderResult = await deps.chat(ctx.team.leader.model, leaderMessages);
  } catch (error) {
    throw new RoundExecutionError("leader", ctx.team.leader.model, error);
  }
  totalInput += leaderResult.inputTokens;
  totalOutput += leaderResult.outputTokens;

  const { content, decision } = parseSynthesis(
    ctx.team.leader.model,
    leaderResult.content,
    config.consensus,
  );

  const synthesis = {
    model: ctx.team.leader.model,
    content,
    ...(decision ? { decision } : {}),
  };

  return {
    round: {
      number: roundNumber,
      responses,
      synthesis,
      ...(failedWorkers.length > 0 ? { failedWorkers } : {}),
    },
    tokens: { input: totalInput, output: totalOutput },
  };
}

// -- Main Entry Point --

/**
 * Run the full multi-round deliberation loop.
 *
 * @param team - Pre-composed team (workers + leader).
 * @param input - Task, optional instructions.
 * @param deps - Injected LLM chat + prompt builders.
 * @param config - Optional engine config (defaults: maxRounds=1, no consensus).
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
  let ctx = createSharedContext(input.task, currentTeam);
  let consensusReached = false;
  let accTokens: TokenUsage = { input: 0, output: 0 };

  for (let i = 1; i <= cfg.maxRounds; i++) {
    let roundResult: { round: Round; tokens: TokenUsage };

    try {
      roundResult = await executeRound(ctx, i, deps, cfg, input);
    } catch (error) {
      if (retryDeps && error instanceof RoundExecutionError) {
        // Cooldown the failed model
        retryDeps.cooldown.add(error.modelId, error.message);
        const cooledIds = retryDeps.cooldown.getCooledDownIds();

        const teamMemberIds = new Set<string>([
          ...cooledIds,
          ...currentTeam.workers.map((w) => w.model),
          currentTeam.leader.model,
        ]);

        let retried = false;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          if (error.role === "worker") {
            // All workers failed (RoundExecutionError is only thrown on total worker failure).
            // Cool down all current workers and replace the entire worker set.
            for (const w of currentTeam.workers) {
              retryDeps.cooldown.add(w.model, "worker-failure");
            }
            const usedIds = new Set([
              ...retryDeps.cooldown.getCooledDownIds(),
              currentTeam.leader.model,
            ]);
            const newWorkers: TeamMember[] = [];
            for (let wi = 0; wi < currentTeam.workers.length; wi++) {
              const replacement = selectTopModel(
                retryDeps.getModels(),
                LEADER_DIMS,
                usedIds,
              );
              if (!replacement) break;
              newWorkers.push({ model: replacement.id, role: "worker" as const });
              usedIds.add(replacement.id);
            }
            if (newWorkers.length === 0) break;
            currentTeam = { ...currentTeam, workers: newWorkers };
          } else {
            const replacement = selectTopModel(
              retryDeps.getModels(),
              LEADER_DIMS,
              teamMemberIds,
            );
            if (!replacement) break;
            currentTeam = {
              ...currentTeam,
              leader: { model: replacement.id, role: "leader" },
            };
          }

          // Rebuild context with updated team, preserving previous rounds
          const previousRounds = [...ctx.rounds];
          ctx = createSharedContext(input.task, currentTeam);
          for (const prevRound of previousRounds) {
            ctx = addRound(ctx, prevRound);
          }

          try {
            roundResult = await executeRound(ctx, i, deps, cfg, input);
            retried = true;
            break;
          } catch (retryError) {
            if (retryError instanceof RoundExecutionError) {
              retryDeps.cooldown.add(retryError.modelId, retryError.message);
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

    // Proactive worker replacement: swap out workers that failed this round
    // so the next round has a better chance of success (only for multi-round)
    if (retryDeps && roundResult!.round.failedWorkers?.length && i < cfg.maxRounds) {
      const failedIds = new Set(roundResult!.round.failedWorkers.map((f) => f.model));
      for (const fid of failedIds) {
        retryDeps.cooldown.add(fid, "partial-failure");
      }
      const usedIds = new Set([
        ...retryDeps.cooldown.getCooledDownIds(),
        ...currentTeam.workers.map((w) => w.model),
        currentTeam.leader.model,
      ]);
      const newWorkers = currentTeam.workers.map((w) => {
        if (!failedIds.has(w.model)) return w;
        const replacement = selectTopModel(retryDeps.getModels(), LEADER_DIMS, usedIds);
        if (!replacement) return w; // keep original if no replacement available
        usedIds.add(replacement.id);
        return { model: replacement.id, role: "worker" as const };
      });
      currentTeam = { ...currentTeam, workers: newWorkers };
      const previousRounds = [...ctx.rounds];
      ctx = createSharedContext(input.task, currentTeam);
      for (const prevRound of previousRounds) {
        ctx = addRound(ctx, prevRound);
      }
    }

    // Consensus check (only when consensus mode is enabled)
    if (cfg.consensus && roundResult!.round.synthesis?.decision === "approve") {
      consensusReached = true;
      break;
    }
  }

  // If no consensus mode, completing all rounds counts as "reached"
  if (!cfg.consensus) {
    consensusReached = true;
  }

  // -- Assemble output --
  const lastRound =
    ctx.rounds.length > 0
      ? ctx.rounds[ctx.rounds.length - 1]
      : undefined;

  const result = lastRound?.synthesis?.content ?? "";

  // Extract per-round synthesis summaries for diagnostics
  const roundsSummary = ctx.rounds.map((r) => ({
    number: r.number,
    ...(r.synthesis ? { synthesis: r.synthesis.content } : {}),
  }));

  return {
    result,
    roundsExecuted: ctx.rounds.length,
    consensusReached,
    totalTokens: accTokens,
    totalLLMCalls: totalLLMCalls(ctx),
    modelsUsed: modelsUsed(ctx),
    rounds: roundsSummary,
  };
}
