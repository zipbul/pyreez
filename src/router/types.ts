/**
 * Router/Selector types — model selection algorithm results.
 */

import type { ModelInfo } from "../model/types";

/**
 * Budget configuration (USD).
 */
export interface BudgetConfig {
  /** Max cost per single pyreez_run request. Default $1.00. */
  perRequest: number;
}

/**
 * Result of model selection for a single task.
 */
export interface SelectResult {
  /** Selected model. */
  model: ModelInfo;
  /** Composite score (weighted capability match). */
  score: number;
  /** Cost efficiency = score / expectedCost. */
  costEfficiency: number;
  /** Expected cost in USD for this task. */
  expectedCost: number;
  /** Human-readable reason for selection. */
  reason: string;
}

/**
 * When no model passes filters, fallback result with a warning.
 */
export interface FallbackSelectResult extends SelectResult {
  /** Constraints that were relaxed. */
  relaxedConstraints: string[];
  /** Warning message. */
  warning: string;
}

/**
 * Adaptive weight provider — supplies per-model boost based on historical performance.
 * D6: Adaptive Routing frame. Returns 0 when no data is available (graceful degradation).
 */
export interface AdaptiveWeightProvider {
  /** Performance boost for a model+taskType pair. Range clamped to [-1, +1]. 0 = no effect. */
  getBoost(modelId: string, taskType: string): number;
}

/** No-op adaptive weight — always returns 0 (existing routing behavior). */
export const nullAdaptiveWeight: AdaptiveWeightProvider = {
  getBoost: () => 0,
};
