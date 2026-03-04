/**
 * Shared composite scoring functions — used by all Selector variants.
 *
 * Extracts the scoring logic from TwoTrackCeSelector so that KNN, Cascade,
 * and future selectors can reuse the same quality + cost-efficiency formula.
 */

import type { ModelScore, AxisTaskRequirement, BudgetConfig } from "../axis/types";
import type { ModelInfo } from "../model/types";
import { SIGMA_BASE } from "../model/types";
import { estimateStaticCost } from "../cost/effective-cost";
import type { RoutingConfig } from "../config";

export interface RankedModel {
  modelId: string;
  /** Capability-weighted quality score. */
  weighted: number;
  /** Final composite score (quality × qw + costEff × cw). */
  composite: number;
  cost: number;
  avgSigma: number;
  info: ModelInfo;
}

/** Minimum confidence floor for uncalibrated dimensions. */
export const MIN_CONFIDENCE = 0.15;

/**
 * Box-Muller transform: generate a standard normal random variate.
 */
export function gaussianSample(): number {
  const u1 = Math.max(1e-10, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Compute capability-weighted quality score for a model.
 * Dimensions with high sigma (uncertainty) are penalized via confidence floor.
 */
export function computeWeighted(
  score: ModelScore,
  capabilities: Record<string, number>,
): number {
  const capEntries = Object.entries(capabilities);
  if (capEntries.length === 0) return score.overall;

  let weighted = 0;
  for (const [dim, weight] of capEntries) {
    const d = score.dimensions[dim];
    const mu = d?.mu ?? score.overall;
    const confidence = d
      ? Math.max(MIN_CONFIDENCE, Math.min(1, 1 - d.sigma / SIGMA_BASE))
      : MIN_CONFIDENCE;
    weighted += mu * confidence * weight;
  }
  return weighted;
}

/**
 * Sample from a truncated normal distribution on [lo, hi].
 * Uses rejection sampling — average iterations ~1.1 for typical (mu, sigma) ranges.
 * Falls back to midpoint after maxIter to guarantee termination.
 */
export function truncatedNormalSample(
  mu: number,
  sigma: number,
  lo: number,
  hi: number,
  sampleFn: () => number = gaussianSample,
  maxIter = 100,
): number {
  for (let i = 0; i < maxIter; i++) {
    const draw = mu + sigma * sampleFn();
    if (draw >= lo && draw <= hi) return draw;
  }
  // Fallback: clamp to bounds (extremely unlikely path)
  return Math.max(lo, Math.min(hi, mu));
}

/**
 * Thompson Sampling variant of computeWeighted.
 * Samples from truncated N(mu, sigma) on [0, 1000] per dimension.
 * High-sigma models occasionally score high, driving natural exploration.
 *
 * Uses truncated normal (not simple clamp) to avoid systematic upward bias
 * for low-mu/high-sigma models. Exploration comes from variance, not
 * mean inflation.
 *
 * Unlike computeWeighted, this does NOT apply a confidence multiplier.
 * Sigma already controls exploration via sampling variance — applying
 * confidence on top would be a double penalty.
 */
export function computeWeightedThompson(
  score: ModelScore,
  capabilities: Record<string, number>,
  sampleFn: () => number = gaussianSample,
): number {
  const capEntries = Object.entries(capabilities);
  if (capEntries.length === 0) return score.overall;

  let weighted = 0;
  for (const [dim, weight] of capEntries) {
    const d = score.dimensions[dim];
    const mu = d?.mu ?? score.overall;
    const sigma = d?.sigma ?? SIGMA_BASE;
    const sampledMu = truncatedNormalSample(mu, sigma, 0, 1000, sampleFn);
    weighted += sampledMu * weight;
  }
  return weighted;
}

/**
 * Compute cost efficiency normalized within the candidate pool.
 * Returns 1.0 for cheapest, 0.0 for most expensive.
 * When all costs are equal (or single model), returns 1.0.
 */
export function poolCostEfficiency(cost: number, minCost: number, maxCost: number): number {
  if (maxCost <= minCost) return 1;
  return 1 - (cost - minCost) / (maxCost - minCost);
}

/**
 * Compute composite score combining quality and cost efficiency.
 * Cost efficiency is pool-relative: cheapest=1.0, most expensive=0.0.
 * Returns a value in [0, ~1] range.
 */
export function computeComposite(
  weighted: number,
  maxWeighted: number,
  costEff: number,
  qw: number,
  cw: number,
  latencyEff?: number,
  lw?: number,
): number {
  const quality = maxWeighted > 0 ? weighted / maxWeighted : 0;
  let score = qw * quality + cw * costEff;
  if (latencyEff != null && lw != null && lw > 0) {
    score += lw * latencyEff;
  }
  return score;
}

/**
 * Compute average sigma (uncertainty) across all dimensions of a model score.
 */
export function computeAvgSigma(score: ModelScore): number {
  const sigmaValues = Object.values(score.dimensions).map((d) => d.sigma);
  return sigmaValues.length > 0
    ? sigmaValues.reduce((a, b) => a + b, 0) / sigmaValues.length
    : SIGMA_BASE;
}

export interface RankModelsOpts {
  registry: { getById(id: string): ModelInfo | undefined };
  routing: RoutingConfig;
  latencyData?: Map<string, number>;
}

/**
 * Full ranking pipeline: filter → score → rank.
 *
 * 1. Filter models with valid registry entries
 * 2. Compute per-model cost + weighted quality
 * 3. Apply budget hard filter
 * 4. Sort by composite score (quality × qw + costEff × cw)
 *
 * Shared by TwoTrackCeSelector, KnnSelector, and CascadeSelector.
 */
export function rankModels(
  scores: ModelScore[],
  req: AxisTaskRequirement,
  budget: BudgetConfig,
  opts: RankModelsOpts,
): RankedModel[] {
  const { registry, routing, latencyData } = opts;
  // Priority: user per-request > criticality-based (when set) > config file
  const CRITICALITY_WEIGHTS: Record<string, { qw: number; cw: number }> = {
    low: { qw: 0.5, cw: 0.5 },
    medium: { qw: 0.7, cw: 0.3 },
    high: { qw: 0.85, cw: 0.15 },
  };
  const critW = req.criticality ? CRITICALITY_WEIGHTS[req.criticality] : undefined;
  const qw = req.budget.qualityWeight ?? critW?.qw ?? routing.qualityWeight;
  const cw = req.budget.costWeight ?? critW?.cw ?? routing.costWeight;
  const lw = routing.latencyWeight ?? 0;
  const inputTokens = req.estimatedInputTokens ?? 500;
  const outputTokens = req.estimatedOutputTokens ?? 500;

  // Score all models
  let ranked: RankedModel[] = [];
  for (const ms of scores) {
    const info = registry.getById(ms.modelId);
    if (!info) continue;

    const cost = estimateStaticCost(info, inputTokens, outputTokens);
    const weighted = computeWeighted(ms, req.capabilities);
    const avgSigma = computeAvgSigma(ms);

    ranked.push({ modelId: ms.modelId, weighted, composite: 0, cost, avgSigma, info });
  }

  // Budget hard filter
  if (budget.perRequest > 0) {
    const filtered = ranked.filter((r) => r.cost <= budget.perRequest);
    if (filtered.length > 0) ranked = filtered;
  }

  // Compute composite scores (with pool-relative cost normalization)
  const maxWeighted = Math.max(...ranked.map((r) => r.weighted), 1);
  const minCost = ranked.length > 0 ? Math.min(...ranked.map((r) => r.cost)) : 0;
  const maxCost = ranked.length > 0 ? Math.max(...ranked.map((r) => r.cost)) : 0;
  for (const r of ranked) {
    const costEff = poolCostEfficiency(r.cost, minCost, maxCost);
    const latEff = latencyData?.has(r.modelId) ? 1 / (1 + latencyData.get(r.modelId)! / 1000) : undefined;
    r.composite = computeComposite(r.weighted, maxWeighted, costEff, qw, cw, latEff, lw);
  }

  // Sort by composite descending
  ranked.sort((a, b) => b.composite - a.composite);

  return ranked;
}
