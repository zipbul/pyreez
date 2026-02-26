/**
 * PyreezEngine — 5-slot pipeline compositor.
 *
 * Orchestrates: Scoring → Classify → (LearningLayer.enhance) → Profile → Select → Deliberate
 * LearningLayer is optional. When provided: enhance() before select, record() after deliberate (fire-and-forget).
 */

import type {
  ScoringSystem,
  Classifier,
  Profiler,
  Selector,
  DeliberationProtocol,
  LearningLayer,
} from "./interfaces";
import type {
  BudgetConfig,
  ChatFn,
  DeliberationResult,
  RouteHints,
  SlotTrace,
  RunTrace,
} from "./types";

export class PyreezEngine {
  constructor(
    private readonly scoring: ScoringSystem,
    private readonly classifier: Classifier,
    private readonly profiler: Profiler,
    private readonly selector: Selector,
    private readonly deliberation: DeliberationProtocol,
    private readonly chat: ChatFn,
    private readonly modelIds: string[],
    private readonly learner?: LearningLayer,
  ) {}

  /** Run Slot 1-4 only (no LLM calls). For benchmark dry mode. */
  async traceOnly(
    prompt: string,
    budget: BudgetConfig,
    hints?: RouteHints,
  ): Promise<SlotTrace> {
    // Slot 1: get scores
    let scores = await this.scoring.getScores(this.modelIds);

    // Slot 2: classify
    const classified = await this.classifier.classify(prompt, hints);

    // Learning Layer: apply L2~L4 personal corrections (optional)
    if (this.learner) {
      scores = await this.learner.enhance(scores, classified);
    }

    // Slot 3→4: profile → select
    const requirement = await this.profiler.profile(classified);
    const plan = await this.selector.select(requirement, scores, budget);

    return { scores, classified, requirement, plan };
  }

  /** Run full 5-slot pipeline and return intermediate trace + result. */
  async runWithTrace(
    prompt: string,
    budget: BudgetConfig,
    hints?: RouteHints,
  ): Promise<RunTrace> {
    const trace = await this.traceOnly(prompt, budget, hints);
    const { scores, classified, plan } = trace;

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
      // Slot 5: deliberate
      result = await this.deliberation.deliberate(
        prompt,
        plan,
        scores,
        this.chat,
      );
    }

    // Learning Layer: fire-and-forget record
    if (this.learner) {
      this.learner.record(classified, plan, result).catch(() => {});
    }

    return { ...trace, result };
  }

  /** Run full 5-slot pipeline and return the final result. */
  async run(
    prompt: string,
    budget: BudgetConfig,
    hints?: RouteHints,
  ): Promise<DeliberationResult> {
    return (await this.runWithTrace(prompt, budget, hints)).result;
  }
}
