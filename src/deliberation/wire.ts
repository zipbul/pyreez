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

import type { ChatMessage, ChatCompletionResponse, FileAccess } from "../llm/types";
import type { ModelInfo } from "../model/types";
import type { DeliberateInput, DeliberateOutput, GenerationParams, Protocol } from "./types";
import type { ChatResult, EngineDeps, EngineConfig, FallbackDeps } from "./engine";
import { createFallbackPool } from "./engine";
import { splitSystemMessages } from "../llm/providers/message-util";
import type { DeliberationStore } from "./store-types";
import { composeTeam, scoreModel } from "./team-composer";
import { deliberate } from "./engine";
import { createCooldownManager } from "./cooldown";
import type { CooldownManager } from "./cooldown";
import type { TranscriptRecorder } from "./transcript";
import { scoreResponse, type RubricChatFn } from "../quality/rubric-judge";
import type { AffinityLogRecord } from "../model/affinity";
import {
  buildSharedConvergenceR1,
  buildSharedConvergenceR2,
  buildSharedConvergenceFollowUp,
  buildAdversarialDebateR1,
  buildAdversarialDebateR2,
  buildAdversarialDebateFollowUp,
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
  readonly cooldown?: CooldownManager;
  /** Optional transcript sink, forwarded to the engine to capture per-worker prompt+output. */
  readonly recordTranscript?: TranscriptRecorder;
  /** Optional affinity scorer: a fixed neutral judge used post-run to rate workers on the topic axes. */
  readonly judge?: { readonly model: string; readonly chat: RubricChatFn };
  /** Optional sink for a scored affinity record (one per worker). Best-effort, off the hot path. */
  readonly recordAffinity?: (record: AffinityLogRecord) => Promise<void> | void;
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
  request: {
    model: string;
    system?: string;
    messages: ChatMessage[];
    fileAccess?: FileAccess;
    webAccess?: boolean;
    reasoning_effort?: number;
    resumeSessionId?: string;
  },
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
): (model: string, messages: ChatMessage[], params?: GenerationParams, opts?: { resumeSessionId?: string }) => Promise<ChatResult> {
  return async (model, messages, params, opts) => {
    // Hoist the system block out of the message list once, here — providers receive it as a
    // first-class field and inject it their own way (native param vs framed into the prompt).
    const { system, conversation } = splitSystemMessages(messages);
    const response = await chatFn({
      model,
      messages: conversation,
      ...(system ? { system } : {}),
      ...(params?.fileAccess ? { fileAccess: params.fileAccess } : {}),
      // webAccess is tri-state: undefined = provider default (xai: web ON), false = forced no-lookup.
      ...(params?.webAccess != null ? { webAccess: params.webAccess } : {}),
      ...(params?.reasoning_effort != null ? { reasoning_effort: params.reasoning_effort } : {}),
      ...(opts?.resumeSessionId ? { resumeSessionId: opts.resumeSessionId } : {}),
    });
    const choice = response.choices[0];
    const raw = choice?.message?.content ?? "";
    const truncated = choice?.finish_reason === "length";
    return {
      content: stripThinkTags(raw),
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      ...(truncated ? { truncated } : {}),
      ...(response.sessionId ? { sessionId: response.sessionId } : {}),
    };
  };
}

// -- Protocol-specific EngineDeps builders --

/**
 * Create EngineDeps for a given protocol.
 * Each protocol wires its own prompt builders.
 */
function createEngineDepsForProtocol(
  protocol: Protocol,
  chatFn: (model: string, messages: ChatMessage[], params?: GenerationParams) => Promise<ChatResult>,
): EngineDeps {
  switch (protocol) {
    case "shared_convergence":
      return {
        chat: chatFn,
        buildR1Messages: (ctx, instructions, roundInfo, workerIndex) =>
          buildSharedConvergenceR1(ctx, instructions, roundInfo, workerIndex),
        buildR2Messages: (ctx, otherResponses, ownPrevious, instructions, roundInfo, workerIndex) =>
          buildSharedConvergenceR2(ctx, otherResponses, ownPrevious, instructions, roundInfo, workerIndex),
        buildFollowUp: (ctx, otherResponses, instructions, roundInfo, workerIndex) =>
          buildSharedConvergenceFollowUp(ctx, otherResponses, instructions, roundInfo, workerIndex),
      };
    case "adversarial_debate":
      return {
        chat: chatFn,
        // The adversarial prompt is tool-agnostic: it does not depend on web access (the worker's tool
        // set is wired separately by request.webAccess). So no web flag is threaded into the builders.
        buildR1Messages: (ctx, instructions, roundInfo, workerIndex) =>
          buildAdversarialDebateR1(ctx, instructions, roundInfo, workerIndex),
        buildR2Messages: (ctx, otherResponses, ownPrevious, instructions, roundInfo, workerIndex) =>
          buildAdversarialDebateR2(ctx, otherResponses, ownPrevious, instructions, roundInfo, workerIndex),
        buildFollowUp: (ctx, otherResponses, instructions, roundInfo, workerIndex) =>
          buildAdversarialDebateFollowUp(ctx, otherResponses, instructions, roundInfo, workerIndex),
      };
    case "host_interrogation":
    case "sequential_refinement":
    case "evaluation_scoring":
    case "red_team":
      // These protocols use specialized execution paths — R1 builder as default
      return {
        chat: chatFn,
        buildR1Messages: (ctx, instructions, roundInfo) =>
          buildSharedConvergenceR1(ctx, instructions, roundInfo),
      };
  }
}

// -- Default rounds per protocol --

function defaultMaxRounds(protocol: Protocol): number {
  switch (protocol) {
    case "shared_convergence": return 3;
    case "adversarial_debate": return 3;
    case "host_interrogation": return 1;
    case "sequential_refinement": return 1;
    case "evaluation_scoring": return 1;
    case "red_team": return 2;
    default: return 1;
  }
}

// -- Deliberate Factory --

/** Hard cap on worker count to prevent cost explosion. */
const MAX_WORKERS = 7;

/**
 * Create a fully-wired `deliberateFn` that can be passed to handlers.
 *
 * Host provides models (required) and protocol (required).
 * Wires: composeTeam + protocol-specific prompt builders + engine.deliberate + chat adapter.
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

    // 2. Protocol-specific minimum workers
    if (input.protocol === "red_team" && input.models.length < 2) {
      throw new Error("red_team protocol requires at least 2 models (generator + attacker)");
    }
    if (input.protocol === "adversarial_debate" && input.models.length < 2) {
      throw new Error("adversarial_debate protocol requires at least 2 models for meaningful opposition");
    }

    // 3. Determine effective count: clamp to [1, MAX_WORKERS]
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

    // 5. Assemble engine deps (protocol-specific prompt builders)
    const protocol = input.protocol;
    const engineDeps = createEngineDepsForProtocol(protocol, deps.chat);

    // 6. Build engine config
    const effectiveMaxRounds = input.maxRounds ?? defaultMaxRounds(protocol);
    const workerGenParams: GenerationParams = {
      ...(input.fileAccess ? { fileAccess: input.fileAccess } : {}),
      ...(input.webAccess != null ? { webAccess: input.webAccess } : {}),
      ...(input.reasoning_effort ? { reasoning_effort: input.reasoning_effort } : {}),
    };
    const config: EngineConfig = {
      maxRounds: effectiveMaxRounds,
      protocol,
      workerGenParams,
      ...(deps.recordTranscript ? { recordTranscript: deps.recordTranscript } : {}),
    };

    // 7. Build fallback pool + replenishment
    const allAvailable = deps.registry.getAvailable();
    const sortedByScore = [...allAvailable].sort(
      (a, b) => scoreModel(b) - scoreModel(a) || b.cost.outputPer1M - a.cost.outputPer1M,
    );
    const pool = createFallbackPool(sortedByScore, cooldown);
    const teamModelIds = new Set(team.workers.map((w) => w.model));

    const fallbackDeps: FallbackDeps = {
      pool,
      replenish(aliveProviders, emptySlots, respondedModels) {
        const candidates = sortedByScore.filter(
          (m: ModelInfo) => aliveProviders.has(m.provider) && !teamModelIds.has(m.id)
            && !cooldown.isOnCooldown(m.id) && !respondedModels.has(m.id),
        );
        if (candidates.length === 0) return [];

        return candidates.slice(0, emptySlots).map((m: ModelInfo) => ({
          model: m.id,
          role: "worker" as const,
        }));
      },
    };

    // 8. Run deliberation
    let result = await deliberate(team, input, engineDeps, config, fallbackDeps);

    // 9. Auto-save to store (best-effort)
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
          protocol,
          ...(result.rounds ? { roundsSummary: result.rounds.map(r => ({ number: r.number })) } : {}),
          ...(result.modelSwaps?.length ? { modelSwaps: result.modelSwaps } : {}),
        });
      } catch {
        // best-effort save — do not fail the deliberation
      }
    }

    // 10. Affinity scoring (best-effort, off the hot path): when the host authored a topic + axes,
    // score each final-round worker with the neutral judge and append one record per worker.
    if (deps.judge && deps.recordAffinity && input.topicPath?.length && input.axes?.length) {
      try {
        const finalRound = result.rounds?.[result.rounds.length - 1];
        const axes = input.axes;
        const topicPath = input.topicPath;
        for (const resp of finalRound?.responses ?? []) {
          // Don't let the judge score its own output — self-evaluation would bias the learned signal.
          if (resp.model === deps.judge.model) continue;
          const scores = await scoreResponse(deps.judge.chat, deps.judge.model, input.task, axes, resp.content);
          if (Object.keys(scores).length > 0) {
            await deps.recordAffinity({
              v: 1,
              ts: Date.now(),
              protocol,
              path: [...topicPath],
              model: resp.model,
              axes: scores,
            });
          }
        }
      } catch {
        // best-effort — affinity scoring must never fail the deliberation
      }
    }

    return result;
  };
}
