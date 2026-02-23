/**
 * Calibration Loop — real usage results → BT rating auto-update.
 *
 * Extracts pairwise comparison signals from usage data (CallRecords)
 * and updates BT mu/sigma via online updates.
 *
 * Key features:
 * - CallRecord → pairwise signal extraction (same task, different models)
 * - Sigma convergence monitoring
 * - Anomaly detection (sudden mu shifts)
 * - Stale model detection (high sigma after many rounds)
 */

import type { CapabilityDimension, DimensionRating } from "../model/types";
import { SIGMA_BASE } from "../model/types";
import type { CallRecord } from "../report/types";
import type { PairwiseOutcome, PairwiseResult } from "../evaluation/types";
import {
  updateRating,
  getRating,
  setRating,
  SIGMA_MIN,
  ANOMALY_THRESHOLD,
  type RatingsMap,
} from "../evaluation/bt-updater";

// -- Constants --

/** Quality score threshold for "strong" signals. */
export const STRONG_QUALITY_DIFF = 3;

/** Minimum quality difference to generate a comparison. */
export const MIN_QUALITY_DIFF = 1;

/** Sigma threshold for marking a model as "converged". */
export const SIGMA_CONVERGED = 100;

/** Sigma threshold for marking a model as "stale" (needs re-evaluation). */
export const SIGMA_STALE = 300;

// -- Task → Dimension Mapping --

/**
 * Map a task type to the primary capability dimensions it exercises.
 */
export function taskToDimensions(taskType: string): CapabilityDimension[] {
  const map: Record<string, CapabilityDimension[]> = {
    CODE_WRITE: ["CODE_GENERATION", "REASONING"],
    CODE_REVIEW: ["CODE_UNDERSTANDING", "ANALYSIS"],
    CODE_DEBUG: ["DEBUGGING", "CODE_UNDERSTANDING"],
    IMPLEMENT_FEATURE: ["CODE_GENERATION", "SYSTEM_THINKING", "REASONING"],
    REFACTOR: ["CODE_UNDERSTANDING", "CODE_GENERATION"],
    EXPLAIN: ["REASONING", "INSTRUCTION_FOLLOWING"],
    TRANSLATE: ["MULTILINGUAL", "INSTRUCTION_FOLLOWING"],
    SUMMARIZE: ["ANALYSIS", "INSTRUCTION_FOLLOWING"],
    MATH: ["MATH_REASONING", "REASONING"],
    CREATIVE: ["CREATIVITY", "INSTRUCTION_FOLLOWING"],
    TOOL_USE: ["TOOL_USE", "INSTRUCTION_FOLLOWING"],
    ARCHITECTURE: ["SYSTEM_THINKING", "REASONING", "ANALYSIS"],
    RESEARCH: ["ANALYSIS", "REASONING", "JUDGMENT"],
  };
  return map[taskType] ?? ["REASONING"];
}

// -- CallRecord → Pairwise Signal --

/**
 * Extract pairwise comparison signals from call records.
 * Groups by taskType, compares quality scores between different models.
 */
export function extractPairwise(records: CallRecord[]): PairwiseResult[] {
  // Group by taskType
  const byTask = new Map<string, CallRecord[]>();
  for (const r of records) {
    if (!byTask.has(r.taskType)) byTask.set(r.taskType, []);
    byTask.get(r.taskType)!.push(r);
  }

  const results: PairwiseResult[] = [];

  for (const [taskType, taskRecords] of byTask) {
    // Compare each pair of different models within same task type
    for (let i = 0; i < taskRecords.length; i++) {
      for (let j = i + 1; j < taskRecords.length; j++) {
        const a = taskRecords[i]!;
        const b = taskRecords[j]!;
        if (a.model === b.model) continue;

        const diff = a.quality - b.quality;
        if (Math.abs(diff) < MIN_QUALITY_DIFF) continue;

        let outcome: PairwiseOutcome;
        if (diff >= STRONG_QUALITY_DIFF) outcome = "A>>B";
        else if (diff > 0) outcome = "A>B";
        else if (diff <= -STRONG_QUALITY_DIFF) outcome = "B>>A";
        else outcome = "B>A";

        results.push({
          promptId: `usage-${taskType}-${i}-${j}`,
          modelA: a!.model,
          modelB: b!.model,
          judge: "usage-quality",
          outcome,
          swapped: false,
          reasoning: `Quality diff: ${diff.toFixed(1)} (${a!.quality} vs ${b!.quality})`,
          confidence: Math.min(1.0, Math.abs(diff) / 10),
        });
      }
    }
  }

  return results;
}

// -- Calibration --

export interface CalibrationResult {
  /** Number of pairwise comparisons processed. */
  comparisonsProcessed: number;
  /** Models that had anomalous updates. */
  anomalies: Array<{ modelId: string; dimension: CapabilityDimension; muDelta: number }>;
  /** Models with converged ratings (low sigma). */
  converged: Array<{ modelId: string; dimension: CapabilityDimension; sigma: number }>;
  /** Models with stale ratings (high sigma, needs re-evaluation). */
  stale: Array<{ modelId: string; dimension: CapabilityDimension; sigma: number }>;
}

/**
 * Run a calibration cycle:
 * 1. Extract pairwise signals from call records
 * 2. Update BT ratings
 * 3. Monitor sigma convergence
 * 4. Detect anomalies
 */
export function calibrate(
  ratings: RatingsMap,
  records: CallRecord[],
): CalibrationResult {
  const pairwise = extractPairwise(records);

  const anomalies: CalibrationResult["anomalies"] = [];
  const converged: CalibrationResult["converged"] = [];
  const stale: CalibrationResult["stale"] = [];

  // Process each pairwise result
  for (const result of pairwise) {
    const dimensions = taskToDimensions(
      result.promptId.split("-")[1] ?? "REASONING",
    );

    for (const dim of dimensions) {
      const ratingA = getRating(ratings, result.modelA, dim);
      const ratingB = getRating(ratings, result.modelB, dim);

      const { updatedA, updatedB, anomaly } = updateRating(
        ratingA,
        ratingB,
        result.outcome,
      );

      if (anomaly) {
        anomalies.push({
          modelId: result.modelA,
          dimension: dim,
          muDelta: updatedA.mu - ratingA.mu,
        });
      }

      setRating(ratings, result.modelA, dim, updatedA);
      setRating(ratings, result.modelB, dim, updatedB);
    }
  }

  // Scan all ratings for convergence/staleness
  for (const [modelId, dims] of ratings) {
    for (const [dim, rating] of dims) {
      if (rating.sigma <= SIGMA_CONVERGED && rating.comparisons > 0) {
        converged.push({ modelId, dimension: dim, sigma: rating.sigma });
      } else if (rating.sigma >= SIGMA_STALE) {
        stale.push({ modelId, dimension: dim, sigma: rating.sigma });
      }
    }
  }

  return {
    comparisonsProcessed: pairwise.length,
    anomalies,
    converged,
    stale,
  };
}
