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
import type { ModelInfo } from "../model/types";
import type { DeliberateInput, DeliberateOutput, GenerationParams } from "./types";
import type { ChatResult, EngineDeps, EngineConfig, FallbackDeps } from "./engine";
import { createFallbackPool } from "./engine";
import type { DeliberationStore } from "./store-types";
import type { ScoringSystem } from "../axis/interfaces";
import type { PollJudgeConfig } from "./poll-judge";
import { composeTeam, selectDiverseModels, orderWorkersByRole } from "./team-composer";
import { deliberate } from "./engine";
import { createCooldownManager } from "./cooldown";
import { evaluateWithPoll } from "./poll-judge";
import {
  buildWorkerMessages,
  buildDebateWorkerMessages,
  buildColdJoinMessages,
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
 * Wrap a raw LLMClient-style chat function into the
 * `(model, messages) => Promise<ChatResult>` signature required by EngineDeps.
 *
 * No retry logic — errors are thrown immediately.
 * Per-worker fallback is handled by the deliberation engine (FallbackPool).
 */
export function createChatAdapter(
  chatFn: RawChatFn,
): (model: string, messages: ChatMessage[], params?: GenerationParams) => Promise<ChatResult> {
  return async (model, messages, params) => {
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
      // All specified models are workers.
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
      // Artifact tasks: 3 workers. Critique: 5 workers.
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
    team = { workers: orderedWorkers };

    // 3. Assemble engine deps — deps.chat already returns ChatResult
    const engineDeps: EngineDeps = {
      chat: deps.chat,
      buildWorkerMessages,
      buildDebateWorkerMessages,
      buildColdJoinMessages,
    };

    // 4. Build engine config
    const isDebate = input.protocol === "debate";
    const effectiveMaxRounds = input.maxRounds
      ?? (isDebate ? 3 : 1);
    const workerGenParams: GenerationParams = {
      temperature: 1.0,
      max_tokens: 2048,
    };
    const config: EngineConfig = {
      maxRounds: effectiveMaxRounds,
      protocol: input.protocol,
      workerGenParams,
    };

    // 5. Build fallback pool (auto mode only; manual mode = no fallback per D8)
    let fallbackDeps: FallbackDeps | undefined;
    if (!input.models) {
      const cooldown = deps.cooldown ?? createCooldownManager();
      const available = deps.registry.getAvailable();
      const pool = createFallbackPool(available, cooldown);
      fallbackDeps = { pool };
    }

    // 6. Run deliberation
    let result = await deliberate(team, input, engineDeps, config, fallbackDeps);

    // 7. PoLL quality evaluation + BT update (best-effort)
    if (deps.pollJudge && deps.scoring && result.rounds) {
      try {
        const lastRound = result.rounds[result.rounds.length - 1];
        if (lastRound?.responses && lastRound.responses.length >= 2) {
          const teamIds = new Set(result.modelsUsed as string[]);
          const workerResponses = lastRound.responses.map((r, idx) => ({
            model: r.model,
            content: r.content,
            workerIndex: idx,
            ...(r.role ? { role: r.role as import("./types").DeliberationRole } : {}),
          }));
          const pollResult = await evaluateWithPoll(
            input.task, workerResponses, teamIds, deps.pollJudge,
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
          roundsExecuted: result.roundsExecuted,
          modelsUsed: [...result.modelsUsed],
          totalLLMCalls: result.totalLLMCalls,
          totalTokens: result.totalTokens,
          workerInstructions: input.workerInstructions,
          protocol: input.protocol,
          ...(result.rounds ? { roundsSummary: result.rounds.map(r => ({ number: r.number })) } : {}),
          ...(result.modelSwaps?.length ? { modelSwaps: result.modelSwaps } : {}),
        });
      } catch {
        // best-effort save — do not fail the deliberation
      }
    }

    return result;
  };
}
