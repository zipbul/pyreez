/**
 * Benchmark anchoring — maps public benchmark scores to BT dimensional ratings.
 *
 * Converts raw benchmark percentages (0-100) to BT mu scale (0-1000) and
 * computes per-dimension ratings by weighted mapping of benchmarks to capability dimensions.
 *
 * @module Benchmark Anchoring
 */

import type { CapabilityDimension, DimensionRating, ModelCapabilities } from "./types";
import { ALL_DIMENSIONS, SIGMA_BASE } from "./types";

// -- Constants --

/** Sigma for benchmark-anchored dimensions (lower = more certain than SIGMA_BASE). */
export const SIGMA_ANCHORED = 150;

/** Sigma reduction factor per additional benchmark source. */
const SIGMA_DECAY_PER_SOURCE = 25;

// -- Benchmark → Dimension mapping --

interface DimensionMapping {
  dimension: CapabilityDimension;
  weight: number;
}

/**
 * Maps each benchmark to the capability dimensions it measures,
 * with relative weights indicating contribution strength.
 *
 * Based on PLAN.md F8 Layer 1 mapping:
 * - IFEval → INSTRUCTION_FOLLOWING, LONG_CONTEXT
 * - BBH → REASONING, ANALYSIS, MULTI_STEP_DEPTH
 * - MATH → MATH_REASONING
 * - GPQA → REASONING, ANALYSIS, JUDGMENT
 * - MuSR → REASONING, LONG_CONTEXT, MULTI_STEP_DEPTH
 * - MMLU-PRO → REASONING, ANALYSIS
 * - HumanEval → CODE_GENERATION
 * - SWE-bench → CODE_GENERATION, DEBUGGING, CODE_UNDERSTANDING, SYSTEM_THINKING
 */
export const BENCHMARK_DIMENSION_MAP: Record<string, DimensionMapping[]> = {
  ifeval: [
    { dimension: "INSTRUCTION_FOLLOWING", weight: 0.8 },
    { dimension: "LONG_CONTEXT", weight: 0.2 },
  ],
  bbh: [
    { dimension: "REASONING", weight: 0.5 },
    { dimension: "ANALYSIS", weight: 0.3 },
    { dimension: "MULTI_STEP_DEPTH", weight: 0.2 },
  ],
  math: [
    { dimension: "MATH_REASONING", weight: 1.0 },
  ],
  gpqa: [
    { dimension: "REASONING", weight: 0.4 },
    { dimension: "ANALYSIS", weight: 0.3 },
    { dimension: "JUDGMENT", weight: 0.3 },
  ],
  musr: [
    { dimension: "REASONING", weight: 0.4 },
    { dimension: "LONG_CONTEXT", weight: 0.3 },
    { dimension: "MULTI_STEP_DEPTH", weight: 0.3 },
  ],
  mmlu_pro: [
    { dimension: "REASONING", weight: 0.4 },
    { dimension: "ANALYSIS", weight: 0.4 },
    { dimension: "JUDGMENT", weight: 0.2 },
  ],
  humaneval: [
    { dimension: "CODE_GENERATION", weight: 0.8 },
    { dimension: "CODE_UNDERSTANDING", weight: 0.2 },
  ],
  swe_bench: [
    { dimension: "CODE_GENERATION", weight: 0.3 },
    { dimension: "DEBUGGING", weight: 0.3 },
    { dimension: "CODE_UNDERSTANDING", weight: 0.2 },
    { dimension: "SYSTEM_THINKING", weight: 0.2 },
  ],
};

// -- Core functions --

/**
 * Normalize a raw benchmark percentage (0-100) to BT mu scale (0-1000).
 * Clamps out-of-range and NaN values.
 */
export function normalizeScore(rawPercent: number, _benchmarkId: string): number {
  if (Number.isNaN(rawPercent) || rawPercent < 0) return 0;
  if (rawPercent > 100) return 1000;
  return rawPercent * 10;
}

/** Benchmark score entry. */
export interface BenchmarkScore {
  benchmark: string;
  score: number; // 0-100 percentage
}

/**
 * Compute a DimensionRating for a specific dimension from benchmark scores.
 *
 * Algorithm:
 * 1. Filter scores to benchmarks that map to the target dimension
 * 2. Compute weighted average of normalized scores
 * 3. Set sigma based on number of contributing benchmarks
 */
export function anchorDimension(
  scores: readonly BenchmarkScore[],
  dimension: CapabilityDimension,
): DimensionRating {
  // Collect all (normalizedMu, weight) pairs for this dimension
  const contributions: { mu: number; weight: number }[] = [];

  for (const entry of scores) {
    const mappings = BENCHMARK_DIMENSION_MAP[entry.benchmark];
    if (!mappings) continue;

    for (const mapping of mappings) {
      if (mapping.dimension === dimension) {
        contributions.push({
          mu: normalizeScore(entry.score, entry.benchmark),
          weight: mapping.weight,
        });
      }
    }
  }

  if (contributions.length === 0) {
    return { mu: 0, sigma: SIGMA_BASE, comparisons: 0 };
  }

  // Weighted average
  let weightedSum = 0;
  let totalWeight = 0;
  for (const c of contributions) {
    weightedSum += c.mu * c.weight;
    totalWeight += c.weight;
  }

  const mu = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Sigma decreases with more sources (more evidence → more certain)
  const sigma = Math.max(
    50, // floor
    SIGMA_ANCHORED - (contributions.length - 1) * SIGMA_DECAY_PER_SOURCE,
  );

  return {
    mu: Math.round(mu * 100) / 100, // 소수점 2자리
    sigma,
    comparisons: contributions.length,
  };
}

/**
 * Anchor all 21 dimensions for a model from its benchmark scores.
 * Dimensions without benchmark coverage get fallback ratings (mu=0, sigma=SIGMA_BASE).
 */
export function anchorModel(
  benchmarks: readonly BenchmarkScore[],
): Record<CapabilityDimension, DimensionRating> {
  const result = {} as Record<CapabilityDimension, DimensionRating>;

  for (const dim of ALL_DIMENSIONS) {
    result[dim] = anchorDimension(benchmarks, dim);
  }

  return result;
}

// -- V1 → V2 migration --

/** V1 legacy score entry. */
interface LegacyScoreEntry {
  score: number;
  confidence: number;
  dataPoints: number;
}

/** V2 score entry. */
interface V2ScoreEntry {
  mu: number;
  sigma: number;
  comparisons: number;
}

interface V2ModelEntry {
  name: string;
  contextWindow: number;
  supportsToolCalling: boolean;
  cost: { inputPer1M: number; outputPer1M: number };
  scores: Record<string, V2ScoreEntry>;
}

interface V2Data {
  version: number;
  models: Record<string, V2ModelEntry>;
}

function isLegacy(entry: unknown): entry is LegacyScoreEntry {
  return typeof entry === "object" && entry !== null && "score" in entry;
}

/**
 * Migrate v1 models.json to v2 format with optional benchmark anchoring.
 *
 * - Already v2 (version >= 2): returned as-is
 * - V1 with benchmarks: anchored dimensions use benchmark mu + low sigma
 * - V1 without benchmarks: score*100 → mu, sigma = SIGMA_BASE
 */
export function migrateToV2(
  data: { version: number; models: Record<string, any> },
  benchmarkData?: Record<string, BenchmarkScore[]>,
): V2Data {
  if (data.version >= 2) {
    return data as V2Data;
  }

  const result: V2Data = {
    version: 2,
    models: {},
  };

  for (const [modelId, entry] of Object.entries(data.models)) {
    const v2Scores: Record<string, V2ScoreEntry> = {};

    // Get benchmark anchoring for this model (if available)
    const modelBenchmarks = benchmarkData?.[modelId];
    const anchored = modelBenchmarks && modelBenchmarks.length > 0
      ? anchorModel(modelBenchmarks)
      : null;

    for (const dim of ALL_DIMENSIONS) {
      if (anchored && anchored[dim].comparisons > 0) {
        // Use benchmark-anchored value
        v2Scores[dim] = anchored[dim];
      } else {
        // Fallback: v1 score*100 or default
        const raw = entry.scores?.[dim];
        if (raw && isLegacy(raw)) {
          v2Scores[dim] = {
            mu: raw.score * 100,
            sigma: SIGMA_BASE,
            comparisons: raw.dataPoints,
          };
        } else {
          v2Scores[dim] = { mu: 0, sigma: SIGMA_BASE, comparisons: 0 };
        }
      }
    }

    result.models[modelId] = {
      name: entry.name,
      contextWindow: entry.contextWindow,
      supportsToolCalling: entry.supportsToolCalling,
      cost: entry.cost,
      scores: v2Scores,
    };
  }

  return result;
}
