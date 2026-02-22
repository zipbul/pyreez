/**
 * Integration Wiring — connects all deliberation modules.
 *
 * Exported:
 *   createChatAdapter — wraps a chat function into EngineDeps.chat signature
 *   createDeliberateFn — factory returning (DeliberateInput) => Promise<DeliberateOutput>
 *   WireDeps — dependency interface for the factory
 *
 * @see PLAN.md Section 2 (Deliberation 프로세스)
 */

import type { ChatMessage, ChatCompletionResponse } from "../llm/types";
import type { ModelInfo } from "../model/types";
import type { DeliberateInput, DeliberateOutput } from "./types";
import type { EngineDeps, EngineConfig } from "./engine";
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
}

// -- Chat Adapter --

type ChatFn = (
  request: { model: string; messages: ChatMessage[] },
) => Promise<ChatCompletionResponse>;

/**
 * Wrap a raw LLMClient-style chat function into the
 * `(model, messages) => Promise<string>` signature required by EngineDeps.
 */
export function createChatAdapter(
  chatFn: ChatFn,
): (model: string, messages: ChatMessage[]) => Promise<string> {
  return async (model, messages) => {
    const response = await chatFn({ model, messages });
    const choice = response.choices[0];
    return choice?.message?.content ?? "";
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
    return deliberate(team, input, engineDeps, config);
  };
}
