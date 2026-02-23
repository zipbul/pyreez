/**
 * BT Updater — update BT ratings from pairwise comparison results.
 *
 * Uses online Bradley-Terry update (simplified from MLE):
 * After comparison A vs B with outcome signal s:
 *   expected_A = mu_A / (mu_A + mu_B)
 *   surprise = s - expected_A (for signal > 0: A won)
 *   K_A = K_BASE * (sigma_A / SIGMA_BASE) // higher uncertainty → larger updates
 *   mu_A' = clamp(mu_A + K_A * surprise, 0, 1000)
 *   sigma_A' = sigma_A * SIGMA_DECAY
 */

import type { CapabilityDimension, DimensionRating } from "../model/types";
import { SIGMA_BASE } from "../model/types";
import type { PairwiseResult, PairwiseOutcome, BTUpdate } from "./types";
import { OUTCOME_SIGNAL } from "./types";

// -- Constants --

/** Base K-factor for BT update. */
export const K_BASE = 32;

/** Sigma decay per comparison. */
export const SIGMA_DECAY = 0.97;

/** Minimum sigma (maximum certainty). */
export const SIGMA_MIN = 50;

/** Anomaly threshold — flag if mu changes more than this in one update. */
export const ANOMALY_THRESHOLD = 100;

// -- Core Update --

/**
 * Bradley-Terry expected win probability: P(A beats B) = mu_A / (mu_A + mu_B).
 */
export function btExpected(muA: number, muB: number): number {
  if (muA + muB === 0) return 0.5;
  return muA / (muA + muB);
}

/**
 * Compute K-factor scaled by uncertainty.
 * Higher sigma → larger K → bigger rating change.
 */
export function scaledK(sigma: number): number {
  return K_BASE * (sigma / SIGMA_BASE);
}

/**
 * Convert a pairwise outcome to a numeric signal from A's perspective.
 * Positive = A wins, negative = B wins, 0 = tie.
 */
export function outcomeToSignal(outcome: PairwiseOutcome): number {
  return OUTCOME_SIGNAL[outcome];
}

/**
 * Perform a single BT update for one dimension.
 * Returns the updated rating for model A.
 */
export function updateRating(
  ratingA: DimensionRating,
  ratingB: DimensionRating,
  outcome: PairwiseOutcome,
): { updatedA: DimensionRating; updatedB: DimensionRating; anomaly: boolean } {
  const signal = outcomeToSignal(outcome);
  const expected = btExpected(ratingA.mu, ratingB.mu);

  // Surprise from A's perspective: positive signal means A should gain
  // For signal > 0 (A wins): surprise = signal * (1 - expected)
  // For signal < 0 (B wins): surprise = signal * expected
  // For signal = 0 (tie): no significant update
  const surprise =
    signal > 0
      ? signal * (1 - expected)
      : signal < 0
        ? signal * expected
        : 0;

  const kA = scaledK(ratingA.sigma);
  const kB = scaledK(ratingB.sigma);

  const newMuA = Math.max(0, Math.min(1000, ratingA.mu + kA * surprise));
  const newMuB = Math.max(0, Math.min(1000, ratingB.mu - kB * surprise));

  const newSigmaA = Math.max(SIGMA_MIN, ratingA.sigma * SIGMA_DECAY);
  const newSigmaB = Math.max(SIGMA_MIN, ratingB.sigma * SIGMA_DECAY);

  const anomaly =
    Math.abs(newMuA - ratingA.mu) > ANOMALY_THRESHOLD ||
    Math.abs(newMuB - ratingB.mu) > ANOMALY_THRESHOLD;

  return {
    updatedA: {
      mu: newMuA,
      sigma: newSigmaA,
      comparisons: ratingA.comparisons + 1,
    },
    updatedB: {
      mu: newMuB,
      sigma: newSigmaB,
      comparisons: ratingB.comparisons + 1,
    },
    anomaly,
  };
}

// -- Batch Update --

/**
 * Ratings store — mutable map of model → dimension → rating.
 */
export type RatingsMap = Map<string, Map<CapabilityDimension, DimensionRating>>;

/**
 * Get a rating from the map, returning a default if not found.
 */
export function getRating(
  ratings: RatingsMap,
  modelId: string,
  dimension: CapabilityDimension,
): DimensionRating {
  return (
    ratings.get(modelId)?.get(dimension) ?? {
      mu: 500,
      sigma: SIGMA_BASE,
      comparisons: 0,
    }
  );
}

/**
 * Set a rating in the map.
 */
export function setRating(
  ratings: RatingsMap,
  modelId: string,
  dimension: CapabilityDimension,
  rating: DimensionRating,
): void {
  if (!ratings.has(modelId)) ratings.set(modelId, new Map());
  ratings.get(modelId)!.set(dimension, rating);
}

/**
 * Apply a batch of pairwise results to update ratings.
 * Each result updates all dimensions that the prompt measures.
 */
export function batchUpdate(
  ratings: RatingsMap,
  results: PairwiseResult[],
  promptDimensions: Map<string, CapabilityDimension[]>,
): { updates: BTUpdate[]; anomalies: BTUpdate[] } {
  const updates: BTUpdate[] = [];
  const anomalies: BTUpdate[] = [];

  for (const result of results) {
    const dimensions = promptDimensions.get(result.promptId);
    if (!dimensions) continue;

    for (const dim of dimensions) {
      const ratingA = getRating(ratings, result.modelA, dim);
      const ratingB = getRating(ratings, result.modelB, dim);

      const { updatedA, updatedB, anomaly } = updateRating(
        ratingA,
        ratingB,
        result.outcome,
      );

      const updateA: BTUpdate = {
        modelId: result.modelA,
        dimension: dim,
        oldMu: ratingA.mu,
        newMu: updatedA.mu,
        oldSigma: ratingA.sigma,
        newSigma: updatedA.sigma,
        comparisons: updatedA.comparisons,
      };

      const updateB: BTUpdate = {
        modelId: result.modelB,
        dimension: dim,
        oldMu: ratingB.mu,
        newMu: updatedB.mu,
        oldSigma: ratingB.sigma,
        newSigma: updatedB.sigma,
        comparisons: updatedB.comparisons,
      };

      setRating(ratings, result.modelA, dim, updatedA);
      setRating(ratings, result.modelB, dim, updatedB);

      updates.push(updateA, updateB);
      if (anomaly) {
        anomalies.push(updateA, updateB);
      }
    }
  }

  return { updates, anomalies };
}

// -- Bootstrap CI --

/**
 * Compute bootstrap confidence interval for a model's mu on a dimension.
 * Resamples the pairwise results and recalculates.
 */
export function bootstrapCI(
  results: PairwiseResult[],
  modelId: string,
  dimension: CapabilityDimension,
  promptDimensions: Map<string, CapabilityDimension[]>,
  iterations: number = 100,
): { lower: number; upper: number; median: number } {
  const mus: number[] = [];

  for (let i = 0; i < iterations; i++) {
    // Resample with replacement
    const resampled = Array.from(
      { length: results.length },
      () => results[Math.floor(Math.random() * results.length)],
    );

    const ratings: RatingsMap = new Map();
    batchUpdate(ratings, resampled, promptDimensions);

    const rating = getRating(ratings, modelId, dimension);
    mus.push(rating.mu);
  }

  mus.sort((a, b) => a - b);
  const lower = mus[Math.floor(iterations * 0.025)];
  const upper = mus[Math.floor(iterations * 0.975)];
  const median = mus[Math.floor(iterations * 0.5)];

  return { lower, upper, median };
}
