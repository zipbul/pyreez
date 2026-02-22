/**
 * Unit tests for selectModel — SELECT phase.
 * PRUNE final list: 17 tests.
 */

import { describe, it, expect } from "bun:test";
import { selectModel } from "./selector";
import type { ModelInfo, ModelCapabilities, ModelConfidence } from "../model/types";
import type { TaskRequirement } from "../profile/types";
import type { BudgetConfig, SelectResult, FallbackSelectResult } from "./types";

// -- Helpers --

function makeCapabilities(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    REASONING: 5,
    MATH_REASONING: 5,
    MULTI_STEP_DEPTH: 5,
    CREATIVITY: 5,
    ANALYSIS: 5,
    JUDGMENT: 5,
    CODE_GENERATION: 5,
    CODE_UNDERSTANDING: 5,
    DEBUGGING: 5,
    SYSTEM_THINKING: 5,
    TOOL_USE: 5,
    HALLUCINATION_RESISTANCE: 5,
    CONFIDENCE_CALIBRATION: 5,
    SELF_CONSISTENCY: 5,
    AMBIGUITY_HANDLING: 5,
    INSTRUCTION_FOLLOWING: 5,
    STRUCTURED_OUTPUT: 5,
    LONG_CONTEXT: 5,
    MULTILINGUAL: 5,
    SPEED: 5,
    COST_EFFICIENCY: 5,
    ...overrides,
  };
}

function makeConfidence(value = 0.3): ModelConfidence {
  return {
    REASONING: value,
    MATH_REASONING: value,
    MULTI_STEP_DEPTH: value,
    CREATIVITY: value,
    ANALYSIS: value,
    JUDGMENT: value,
    CODE_GENERATION: value,
    CODE_UNDERSTANDING: value,
    DEBUGGING: value,
    SYSTEM_THINKING: value,
    TOOL_USE: value,
    HALLUCINATION_RESISTANCE: value,
    CONFIDENCE_CALIBRATION: value,
    SELF_CONSISTENCY: value,
    AMBIGUITY_HANDLING: value,
    INSTRUCTION_FOLLOWING: value,
    STRUCTURED_OUTPUT: value,
    LONG_CONTEXT: value,
    MULTILINGUAL: value,
    SPEED: value,
    COST_EFFICIENCY: value,
  };
}

function makeModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "test/model-a",
    name: "Model A",
    contextWindow: 100_000,
    capabilities: makeCapabilities(),
    confidence: makeConfidence(),
    cost: { inputPer1M: 1.0, outputPer1M: 4.0 },
    supportsToolCalling: true,
    ...overrides,
  };
}

function makeRequirement(overrides: Partial<TaskRequirement> = {}): TaskRequirement {
  return {
    taskType: "IMPLEMENT_FEATURE",
    domain: "CODING",
    requiredCapabilities: [
      { dimension: "CODE_GENERATION", weight: 0.5 },
      { dimension: "REASONING", weight: 0.3 },
      { dimension: "INSTRUCTION_FOLLOWING", weight: 0.2 },
    ],
    estimatedInputTokens: 2000,
    estimatedOutputTokens: 1000,
    requiresStructuredOutput: false,
    requiresKorean: false,
    requiresToolCalling: false,
    ...overrides,
  };
}

const DEFAULT_BUDGET: BudgetConfig = { perRequest: 1.0 };

describe("selectModel", () => {
  // -- HP: cost-efficiency based selection --

  it("should select model with highest cost-efficiency when multiple pass all filters", () => {
    // Arrange — Model B is cheaper with same capabilities
    const expensive = makeModel({
      id: "expensive",
      cost: { inputPer1M: 5.0, outputPer1M: 20.0 },
    });
    const cheap = makeModel({
      id: "cheap",
      cost: { inputPer1M: 0.1, outputPer1M: 0.4 },
    });

    // Act
    const result = selectModel([expensive, cheap], makeRequirement(), DEFAULT_BUDGET);

    // Assert
    expect(result.model.id).toBe("cheap");
    expect(result.costEfficiency).toBeGreaterThan(0);
  });

  // -- HP: context window filter --

  it("should filter out model with insufficient context window", () => {
    // Arrange
    const smallContext = makeModel({
      id: "small",
      contextWindow: 100, // Too small for 2000+1000 tokens
    });
    const largeContext = makeModel({
      id: "large",
      contextWindow: 100_000,
    });

    // Act
    const result = selectModel(
      [smallContext, largeContext],
      makeRequirement(),
      DEFAULT_BUDGET,
    );

    // Assert
    expect(result.model.id).toBe("large");
  });

  // -- HP: tool calling filter --

  it("should filter out model without tool calling when required", () => {
    // Arrange
    const noTools = makeModel({ id: "no-tools", supportsToolCalling: false });
    const withTools = makeModel({ id: "with-tools", supportsToolCalling: true });

    // Act
    const result = selectModel(
      [noTools, withTools],
      makeRequirement({ requiresToolCalling: true }),
      DEFAULT_BUDGET,
    );

    // Assert
    expect(result.model.id).toBe("with-tools");
  });

  // -- HP: Korean multilingual filter --

  it("should filter out model with MULTILINGUAL < 5 when Korean required", () => {
    // Arrange
    const lowMulti = makeModel({
      id: "low-multi",
      capabilities: makeCapabilities({ MULTILINGUAL: 4 }),
    });
    const highMulti = makeModel({
      id: "high-multi",
      capabilities: makeCapabilities({ MULTILINGUAL: 7 }),
    });

    // Act
    const result = selectModel(
      [lowMulti, highMulti],
      makeRequirement({ requiresKorean: true }),
      DEFAULT_BUDGET,
    );

    // Assert
    expect(result.model.id).toBe("high-multi");
  });

  // -- HP: cost budget filter --

  it("should filter out model exceeding budget per request", () => {
    // Arrange — expensive model costs more than $0.01 budget
    const expensive = makeModel({
      id: "expensive",
      cost: { inputPer1M: 100.0, outputPer1M: 400.0 },
    });
    const cheap = makeModel({
      id: "cheap",
      cost: { inputPer1M: 0.1, outputPer1M: 0.4 },
    });

    // Act
    const result = selectModel(
      [expensive, cheap],
      makeRequirement(),
      { perRequest: 0.01 },
    );

    // Assert
    expect(result.model.id).toBe("cheap");
  });

  // -- HP: composite score with confidence factor --

  it("should calculate composite score correctly with confidence factor", () => {
    // Arrange — single model, verify score algebra
    const model = makeModel({
      capabilities: makeCapabilities({ CODE_GENERATION: 8, REASONING: 6, INSTRUCTION_FOLLOWING: 7 }),
      confidence: makeConfidence(0.5),
    });
    const req = makeRequirement({
      requiredCapabilities: [
        { dimension: "CODE_GENERATION", weight: 1.0 }, // simplified single dimension
      ],
    });

    // Act
    const result = selectModel([model], req, DEFAULT_BUDGET);

    // Assert
    // score = 8 × (0.5 + 0.5 × 0.5) × 1.0 = 8 × 0.75 = 6.0
    expect(result.score).toBeCloseTo(6.0, 4);
  });

  // -- HP: minimum capability threshold --

  it("should filter out model below minimum capability threshold", () => {
    // Arrange
    const lowScore = makeModel({
      id: "low",
      capabilities: makeCapabilities({ CODE_GENERATION: 3 }),
    });
    const highScore = makeModel({
      id: "high",
      capabilities: makeCapabilities({ CODE_GENERATION: 8 }),
    });
    const req = makeRequirement({
      requiredCapabilities: [
        { dimension: "CODE_GENERATION", weight: 1.0, minimum: 5 },
      ],
    });

    // Act
    const result = selectModel([lowScore, highScore], req, DEFAULT_BUDGET);

    // Assert
    expect(result.model.id).toBe("high");
  });

  // -- NE: empty models --

  it("should return fallback when models array is empty", () => {
    // Act
    const result = selectModel([], makeRequirement(), DEFAULT_BUDGET);

    // Assert
    expect((result as FallbackSelectResult).warning).toBeDefined();
    expect((result as FallbackSelectResult).relaxedConstraints).toBeDefined();
  });

  // -- NE: all models filtered --

  it("should return fallback when all models filtered out", () => {
    // Arrange — all models too expensive
    const model = makeModel({
      cost: { inputPer1M: 1000.0, outputPer1M: 4000.0 },
    });

    // Act
    const result = selectModel([model], makeRequirement(), { perRequest: 0.0001 });

    // Assert
    expect((result as FallbackSelectResult).warning).toBeDefined();
    expect((result as FallbackSelectResult).relaxedConstraints.length).toBeGreaterThan(0);
  });

  // -- NE: single model passes --

  it("should select the only passing model when just one survives", () => {
    // Arrange
    const onlyModel = makeModel({ id: "sole-survivor" });

    // Act
    const result = selectModel([onlyModel], makeRequirement(), DEFAULT_BUDGET);

    // Assert
    expect(result.model.id).toBe("sole-survivor");
    expect(result.score).toBeGreaterThan(0);
  });

  // -- ED: budget=0 --

  it("should return fallback when budget.perRequest is 0", () => {
    // Arrange
    const model = makeModel();

    // Act
    const result = selectModel([model], makeRequirement(), { perRequest: 0 });

    // Assert
    expect((result as FallbackSelectResult).warning).toBeDefined();
  });

  // -- ED: tiebreak by score --

  it("should break tie by score DESC when cost-efficiency is equal", () => {
    // Arrange — same cost, different capabilities
    const cost = { inputPer1M: 1.0, outputPer1M: 4.0 };
    const weaker = makeModel({
      id: "weaker",
      capabilities: makeCapabilities({ CODE_GENERATION: 5 }),
      cost,
    });
    const stronger = makeModel({
      id: "stronger",
      capabilities: makeCapabilities({ CODE_GENERATION: 9 }),
      cost,
    });

    // Act
    const result = selectModel([weaker, stronger], makeRequirement(), DEFAULT_BUDGET);

    // Assert — same cost → same CE ratio direction, but higher score wins
    expect(result.model.id).toBe("stronger");
  });

  // -- ED: exact minimum threshold --

  it("should pass model with score exactly at minimum threshold", () => {
    // Arrange
    const exactModel = makeModel({
      id: "exact",
      capabilities: makeCapabilities({ CODE_GENERATION: 5 }),
    });
    const req = makeRequirement({
      requiredCapabilities: [
        { dimension: "CODE_GENERATION", weight: 1.0, minimum: 5 },
      ],
    });

    // Act
    const result = selectModel([exactModel], req, DEFAULT_BUDGET);

    // Assert — exactly at threshold should pass
    expect(result.model.id).toBe("exact");
  });

  // -- CO: all filters active --

  it("should select only model passing all constraints when all filters active", () => {
    // Arrange
    const noTools = makeModel({ id: "no-tools", supportsToolCalling: false });
    const lowMulti = makeModel({
      id: "low-multi",
      capabilities: makeCapabilities({ MULTILINGUAL: 3 }),
    });
    const winner = makeModel({
      id: "winner",
      capabilities: makeCapabilities({ MULTILINGUAL: 8, CODE_GENERATION: 9 }),
      supportsToolCalling: true,
    });

    const req = makeRequirement({
      requiresToolCalling: true,
      requiresKorean: true,
      requiredCapabilities: [
        { dimension: "CODE_GENERATION", weight: 1.0, minimum: 7 },
      ],
    });

    // Act
    const result = selectModel([noTools, lowMulti, winner], req, DEFAULT_BUDGET);

    // Assert
    expect(result.model.id).toBe("winner");
  });

  // -- CO: single model barely passes --

  it("should select model that barely passes all filters", () => {
    // Arrange
    const barely = makeModel({
      id: "barely",
      contextWindow: 3001, // barely >= 2000+1000
      capabilities: makeCapabilities({ MULTILINGUAL: 5, CODE_GENERATION: 5 }),
      supportsToolCalling: true,
    });
    const req = makeRequirement({
      requiresToolCalling: true,
      requiresKorean: true,
      requiredCapabilities: [
        { dimension: "CODE_GENERATION", weight: 1.0, minimum: 5 },
      ],
    });

    // Act
    const result = selectModel([barely], req, DEFAULT_BUDGET);

    // Assert
    expect(result.model.id).toBe("barely");
  });

  // -- ID: idempotency --

  it("should return identical result for same inputs on repeated calls", () => {
    // Arrange
    const models = [makeModel()];
    const req = makeRequirement();

    // Act
    const result1 = selectModel(models, req, DEFAULT_BUDGET);
    const result2 = selectModel(models, req, DEFAULT_BUDGET);

    // Assert
    expect(result1.model.id).toBe(result2.model.id);
    expect(result1.score).toBe(result2.score);
    expect(result1.costEfficiency).toBe(result2.costEfficiency);
  });

  // -- OR: input order independence --

  it("should select same model regardless of array order", () => {
    // Arrange
    const modelA = makeModel({
      id: "a",
      capabilities: makeCapabilities({ CODE_GENERATION: 9 }),
      cost: { inputPer1M: 0.1, outputPer1M: 0.4 },
    });
    const modelB = makeModel({
      id: "b",
      capabilities: makeCapabilities({ CODE_GENERATION: 5 }),
      cost: { inputPer1M: 1.0, outputPer1M: 4.0 },
    });

    // Act
    const result1 = selectModel([modelA, modelB], makeRequirement(), DEFAULT_BUDGET);
    const result2 = selectModel([modelB, modelA], makeRequirement(), DEFAULT_BUDGET);

    // Assert
    expect(result1.model.id).toBe(result2.model.id);
  });
});
