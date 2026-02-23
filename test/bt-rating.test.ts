/**
 * Integration tests for BT Dimensional Rating.
 * Cross-module: types + registry + selector + team-composer.
 *
 * SUT boundary: ModelRegistry → selectModel → compositeScore pipeline.
 * Outside boundary: none (all real implementations).
 */

import { describe, it, expect } from "bun:test";
import { selectModel } from "../src/router/selector";
import type { AdaptiveWeightProvider } from "../src/router/types";
import type { TaskRequirement } from "../src/profile/types";
import type { BudgetConfig, FallbackSelectResult } from "../src/router/types";
import type { ModelInfo, CapabilityDimension } from "../src/model/types";
import { ALL_DIMENSIONS } from "../src/model/types";

// -- Helpers --

const SIGMA_BASE = 350;

function makeDimensionRating(
  mu: number,
  sigma: number,
  comparisons: number,
): { mu: number; sigma: number; comparisons: number } {
  return { mu, sigma, comparisons };
}

function makeBTModel(overrides: {
  id: string;
  contextWindow?: number;
  cost?: { inputPer1M: number; outputPer1M: number };
  supportsToolCalling?: boolean;
  capabilities?: Partial<
    Record<CapabilityDimension, { mu: number; sigma: number; comparisons: number }>
  >;
}): ModelInfo {
  const caps: Record<string, { mu: number; sigma: number; comparisons: number }> = {};
  for (const dim of ALL_DIMENSIONS) {
    caps[dim] = overrides.capabilities?.[dim as CapabilityDimension] ?? makeDimensionRating(500, 350, 0);
  }
  return {
    id: overrides.id,
    name: overrides.id,
    contextWindow: overrides.contextWindow ?? 100_000,
    capabilities: caps as any,
    
    cost: overrides.cost ?? { inputPer1M: 1.0, outputPer1M: 4.0 },
    supportsToolCalling: overrides.supportsToolCalling ?? true,
  };
}

function makeReq(overrides: Partial<TaskRequirement> = {}): TaskRequirement {
  return {
    taskType: "IMPLEMENT_FEATURE",
    domain: "CODING",
    requiredCapabilities: [
      { dimension: "CODE_GENERATION", weight: 1.0 },
    ],
    estimatedInputTokens: 2000,
    estimatedOutputTokens: 1000,
    requiresStructuredOutput: false,
    requiresKorean: false,
    requiresToolCalling: false,
    ...overrides,
  };
}

const BUDGET: BudgetConfig = { perRequest: 10.0 };

describe("BT Rating Integration", () => {
  it("should return score=0 when mu=0 and sigma=0", () => {
    // Arrange — mu=0 means no strength, sigma=0 means penalty=1
    // score = 0 * 1.0 * weight = 0
    const model = makeBTModel({
      id: "zero/zero",
      capabilities: {
        CODE_GENERATION: makeDimensionRating(0, 0, 0),
      },
    });

    // Act
    const result = selectModel([model], makeReq(), BUDGET);

    // Assert
    expect(result.score).toBe(0);
  });

  it("should tiebreak by score when all CE equal (cost=0)", () => {
    // Arrange — both cost=0 → CE=Infinity, tiebreak by score DESC
    const weak = makeBTModel({
      id: "weak",
      cost: { inputPer1M: 0, outputPer1M: 0 },
      capabilities: {
        CODE_GENERATION: makeDimensionRating(500, 0, 50),
      },
    });
    const strong = makeBTModel({
      id: "strong",
      cost: { inputPer1M: 0, outputPer1M: 0 },
      capabilities: {
        CODE_GENERATION: makeDimensionRating(900, 0, 50),
      },
    });

    // Act
    const result = selectModel([weak, strong], makeReq(), BUDGET);

    // Assert — both CE=Infinity, strong has higher score → wins
    expect(result.model.id).toBe("strong");
    expect(result.costEfficiency).toBe(Infinity);
  });

  it("should produce same ranking regardless of input order", () => {
    // Arrange
    const a = makeBTModel({
      id: "a",
      cost: { inputPer1M: 0.5, outputPer1M: 2.0 },
      capabilities: {
        CODE_GENERATION: makeDimensionRating(900, 100, 30),
      },
    });
    const b = makeBTModel({
      id: "b",
      cost: { inputPer1M: 2.0, outputPer1M: 8.0 },
      capabilities: {
        CODE_GENERATION: makeDimensionRating(700, 200, 15),
      },
    });
    const c = makeBTModel({
      id: "c",
      cost: { inputPer1M: 1.0, outputPer1M: 4.0 },
      capabilities: {
        CODE_GENERATION: makeDimensionRating(800, 50, 40),
      },
    });

    // Act
    const r1 = selectModel([a, b, c], makeReq(), BUDGET);
    const r2 = selectModel([c, a, b], makeReq(), BUDGET);
    const r3 = selectModel([b, c, a], makeReq(), BUDGET);

    // Assert — same winner regardless of order
    expect(r1.model.id).toBe(r2.model.id);
    expect(r2.model.id).toBe(r3.model.id);
  });
});
