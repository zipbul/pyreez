/**
 * Integration Wiring — connects all deliberation modules.
 *
 * Exported:
 *   stripThinkTags — strip DeepSeek `<think>` blocks from LLM responses
 *   createChatAdapter — wraps a chat function into EngineDeps.chat signature (with retry + token tracking)
 *   createDeliberateFn — factory returning (DeliberateInput) => Promise<DeliberateOutput>
 *   WireDeps — dependency interface for the factory
 *
 * @module Deliberation Wire
 */

import type { ChatMessage, ChatCompletionResponse } from "../llm/types";
import { LLMClientError } from "../llm/errors";
import type { ModelInfo } from "../model/types";
import type { DeliberateInput, DeliberateOutput, GenerationParams } from "./types";
import type { ChatResult, EngineDeps, EngineConfig, RetryDeps } from "./engine";
import type { DeliberationStore } from "./store-types";
import type { ScoringSystem } from "../axis/interfaces";
import type { PollJudgeConfig } from "./poll-judge";
import { composeTeam, selectDiverseModels, orderWorkersByRole } from "./team-composer";
import { deliberate } from "./engine";
import { createCooldownManager } from "./cooldown";
import { evaluateWithPoll } from "./poll-judge";
import {
  buildWorkerMessages,
  buildLeaderMessages,
  buildDebateWorkerMessages,
} from "./prompts";

// -- Public types --

/**
 * Dependencies for creating a deliberate function.
 */
export interface WireDeps {
  readonly registry: {
    getAll(): ModelInfo[];
    getAvailable(): ModelInfo[];
    getById(id: string): ModelInfo | undefined;
  };
  readonly chat: (model: string, messages: ChatMessage[], params?: GenerationParams) => Promise<ChatResult>;
  readonly store?: DeliberationStore;
  readonly pollJudge?: PollJudgeConfig;
  readonly scoring?: ScoringSystem;
  /** Shared CooldownManager (process-scoped). When omitted, a per-call instance is created. */
  readonly cooldown?: import("./cooldown").CooldownManager;
}

// -- Think Tag Stripping --

/**
 * Strip `<think>...</think>` blocks from LLM responses.
 * DeepSeek-R1 and similar reasoning models emit these blocks.
 * Uses non-greedy match to handle multiple blocks correctly.
 */
export function stripThinkTags(text: string): string {
  // Strip complete <think>...</think> blocks
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  // Strip unclosed <think> only if no matching </think> follows
  // (prevents stripping literal "<think>" in normal prose)
  const openIdx = result.lastIndexOf("<think>");
  if (openIdx !== -1 && result.indexOf("</think>", openIdx) === -1) {
    result = result.slice(0, openIdx);
  }
  return result.trim();
}

// -- Chat Adapter --

type RawChatFn = (
  request: { model: string; messages: ChatMessage[]; temperature?: number; max_tokens?: number; top_p?: number },
) => Promise<ChatCompletionResponse>;

/**
 * Retry configuration for the chat adapter.
 */
export interface ChatAdapterOptions {
  /** Maximum number of retries on retryable errors. Default: 3. */
  readonly maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default: 1000. */
  readonly baseDelayMs?: number;
  /** HTTP status codes that trigger retry. Default: [429]. */
  readonly retryableStatuses?: readonly number[];
  /** Random function for jitter (0~1). Default: Math.random. Injected for deterministic testing. */
  readonly randomFn?: () => number;
  /** Callback invoked on each retryable error. Use for telemetry/event collection. */
  readonly onRetry?: (event: RetryEvent) => void;
  /**
   * Maximum delay in ms applied to retryAfterMs before jitter.
   * Prevents extremely long waits when the server returns a large Retry-After header.
   * When undefined, no cap is applied.
   */
  readonly maxRetryAfterMs?: number;
}

/**
 * Event emitted on each retryable error occurrence.
 */
export interface RetryEvent {
  /** HTTP status code that triggered the event. */
  readonly status: number;
  /** Retry attempt number (1-based). */
  readonly attempt: number;
  /** Delay in ms before next retry (or 0 if willRetry=false). */
  readonly delayMs: number;
  /** Model ID that was being called. */
  readonly model: string;
  /** Whether a retry will be attempted after this event. */
  readonly willRetry: boolean;
}

const DEFAULT_ADAPTER_OPTIONS = {
  maxRetries: 3,
  baseDelayMs: 1000,
  retryableStatuses: [429] as readonly number[],
  randomFn: Math.random,
};

/**
 * Wrap a raw LLMClient-style chat function into the
 * `(model, messages) => Promise<ChatResult>` signature required by EngineDeps.
 *
 * Features:
 *   - Strips `<think>` tags from responses (DeepSeek-R1 support)
 *   - Tracks token usage from response.usage
 *   - Retries on retryable HTTP statuses with exponential backoff + jitter
 *   - Emits RetryEvent via onRetry callback for telemetry
 */
export function createChatAdapter(
  chatFn: RawChatFn,
  options?: ChatAdapterOptions,
): (model: string, messages: ChatMessage[], params?: GenerationParams) => Promise<ChatResult> {
  const opts = { ...DEFAULT_ADAPTER_OPTIONS, ...options };

  return async (model, messages, params) => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      try {
        const response = await chatFn({
          model,
          messages,
          ...(params?.temperature != null ? { temperature: params.temperature } : {}),
          ...(params?.max_tokens != null ? { max_tokens: params.max_tokens } : {}),
          ...(params?.top_p != null ? { top_p: params.top_p } : {}),
        });
        const choice = response.choices[0];
        const raw = choice?.message?.content ?? "";
        const truncated = choice?.finish_reason === "length";
        return {
          content: stripThinkTags(raw),
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
          ...(truncated ? { truncated } : {}),
        };
      } catch (error) {
        lastError = error;

        // Retryable error detection
        if (
          error instanceof LLMClientError &&
          opts.retryableStatuses.includes(error.status)
        ) {
          const willRetry = attempt < opts.maxRetries;
          const rawDelay = willRetry
            ? (error.retryAfterMs ?? opts.baseDelayMs * 2 ** attempt)
            : 0;
          const baseDelay =
            willRetry && opts.maxRetryAfterMs != null
              ? Math.min(rawDelay, opts.maxRetryAfterMs)
              : rawDelay;
          const jitter = willRetry ? 0.5 + opts.randomFn() * 0.5 : 1;
          const delay = baseDelay * jitter;

          // Emit retry event for telemetry
          opts.onRetry?.({
            status: error.status,
            attempt: attempt + 1,
            delayMs: delay,
            model,
            willRetry,
          });

          if (willRetry) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        }

        throw error;
      }
    }

    // Should never reach here, but satisfy TypeScript
    throw lastError;
  };
}

// -- Deliberate Factory --

/**
 * Create a fully-wired `deliberateFn` that can be passed to PyreezMcpServer.
 *
 * Wires: composeTeam + prompt builders + engine.deliberate + chat adapter.
 */
export function createDeliberateFn(
  deps: WireDeps,
): (input: DeliberateInput) => Promise<DeliberateOutput> {
  return async (input) => {
    let team: import("./types").TeamComposition;

    if (input.models && input.models.length >= 2) {
      // Validate all model IDs exist in registry
      const invalid = input.models.filter((id) => !deps.registry.getById(id));
      if (invalid.length > 0) {
        throw new Error(`Unknown model(s): ${invalid.join(", ")}. Check scores/models.json.`);
      }
      // All specified models participate. Leader auto-selected by JUDGMENT score.
      const specifiedModels = input.models
        .map((id) => deps.registry.getById(id)!)
        .filter(Boolean);
      team = composeTeam(
        { task: input.task, modelIds: [...input.models] },
        {
          getModels: () => specifiedModels,
          getById: (id) => deps.registry.getById(id),
        },
      );
    } else {
      // Auto compose from available models, capped to prevent cost explosion.
      // selectDiverseModels ensures provider diversity (round-robin across providers).
      // Team-composer handles leader selection by JUDGMENT score internally.
      // Artifact tasks: 2 workers + 1 leader = 3. Critique: 4 workers + 1 leader = 5.
      const available = deps.registry.getAvailable();
      const MAX_AUTO_TEAM = input.taskNature === "artifact" ? 3 : 5;
      const selected = selectDiverseModels(available, MAX_AUTO_TEAM);
      const modelIds = selected.map((m) => m.id);
      team = composeTeam(
        { task: input.task, modelIds },
        {
          getModels: () => selected,
          getById: (id) => deps.registry.getById(id),
        },
      );
    }

    // 2.5. Reorder workers by capability → role fit
    //       advocate(idx 0)=REASONING, critic(idx 1)=ANALYSIS, wildcard(idx 2)=CREATIVITY
    const orderedWorkers = orderWorkersByRole(team.workers, (id) => deps.registry.getById(id));
    team = { ...team, workers: orderedWorkers };

    // 3. Assemble engine deps — deps.chat already returns ChatResult
    const engineDeps: EngineDeps = {
      chat: deps.chat,
      buildWorkerMessages,
      buildLeaderMessages,
      buildDebateWorkerMessages,
    };

    // 4. Build engine config
    const isDebate = input.protocol === "debate";
    // For debate: default to 3 rounds, but respect explicit user input
    const effectiveMaxRounds = input.maxRounds
      ?? (isDebate ? 3 : 1);
    const nature = input.taskNature ?? "critique";
    const workerGenParams: GenerationParams = {
      temperature: 1.0,
      top_p: 0.9,
      max_tokens: 2048,
    };
    // Artifact leader output IS the deliverable — no max_tokens constraint.
    // Critique leader has a cap since analysis output is bounded.
    const leaderGenParams: GenerationParams = {
      temperature: 0.7,
      ...(nature === "artifact" ? {} : { max_tokens: 8192 }),
    };
    const config: EngineConfig = {
      maxRounds: effectiveMaxRounds,
      consensus: input.consensus,
      leaderContributes: input.leaderContributes,
      protocol: input.protocol,
      structuralTags: nature === "critique"
        ? ["verification", "adopted", "novel", "result"]
        : undefined,
      workerGenParams,
      leaderGenParams,
    };

    // 5. Build retryDeps for automatic team recomposition on failure
    const retryDeps: RetryDeps = {
      cooldown: deps.cooldown ?? createCooldownManager(),
      getModels: () => deps.registry.getAvailable(),
    };

    // 6. Run deliberation
    let result = await deliberate(team, input, engineDeps, config, retryDeps);

    // 7. PoLL quality evaluation + BT update (best-effort)
    if (deps.pollJudge && deps.scoring && result.rounds) {
      try {
        const lastRound = result.rounds[result.rounds.length - 1];
        if (lastRound?.responses && lastRound.responses.length >= 2) {
          const teamIds = new Set(result.modelsUsed as string[]);
          const pollResult = await evaluateWithPoll(
            input.task, lastRound.responses, teamIds, deps.pollJudge,
          );
          if (pollResult.pairwise.length > 0) {
            await deps.scoring.update([...pollResult.pairwise]);
          }
          if (pollResult.workerScores.length > 0) {
            result = { ...result, pollScores: pollResult.workerScores };
          }
        }
      } catch {
        // best-effort — do not fail deliberation
      }
    }

    // 8. Auto-save to store (best-effort, errors are swallowed)
    if (deps.store) {
      try {
        await deps.store.save({
          id: crypto.randomUUID(),
          task: input.task,
          timestamp: Date.now(),
          consensusReached: result.consensusReached,
          roundsExecuted: result.roundsExecuted,
          result: result.result,
          modelsUsed: [...result.modelsUsed],
          totalLLMCalls: result.totalLLMCalls,
          totalTokens: result.totalTokens,
          workerInstructions: input.workerInstructions,
          leaderInstructions: input.leaderInstructions,
          consensus: input.consensus,
          protocol: input.protocol,
          ...(result.rounds ? { roundsSummary: result.rounds } : {}),
        });
      } catch {
        // best-effort save — do not fail the deliberation
      }
    }

    return result;
  };
}
