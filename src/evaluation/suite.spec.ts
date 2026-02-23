/**
 * Evaluation Suite integration tests.
 */
import { describe, it, expect } from "bun:test";
import { runEvalSuite } from "./suite";
import { PromptRegistry } from "./prompts";
import type {
  ModelRunner,
  PairwiseJudge,
  EvalSuiteConfig,
  EvalResponse,
  PairwiseResult,
  JudgeConfig,
  EvalPrompt,
} from "./types";
import type { RatingsMap } from "./bt-updater";
import { setRating } from "./bt-updater";
import { SIGMA_BASE } from "../model/types";

// -- Helpers --

function makeRegistry(): PromptRegistry {
  const reg = new PromptRegistry();
  reg.register({
    id: "coding-mod-001",
    domain: "coding",
    difficulty: "moderate",
    text: "Implement a LRU cache",
    expectedDimensions: ["CODE_GENERATION", "REASONING"],
    criteria: {
      specificity: 4, domainKnowledge: 4, complexity: 4,
      problemSolving: 4, creativity: 3, technicalAccuracy: 5, realWorldApplication: 4,
    },
    verifiable: true,
    referenceAnswer: "class LRUCache { ... }",
  });
  reg.register({
    id: "math-simple-001",
    domain: "math",
    difficulty: "simple",
    text: "What is 17 * 23?",
    expectedDimensions: ["MATH_REASONING"],
    criteria: {
      specificity: 5, domainKnowledge: 2, complexity: 1,
      problemSolving: 2, creativity: 0, technicalAccuracy: 5, realWorldApplication: 1,
    },
    verifiable: true,
    referenceAnswer: "391",
  });
  return reg;
}

function makeMockRunner(): ModelRunner {
  return {
    generate: async (modelId, prompt): Promise<EvalResponse> => ({
      promptId: "",
      modelId,
      response: `Response from ${modelId}: ${prompt.slice(0, 20)}`,
      latencyMs: 50,
      tokenUsage: { input: 100, output: 200 },
    }),
  };
}

function makeMockJudge(outcome: "A>>B" | "A>B" | "A=B" | "B>A" | "B>>A" = "A>B"): PairwiseJudge {
  return {
    judge: async (prompt, responseA, responseB, config): Promise<PairwiseResult> => ({
      promptId: prompt.id,
      modelA: responseA.modelId,
      modelB: responseB.modelId,
      judge: config.judgeModel,
      outcome,
      swapped: false,
      reasoning: "A is better",
      confidence: 0.8,
    }),
  };
}

function makeConfig(overrides: Partial<EvalSuiteConfig> = {}): EvalSuiteConfig {
  return {
    modelIds: ["model-a", "model-b"],
    anchorModelId: "anchor",
    judgeConfig: {
      judgeModel: "judge/o3",
      temperature: 0,
      maxTokens: 2000,
      lengthBiasCorrection: false,
    },
    concurrency: 1,
    positionSwap: false,
    ...overrides,
  };
}

// ================================================================
// runEvalSuite
// ================================================================

describe("runEvalSuite", () => {
  it("should run full pipeline and return results", async () => {
    const registry = makeRegistry();
    const runner = makeMockRunner();
    const judge = makeMockJudge("A>B");
    const config = makeConfig();
    const ratings: RatingsMap = new Map();

    const result = await runEvalSuite(registry, runner, judge, config, ratings);

    expect(result.promptCount).toBe(2);
    expect(result.modelCount).toBe(3); // model-a, model-b, anchor
    expect(result.pairwiseResults.length).toBeGreaterThan(0);
    expect(result.btUpdates.length).toBeGreaterThan(0);
    expect(result.consistencyRate).toBe(1.0); // no swap → all consistent
  });

  it("should throw on empty prompts (no match)", async () => {
    const registry = new PromptRegistry();
    const runner = makeMockRunner();
    const judge = makeMockJudge();
    const config = makeConfig({ domains: ["coding"] });
    const ratings: RatingsMap = new Map();

    expect(
      runEvalSuite(registry, runner, judge, config, ratings),
    ).rejects.toThrow("No prompts");
  });

  it("should update BT ratings after run", async () => {
    const registry = makeRegistry();
    const runner = makeMockRunner();
    const judge = makeMockJudge("A>>B"); // model-a always wins strongly
    const config = makeConfig({ modelIds: ["model-a"], anchorModelId: "anchor" });
    const ratings: RatingsMap = new Map();

    // Set initial ratings
    setRating(ratings, "model-a", "CODE_GENERATION", { mu: 500, sigma: SIGMA_BASE, comparisons: 0 });
    setRating(ratings, "anchor", "CODE_GENERATION", { mu: 500, sigma: SIGMA_BASE, comparisons: 0 });

    await runEvalSuite(registry, runner, judge, config, ratings);

    const modelARating = ratings.get("model-a")?.get("CODE_GENERATION");
    expect(modelARating!.mu).toBeGreaterThan(500);
    expect(modelARating!.comparisons).toBeGreaterThan(0);
  });

  it("should store pairwise results with correct model ids", async () => {
    const registry = makeRegistry();
    const runner = makeMockRunner();
    const judge = makeMockJudge("A>B");
    const config = makeConfig({ modelIds: ["model-a"], anchorModelId: "anchor" });
    const ratings: RatingsMap = new Map();

    const result = await runEvalSuite(registry, runner, judge, config, ratings);

    for (const pr of result.pairwiseResults) {
      expect(pr.modelA).toBe("model-a");
      expect(pr.modelB).toBe("anchor");
    }
  });
});
