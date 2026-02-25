/**
 * Axis slot interfaces — 5-slot pipeline + LearningLayer.
 *
 * All slot interfaces use Promise<T> returns.
 * Sync variants resolve immediately. Async variants (LLM-based) resolve on completion.
 */

import type {
  ClassifyOutput,
  AxisTaskRequirement,
  EnsemblePlan,
  DeliberationResult,
  ModelScore,
  BudgetConfig,
  RouteHints,
  PairwiseResult,
  ChatFn,
} from "./types";

// -- Slot 1 --

/**
 * Scoring system — owns global (scores/models.json) + personal (.pyreez/learning/bt-ratings.json) BT ratings.
 * getScores() returns merged values. update() writes to personal only.
 */
export interface ScoringSystem {
  getScores(modelIds: string[]): Promise<ModelScore[]>;
  update(results: PairwiseResult[]): Promise<void>;
}

// -- Slot 2 --

/**
 * Classifier — classifies prompt into domain/taskType/complexity/criticality.
 * output.vocabKind tells Profiler which lookup table to use.
 */
export interface Classifier {
  classify(prompt: string, hints?: RouteHints): Promise<ClassifyOutput>;
}

// -- Slot 3 --

/**
 * Profiler — maps ClassifyOutput to capability requirements.
 * Must be compatible with the Classifier's vocabKind (see Classifier-Profiler matrix).
 */
export interface Profiler {
  profile(input: ClassifyOutput): Promise<AxisTaskRequirement>;
}

// -- Slot 4 --

/**
 * Selector — picks the best model(s) from scored candidates.
 */
export interface Selector {
  select(
    req: AxisTaskRequirement,
    scores: ModelScore[],
    budget: BudgetConfig,
  ): Promise<EnsemblePlan>;
}

// -- Slot 5 --

/**
 * Deliberation protocol — coordinates multiple models to produce a final result.
 * scores parameter: D2 (role-based) uses it for role assignment. Other protocols may ignore it.
 */
export interface DeliberationProtocol {
  deliberate(
    task: string,
    plan: EnsemblePlan,
    scores: ModelScore[],
    chat: ChatFn,
  ): Promise<DeliberationResult>;
}

// -- Learning Layer (optional) --

/**
 * Learning layer — cross-cutting concern that improves all slots over time.
 * L1 BT: delegated to ScoringSystem.
 * L2~L4: managed directly here (preference, MoE weights, MF).
 */
export interface LearningLayer {
  /**
   * Record call result. Internally: store → T3 Judge (if active) → L2~L4 update (async).
   * Fire-and-forget from PyreezEngine — errors are swallowed.
   */
  record(
    classified: ClassifyOutput,
    plan: EnsemblePlan,
    result: DeliberationResult,
  ): Promise<void>;

  /**
   * Apply L2~L4 personal corrections to scores.
   * L1 BT is already included in ScoringSystem.getScores() — do NOT re-apply.
   */
  enhance(
    scores: ModelScore[],
    classified: ClassifyOutput,
  ): Promise<ModelScore[]>;
}
