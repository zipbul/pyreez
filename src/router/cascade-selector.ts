/**
 * Cascade Selector — cost-first model selection.
 *
 * Strategy: pick the cheapest model that meets a quality threshold.
 * The threshold is derived from the median composite score (no separate param needed).
 * If no model meets the threshold, escalates to the highest-composite model.
 *
 * Uses the same qualityWeight/costWeight formula as other selectors.
 */

import type { Selector } from "../axis/interfaces";
import type {
  AxisTaskRequirement,
  ModelScore,
  BudgetConfig,
  EnsemblePlan,
} from "../axis/types";
import type { ModelInfo } from "../model/types";
import { rankModels, type RankModelsOpts } from "./composite-score";
import type { RoutingConfig } from "../config";

export interface CascadeSelectorOpts {
  registry: { getById(id: string): ModelInfo | undefined };
  routing: RoutingConfig;
}

export class CascadeSelector implements Selector {
  private readonly registry: { getById(id: string): ModelInfo | undefined };
  private readonly routing: RoutingConfig;

  constructor(opts: CascadeSelectorOpts) {
    this.registry = opts.registry;
    this.routing = opts.routing;
  }

  async select(
    req: AxisTaskRequirement,
    scores: ModelScore[],
    budget: BudgetConfig,
  ): Promise<EnsemblePlan> {
    const rankOpts: RankModelsOpts = {
      registry: this.registry,
      routing: this.routing,
    };
    const ranked = rankModels(scores, req, budget, rankOpts);

    if (ranked.length === 0) {
      return {
        models: [],
        strategy: "cascade",
        estimatedCost: 0,
        reason: "no models available",
      };
    }

    // Median composite score as quality threshold
    const composites = ranked.map((r) => r.composite).sort((a, b) => a - b);
    const mid = Math.floor(composites.length / 2);
    const medianComposite =
      composites.length % 2 === 0
        ? (composites[mid - 1]! + composites[mid]!) / 2
        : composites[mid]!;

    // Sort by cost ascending
    const byCost = [...ranked].sort((a, b) => a.cost - b.cost);

    // Find cheapest model with composite >= median
    const pick = byCost.find((r) => r.composite >= medianComposite);

    if (!pick) {
      // Escalate: use the highest-composite model
      const best = ranked[0]!;
      return {
        models: [{ modelId: best.modelId, role: "primary", weight: 1.0 }],
        strategy: "cascade-escalated",
        estimatedCost: best.cost,
        reason: `cascade: escalated to "${best.modelId}" (no model met median threshold)`,
      };
    }

    return {
      models: [{ modelId: pick.modelId, role: "primary", weight: 1.0 }],
      strategy: "cascade",
      estimatedCost: pick.cost,
      reason: `cascade: cheapest model above median quality "${pick.modelId}"`,
    };
  }
}
