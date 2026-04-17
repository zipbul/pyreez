/**
 * Multi-component convergence score.
 *
 * Pattern from synaptent/aragora docs/algorithms/CONVERGENCE.md (Feb 2026):
 * single similarity metric is insufficient — combine semantic agreement,
 * lexical diversity, evidence overlap, and round-over-round stability into
 * a weighted score, then classify into converged/refining/diverging with a
 * consecutive-stable-rounds requirement.
 *
 * Our text-distance-only signals (Phase 2/3/7) measured as dead in practice
 * because Levenshtein alone misses semantic agreement. This module composes
 * the four components Aragora identifies, using LLM-judge convergence for
 * the semantic axis (since we lack embeddings).
 *
 * @module quality/convergence-score
 */

export interface ConvergenceComponents {
  /** Semantic agreement: 1.0 = HIGH (same conclusion), 0.0 = DIVERSE. */
  readonly semantic: number;
  /** Lexical diversity: 0.0 = identical wording, 1.0 = maximally different.
   * Lower diversity → more converged (formula inverts this). */
  readonly diversity: number;
  /** Evidence/citation overlap: 1.0 = fully shared sources, 0.0 = no overlap. */
  readonly evidence: number;
  /** Round-over-round stability: 1.0 = identical to previous round, 0.0 = volatile.
   * Already-inverted volatility (1 - volatility). For single-round runs, use 1.0
   * (no prior round to be unstable against). */
  readonly stability: number;
}

const WEIGHTS = {
  semantic: 0.4,
  diversity: 0.2,
  evidence: 0.2,
  stability: 0.2,
} as const;

/**
 * Aragora-weighted overall convergence score in [0, 1].
 * Source: https://github.com/synaptent/aragora/blob/main/docs/algorithms/CONVERGENCE.md
 *   score = semantic*0.4 + (1-diversity)*0.2 + evidence*0.2 + (1-volatility)*0.2
 * We pass `stability` as already-inverted volatility, so the formula simplifies.
 */
export function computeConvergenceScore(c: ConvergenceComponents): number {
  const raw =
    c.semantic * WEIGHTS.semantic +
    (1 - c.diversity) * WEIGHTS.diversity +
    c.evidence * WEIGHTS.evidence +
    c.stability * WEIGHTS.stability;
  return Math.max(0, Math.min(1, raw));
}

export type ConvergenceStatus = "converged" | "refining" | "diverging";

const CONVERGED_THRESHOLD = 0.85;
const DIVERGING_THRESHOLD = 0.40;

/**
 * Classify into 3-state status with consecutive-stable-rounds requirement.
 * Source: synaptent/aragora CONVERGENCE.md — converged requires both score
 * threshold AND `consecutive_stable_rounds >= consecutive_rounds_needed`.
 *
 * Default consecutive_rounds_needed = 1 (Aragora default).
 */
export function classifyStatus(
  score: number,
  consecutiveStableRounds: number,
  consecutiveRoundsNeeded: number = 1,
): ConvergenceStatus {
  if (score >= CONVERGED_THRESHOLD && consecutiveStableRounds >= consecutiveRoundsNeeded) {
    return "converged";
  }
  if (score < DIVERGING_THRESHOLD) return "diverging";
  return "refining";
}
