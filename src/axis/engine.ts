/**
 * PyreezEngine — 3-stage pipeline compositor.
 *
 * Orchestrates: Scoring → (LearningLayer.enhance) → Profile → Select → Deliberate
 * Classification is provided by the host agent (not done server-side).
 * LearningLayer is optional. When provided: enhance() before select, record() after deliberate (fire-and-forget).
 */

import type {
  ScoringSystem,
  Profiler,
  Selector,
  DeliberationProtocol,
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

export class PyreezEngine {
  constructor(
    private readonly scoring: ScoringSystem,
    private readonly profiler: Profiler,
    private readonly selector: Selector,
    private readonly deliberation: DeliberationProtocol,
    private readonly chat: ChatFn,
    private readonly modelIds: string[],
    private readonly learner?: LearningLayer,
  ) {}

  /** Run Stage 1-2 only (no LLM calls). For benchmark dry mode. */
  async traceOnly(
    prompt: string,
    budget: BudgetConfig,
    classification: TaskClassification,
  ): Promise<SlotTrace> {
    // Scoring: get BT ratings
    let scores = await this.scoring.getScores(this.modelIds);

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
  ): Promise<RunTrace> {
    const trace = await this.traceOnly(prompt, budget, classification);
    const { scores, plan } = trace;

    let result: DeliberationResult;

    // Single-model shortcut: skip deliberation
    if (plan.models.length === 1) {
      const response = await this.chat(plan.models[0]!.modelId, prompt);
      result = {
        result: response,
        roundsExecuted: 0,
        consensusReached: true,
        totalLLMCalls: 1,
        modelsUsed: [plan.models[0]!.modelId],
        protocol: "single",
      };
    } else {
      // Stage 3: deliberate
      result = await this.deliberation.deliberate(
        prompt,
        plan,
        scores,
        this.chat,
      );
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
  ): Promise<DeliberationResult> {
    return (await this.runWithTrace(prompt, budget, classification)).result;
  }
}
