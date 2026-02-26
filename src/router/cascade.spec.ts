/**
 * Adaptive Weight Cascade tests.
 */
import { describe, it, expect } from "bun:test";
import {
  buildCascadeChain,
  passesGate,
  executeCascade,
  estimateSavings,
  type CascadeConfig,
  type ConfidenceChecker,
  type CascadeResult,
} from "./cascade";
import type { ModelInfo } from "../model/types";
import type { TaskRequirement } from "../profile/types";

// -- Helpers --

function makeModel(id: string, inputPer1M: number, outputPer1M: number): ModelInfo {
  return {
    id,
    name: id,
    provider: "github",
    contextWindow: 100_000,
    capabilities: {} as any,
    cost: { inputPer1M, outputPer1M },
    supportsToolCalling: true,
  };
}

function makeRequirement(): TaskRequirement {
  return {
    taskType: "IMPLEMENT_FEATURE" as any,
    domain: "CODING",
    requiredCapabilities: [],
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    requiresStructuredOutput: false,
    requiresKorean: false,
    requiresToolCalling: false,
  };
}

function makeConfig(overrides: Partial<CascadeConfig> = {}): CascadeConfig {
  return {
    confidenceThreshold: 0.8,
    maxSteps: 5,
    budgetLimit: 1.0,
    ...overrides,
  };
}

function makeMockChecker(confidences: Record<string, number>): ConfidenceChecker {
  return {
    checkConfidence: async (modelId: string) => confidences[modelId] ?? 0.5,
  };
}

// ================================================================
// buildCascadeChain
// ================================================================

describe("buildCascadeChain", () => {
  it("should sort models by cost ascending", () => {
    const models = [
      makeModel("expensive", 10, 30),
      makeModel("cheap", 0.1, 0.3),
      makeModel("medium", 2, 6),
    ];
    const chain = buildCascadeChain(models, 1000, 500);
    expect(chain[0]!.model.id).toBe("cheap");
    expect(chain[1]!.model.id).toBe("medium");
    expect(chain[2]!.model.id).toBe("expensive");
  });

  it("should calculate estimated cost", () => {
    const models = [makeModel("m1", 1.0, 4.0)];
    const chain = buildCascadeChain(models, 1000, 500);
    // (1000 * 1.0 + 500 * 4.0) / 1_000_000 = 3000 / 1_000_000 = 0.003
    expect(chain[0]!.estimatedCost).toBeCloseTo(0.003, 5);
  });
});

// ================================================================
// passesGate
// ================================================================

describe("passesGate", () => {
  it("should pass when confidence >= threshold", () => {
    expect(passesGate(0.9, 0.8)).toBe(true);
    expect(passesGate(0.8, 0.8)).toBe(true);
  });

  it("should fail when confidence < threshold", () => {
    expect(passesGate(0.7, 0.8)).toBe(false);
  });
});

// ================================================================
// executeCascade
// ================================================================

describe("executeCascade", () => {
  it("should accept first model if confidence is high enough", async () => {
    const models = [
      makeModel("cheap", 0.1, 0.3),
      makeModel("expensive", 10, 30),
    ];
    const checker = makeMockChecker({ cheap: 0.9, expensive: 0.95 });
    const result = await executeCascade(models, makeRequirement(), makeConfig(), checker, "test");

    expect(result.selectedModelId).toBe("cheap");
    expect(result.completed).toBe(true);
    expect(result.steps).toHaveLength(1);
  });

  it("should escalate when first model confidence is low", async () => {
    const models = [
      makeModel("cheap", 0.1, 0.3),
      makeModel("expensive", 10, 30),
    ];
    const checker = makeMockChecker({ cheap: 0.5, expensive: 0.9 });
    const result = await executeCascade(models, makeRequirement(), makeConfig(), checker, "test");

    expect(result.selectedModelId).toBe("expensive");
    expect(result.completed).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]!.accepted).toBe(false);
    expect(result.steps[1]!.accepted).toBe(true);
  });

  it("should stop at maxSteps", async () => {
    const models = [
      makeModel("m1", 0.1, 0.1),
      makeModel("m2", 0.2, 0.2),
      makeModel("m3", 0.3, 0.3),
    ];
    const checker = makeMockChecker({ m1: 0.1, m2: 0.1, m3: 0.1 });
    const config = makeConfig({ maxSteps: 2 });
    const result = await executeCascade(models, makeRequirement(), config, checker, "test");

    expect(result.steps).toHaveLength(2);
    expect(result.completed).toBe(false);
  });

  it("should stop when budget is exhausted", async () => {
    const models = [
      makeModel("cheap", 0.1, 0.3),
      makeModel("expensive", 1000, 3000), // very expensive
    ];
    const checker = makeMockChecker({ cheap: 0.5, expensive: 0.9 });
    const config = makeConfig({ budgetLimit: 0.001 });
    const result = await executeCascade(models, makeRequirement(), config, checker, "test");

    // cheap cost: (1000*0.1 + 500*0.3)/1M = 250/1M = 0.00025
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    // expensive would exceed budget
    expect(result.budgetExhausted).toBe(true);
  });

  it("should use last model when none pass gate", async () => {
    const models = [
      makeModel("m1", 0.1, 0.3),
      makeModel("m2", 1.0, 3.0),
    ];
    const checker = makeMockChecker({ m1: 0.3, m2: 0.4 });
    const result = await executeCascade(models, makeRequirement(), makeConfig(), checker, "test");

    expect(result.completed).toBe(false);
    expect(result.selectedModelId).toBe("m2");
  });

  it("should accumulate total cost across steps", async () => {
    const models = [
      makeModel("m1", 1.0, 2.0),
      makeModel("m2", 3.0, 6.0),
    ];
    const checker = makeMockChecker({ m1: 0.5, m2: 0.9 });
    const result = await executeCascade(models, makeRequirement(), makeConfig(), checker, "test");

    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.totalCost).toBe(result.steps.reduce((sum, s) => sum + s.estimatedCost, 0));
  });
});

// ================================================================
// estimateSavings
// ================================================================

describe("estimateSavings", () => {
  it("should calculate savings when cascade is cheaper", () => {
    const result: CascadeResult = {
      selectedModelId: "cheap",
      totalCost: 0.01,
      steps: [],
      completed: true,
      budgetExhausted: false,
    };
    const { saved, savingsPercent } = estimateSavings(result, 0.10);
    expect(saved).toBeCloseTo(0.09, 5);
    expect(savingsPercent).toBeCloseTo(90, 1);
  });

  it("should return 0 savings when cascade costs more", () => {
    const result: CascadeResult = {
      selectedModelId: "m",
      totalCost: 0.20,
      steps: [],
      completed: true,
      budgetExhausted: false,
    };
    const { saved, savingsPercent } = estimateSavings(result, 0.10);
    expect(saved).toBe(0);
    expect(savingsPercent).toBe(0);
  });

  it("should handle zero best model cost", () => {
    const result: CascadeResult = {
      selectedModelId: "m",
      totalCost: 0,
      steps: [],
      completed: true,
      budgetExhausted: false,
    };
    expect(estimateSavings(result, 0).savingsPercent).toBe(0);
  });
});
