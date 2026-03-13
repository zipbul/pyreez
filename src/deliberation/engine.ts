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
  totalLLMCalls,
  modelsUsed,
} from "./shared-context";
import { selectTopModel, LEADER_DIMS } from "./team-composer";
import { classifyError, type CooldownManager } from "./cooldown";
import {
  validateSynthesisStructure,
  buildRetryHint,
} from "./synthesis-validator";

import type { RoundInfo } from "./prompts";

// Re-export ChatResult from canonical location for backward compatibility
export type { ChatResult } from "../axis/types";
import type { ChatResult } from "../axis/types";

// -- Constants --

/**
 * Minimum character length for a valid worker response.
 * Responses shorter than this are treated as degenerate (empty, provider failure, etc.)
 * and excluded from leader synthesis. Workers are instructed of this requirement in their prompts.
 */
export const MIN_WORKER_RESPONSE_LENGTH = 200;

// -- Public Interfaces --

/**
 * Error thrown by executeRound when a specific role's LLM call fails.
 */
export class RoundExecutionError extends Error {
  constructor(
    public readonly role: "worker" | "leader",
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
  readonly buildLeaderMessages: (
    ctx: SharedContext,
    instructions?: string,
    roundInfo?: RoundInfo,
    consensus?: ConsensusMode,
    protocol?: "diverge-synth" | "debate",
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
  readonly consensus?: ConsensusMode;
  readonly protocol?: "diverge-synth" | "debate";
  /**
   * When true, the leader also responds independently in the worker (diverge) phase
   * before synthesizing all responses including its own.
   * Prevents anchoring bias and ensures the strongest model contributes its own reasoning.
   * Default: false.
   */
  readonly leaderContributes?: boolean;
  /**
   * XML tags to validate in leader synthesis output.
   * Undefined = no structural validation. Non-empty array = validate and retry once on failure.
   */
  readonly structuralTags?: readonly string[];
  /** Generation params for worker LLM calls. */
  readonly workerGenParams?: GenerationParams;
  /** Generation params for leader LLM calls. */
  readonly leaderGenParams?: GenerationParams;
}

const DEFAULT_CONFIG: EngineConfig = {
  maxRounds: 1,
  leaderContributes: false,
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

/**
 * Extract the outermost JSON object from a string that may contain
 * surrounding text (e.g. LLM commentary before/after the JSON block).
 * Returns null if no valid JSON object is found.
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// -- Deliberation Block Stripping --

/**
 * Strip `<deliberation>...</deliberation>` scratchpad blocks from leader output.
 * These blocks are used by artifact leaders for internal reasoning and should
 * not appear in the final result returned to the user.
 */
function stripDeliberationBlock(text: string): string {
  return text.replace(/<deliberation>[\s\S]*?<\/deliberation>/g, "").trim();
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
    return { content: stripDeliberationBlock(response) };
  }

  const VALID_DECISIONS = ["continue", "approve"];

  // Attempt 1: strip markdown wrapping and parse
  const cleaned = stripJsonWrapping(response);
  try {
    const parsed = JSON.parse(cleaned);
    const decision = VALID_DECISIONS.includes(parsed.decision)
      ? (parsed.decision as "continue" | "approve")
      : undefined;
    return {
      content: stripDeliberationBlock(parsed.result ?? parsed.content ?? response),
      decision,
    };
  } catch {
    // fall through to fallback
  }

  // Attempt 2: extract outermost JSON object from response text
  // Handles cases where the LLM wraps JSON in commentary
  const jsonBlock = extractJsonObject(response);
  if (jsonBlock) {
    try {
      const parsed = JSON.parse(jsonBlock);
      const decision = VALID_DECISIONS.includes(parsed.decision)
        ? (parsed.decision as "continue" | "approve")
        : undefined;
      return {
        content: stripDeliberationBlock(parsed.result ?? parsed.content ?? response),
        decision,
      };
    } catch {
      // fall through
    }
  }

  return { content: stripDeliberationBlock(response) };
}

// -- Internal: leader retry helper --

/**
 * Retry leader once with a hint appended to instructions.
 * Returns parsed content, optional decision, and extra tokens consumed.
 */
async function retryLeaderOnce(
  ctx: SharedContext,
  roundNumber: number,
  responses: readonly WorkerResponse[],
  deps: EngineDeps,
  config: EngineConfig,
  hint: string,
  leaderInstructions?: string,
): Promise<{ content: string; decision?: "continue" | "approve"; extraTokens: TokenUsage }> {
  const partialRound: Round = { number: roundNumber, responses };
  const ctxForRetry = addRound(ctx, partialRound);
  const retryMessages = deps.buildLeaderMessages(
    ctxForRetry,
    (leaderInstructions ?? "") + hint,
    { current: roundNumber, max: config.maxRounds },
    config.consensus,
    config.protocol,
  );
  const retryResult = await deps.chat(ctx.team.leader.model, retryMessages, config.leaderGenParams);
  const retryTokens: TokenUsage = { input: retryResult.inputTokens, output: retryResult.outputTokens };
  if (retryResult.truncated) {
    throw new RoundExecutionError(
      "leader",
      ctx.team.leader.model,
      new Error("Leader response truncated (max_tokens reached). Output is incomplete."),
      retryTokens,
    );
  }
  const parsed = parseSynthesis(ctx.team.leader.model, retryResult.content, config.consensus);
  return {
    content: parsed.content,
    decision: parsed.decision,
    extraTokens: retryTokens,
  };
}

// -- Round Execution --

/**
 * Execute a single deliberation round:
 *   1. Workers respond independently in parallel (Promise.allSettled)
 *   2. Leader synthesizes all worker responses
 *   3. Truncation guard (always throws)
 *   4. Structural validation (if structuralTags configured) with one retry
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

  // 1. Diverge phase — all participants respond in parallel
  //    When leaderContributes is true, leader also responds independently
  //    before synthesizing, ensuring the strongest model's unanchored opinion is captured.
  const useDebateBuilder = config.protocol === "debate" && deps.buildDebateWorkerMessages && roundNumber > 1;

  const leaderContributes = config.leaderContributes === true;
  const divergeParticipants = leaderContributes
    ? [...ctx.team.workers, ctx.team.leader]
    : [...ctx.team.workers];

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
      // Workers are instructed to produce at least MIN_WORKER_RESPONSE_LENGTH chars.
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

  // Guard: all workers produced degenerate responses — no point running leader with empty input
  if (responses.length === 0 && failedWorkers.length > 0) {
    throw new RoundExecutionError(
      "worker",
      failedWorkers[0]!.model,
      new Error(`All ${failedWorkers.length} worker(s) produced degenerate responses (below ${MIN_WORKER_RESPONSE_LENGTH} chars)`),
      { input: totalInput, output: totalOutput },
    );
  }

  // 2. Leader — sees current round's worker responses
  const partialRound: Round = { number: roundNumber, responses };
  const ctxForLeader = addRound(ctx, partialRound);
  const leaderMessages = deps.buildLeaderMessages(
    ctxForLeader,
    input.leaderInstructions,
    roundInfo,
    config.consensus,
    config.protocol,
  );
  let leaderResult: ChatResult;
  try {
    leaderResult = await deps.chat(ctx.team.leader.model, leaderMessages, config.leaderGenParams);
  } catch (error) {
    throw new RoundExecutionError("leader", ctx.team.leader.model, error,
      { input: totalInput, output: totalOutput });
  }
  totalInput += leaderResult.inputTokens;
  totalOutput += leaderResult.outputTokens;

  // Truncation guard: finish_reason === "length" means max_tokens was hit.
  // Always throw — truncated output is incomplete regardless of task nature.
  // deliberate()'s team recomposition retry will handle recovery.
  if (leaderResult.truncated) {
    throw new RoundExecutionError(
      "leader",
      ctx.team.leader.model,
      new Error("Leader response truncated (max_tokens reached). Output is incomplete."),
      { input: totalInput, output: totalOutput },
    );
  }

  let { content, decision } = parseSynthesis(
    ctx.team.leader.model,
    leaderResult.content,
    config.consensus,
  );

  // Structural validation: check required XML tags and retry leader once if missing
  if (config.structuralTags?.length) {
    const isDebateIntermediate = config.protocol === "debate"
      && roundNumber < config.maxRounds
      && decision !== "approve";
    if (!isDebateIntermediate) {
      const validation = validateSynthesisStructure(content, config.structuralTags);
      if (!validation.valid) {
        try {
          const retry = await retryLeaderOnce(
            ctx, roundNumber, responses, deps, config,
            buildRetryHint(validation.missing), input.leaderInstructions,
          );
          // Check retry result structure too
          const retryValidation = validateSynthesisStructure(retry.content, config.structuralTags);
          if (retryValidation.valid) {
            content = retry.content;
            decision = retry.decision;
            totalInput += retry.extraTokens.input;
            totalOutput += retry.extraTokens.output;
          } else {
            totalInput += retry.extraTokens.input;
            totalOutput += retry.extraTokens.output;
            throw new RoundExecutionError(
              "leader",
              ctx.team.leader.model,
              new Error(`Leader synthesis missing required sections after retry: ${retryValidation.missing.join(", ")}`),
              { input: totalInput, output: totalOutput },
            );
          }
        } catch (error) {
          if (error instanceof RoundExecutionError) {
            // Merge retry tokens from retryLeaderOnce into our accumulated total
            if (error.tokensConsumed) {
              const merged: TokenUsage = {
                input: totalInput + error.tokensConsumed.input,
                output: totalOutput + error.tokensConsumed.output,
              };
              throw new RoundExecutionError(error.role, error.modelId, error.cause, merged);
            }
            throw error;
          }
          throw new RoundExecutionError(
            "leader",
            ctx.team.leader.model,
            error instanceof Error ? error : new Error(String(error)),
            { input: totalInput, output: totalOutput },
          );
        }
      }
    }
  }

  // For debate protocol, force "continue" on round 1: workers haven't exchanged views yet,
  // so the leader can't meaningfully approve consensus. Round 2+ may approve early.
  const effectiveDecision = (config.protocol === "debate" && roundNumber === 1 && config.maxRounds > 1)
    ? "continue" as const
    : decision;

  const synthesis = {
    model: ctx.team.leader.model,
    content,
    ...(effectiveDecision ? { decision: effectiveDecision } : {}),
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
  let ctx = createSharedContext(input.task, currentTeam, input.taskNature);
  let consensusReached: boolean | null = false;
  let accTokens: TokenUsage = { input: 0, output: 0 };

  for (let i = 1; i <= cfg.maxRounds; i++) {
    let roundResult: { round: Round; tokens: TokenUsage };

    try {
      roundResult = await executeRound(ctx, i, deps, cfg, input);
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
              retryDeps.cooldown.add(w.model, "worker-failure", errorType);
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
          ctx = createSharedContext(input.task, currentTeam, input.taskNature);
          for (const prevRound of previousRounds) {
            ctx = addRound(ctx, prevRound);
          }

          try {
            roundResult = await executeRound(ctx, i, deps, cfg, input);
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
      ctx = createSharedContext(input.task, currentTeam, input.taskNature);
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

  // If no consensus mode, consensusReached is null (not applicable)
  if (!cfg.consensus) {
    consensusReached = null;
  }

  // -- Assemble output --
  const lastRound =
    ctx.rounds.length > 0
      ? ctx.rounds[ctx.rounds.length - 1]
      : undefined;

  const result = lastRound?.synthesis?.content ?? "";

  // Extract per-round details for diagnostics (worker responses + synthesis + failures)
  const roundsSummary = ctx.rounds.map((r) => ({
    number: r.number,
    responses: r.responses.map((resp) => ({ model: resp.model, content: resp.content })),
    ...(r.synthesis ? { synthesis: r.synthesis.content } : {}),
    ...(r.failedWorkers?.length ? { failedWorkers: r.failedWorkers } : {}),
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
