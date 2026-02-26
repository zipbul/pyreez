/**
 * Model selector — SELECT phase.
 * 5-step algorithm: HARD FILTER → COMPOSITE SCORE → COST-EFFICIENCY → BUDGET-AWARE → FALLBACK.
 */

import type { ModelInfo, CapabilityDimension } from "../model/types";
import { SIGMA_BASE } from "../model/types";
import type { TaskRequirement, CapabilityRequirement } from "../profile/types";
import type {
  BudgetConfig,
  SelectResult,
  FallbackSelectResult,
  AdaptiveWeightProvider,
} from "./types";
import { nullAdaptiveWeight } from "./types";
import { estimateStaticCost } from "../cost/effective-cost";

// -- Cost calculation --

/**
 * Estimate the request cost in USD for a model given token estimates.
 */
function estimateCost(
  model: ModelInfo,
  inputTokens: number,
  outputTokens: number,
): number {
  return estimateStaticCost(model, inputTokens, outputTokens);
}

// -- Step 1: HARD FILTER --

interface FilteredModel {
  model: ModelInfo;
  expectedCost: number;
}

function hardFilter(
  models: ModelInfo[],
  requirement: TaskRequirement,
  budget: BudgetConfig,
): FilteredModel[] {
  const totalTokens =
    requirement.estimatedInputTokens + requirement.estimatedOutputTokens;

  return models.filter((model) => {
    // Context window check
    if (model.contextWindow < totalTokens) return false;

    // Tool calling check
    if (requirement.requiresToolCalling && !model.supportsToolCalling)
      return false;

    // Korean / multilingual check
    if (requirement.requiresKorean && model.capabilities.MULTILINGUAL.mu < 500)
      return false;

    // Minimum capability thresholds
    for (const cap of requirement.requiredCapabilities) {
      if (
        cap.minimum !== undefined &&
        model.capabilities[cap.dimension].mu < cap.minimum
      ) {
        return false;
      }
    }

    // Cost check
    const cost = estimateCost(
      model,
      requirement.estimatedInputTokens,
      requirement.estimatedOutputTokens,
    );
    if (cost > budget.perRequest) return false;

    return true;
  }).map((model) => ({
    model,
    expectedCost: estimateCost(
      model,
      requirement.estimatedInputTokens,
      requirement.estimatedOutputTokens,
    ),
  }));
}

// -- Step 2: COMPOSITE SCORE --

function compositeScore(
  model: ModelInfo,
  requiredCapabilities: CapabilityRequirement[],
  adaptive: AdaptiveWeightProvider,
  taskType: string,
): number {
  let score = 0;
  for (const cap of requiredCapabilities) {
    const rating = model.capabilities[cap.dimension];
    const uncertaintyPenalty = 1 / (1 + rating.sigma / SIGMA_BASE);
    score += rating.mu * uncertaintyPenalty * cap.weight;
  }
  const boost = Math.max(-1, Math.min(1, adaptive.getBoost(model.id, taskType)));
  return score * (1 + boost);
}

// -- Step 3: COST-EFFICIENCY --

interface ScoredModel {
  model: ModelInfo;
  score: number;
  expectedCost: number;
  costEfficiency: number;
}

/** Determine if criticality warrants quality-first selection. */
function isQualityFirst(criticality?: string): boolean {
  return criticality === "critical" || criticality === "high";
}

function scoredAndRanked(
  filtered: FilteredModel[],
  requiredCapabilities: CapabilityRequirement[],
  adaptive: AdaptiveWeightProvider,
  taskType: string,
  qualityFirst: boolean = false,
): ScoredModel[] {
  const scored = filtered.map(({ model, expectedCost }) => {
    const score = compositeScore(model, requiredCapabilities, adaptive, taskType);
    const costEfficiency = expectedCost > 0 ? score / expectedCost : Infinity;
    return { model, score, expectedCost, costEfficiency };
  });

  if (qualityFirst) {
    // Quality-first: score DESC → costEfficiency DESC (tiebreak)
    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.costEfficiency - a.costEfficiency;
    });
  } else {
    // Cost-first: costEfficiency DESC → score DESC (tiebreak)
    scored.sort((a, b) => {
      if (b.costEfficiency !== a.costEfficiency) {
        return b.costEfficiency - a.costEfficiency;
      }
      return b.score - a.score;
    });
  }

  return scored;
}

// -- Step 5: FALLBACK --

function fallbackResult(
  models: ModelInfo[],
  requirement: TaskRequirement,
): FallbackSelectResult {
  // If no models at all, return a synthetic fallback
  if (models.length === 0) {
    return {
      model: {
        id: "fallback/none",
        name: "No Model Available",
        provider: "anthropic",
        contextWindow: 0,
        capabilities: {} as any,
        cost: { inputPer1M: 0, outputPer1M: 0 },
        supportsToolCalling: false,
      },
      score: 0,
      costEfficiency: 0,
      expectedCost: 0,
      reason: "No models available",
      relaxedConstraints: ["all"],
      warning: "No models were provided. Cannot select a model.",
    };
  }

  // Find cheapest model from original list
  const cheapest = models.reduce((min, m) =>
    m.cost.inputPer1M + m.cost.outputPer1M <
    min.cost.inputPer1M + min.cost.outputPer1M
      ? m
      : min,
  );

  const expectedCost = estimateCost(
    cheapest,
    requirement.estimatedInputTokens,
    requirement.estimatedOutputTokens,
  );

  const score = compositeScore(cheapest, requirement.requiredCapabilities, nullAdaptiveWeight, requirement.taskType);

  return {
    model: cheapest,
    score,
    costEfficiency: expectedCost > 0 ? score / expectedCost : 0,
    expectedCost,
    reason: `Fallback: all models filtered. Using cheapest model "${cheapest.name}".`,
    relaxedConstraints: [
      "minimum_threshold",
      "multilingual",
      "tool_calling",
      "budget",
    ],
    warning: `No model passed all filters. Relaxed constraints and selected cheapest model "${cheapest.name}".`,
  };
}

// -- Public API --

/**
 * Select the best model for a task requirement within budget.
 * Implements the 5-step SELECT algorithm.
 */
export function selectModel(
  models: ModelInfo[],
  requirement: TaskRequirement,
  budget: BudgetConfig,
  adaptive?: AdaptiveWeightProvider,
): SelectResult | FallbackSelectResult {
  const effectiveAdaptive = adaptive ?? nullAdaptiveWeight;
  // Step 1: HARD FILTER
  const filtered = hardFilter(models, requirement, budget);

  // Step 5: FALLBACK if nothing passed
  if (filtered.length === 0) {
    return fallbackResult(models, requirement);
  }

  // Step 2 + 3: COMPOSITE SCORE → ranking (quality-first or cost-first based on criticality)
  const qualityFirst = isQualityFirst(requirement.criticality);
  const ranked = scoredAndRanked(
    filtered,
    requirement.requiredCapabilities,
    effectiveAdaptive,
    requirement.taskType,
    qualityFirst,
  );

  // Step 4: return top candidate (2-Track: quality-first for critical/high, cost-first otherwise)
  const best = ranked[0]!;

  return {
    model: best.model,
    score: best.score,
    costEfficiency: best.costEfficiency,
    expectedCost: best.expectedCost,
    reason: `Selected "${best.model.name}" (CE: ${best.costEfficiency.toFixed(1)}, score: ${best.score.toFixed(2)})`,
  };
}
