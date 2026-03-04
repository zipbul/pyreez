/**
 * Routing benchmark runner.
 *
 * Evaluates selector quality by comparing selected model quality
 * against ground truth from BenchmarkCase data.
 */

import type { Selector, Profiler } from "../axis/interfaces";
import type { ModelScore, BudgetConfig, TaskClassification } from "../axis/types";
import type { BenchmarkCase, SelectorResult } from "./types";

export async function runRoutingBenchmark(
  cases: BenchmarkCase[],
  selectors: Map<string, Selector>,
  getScores: (modelIds: string[]) => Promise<ModelScore[]>,
  profiler: Profiler,
  budget: BudgetConfig,
): Promise<SelectorResult[]> {
  const results: SelectorResult[] = [];

  for (const [name, selector] of selectors) {
    let exactMatches = 0;
    let totalQualityRatio = 0;
    let totalRegret = 0;
    let winsVsRandom = 0;
    let validCases = 0;

    for (const tc of cases) {
      const modelIds = Object.keys(tc.modelQualities);
      if (modelIds.length === 0) continue;

      const bestModelId = modelIds.reduce((best, id) =>
        tc.modelQualities[id]! > tc.modelQualities[best]! ? id : best,
      );
      const bestQuality = tc.modelQualities[bestModelId]!;

      // Simulate classification
      const classification: TaskClassification = {
        domain: tc.domain,
        taskType: tc.taskType,
        complexity: tc.complexity,
      };

      const scores = await getScores(modelIds);
      const requirement = await profiler.profile(classification);
      const plan = await selector.select(requirement, scores, budget);

      if (plan.models.length === 0) continue;

      const selectedId = plan.models[0]!.modelId;
      const selectedQuality = tc.modelQualities[selectedId] ?? 0;

      validCases++;

      // Exact match
      if (selectedId === bestModelId) exactMatches++;

      // Quality ratio
      totalQualityRatio += bestQuality > 0 ? selectedQuality / bestQuality : 1;

      // Regret
      totalRegret += bestQuality - selectedQuality;

      // Win vs random (round-robin baseline for determinism)
      const randomIdx = validCases % modelIds.length;
      const randomQuality = tc.modelQualities[modelIds[randomIdx]!]!;
      if (selectedQuality >= randomQuality) winsVsRandom++;
    }

    const n = Math.max(1, validCases);
    results.push({
      selectorName: name,
      totalCases: validCases,
      exactMatchRate: exactMatches / n,
      qualityRatio: totalQualityRatio / n,
      avgRegret: totalRegret / n,
      winRateVsRandom: winsVsRandom / n,
    });
  }

  return results;
}
