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
import { composeTeam, NoModelsAvailableError } from "./team-composer";
import { deliberate } from "./engine";
import { createCooldownManager } from "./cooldown";
import type { CooldownManager } from "./cooldown";
import type { TranscriptRecorder } from "./transcript";
import type { FileIO } from "../report/types";
import { scoreDeliberation } from "../quality/scoring";
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
 * Wiring for the post-run scoring hook (best-effort, off the hot path). `enabled` is the
 * `--no-scoring` kill switch — protocol-level gating (SC/ADV default-on, eval opt-in) lives inside
 * the hook itself (scoreDeliberation), since it depends on `input.protocol`, which isn't known yet
 * at the point these deps are constructed (once, in cli.ts's buildConfig()).
 */
export interface ScoringWireDeps {
  readonly fileIO: FileIO;
  readonly enabled: boolean;
  /** eval(evaluation_scoring)은 1R 프로토콜 오버헤드가 커 기본 OFF — --score-eval로만 켠다. */
  readonly scoreEvalEnabled?: boolean;
  /** Test seam — default Date.now/Math.random. */
  readonly now?: () => number;
  readonly rng?: () => number;
}

/**
 * Dependencies for creating a deliberate function.
 */
export interface WireDeps {
  readonly registry: {
    getAvailable(): ModelInfo[];
    getById(id: string): ModelInfo | undefined;
  };
  readonly chat: (model: string, messages: ChatMessage[], params?: GenerationParams) => Promise<ChatResult>;
  /** Shared CooldownManager (process-scoped). When omitted, a per-call instance is created. */
  readonly cooldown?: CooldownManager;
  /** Optional transcript sink, forwarded to the engine to capture per-worker prompt+output. */
  readonly recordTranscript?: TranscriptRecorder;
  /** Optional post-run scoring hook wiring. Absent = scoring never runs (equivalent to --no-scoring). */
  readonly scoring?: ScoringWireDeps;

  // -- Test seam --
  // Override the team-composition / engine collaborators below. Each defaults to the real
  // implementation from ./team-composer and ./engine — only test code should ever set these.
  // This exists so unit tests can inject fakes directly instead of mock.module()'ing "./engine" /
  // "./team-composer": mock.module() rewrites Bun's process-wide module registry and isn't
  // restored between test files, so a test that mocks these modules leaks its stubs into every
  // other file that imports the real wire.ts afterward in the same `bun test` run.
  readonly composeTeam?: typeof composeTeam;
  readonly deliberate?: typeof deliberate;
  readonly createFallbackPool?: typeof createFallbackPool;
  readonly scoreDeliberation?: typeof scoreDeliberation;
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
    return {
      content: stripThinkTags(response.content),
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
      // Each of these runs its own executor, which overrides buildR1Messages with the prompt its
      // protocol actually needs. Nothing should ever fall back to this outer builder — a worker that
      // did would be asked shared_convergence's analysis question instead of, say, attacking a draft.
      // It used to default to buildSharedConvergenceR1, which produced exactly that wrong prompt in
      // silence; throwing makes the mistake impossible to miss.
      return {
        chat: chatFn,
        buildR1Messages: () => {
          throw new Error(
            `${protocol} builds its worker prompts inside its own round executor; the protocol-level R1 builder must not be used`,
          );
        },
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
    // Test seam (see WireDeps) — real implementations unless a test overrides them.
    const doComposeTeam = deps.composeTeam ?? composeTeam;
    const doCreateFallbackPool = deps.createFallbackPool ?? createFallbackPool;
    const runDeliberate = deps.deliberate ?? deliberate;
    const doScoreDeliberation = deps.scoreDeliberation ?? scoreDeliberation;

    const cooldown = deps.cooldown ?? createCooldownManager();

    // 1. Validate models array non-empty and all IDs exist in registry
    if (!input.models.length) {
      throw new NoModelsAvailableError("No models given to deliberate on. At least one is required.");
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
    let team = doComposeTeam(
      { task: input.task, modelIds },
      {
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
    // Fallback candidates in discovery order. There is no quality ranking to sort by: discovery
    // reports only id + provider, so any "best model first" ordering would be invented. What makes
    // the pick safe is the pool's own logic — same-provider first, cooldown-excluded, no duplicates.
    const allAvailable = deps.registry.getAvailable();
    const pool = doCreateFallbackPool(allAvailable, cooldown);
    const teamModelIds = new Set(team.workers.map((w) => w.model));

    const fallbackDeps: FallbackDeps = {
      pool,
      replenish(aliveProviders, emptySlots, respondedModels) {
        const candidates = allAvailable.filter(
          (m: ModelInfo) => aliveProviders.has(m.provider) && !teamModelIds.has(m.id)
            && !cooldown.isOnCooldown(m.id) && !respondedModels.has(m.id),
        );
        if (candidates.length === 0) return [];

        return candidates.slice(0, emptySlots).map((m: ModelInfo) => ({
          model: m.id,
        }));
      },
    };

    // 8. Run deliberation
    let result = await runDeliberate(team, input, engineDeps, config, fallbackDeps);


    // 9. Scoring hook (best-effort, off the hot path): score R1 with a 3-judge panel and fold the
    // (model, protocol, topic, axis) medians into ratings.json. Protocol/eval gating (SC/ADV
    // default-on, eval opt-in) lives inside the hook — it needs input.protocol, which isn't known
    // yet at the point deps.scoring is constructed. scoreDeliberation never throws by contract; the
    // try/catch here is defense in depth (matches the old affinity block's own belt-and-suspenders).
    if (deps.scoring?.enabled) {
      try {
        await doScoreDeliberation(input, result, {
          chat: deps.chat,
          fileIO: deps.scoring.fileIO,
          now: deps.scoring.now ?? Date.now,
          rng: deps.scoring.rng ?? Math.random,
          ...(input.topicPath?.length ? { hostTopicPath: input.topicPath } : {}),
          scoreEvalEnabled: deps.scoring.scoreEvalEnabled ?? false,
        });
      } catch {
        // best-effort — scoring must never fail the deliberation
      }
    }

    return result;
  };
}
