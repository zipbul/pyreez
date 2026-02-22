/**
 * Unit tests for route() — pipeline integration.
 * PRUNE final list: 8 tests.
 * Uses DI injection (TST-MOCK-STRATEGY priority 1) to avoid mock.module pollution.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { route } from "./router";
import type { RouteDeps } from "./router";
import type { ClassifyResult } from "../classify/types";
import type { TaskRequirement } from "../profile/types";
import type { SelectResult, FallbackSelectResult, BudgetConfig } from "./types";
import type { ModelInfo } from "../model/types";

// -- Stub data --

const stubClassifyResult: ClassifyResult = {
  domain: "CODING",
  taskType: "IMPLEMENT_FEATURE",
  complexity: "moderate",
  criticality: "medium",
  method: "rule",
};

const stubRequirement: TaskRequirement = {
  taskType: "IMPLEMENT_FEATURE",
  domain: "CODING",
  requiredCapabilities: [{ dimension: "CODE_GENERATION", weight: 1.0 }],
  estimatedInputTokens: 2000,
  estimatedOutputTokens: 1000,
  requiresStructuredOutput: false,
  requiresKorean: false,
  requiresToolCalling: false,
};

const stubModel: ModelInfo = {
  id: "test/model",
  name: "Test Model",
  contextWindow: 100_000,
  capabilities: {
    REASONING: 7, MATH_REASONING: 6, MULTI_STEP_DEPTH: 6, CREATIVITY: 5, ANALYSIS: 7, JUDGMENT: 7,
    CODE_GENERATION: 8, CODE_UNDERSTANDING: 7, DEBUGGING: 7, SYSTEM_THINKING: 6, TOOL_USE: 6,
    HALLUCINATION_RESISTANCE: 6, CONFIDENCE_CALIBRATION: 6, SELF_CONSISTENCY: 6, AMBIGUITY_HANDLING: 6,
    INSTRUCTION_FOLLOWING: 7, STRUCTURED_OUTPUT: 7, LONG_CONTEXT: 7, MULTILINGUAL: 6,
    SPEED: 7, COST_EFFICIENCY: 6,
  },
  confidence: {
    REASONING: 0.3, MATH_REASONING: 0.3, MULTI_STEP_DEPTH: 0.3, CREATIVITY: 0.3, ANALYSIS: 0.3, JUDGMENT: 0.3,
    CODE_GENERATION: 0.3, CODE_UNDERSTANDING: 0.3, DEBUGGING: 0.3, SYSTEM_THINKING: 0.3, TOOL_USE: 0.3,
    HALLUCINATION_RESISTANCE: 0.3, CONFIDENCE_CALIBRATION: 0.3, SELF_CONSISTENCY: 0.3, AMBIGUITY_HANDLING: 0.3,
    INSTRUCTION_FOLLOWING: 0.3, STRUCTURED_OUTPUT: 0.3, LONG_CONTEXT: 0.3, MULTILINGUAL: 0.3,
    SPEED: 0.3, COST_EFFICIENCY: 0.3,
  },
  cost: { inputPer1M: 0.4, outputPer1M: 1.6 },
  supportsToolCalling: true,
};

const stubSelectResult: SelectResult = {
  model: stubModel,
  score: 5.2,
  costEfficiency: 1000,
  expectedCost: 0.0024,
  reason: "Selected Test Model",
};

const stubFallbackResult: FallbackSelectResult = {
  ...stubSelectResult,
  relaxedConstraints: ["budget"],
  warning: "Fallback: all models filtered",
};

// -- Stub deps factory --

let classifyReturnValue: ClassifyResult | null;
let selectReturnValue: SelectResult | FallbackSelectResult;
let capturedBudget: BudgetConfig | undefined;

function makeDeps(): RouteDeps {
  return {
    classify: () => classifyReturnValue,
    profile: () => stubRequirement,
    select: (_models, _req, budget) => {
      capturedBudget = budget;
      return selectReturnValue;
    },
    getModels: () => [stubModel],
  };
}

describe("route", () => {
  beforeEach(() => {
    classifyReturnValue = stubClassifyResult;
    selectReturnValue = stubSelectResult;
    capturedBudget = undefined;
  });

  // -- HP: full pipeline success --

  it("should return RouteResult with classification, requirement, and selection", () => {
    // Act
    const result = route("함수 구현해줘", undefined, makeDeps());

    // Assert
    expect(result).not.toBeNull();
    expect(result!.classification).toEqual(stubClassifyResult);
    expect(result!.requirement).toEqual(stubRequirement);
    expect(result!.selection).toEqual(stubSelectResult);
  });

  // -- HP: budget provided --

  it("should forward provided budget to selectModel", () => {
    // Arrange
    const customBudget: BudgetConfig = { perRequest: 0.5 };

    // Act
    route("함수 구현해줘", customBudget, makeDeps());

    // Assert
    expect(capturedBudget).toEqual(customBudget);
  });

  // -- HP: budget default --

  it("should use $1.00 default budget when not provided", () => {
    // Act
    route("함수 구현해줘", undefined, makeDeps());

    // Assert
    expect(capturedBudget).toEqual({ perRequest: 1.0 });
  });

  // -- NE: classify returns null --

  it("should return null when classification fails", () => {
    // Arrange
    classifyReturnValue = null;

    // Act
    const result = route("알 수 없는 요청", undefined, makeDeps());

    // Assert
    expect(result).toBeNull();
  });

  // -- NE: empty prompt --

  it("should return null for empty prompt", () => {
    // Arrange
    classifyReturnValue = null;

    // Act
    const result = route("", undefined, makeDeps());

    // Assert
    expect(result).toBeNull();
  });

  // -- ED: budget=0 --

  it("should return result even when budget is 0 (selectModel handles fallback)", () => {
    // Arrange
    selectReturnValue = stubFallbackResult;

    // Act
    const result = route("함수 구현해줘", { perRequest: 0 }, makeDeps());

    // Assert
    expect(result).not.toBeNull();
    expect((result!.selection as FallbackSelectResult).warning).toBeDefined();
  });

  // -- CO: classify succeeds but select returns fallback --

  it("should return RouteResult even when selectModel returns fallback", () => {
    // Arrange
    selectReturnValue = stubFallbackResult;

    // Act
    const result = route("함수 구현해줘", undefined, makeDeps());

    // Assert
    expect(result).not.toBeNull();
    expect(result!.classification).toEqual(stubClassifyResult);
    expect((result!.selection as FallbackSelectResult).relaxedConstraints).toBeDefined();
  });

  // -- ID: idempotency --

  it("should return identical result for same prompt on repeated calls", () => {
    // Arrange
    const deps = makeDeps();

    // Act
    const result1 = route("함수 구현해줘", undefined, deps);
    const result2 = route("함수 구현해줘", undefined, deps);

    // Assert
    expect(result1).toEqual(result2);
  });
});
