/**
 * Integration Wiring — connects all deliberation modules.
 *
 * Exported:
 *   stripThinkTags — strip DeepSeek `<think>` blocks from LLM responses
 *   createChatAdapter — wraps a chat function into EngineDeps.chat signature (with retry)
 *   createDeliberateFn — factory returning (DeliberateInput) => Promise<DeliberateOutput>
 *   WireDeps — dependency interface for the factory
 *
 * @module Deliberation Wire
 */

import type { ChatMessage, ChatCompletionResponse } from "../llm/types";
import { LLMClientError } from "../llm/client";
import type { ModelInfo } from "../model/types";
import type { DeliberateInput, DeliberateOutput } from "./types";
import type { EngineDeps, EngineConfig } from "./engine";
import type { DeliberationStore } from "./store-types";
import { composeTeam } from "./team-composer";
import type { ComposeTeamOptions } from "./team-composer";
import { deliberate } from "./engine";
import {
  buildProducerMessages,
  buildReviewerMessages,
  buildLeaderMessages,
} from "./prompts";

// -- Public types --

/**
 * Dependencies for creating a deliberate function.
 */
export interface WireDeps {
  readonly registry: {
    getAll(): ModelInfo[];
    getById(id: string): ModelInfo | undefined;
  };
  readonly chat: (model: string, messages: ChatMessage[]) => Promise<string>;
  readonly store?: DeliberationStore;
}

// -- Think Tag Stripping --

/**
 * Strip `<think>...</think>` blocks from LLM responses.
 * DeepSeek-R1 and similar reasoning models emit these blocks.
 * Uses non-greedy match to handle multiple blocks correctly.
 */
export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// -- Chat Adapter --

type ChatFn = (
  request: { model: string; messages: ChatMessage[] },
) => Promise<ChatCompletionResponse>;

/**
 * Retry configuration for the chat adapter.
 */
export interface ChatAdapterOptions {
  /** Maximum number of retries on 429. Default: 3. */
  readonly maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default: 1000. */
  readonly baseDelayMs?: number;
}

const DEFAULT_ADAPTER_OPTIONS: Required<ChatAdapterOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
};

/**
 * Wrap a raw LLMClient-style chat function into the
 * `(model, messages) => Promise<string>` signature required by EngineDeps.
 *
 * Features:
 *   - Strips `<think>` tags from responses (DeepSeek-R1 support)
 *   - Retries on 429 (rate limit) with exponential backoff
 */
export function createChatAdapter(
  chatFn: ChatFn,
  options?: ChatAdapterOptions,
): (model: string, messages: ChatMessage[]) => Promise<string> {
  const opts = { ...DEFAULT_ADAPTER_OPTIONS, ...options };

  return async (model, messages) => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      try {
        const response = await chatFn({ model, messages });
        const choice = response.choices[0];
        const raw = choice?.message?.content ?? "";
        return stripThinkTags(raw);
      } catch (error) {
        lastError = error;

        // Only retry on 429 rate limit
        if (
          error instanceof LLMClientError &&
          error.status === 429 &&
          attempt < opts.maxRetries
        ) {
          const delay = error.retryAfterMs ?? opts.baseDelayMs * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
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
    // 1. Map input → ComposeTeamOptions
    const teamOptions: ComposeTeamOptions = {
      task: input.task,
      perspectives: [...input.perspectives],
      overrides: input.team
        ? {
            producer: input.team.producer,
            reviewers: input.team.reviewers
              ? [...input.team.reviewers]
              : undefined,
            leader: input.team.leader,
          }
        : undefined,
    };

    // 2. Compose team via registry
    const team = composeTeam(teamOptions, {
      getModels: () => deps.registry.getAll(),
      getById: (id) => deps.registry.getById(id),
    });

    // 3. Assemble engine deps
    const engineDeps: EngineDeps = {
      chat: deps.chat,
      buildProducerMessages,
      buildReviewerMessages,
      buildLeaderMessages,
    };

    // 4. Build engine config (only when overrides provided)
    const config: EngineConfig | undefined =
      input.maxRounds != null || input.consensus != null
        ? {
            maxRounds: input.maxRounds ?? 3,
            consensus: input.consensus ?? "leader_decides",
          }
        : undefined;

    // 5. Run deliberation
    const result = await deliberate(team, input, engineDeps, config);

    // 6. Auto-save to store (best-effort, errors are swallowed)
    if (deps.store) {
      try {
        await deps.store.save({
          id: crypto.randomUUID(),
          task: input.task,
          timestamp: Date.now(),
          perspectives: [...input.perspectives],
          consensusReached: result.consensusReached,
          roundsExecuted: result.roundsExecuted,
          result: result.result,
          modelsUsed: [...result.modelsUsed],
          totalLLMCalls: result.totalLLMCalls,
          producerInstructions: input.producerInstructions,
          leaderInstructions: input.leaderInstructions,
          consensus: input.consensus,
        });
      } catch {
        // best-effort save — do not fail the deliberation
      }
    }

    return result;
  };
}
