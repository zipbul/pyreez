/**
 * Benchmark Pipeline — wires evaluation suite to calibration persistence.
 *
 * Exported:
 *   runBenchmarkPipeline — full pipeline: prompts → suite → BT update → persist
 *   BenchmarkPipelineConfig — pipeline configuration
 *   BenchmarkPipelineDeps — injected dependencies
 *   BenchmarkPipelineResult — pipeline output
 *
 * @module Evaluation Pipeline
 */

import type {
  EvalPrompt,
  EvalSuiteConfig,
  EvalSuiteResult,
  ModelRunner,
  PairwiseJudge,
  JudgeConfig,
  EvalDomain,
  EvalDifficulty,
} from "./types";
import type { ModelInfo } from "../model/types";
import type { PersistIO } from "../model/calibration";
import type { RatingsMap } from "./bt-updater";
import { PromptRegistry } from "./prompts";

// -- Public Types --

export interface BenchmarkPipelineConfig {
  readonly modelIds: string[];
  readonly anchorModelId: string;
  readonly judgeConfig: JudgeConfig;
  readonly concurrency: number;
  readonly positionSwap: boolean;
  readonly modelsPath: string;
  readonly domains?: EvalDomain[];
  readonly difficulties?: EvalDifficulty[];
}

export interface BenchmarkPipelineDeps {
  readonly runner: ModelRunner;
  readonly judge: PairwiseJudge;
  readonly loadPrompts: () => EvalPrompt[];
  readonly loadModels: () => ModelInfo[];
  readonly persistIO: PersistIO;
  readonly runEvalSuite: (
    registry: PromptRegistry,
    runner: ModelRunner,
    judge: PairwiseJudge,
    config: EvalSuiteConfig,
    ratings: RatingsMap,
  ) => Promise<EvalSuiteResult>;
  readonly extractRatingsMap: (models: ModelInfo[]) => RatingsMap;
  readonly persistRatings: (
    filePath: string,
    ratings: RatingsMap,
    io: PersistIO,
  ) => Promise<void>;
}

export interface BenchmarkPipelineResult {
  readonly suiteResult: EvalSuiteResult;
  readonly ratingsUpdated: number;
  readonly modelsPersisted: boolean;
}

// -- Pipeline --

/**
 * Run the full benchmark pipeline:
 *   1. Load & validate prompts
 *   2. Load models → extract ratings map
 *   3. Run evaluation suite (prompts × models → pairwise → BT update)
 *   4. Persist updated ratings to models.json
 *   5. Return summary
 */
export async function runBenchmarkPipeline(
  config: BenchmarkPipelineConfig,
  deps: BenchmarkPipelineDeps,
): Promise<BenchmarkPipelineResult> {
  // 1. Load & validate prompts
  const prompts = deps.loadPrompts();
  if (prompts.length === 0) {
    throw new Error("No prompts available");
  }

  // 2. Load models & build ratings
  const models = deps.loadModels();
  if (models.length === 0) {
    throw new Error("No models available");
  }

  const registry = new PromptRegistry();
  for (const p of prompts) {
    registry.register(p);
  }

  const ratings: RatingsMap = deps.extractRatingsMap(models);

  // 3. Build suite config & run
  const suiteConfig: EvalSuiteConfig = {
    modelIds: config.modelIds,
    anchorModelId: config.anchorModelId,
    judgeConfig: config.judgeConfig,
    concurrency: config.concurrency,
    positionSwap: config.positionSwap,
    domains: config.domains,
    difficulties: config.difficulties,
  };

  const suiteResult = await deps.runEvalSuite(
    registry,
    deps.runner,
    deps.judge,
    suiteConfig,
    ratings,
  );

  // 4. Persist updated ratings
  await deps.persistRatings(config.modelsPath, ratings, deps.persistIO);

  // 5. Return summary
  return {
    suiteResult,
    ratingsUpdated: suiteResult.btUpdates.length,
    modelsPersisted: true,
  };
}
