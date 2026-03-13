/**
 * PyreezEngine — 3-stage pipeline compositor.
 *
 * Orchestrates: Scoring → (LearningLayer.enhance) → Profile → Select → Deliberate
 * Classification is provided by the host agent (not done server-side).
 * LearningLayer is optional. When provided: enhance() before select, record() after deliberate (fire-and-forget).
 * CooldownManager is optional. When provided: pre-filters unhealthy models before scoring.
 */

import type {
  ScoringSystem,
  Profiler,
  Selector,
  DeliberationProtocol,
  DeliberationOverrides,
  LearningLayer,
} from "./interfaces";
import type {
  BudgetConfig,
  ChatFn,
  TaskClassification,
  DeliberationResult,
  SlotTrace,
  RunTrace,
} from "./types";
import type { CooldownManager } from "../deliberation/cooldown";

export class PyreezEngine {
  constructor(
    private readonly scoring: ScoringSystem,
    private readonly profiler: Profiler,
    private readonly selector: Selector,
    private readonly deliberation: DeliberationProtocol,
    private readonly chat: ChatFn,
    private readonly modelIds: string[],
    private readonly learner?: LearningLayer,
    /** Shared CooldownManager for pre-filtering unhealthy models. */
    private readonly cooldown?: CooldownManager,
  ) {}

  /** Run Stage 1-2 only (no LLM calls). For benchmark dry mode. */
  async traceOnly(
    _prompt: string,
    budget: BudgetConfig,
    classification: TaskClassification,
  ): Promise<SlotTrace> {
    // Pre-filter: exclude models currently on cooldown
    let effectiveModelIds = this.modelIds;
    if (this.cooldown) {
      const cooled = this.cooldown.getCooledDownIds();
      if (cooled.size > 0) {
        const filtered = this.modelIds.filter((id) => !cooled.has(id));
        // Only apply filter if at least 1 model remains (never filter all)
        if (filtered.length > 0) {
          effectiveModelIds = filtered;
        }
      }
    }

    // Scoring: get BT ratings
    let scores = await this.scoring.getScores(effectiveModelIds);

    // Learning Layer: apply L2~L4 personal corrections (optional)
    if (this.learner) {
      scores = await this.learner.enhance(scores, classification);
    }

    // Stage 1: profile lookup
    const requirement = await this.profiler.profile(classification);

    // Stage 2: select
    const plan = await this.selector.select(requirement, scores, budget);

    return { scores, classified: classification, requirement, plan };
  }

  /** Run full 3-stage pipeline and return intermediate trace + result. */
  async runWithTrace(
    prompt: string,
    budget: BudgetConfig,
    classification: TaskClassification,
    deliberationOverrides?: DeliberationOverrides,
  ): Promise<RunTrace> {
    const trace = await this.traceOnly(prompt, budget, classification);
    const { scores, plan } = trace;

    const sessionId = crypto.randomUUID();
    let result: DeliberationResult;

    // Single-model shortcut: skip deliberation
    if (plan.models.length === 1) {
      const chatResult = await this.chat(plan.models[0]!.modelId, prompt);
      result = {
        result: chatResult.content,
        roundsExecuted: 0,
        consensusReached: null,
        totalLLMCalls: 1,
        modelsUsed: [plan.models[0]!.modelId],
        protocol: "single",
        sessionId,
      };
    } else {
      // Stage 3: deliberate
      const raw = await this.deliberation.deliberate(
        prompt,
        plan,
        scores,
        this.chat,
        deliberationOverrides,
      );
      result = { ...raw, sessionId };
    }

    // Learning Layer: fire-and-forget record
    if (this.learner) {
      this.learner.record(classification, plan, result).catch(() => {});
    }

    return { ...trace, result };
  }

  /** Run full 3-stage pipeline and return the final result. */
  async run(
    prompt: string,
    budget: BudgetConfig,
    classification: TaskClassification,
    deliberationOverrides?: DeliberationOverrides,
  ): Promise<DeliberationResult> {
    return (await this.runWithTrace(prompt, budget, classification, deliberationOverrides)).result;
  }
}
