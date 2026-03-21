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
import { composeTeam, orderWorkersByRole } from "./team-composer";
import type { SkillCellStore } from "../model/skillcell-store";
import type { ExternalEvaluator } from "./external-evaluator";
import { deliberate } from "./engine";
import { createCooldownManager } from "./cooldown";
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
  /** Shared CooldownManager (process-scoped). When omitted, a per-call instance is created. */
  readonly cooldown?: import("./cooldown").CooldownManager;
  /** SkillCell store for evaluator SkillCell updates. */
  readonly skillCellStore?: SkillCellStore;
  /** External evaluator for binary dimension feedback. */
  readonly externalEvaluator?: ExternalEvaluator;
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

/** Hard cap on worker count to prevent cost explosion. */
const MAX_WORKERS = 7;

/**
 * Create a fully-wired `deliberateFn` that can be passed to PyreezMcpServer.
 *
 * Host provides models (required) and optional count.
 * Wires: composeTeam + prompt builders + engine.deliberate + chat adapter.
 */
export function createDeliberateFn(
  deps: WireDeps,
): (input: DeliberateInput) => Promise<DeliberateOutput> {
  return async (input) => {
    const cooldown = deps.cooldown ?? createCooldownManager();

    // 1. Validate models array non-empty and all IDs exist in registry
    if (!input.models.length) {
      throw new Error("models is required (min 1)");
    }
    const invalid = input.models.filter((id) => !deps.registry.getById(id));
    if (invalid.length > 0) {
      const available = deps.registry.getAvailable().map((m) => m.id);
      throw new Error(
        `Unknown model(s): ${invalid.join(", ")}. Available: ${available.join(", ")}`,
      );
    }

    // 2. Determine effective count: clamp to [1, MAX_WORKERS]
    const effectiveCount = Math.min(
      Math.max(input.count ?? input.models.length, 1),
      MAX_WORKERS,
    );

    // 3. Build model list: take first `effectiveCount` from models,
    //    round-robin duplicate if count > models.length
    const modelIds: string[] = [];
    for (let i = 0; i < effectiveCount; i++) {
      modelIds.push(input.models[i % input.models.length]!);
    }

    // 4. Compose team
    const specifiedModels = modelIds
      .map((id) => deps.registry.getById(id)!)
      .filter(Boolean);
    let team = composeTeam(
      { task: input.task, modelIds },
      {
        getModels: () => specifiedModels,
        getById: (id) => deps.registry.getById(id),
      },
    );

    // 5. Reorder workers by capability → role fit
    const orderedWorkers = orderWorkersByRole(team.workers, (id) => deps.registry.getById(id));
    team = { workers: orderedWorkers };

    // 6. Assemble engine deps
    const engineDeps: EngineDeps = {
      chat: deps.chat,
      buildWorkerMessages,
      buildDebateWorkerMessages,
      buildColdJoinMessages,
    };

    // 7. Build engine config
    const isDebate = input.protocol === "debate";
    const effectiveMaxRounds = input.maxRounds ?? (isDebate ? 3 : 1);
    const workerGenParams: GenerationParams = {
      temperature: 1.0,
      max_tokens: 2048,
    };
    const config: EngineConfig = {
      maxRounds: effectiveMaxRounds,
      protocol: input.protocol,
      workerGenParams,
    };

    // 8. Build fallback pool + replenishment
    //    Fallback: cost descending (expensive = likely more capable)
    const allAvailable = deps.registry.getAvailable();
    const sortedByCost = [...allAvailable].sort(
      (a, b) => b.cost.outputPer1M - a.cost.outputPer1M,
    );
    const pool = createFallbackPool(sortedByCost, cooldown);
    const teamModelIds = new Set(team.workers.map((w) => w.model));

    const fallbackDeps: FallbackDeps = {
      pool,
      replenish(aliveProviders, emptySlots, respondedModels) {
        // Select replacement models from alive providers, cost descending
        const candidates = sortedByCost.filter(
          (m) => aliveProviders.has(m.provider) && !teamModelIds.has(m.id)
            && !cooldown.isOnCooldown(m.id) && !respondedModels.has(m.id),
        );
        if (candidates.length === 0) return [];

        // Take top N by cost (already sorted)
        return candidates.slice(0, emptySlots).map((m) => ({
          model: m.id,
          role: "worker" as const,
        }));
      },
    };

    // 9. Run deliberation
    let result = await deliberate(team, input, engineDeps, config, fallbackDeps);

    // 10. External evaluator → SkillCell update (best-effort)
    if (deps.externalEvaluator && deps.skillCellStore && result.rounds && input.domain) {
      try {
        const lastRound = result.rounds[result.rounds.length - 1];
        if (lastRound?.responses) {
          const teamProviders = new Set(
            result.modelsUsed.map((id) => deps.registry.getById(id)?.provider).filter(Boolean) as string[],
          );
          const deliberationId = crypto.randomUUID();
          const taskType = input.taskType ?? "QUESTION_ANSWER";
          for (const response of lastRound.responses) {
            try {
              const feedback = await deps.externalEvaluator.evaluate(
                input.task, response.model, response.content ?? "",
                input.domain, taskType, deliberationId, teamProviders,
              );
              deps.skillCellStore.update(feedback);
            } catch {
              // Per-worker evaluation failure — skip this worker, continue others
            }
          }
          await deps.skillCellStore.save();
        }
      } catch {
        // best-effort — do not fail deliberation
      }
    }

    // 11. Auto-save to store (best-effort)
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
