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

/**
 * Default thresholds: pyreez measurement-based, NOT from Aragora source.
 * Aragora docs/algorithms/CONVERGENCE.md describes the formula and the
 * consecutive_rounds_needed concept (default 1) but does not publish
 * specific score thresholds for converged/diverging classification.
 *
 * pyreez measurement (13 task types, multi-provider anthropic+openai+google,
 * single round, judge=anthropic/claude-haiku-4.5):
 *   HIGH cases (n=10):     0.630–0.680
 *   MODERATE cases (n=1):  0.431
 *   DIVERSE cases (n=2):   0.229–0.234
 *
 * 0.53 converged: midpoint of HIGH min (0.630) and MODERATE max (0.431).
 * 0.33 diverging: midpoint of MODERATE min (0.431) and DIVERSE max (0.234).
 *
 * Caveat: judge accuracy vs expectedLabel was only 38.5% in this run —
 * judge tends to over-classify as HIGH (e.g., controversial topics like
 * ethics/philosophy got HIGH despite expected DIVERSE). The score-based
 * status may actually be more accurate than the judge level. Use both
 * signals together; treat single-judge convergence level as one input,
 * not ground truth.
 *
 * Re-tune as the corpus grows. Override via ClassifyOptions.
 */
export const DEFAULT_CONVERGED_THRESHOLD = 0.53;
export const DEFAULT_DIVERGING_THRESHOLD = 0.33;

export interface ClassifyOptions {
  convergedThreshold?: number;
  divergingThreshold?: number;
  consecutiveRoundsNeeded?: number;
}

/**
 * Classify into 3-state status with consecutive-stable-rounds requirement.
 * Status logic source: synaptent/aragora CONVERGENCE.md — converged requires
 * both score threshold AND consecutive_stable_rounds >= consecutive_rounds_needed.
 * The 3-state taxonomy (converged/refining/diverging) is from the same source.
 */
export function classifyStatus(
  score: number,
  consecutiveStableRounds: number,
  consecutiveRoundsNeededOrOptions: number | ClassifyOptions = 1,
): ConvergenceStatus {
  const opts: ClassifyOptions = typeof consecutiveRoundsNeededOrOptions === "number"
    ? { consecutiveRoundsNeeded: consecutiveRoundsNeededOrOptions }
    : consecutiveRoundsNeededOrOptions;
  const conv = opts.convergedThreshold ?? DEFAULT_CONVERGED_THRESHOLD;
  const div = opts.divergingThreshold ?? DEFAULT_DIVERGING_THRESHOLD;
  const need = opts.consecutiveRoundsNeeded ?? 1;
  if (score >= conv && consecutiveStableRounds >= need) {
    return "converged";
  }
  if (score < div) return "diverging";
  return "refining";
}
