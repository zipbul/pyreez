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

  async run(
    prompt: string,
    budget: BudgetConfig,
    hints?: RouteHints,
  ): Promise<DeliberationResult> {
    // TODO: Phase 7 — T2 bypass 체크 (슬롯 2-3-4 건너뛰고 EnsemblePlan 직접 생산)

    // Slot 1: get scores (global + personal merged)
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

    // Single-model shortcut: skip deliberation
    if (plan.models.length === 1) {
      const response = await this.chat(plan.models[0]!.modelId, prompt);
      const result: DeliberationResult = {
        result: response,
        roundsExecuted: 0,
        consensusReached: true,
        totalLLMCalls: 1,
        modelsUsed: [plan.models[0]!.modelId],
        protocol: "single",
      };

      // Learning Layer: fire-and-forget record
      if (this.learner) {
        this.learner.record(classified, plan, result).catch(() => {});
      }

      return result;
    }

    // Slot 5: deliberate
    const result = await this.deliberation.deliberate(
      prompt,
      plan,
      scores,
      this.chat,
    );

    // Learning Layer: fire-and-forget record
    if (this.learner) {
      this.learner.record(classified, plan, result).catch(() => {});
    }

    return result;
  }
}
