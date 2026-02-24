/**
 * Unit tests for pipeline.ts — Benchmark Pipeline.
 *
 * SUT: runBenchmarkPipeline
 * All external deps injected via BenchmarkPipelineDeps (DI, TST-MOCK-STRATEGY #1).
 */
import { describe, it, expect, mock } from "bun:test";
import { runBenchmarkPipeline } from "./pipeline";
import type { BenchmarkPipelineConfig, BenchmarkPipelineDeps } from "./pipeline";
import { PromptRegistry } from "./prompts";
import type {
  EvalPrompt,
  EvalResponse,
  EvalSuiteConfig,
  EvalSuiteResult,
  ModelRunner,
  PairwiseJudge,
  PairwiseResult,
  JudgeConfig,
  BTUpdate,
} from "./types";
import type { RatingsMap } from "./bt-updater";
import { SIGMA_BASE, type ModelInfo, type CapabilityDimension } from "../model/types";
import type { PersistIO } from "../model/calibration";

// -- Fixtures --

function makePrompt(overrides: Partial<EvalPrompt> = {}): EvalPrompt {
  return {
    id: "coding-mod-001",
    domain: "coding",
    difficulty: "moderate",
    text: "Implement a LRU cache",
    expectedDimensions: ["CODE_GENERATION", "REASONING"],
    criteria: {
      specificity: 4, domainKnowledge: 4, complexity: 4,
      problemSolving: 4, creativity: 3, technicalAccuracy: 5, realWorldApplication: 4,
    },
    verifiable: false,
    ...overrides,
  };
}

function makeModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "openai/gpt-4.1",
    name: "GPT-4.1",
    contextWindow: 1048576,
    capabilities: {
      CODE_GENERATION: { mu: 500, sigma: SIGMA_BASE, comparisons: 0 },
      REASONING: { mu: 500, sigma: SIGMA_BASE, comparisons: 0 },
    } as any,
    confidence: {},
    cost: { inputPer1M: 2.0, outputPer1M: 8.0 },
    supportsToolCalling: true,
    ...overrides,
  };
}

function makeSuiteResult(overrides: Partial<EvalSuiteResult> = {}): EvalSuiteResult {
  return {
    timestamp: "2026-02-24T00:00:00.000Z",
    promptCount: 1,
    modelCount: 2,
    pairwiseResults: [],
    btUpdates: [
      {
        modelId: "model-a",
        dimension: "CODE_GENERATION" as CapabilityDimension,
        oldMu: 500,
        newMu: 520,
        oldSigma: SIGMA_BASE,
        newSigma: SIGMA_BASE * 0.97,
        comparisons: 1,
      },
      {
        modelId: "anchor",
        dimension: "CODE_GENERATION" as CapabilityDimension,
        oldMu: 500,
        newMu: 480,
        oldSigma: SIGMA_BASE,
        newSigma: SIGMA_BASE * 0.97,
        comparisons: 1,
      },
    ],
    consistencyRate: 1.0,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<BenchmarkPipelineConfig> = {}): BenchmarkPipelineConfig {
  return {
    modelIds: ["model-a"],
    anchorModelId: "anchor",
    judgeConfig: {
      judgeModel: "judge/o3",
      temperature: 0,
      maxTokens: 2000,
      lengthBiasCorrection: false,
    },
    concurrency: 1,
    positionSwap: false,
    modelsPath: "scores/models.json",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<BenchmarkPipelineDeps> = {}): BenchmarkPipelineDeps {
  return {
    runner: { generate: mock(async () => ({} as EvalResponse)) },
    judge: { judge: mock(async () => ({} as PairwiseResult)) },
    loadPrompts: mock(() => [makePrompt()]),
    loadModels: mock(() => [makeModel(), makeModel({ id: "anchor", name: "Anchor" })]),
    persistIO: {
      readFile: mock(async () => JSON.stringify({ version: 2, models: {} })),
      writeFile: mock(async () => {}),
    },
    runEvalSuite: mock(async () => makeSuiteResult()),
    extractRatingsMap: mock(() => new Map() as RatingsMap),
    persistRatings: mock(async () => {}),
    ...overrides,
  };
}

// ================================================================
// runBenchmarkPipeline
// ================================================================

describe("runBenchmarkPipeline", () => {
  // -- HP --

  it("should run full pipeline with valid inputs", async () => {
    // Arrange
    const suiteResult = makeSuiteResult();
    const deps = makeDeps({
      runEvalSuite: mock(async () => suiteResult),
    });

    // Act
    const result = await runBenchmarkPipeline(makeConfig(), deps);

    // Assert
    expect(result.suiteResult).toBe(suiteResult);
    expect(result.ratingsUpdated).toBe(2);
    expect(result.modelsPersisted).toBe(true);
  });

  it("should pass domains filter to suite config", async () => {
    // Arrange
    let capturedConfig: EvalSuiteConfig | undefined;
    const deps = makeDeps({
      runEvalSuite: mock(async (_reg: any, _run: any, _judge: any, cfg: EvalSuiteConfig) => {
        capturedConfig = cfg;
        return makeSuiteResult();
      }),
    });

    // Act
    await runBenchmarkPipeline(makeConfig({ domains: ["coding"] }), deps);

    // Assert
    expect(capturedConfig!.domains).toEqual(["coding"]);
  });

  it("should pass judgeConfig through correctly", async () => {
    // Arrange
    let capturedConfig: EvalSuiteConfig | undefined;
    const deps = makeDeps({
      runEvalSuite: mock(async (_reg: any, _run: any, _judge: any, cfg: EvalSuiteConfig) => {
        capturedConfig = cfg;
        return makeSuiteResult();
      }),
    });
    const judgeConfig: JudgeConfig = {
      judgeModel: "custom/judge",
      temperature: 0.5,
      maxTokens: 4000,
      lengthBiasCorrection: true,
    };

    // Act
    await runBenchmarkPipeline(makeConfig({ judgeConfig }), deps);

    // Assert
    expect(capturedConfig!.judgeConfig).toEqual(judgeConfig);
  });

  it("should build ratings map from loaded models via extractRatingsMap", async () => {
    // Arrange
    const models = [makeModel()];
    let capturedModels: ModelInfo[] | undefined;
    const deps = makeDeps({
      loadModels: mock(() => models),
      extractRatingsMap: mock((m: ModelInfo[]) => {
        capturedModels = m;
        return new Map();
      }),
    });

    // Act
    await runBenchmarkPipeline(makeConfig(), deps);

    // Assert
    expect(capturedModels).toBe(models);
  });

  it("should return ratingsUpdated matching btUpdates length", async () => {
    // Arrange
    const updates: BTUpdate[] = Array.from({ length: 6 }, (_, i) => ({
      modelId: `m-${i}`,
      dimension: "REASONING" as CapabilityDimension,
      oldMu: 500, newMu: 510, oldSigma: SIGMA_BASE, newSigma: 340, comparisons: 1,
    }));
    const deps = makeDeps({
      runEvalSuite: mock(async () => makeSuiteResult({ btUpdates: updates })),
    });

    // Act
    const result = await runBenchmarkPipeline(makeConfig(), deps);

    // Assert
    expect(result.ratingsUpdated).toBe(6);
  });

  it("should set modelsPersisted to true", async () => {
    // Arrange
    const deps = makeDeps();

    // Act
    const result = await runBenchmarkPipeline(makeConfig(), deps);

    // Assert
    expect(result.modelsPersisted).toBe(true);
  });

  // -- NE --

  it("should throw when no prompts available", async () => {
    // Arrange
    const deps = makeDeps({ loadPrompts: mock(() => []) });

    // Act & Assert
    expect(runBenchmarkPipeline(makeConfig(), deps)).rejects.toThrow("No prompts available");
  });

  it("should throw when no models available", async () => {
    // Arrange
    const deps = makeDeps({ loadModels: mock(() => []) });

    // Act & Assert
    expect(runBenchmarkPipeline(makeConfig(), deps)).rejects.toThrow("No models available");
  });

  it("should propagate loadPrompts errors", async () => {
    // Arrange
    const deps = makeDeps({
      loadPrompts: mock(() => { throw new Error("prompts file corrupt"); }),
    });

    // Act & Assert
    expect(runBenchmarkPipeline(makeConfig(), deps)).rejects.toThrow("prompts file corrupt");
  });

  it("should propagate loadModels errors", async () => {
    // Arrange
    const deps = makeDeps({
      loadModels: mock(() => { throw new Error("models file corrupt"); }),
    });

    // Act & Assert
    expect(runBenchmarkPipeline(makeConfig(), deps)).rejects.toThrow("models file corrupt");
  });

  it("should propagate runEvalSuite errors", async () => {
    // Arrange
    const deps = makeDeps({
      runEvalSuite: mock(async () => { throw new Error("runner failed"); }),
    });

    // Act & Assert
    expect(runBenchmarkPipeline(makeConfig(), deps)).rejects.toThrow("runner failed");
  });

  it("should propagate persistRatings errors", async () => {
    // Arrange
    const deps = makeDeps({
      persistRatings: mock(async () => { throw new Error("write denied"); }),
    });

    // Act & Assert
    expect(runBenchmarkPipeline(makeConfig(), deps)).rejects.toThrow("write denied");
  });

  it("should throw when domain filter yields no matching prompts", async () => {
    // Arrange
    const deps = makeDeps({
      runEvalSuite: mock(async () => {
        throw new Error("No prompts match the filter criteria");
      }),
    });

    // Act & Assert
    expect(
      runBenchmarkPipeline(makeConfig({ domains: ["math"] }), deps),
    ).rejects.toThrow("No prompts match");
  });

  // -- ED --

  it("should handle minimal single-prompt single-model input", async () => {
    // Arrange
    const singleBT: BTUpdate = {
      modelId: "model-a", dimension: "CODE_GENERATION" as CapabilityDimension,
      oldMu: 500, newMu: 510, oldSigma: SIGMA_BASE, newSigma: 340, comparisons: 1,
    };
    const deps = makeDeps({
      loadPrompts: mock(() => [makePrompt()]),
      runEvalSuite: mock(async () => makeSuiteResult({
        promptCount: 1, modelCount: 2, btUpdates: [singleBT],
      })),
    });

    // Act
    const result = await runBenchmarkPipeline(makeConfig({ modelIds: ["model-a"] }), deps);

    // Assert
    expect(result.suiteResult.promptCount).toBe(1);
    expect(result.ratingsUpdated).toBe(1);
  });

  it("should deduplicate anchorModelId in modelIds", async () => {
    // Arrange
    let capturedConfig: EvalSuiteConfig | undefined;
    const deps = makeDeps({
      runEvalSuite: mock(async (_reg: any, _run: any, _judge: any, cfg: EvalSuiteConfig) => {
        capturedConfig = cfg;
        return makeSuiteResult();
      }),
    });

    // Act
    await runBenchmarkPipeline(
      makeConfig({ modelIds: ["anchor", "model-a"], anchorModelId: "anchor" }),
      deps,
    );

    // Assert — pipeline passes config through; suite.ts deduplicates via new Set
    expect(capturedConfig!.modelIds).toEqual(["anchor", "model-a"]);
    expect(capturedConfig!.anchorModelId).toBe("anchor");
  });

  // -- CO --

  it("should check prompts before models when both empty", async () => {
    // Arrange
    const loadPrompts = mock(() => [] as EvalPrompt[]);
    const loadModels = mock(() => [] as ModelInfo[]);
    const deps = makeDeps({ loadPrompts, loadModels });

    // Act & Assert
    await expect(runBenchmarkPipeline(makeConfig(), deps)).rejects.toThrow("No prompts");
    expect(loadModels).not.toHaveBeenCalled();
  });

  it("should propagate persist error after successful suite run", async () => {
    // Arrange
    const deps = makeDeps({
      persistRatings: mock(async () => { throw new Error("disk full"); }),
    });

    // Act & Assert
    await expect(runBenchmarkPipeline(makeConfig(), deps)).rejects.toThrow("disk full");
  });

  // -- ST --

  it("should increase comparisons after pipeline", async () => {
    // Arrange
    const ratings: RatingsMap = new Map();
    const dimMap = new Map<CapabilityDimension, any>();
    dimMap.set("CODE_GENERATION" as CapabilityDimension, { mu: 500, sigma: SIGMA_BASE, comparisons: 0 });
    ratings.set("model-a", dimMap);

    const deps = makeDeps({
      extractRatingsMap: mock(() => ratings),
      runEvalSuite: mock(async (_reg: any, _run: any, _judge: any, _cfg: any, ratingsArg: RatingsMap) => {
        const entry = ratingsArg.get("model-a")?.get("CODE_GENERATION" as CapabilityDimension);
        if (entry) {
          entry.comparisons = 5;
          entry.mu = 520;
        }
        return makeSuiteResult();
      }),
    });

    // Act
    await runBenchmarkPipeline(makeConfig(), deps);

    // Assert
    const updated = ratings.get("model-a")?.get("CODE_GENERATION" as CapabilityDimension);
    expect(updated!.comparisons).toBe(5);
  });

  it("should shift mu from initial values", async () => {
    // Arrange
    const ratings: RatingsMap = new Map();
    const dimMap = new Map<CapabilityDimension, any>();
    dimMap.set("REASONING" as CapabilityDimension, { mu: 500, sigma: SIGMA_BASE, comparisons: 0 });
    ratings.set("model-a", dimMap);

    const deps = makeDeps({
      extractRatingsMap: mock(() => ratings),
      runEvalSuite: mock(async (_reg: any, _run: any, _judge: any, _cfg: any, ratingsArg: RatingsMap) => {
        const entry = ratingsArg.get("model-a")?.get("REASONING" as CapabilityDimension);
        if (entry) entry.mu = 550;
        return makeSuiteResult();
      }),
    });

    // Act
    await runBenchmarkPipeline(makeConfig(), deps);

    // Assert
    const mu = ratings.get("model-a")?.get("REASONING" as CapabilityDimension)?.mu;
    expect(mu).toBe(550);
  });

  // -- ID --

  it("should return consistent structure for same inputs", async () => {
    // Arrange
    const suiteResult = makeSuiteResult();
    const deps = makeDeps({
      runEvalSuite: mock(async () => suiteResult),
    });
    const config = makeConfig();

    // Act
    const result1 = await runBenchmarkPipeline(config, deps);
    const result2 = await runBenchmarkPipeline(config, deps);

    // Assert
    expect(result1.ratingsUpdated).toBe(result2.ratingsUpdated);
    expect(result1.modelsPersisted).toBe(result2.modelsPersisted);
  });

  // -- OR --

  it("should call loadPrompts before loadModels", async () => {
    // Arrange
    const callOrder: string[] = [];
    const deps = makeDeps({
      loadPrompts: mock(() => {
        callOrder.push("prompts");
        return [makePrompt()];
      }),
      loadModels: mock(() => {
        callOrder.push("models");
        return [makeModel()];
      }),
    });

    // Act
    await runBenchmarkPipeline(makeConfig(), deps);

    // Assert
    expect(callOrder[0]).toBe("prompts");
    expect(callOrder[1]).toBe("models");
  });
});
