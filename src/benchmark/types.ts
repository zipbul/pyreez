/**
 * Routing benchmark types.
 */

export interface BenchmarkCase {
  id: string;
  domain: string;
  taskType: string;
  complexity: "simple" | "moderate" | "complex";
  /** Ground truth: model ID → quality score (0~10). */
  modelQualities: Record<string, number>;
}

export interface SelectorResult {
  selectorName: string;
  totalCases: number;
  /** Fraction of cases where the selector picked the best model. */
  exactMatchRate: number;
  /** Average (selected quality / best quality). 1.0 = always optimal. */
  qualityRatio: number;
  /** Average regret: best - selected quality. 0 = no regret. */
  avgRegret: number;
  /** Win rate vs random selection baseline. */
  winRateVsRandom: number;
}
