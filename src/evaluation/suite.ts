/**
 * Evaluation Suite — orchestration of the 4-layer evaluation pipeline.
 *
 * Pipeline: prompts → model responses → pairwise comparison → BT update.
 */

import type {
  EvalPrompt,
  EvalResponse,
  PairwiseResult,
  EvalSuiteConfig,
  EvalSuiteResult,
  ModelRunner,
  PairwiseJudge,
  BTUpdate,
} from "./types";
import type { CapabilityDimension } from "../model/types";
import { PromptRegistry } from "./prompts";
import { runMatrix } from "./runner";
import { anchorPairings, runPairwise } from "./pairwise";
import {
  batchUpdate,
  getRating,
  type RatingsMap,
} from "./bt-updater";

/**
 * Run a full evaluation suite.
 * 1. Collect responses from all models for all prompts
 * 2. Run pairwise comparisons (each model vs anchor)
 * 3. Update BT ratings
 */
export async function runEvalSuite(
  registry: PromptRegistry,
  runner: ModelRunner,
  judge: PairwiseJudge,
  config: EvalSuiteConfig,
  ratings: RatingsMap,
): Promise<EvalSuiteResult> {
  // 1. Select prompts
  const prompts = registry.query({
    domain: config.domains?.[0],
    difficulty: config.difficulties?.[0],
  });

  if (prompts.length === 0) {
    throw new Error("No prompts match the filter criteria");
  }

  // 2. Collect responses
  const allModelIds = [
    ...new Set([config.anchorModelId, ...config.modelIds]),
  ];
  const responses = await runMatrix(
    runner,
    prompts,
    allModelIds,
    config.concurrency,
  );

  // Index responses by promptId → modelId
  const responseIndex = new Map<string, Map<string, EvalResponse>>();
  for (const r of responses) {
    if (!responseIndex.has(r.promptId))
      responseIndex.set(r.promptId, new Map());
    responseIndex.get(r.promptId)!.set(r.modelId, r);
  }

  // 3. Run pairwise comparisons
  const pairs = anchorPairings(config.modelIds, config.anchorModelId);
  const pairwiseResults: PairwiseResult[] = [];
  let consistentCount = 0;
  let totalComparisons = 0;

  for (const prompt of prompts) {
    const promptResponses = responseIndex.get(prompt.id);
    if (!promptResponses) continue;

    for (const [modelId, anchorId] of pairs) {
      const responseA = promptResponses.get(modelId);
      const responseB = promptResponses.get(anchorId);
      if (!responseA || !responseB) continue;

      const result = await runPairwise(
        judge,
        prompt,
        responseA,
        responseB,
        config.judgeConfig,
        config.positionSwap,
      );

      // Store with reconciled outcome
      pairwiseResults.push({
        ...result.original,
        outcome: result.reconciled,
      });

      totalComparisons++;
      if (result.consistent) consistentCount++;
    }
  }

  // 4. Build prompt → dimensions map
  const promptDimensions = new Map<string, CapabilityDimension[]>();
  for (const p of prompts) {
    promptDimensions.set(p.id, p.expectedDimensions);
  }

  // 5. Update BT ratings
  const { updates, anomalies } = batchUpdate(
    ratings,
    pairwiseResults,
    promptDimensions,
  );

  return {
    timestamp: new Date().toISOString(),
    promptCount: prompts.length,
    modelCount: allModelIds.length,
    pairwiseResults,
    btUpdates: updates,
    consistencyRate:
      totalComparisons > 0 ? consistentCount / totalComparisons : 1.0,
  };
}
