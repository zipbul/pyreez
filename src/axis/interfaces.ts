/**
 * Axis slot interfaces — 3-stage pipeline + LearningLayer.
 *
 * Stage 1: Understand — Profiler maps TaskClassification → AxisTaskRequirement
 * Stage 2: Select — ScoringSystem + Selector
 * Stage 3: Execute — DeliberationProtocol
 */

import type {
  TaskClassification,
  AxisTaskRequirement,
  EnsemblePlan,
  DeliberationResult,
  ModelScore,
  BudgetConfig,
  PairwiseResult,
  ChatFn,
} from "./types";

// -- Scoring --

/**
 * Scoring system — owns global (scores/models.json) + personal (.pyreez/learning/bt-ratings.json) BT ratings.
 * getScores() returns merged values. update() writes to personal only.
 */
export interface ScoringSystem {
  getScores(modelIds: string[]): Promise<ModelScore[]>;
  update(results: PairwiseResult[]): Promise<void>;
}

// -- Profiler --

/**
 * Profiler — maps TaskClassification to capability requirements.
 */
export interface Profiler {
  profile(input: TaskClassification): Promise<AxisTaskRequirement>;
}

// -- Selector --

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

// -- Deliberation --

/**
 * Deliberation protocol — coordinates multiple models to produce a final result.
 * scores parameter: role-based protocol uses it for role assignment.
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
 * Learning layer — cross-cutting concern that improves scoring over time.
 * L2: preference tracking (win/loss from deliberations)
 */
export interface LearningLayer {
  /**
   * Record call result. Fire-and-forget from PyreezEngine — errors are swallowed.
   */
  record(
    classified: TaskClassification,
    plan: EnsemblePlan,
    result: DeliberationResult,
  ): Promise<void>;

  /**
   * Apply personal corrections to scores.
   */
  enhance(
    scores: ModelScore[],
    classified: TaskClassification,
  ): Promise<ModelScore[]>;
}
