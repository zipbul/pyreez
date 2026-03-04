/**
 * KNN Selector — preference-based model selection (RouteLLM reference).
 *
 * Uses historical preference data (win rates per task type) to select models.
 * Falls back to composite scoring when preference data is insufficient.
 */

import type { Selector } from "../axis/interfaces";
import type {
  AxisTaskRequirement,
  ModelScore,
  BudgetConfig,
  EnsemblePlan,
} from "../axis/types";
import type { ModelInfo } from "../model/types";
import type { PreferenceTable } from "./preference";
import { routeByPreference } from "./preference";
import { rankModels, type RankModelsOpts } from "./composite-score";
import { estimateStaticCost } from "../cost/effective-cost";
import type { RoutingConfig } from "../config";

export interface KnnSelectorOpts {
  preferenceTable: PreferenceTable;
  registry: { getById(id: string): ModelInfo | undefined };
  ensembleSize?: number;
  /** Minimum confidence threshold for preference data. Default: 0.3. */
  minConfidence?: number;
  routing: RoutingConfig;
}

const DEFAULT_ENSEMBLE_SIZE = 3;
const DEFAULT_MIN_CONFIDENCE = 0.3;

export class KnnSelector implements Selector {
  private readonly preferenceTable: PreferenceTable;
  private readonly registry: { getById(id: string): ModelInfo | undefined };
  private readonly ensembleSize: number;
  private readonly minConfidence: number;
  private readonly routing: RoutingConfig;

  constructor(opts: KnnSelectorOpts) {
    this.preferenceTable = opts.preferenceTable;
    this.registry = opts.registry;
    this.ensembleSize = opts.ensembleSize ?? DEFAULT_ENSEMBLE_SIZE;
    this.minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.routing = opts.routing;
  }

  async select(
    req: AxisTaskRequirement,
    scores: ModelScore[],
    budget: BudgetConfig,
  ): Promise<EnsemblePlan> {
    const taskType = req.taskType ?? "QUESTION_ANSWER";
    const size = Math.max(1, this.ensembleSize);

    // 1. Get preference rankings for this task type
    const prefRanked = routeByPreference(
      this.preferenceTable,
      taskType,
      scores.map((s) => s.modelId),
    );

    // 2. Filter to models with sufficient confidence
    const confident = prefRanked.filter(
      (r) => r.confidence >= this.minConfidence,
    );

    // 3. Not enough confident data → composite fallback
    if (confident.length === 0) {
      const rankOpts: RankModelsOpts = {
        registry: this.registry,
        routing: this.routing,
      };
      const ranked = rankModels(scores, req, budget, rankOpts);

      if (ranked.length === 0) {
        return {
          models: [],
          strategy: "knn-fallback-composite",
          estimatedCost: 0,
          reason: "no models available",
        };
      }

      const selected = ranked.slice(0, Math.min(size, ranked.length));
      const totalCost = selected.reduce((sum, r) => sum + r.cost, 0);

      return {
        models: selected.map((r) => ({ modelId: r.modelId, weight: 1.0 })),
        strategy: "knn-fallback-composite",
        estimatedCost: totalCost,
        reason: `knn: insufficient preference data for ${taskType}, using composite fallback`,
      };
    }

    // 4. Use preference data to select top models
    // Filter by budget via registry (using shared cost function)
    const budgetFiltered = confident.filter((r) => {
      const info = this.registry.getById(r.modelId);
      if (!info) return false;
      if (budget.perRequest <= 0) return true;
      const cost = estimateStaticCost(
        info,
        req.estimatedInputTokens ?? 500,
        req.estimatedOutputTokens ?? 500,
      );
      return cost <= budget.perRequest;
    });

    const candidates = budgetFiltered.length > 0 ? budgetFiltered : confident;
    const selected = candidates.slice(0, Math.min(size, candidates.length));

    const totalCost = selected.reduce((sum, r) => {
      const info = this.registry.getById(r.modelId);
      if (!info) return sum;
      return sum + estimateStaticCost(
        info,
        req.estimatedInputTokens ?? 500,
        req.estimatedOutputTokens ?? 500,
      );
    }, 0);

    return {
      models: selected.map((r) => ({ modelId: r.modelId, weight: 1.0 })),
      strategy: "knn-preference",
      estimatedCost: totalCost,
      reason: `knn: preference-based selection for ${taskType} (${confident.length} confident models)`,
    };
  }
}
