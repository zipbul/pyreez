/**
 * Unit tests for selectModel — SELECT phase.
 */

import { describe, it, expect } from "bun:test";
import { selectModel } from "./selector";
import type { ModelInfo, ModelCapabilities, DimensionRating } from "../model/types";
import { ALL_DIMENSIONS, SIGMA_BASE } from "../model/types";
import type { AdaptiveWeightProvider } from "./types";
import type { TaskRequirement } from "../profile/types";
import type { BudgetConfig, SelectResult, FallbackSelectResult } from "./types";

// -- Helpers --

/** Default DimensionRating: mu=500 (old score 5), sigma=SIGMA_BASE (initial uncertainty). */
const DEFAULT_RATING: DimensionRating = { mu: 500, sigma: SIGMA_BASE, comparisons: 0 };

/**
 * Create capabilities with DimensionRating overrides.
 * Pass mu values (shorthand) or full DimensionRating objects.
 */
function makeCapabilities(
  overrides: Partial<Record<keyof ModelCapabilities, number | DimensionRating>> = {},
): ModelCapabilities {
  const caps: Record<string, DimensionRating> = {};
  for (const dim of ALL_DIMENSIONS) {
    const val = overrides[dim];
    if (val === undefined) {
      caps[dim] = { ...DEFAULT_RATING };
    } else if (typeof val === "number") {
      // Shorthand: number = mu value (old 0-10 scale × 100)
      caps[dim] = { mu: val * 100, sigma: SIGMA_BASE, comparisons: 0 };
    } else {
      caps[dim] = val;
    }
  }
  return caps as ModelCapabilities;
}

function makeModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "test/model-a",
    name: "Model A",
    contextWindow: 100_000,
    capabilities: makeCapabilities(),
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

  it("should calculate composite score correctly with uncertainty penalty", () => {
    // Arrange — single model, verify BT score algebra
    // CODE_GENERATION: mu=800 (old 8), sigma=SIGMA_BASE → penalty=0.5
    const model = makeModel({
      capabilities: makeCapabilities({ CODE_GENERATION: 8 }),
    });
    const req = makeRequirement({
      requiredCapabilities: [
        { dimension: "CODE_GENERATION", weight: 1.0 },
      ],
    });

    // Act
    const result = selectModel([model], req, DEFAULT_BUDGET);

    // Assert
    // score = 800 × (1/(1 + 350/350)) × 1.0 = 800 × 0.5 = 400
    expect(result.score).toBeCloseTo(400, 0);
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

  // === Adaptive Routing ===

  describe("adaptive boost", () => {
    it("should use existing score when adaptive is not provided", () => {
      // Arrange
      const model = makeModel({
        id: "test/model-a",
        capabilities: makeCapabilities({ CODE_GENERATION: 9, REASONING: 8 }),
      });

      // Act
      const withoutAdaptive = selectModel([model], makeRequirement(), DEFAULT_BUDGET);
      const withNull = selectModel([model], makeRequirement(), DEFAULT_BUDGET, undefined);

      // Assert
      expect(withoutAdaptive.score).toBe(withNull.score);
    });

    it("should keep same score when boost is 0", () => {
      // Arrange
      const model = makeModel({ id: "m1" });
      const adaptive: AdaptiveWeightProvider = { getBoost: () => 0 };

      // Act
      const baseline = selectModel([model], makeRequirement(), DEFAULT_BUDGET);
      const boosted = selectModel([model], makeRequirement(), DEFAULT_BUDGET, adaptive);

      // Assert
      expect(boosted.score).toBe(baseline.score);
    });

    it("should increase model score when boost is positive", () => {
      // Arrange
      const model = makeModel({ id: "m1" });
      const adaptive: AdaptiveWeightProvider = { getBoost: () => 0.2 };

      // Act
      const baseline = selectModel([model], makeRequirement(), DEFAULT_BUDGET);
      const boosted = selectModel([model], makeRequirement(), DEFAULT_BUDGET, adaptive);

      // Assert
      expect(boosted.score).toBeGreaterThan(baseline.score);
    });

    it("should decrease model score when boost is negative", () => {
      // Arrange
      const model = makeModel({ id: "m1" });
      const adaptive: AdaptiveWeightProvider = { getBoost: () => -0.2 };

      // Act
      const baseline = selectModel([model], makeRequirement(), DEFAULT_BUDGET);
      const boosted = selectModel([model], makeRequirement(), DEFAULT_BUDGET, adaptive);

      // Assert
      expect(boosted.score).toBeLessThan(baseline.score);
    });

    it("should reverse ranking when inferior model gets higher boost", () => {
      // Arrange — model B has lower capability but will get higher boost
      const modelA = makeModel({
        id: "a",
        capabilities: makeCapabilities({ CODE_GENERATION: 9 }),
        cost: { inputPer1M: 1.0, outputPer1M: 4.0 },
      });
      const modelB = makeModel({
        id: "b",
        capabilities: makeCapabilities({ CODE_GENERATION: 6 }),
        cost: { inputPer1M: 1.0, outputPer1M: 4.0 },
      });
      const adaptive: AdaptiveWeightProvider = {
        getBoost: (modelId: string) => (modelId === "b" ? 0.8 : -0.5),
      };

      // Act — without adaptive, A wins; with adaptive, B should win
      const baseline = selectModel([modelA, modelB], makeRequirement(), DEFAULT_BUDGET);
      const boosted = selectModel([modelA, modelB], makeRequirement(), DEFAULT_BUDGET, adaptive);

      // Assert
      expect(baseline.model.id).toBe("a");
      expect(boosted.model.id).toBe("b");
    });

    it("should change costEfficiency when boost affects score", () => {
      // Arrange
      const model = makeModel({ id: "m1" });
      const adaptive: AdaptiveWeightProvider = { getBoost: () => 0.5 };

      // Act
      const baseline = selectModel([model], makeRequirement(), DEFAULT_BUDGET);
      const boosted = selectModel([model], makeRequirement(), DEFAULT_BUDGET, adaptive);

      // Assert
      expect(boosted.costEfficiency).toBeGreaterThan(baseline.costEfficiency);
    });

    it("should double score when boost is 1", () => {
      // Arrange
      const model = makeModel({ id: "m1" });
      const adaptive: AdaptiveWeightProvider = { getBoost: () => 1 };

      // Act
      const baseline = selectModel([model], makeRequirement(), DEFAULT_BUDGET);
      const boosted = selectModel([model], makeRequirement(), DEFAULT_BUDGET, adaptive);

      // Assert
      expect(boosted.score).toBeCloseTo(baseline.score * 2, 5);
    });

    it("should zero score when boost is -1", () => {
      // Arrange
      const model = makeModel({ id: "m1" });
      const adaptive: AdaptiveWeightProvider = { getBoost: () => -1 };

      // Act
      const boosted = selectModel([model], makeRequirement(), DEFAULT_BUDGET, adaptive);

      // Assert
      expect(boosted.score).toBe(0);
    });

    it("should clamp boost to 1 when boost exceeds 1", () => {
      // Arrange
      const model = makeModel({ id: "m1" });
      const boostOver: AdaptiveWeightProvider = { getBoost: () => 5.0 };
      const boostExact: AdaptiveWeightProvider = { getBoost: () => 1.0 };

      // Act
      const overResult = selectModel([model], makeRequirement(), DEFAULT_BUDGET, boostOver);
      const exactResult = selectModel([model], makeRequirement(), DEFAULT_BUDGET, boostExact);

      // Assert
      expect(overResult.score).toBeCloseTo(exactResult.score, 5);
    });

    it("should clamp boost to -1 when boost is below -1", () => {
      // Arrange
      const model = makeModel({ id: "m1" });
      const boostUnder: AdaptiveWeightProvider = { getBoost: () => -3.0 };
      const boostExact: AdaptiveWeightProvider = { getBoost: () => -1.0 };

      // Act
      const underResult = selectModel([model], makeRequirement(), DEFAULT_BUDGET, boostUnder);
      const exactResult = selectModel([model], makeRequirement(), DEFAULT_BUDGET, boostExact);

      // Assert
      expect(underResult.score).toBeCloseTo(exactResult.score, 5);
    });

    it("should make all scores zero when all models get boost=-1", () => {
      // Arrange
      const modelA = makeModel({ id: "a", cost: { inputPer1M: 0.1, outputPer1M: 0.4 } });
      const modelB = makeModel({ id: "b", cost: { inputPer1M: 1.0, outputPer1M: 4.0 } });
      const adaptive: AdaptiveWeightProvider = { getBoost: () => -1 };

      // Act
      const result = selectModel([modelA, modelB], makeRequirement(), DEFAULT_BUDGET, adaptive);

      // Assert
      expect(result.score).toBe(0);
    });

    it("should ignore boost when all models fail hardFilter (fallback)", () => {
      // Arrange — budget=0 forces fallback
      const model = makeModel({ id: "m1" });
      const adaptive: AdaptiveWeightProvider = { getBoost: () => 1.0 };

      // Act
      const result = selectModel([model], makeRequirement(), { perRequest: 0 }, adaptive);

      // Assert — fallback result has relaxedConstraints
      expect((result as any).relaxedConstraints).toBeDefined();
    });

    it("should use score as tiebreak when boost causes CE tie", () => {
      // Arrange — same cost, same boost, different base scores → score tiebreak
      const modelA = makeModel({
        id: "a",
        capabilities: makeCapabilities({ CODE_GENERATION: 9 }),
        cost: { inputPer1M: 1.0, outputPer1M: 4.0 },
      });
      const modelB = makeModel({
        id: "b",
        capabilities: makeCapabilities({ CODE_GENERATION: 7 }),
        cost: { inputPer1M: 1.0, outputPer1M: 4.0 },
      });
      const adaptive: AdaptiveWeightProvider = { getBoost: () => 0 };

      // Act
      const result = selectModel([modelA, modelB], makeRequirement(), DEFAULT_BUDGET, adaptive);

      // Assert — A has higher score, should win tiebreak
      expect(result.model.id).toBe("a");
    });

    it("should return identical result for identical inputs with adaptive", () => {
      // Arrange
      const model = makeModel({ id: "m1" });
      const adaptive: AdaptiveWeightProvider = { getBoost: () => 0.3 };

      // Act
      const r1 = selectModel([model], makeRequirement(), DEFAULT_BUDGET, adaptive);
      const r2 = selectModel([model], makeRequirement(), DEFAULT_BUDGET, adaptive);

      // Assert
      expect(r1.score).toBe(r2.score);
      expect(r1.model.id).toBe(r2.model.id);
    });

    it("should return same result regardless of models array order with adaptive", () => {
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
      const adaptive: AdaptiveWeightProvider = {
        getBoost: (modelId: string) => (modelId === "a" ? 0.1 : 0.3),
      };

      // Act
      const r1 = selectModel([modelA, modelB], makeRequirement(), DEFAULT_BUDGET, adaptive);
      const r2 = selectModel([modelB, modelA], makeRequirement(), DEFAULT_BUDGET, adaptive);

      // Assert
      expect(r1.model.id).toBe(r2.model.id);
    });
  });
});

// ================================================================
// BT Dimensional Rating — selector functions
// ================================================================

/**
 * BT Rating tests for selector.
 * compositeScore formula: mu * (1 / (1 + sigma / SIGMA_BASE)) * weight, then × (1+boost).
 * SIGMA_BASE = 350.
 */

import { ALL_DIMENSIONS } from "../model/types";
import type { CapabilityDimension } from "../model/types";

/** DimensionRating-style capabilities helper. */
function makeBTCapabilities(
  overrides: Partial<
    Record<CapabilityDimension, { mu: number; sigma: number; comparisons: number }>
  > = {},
): Record<CapabilityDimension, { mu: number; sigma: number; comparisons: number }> {
  const caps: Record<string, { mu: number; sigma: number; comparisons: number }> = {};
  for (const dim of ALL_DIMENSIONS) {
    caps[dim] = overrides[dim as CapabilityDimension] ?? { mu: 500, sigma: 350, comparisons: 0 };
  }
  return caps as any;
}

/** Create ModelInfo with DimensionRating capabilities. */
function makeBTModel(overrides: Partial<ModelInfo> & {
  btCapabilities?: Partial<
    Record<CapabilityDimension, { mu: number; sigma: number; comparisons: number }>
  >;
} = {}): ModelInfo {
  const { btCapabilities, ...rest } = overrides;
  return {
    id: "test/bt-model",
    name: "BT Model",
    contextWindow: 100_000,
    capabilities: makeBTCapabilities(btCapabilities) as any,
    cost: { inputPer1M: 1.0, outputPer1M: 4.0 },
    supportsToolCalling: true,
    ...rest,
  };
}

// ================================================================
// compositeScore (BT)
// ================================================================

describe("selectModel (BT: compositeScore)", () => {
  it("should calculate score with single dimension mu/sigma/weight", () => {
    // Arrange — mu=800, sigma=350 → penalty=0.5, weight=1.0 → 800*0.5*1.0=400
    const model = makeBTModel({
      btCapabilities: {
        CODE_GENERATION: { mu: 800, sigma: 350, comparisons: 10 },
      },
    });
    const req = makeRequirement({
      requiredCapabilities: [{ dimension: "CODE_GENERATION", weight: 1.0 }],
    });

    // Act
    const result = selectModel([model], req, DEFAULT_BUDGET);

    // Assert
    expect(result.score).toBeCloseTo(400, 0);
  });

  it("should sum across multiple dimensions with varying mu/sigma", () => {
    // Arrange
    const model = makeBTModel({
      btCapabilities: {
        CODE_GENERATION: { mu: 800, sigma: 0, comparisons: 50 },    // penalty=1 → 800*1*0.6=480
        REASONING: { mu: 600, sigma: 350, comparisons: 5 },          // penalty=0.5 → 600*0.5*0.4=120
      },
    });
    const req = makeRequirement({
      requiredCapabilities: [
        { dimension: "CODE_GENERATION", weight: 0.6 },
        { dimension: "REASONING", weight: 0.4 },
      ],
    });

    // Act
    const result = selectModel([model], req, DEFAULT_BUDGET);

    // Assert — 480 + 120 = 600
    expect(result.score).toBeCloseTo(600, 0);
  });

  it("should apply boost correctly (positive and negative)", () => {
    // Arrange
    const model = makeBTModel({
      id: "boost-test",
      btCapabilities: {
        CODE_GENERATION: { mu: 1000, sigma: 0, comparisons: 100 },
      },
    });
    const req = makeRequirement({
      requiredCapabilities: [{ dimension: "CODE_GENERATION", weight: 1.0 }],
    });
    const posBoost: AdaptiveWeightProvider = { getBoost: () => 0.5 };
    const negBoost: AdaptiveWeightProvider = { getBoost: () => -0.5 };

    // Act
    const posResult = selectModel([model], req, DEFAULT_BUDGET, posBoost);
    const negResult = selectModel([model], req, DEFAULT_BUDGET, negBoost);

    // Assert — base=1000, pos: 1000*1.5=1500, neg: 1000*0.5=500
    expect(posResult.score).toBeCloseTo(1500, 0);
    expect(negResult.score).toBeCloseTo(500, 0);
  });

  it("should return 0 when all mu=0", () => {
    // Arrange — all required dimensions have mu=0
    const model = makeBTModel({
      btCapabilities: {
        CODE_GENERATION: { mu: 0, sigma: 350, comparisons: 0 },
        REASONING: { mu: 0, sigma: 350, comparisons: 0 },
        INSTRUCTION_FOLLOWING: { mu: 0, sigma: 350, comparisons: 0 },
      },
    });
    const req = makeRequirement();

    // Act
    const result = selectModel([model], req, DEFAULT_BUDGET);

    // Assert
    expect(result.score).toBe(0);
  });

  it("should return 0 when requiredCapabilities is empty", () => {
    // Arrange
    const model = makeBTModel();
    const req = makeRequirement({ requiredCapabilities: [] });

    // Act
    const result = selectModel([model], req, DEFAULT_BUDGET);

    // Assert
    expect(result.score).toBe(0);
  });

  it("should use penalty=1 when sigma=0 (full confidence)", () => {
    // Arrange — sigma=0 → penalty=1, mu=900 → score=900
    const model = makeBTModel({
      btCapabilities: {
        CODE_GENERATION: { mu: 900, sigma: 0, comparisons: 100 },
      },
    });
    const req = makeRequirement({
      requiredCapabilities: [{ dimension: "CODE_GENERATION", weight: 1.0 }],
    });

    // Act
    const result = selectModel([model], req, DEFAULT_BUDGET);

    // Assert
    expect(result.score).toBeCloseTo(900, 0);
  });

  it("should use penalty=0.5 when sigma=SIGMA_BASE", () => {
    // Arrange — sigma=350=SIGMA_BASE → penalty=0.5, mu=1000 → score=500
    const model = makeBTModel({
      btCapabilities: {
        CODE_GENERATION: { mu: 1000, sigma: SIGMA_BASE, comparisons: 0 },
      },
    });
    const req = makeRequirement({
      requiredCapabilities: [{ dimension: "CODE_GENERATION", weight: 1.0 }],
    });

    // Act
    const result = selectModel([model], req, DEFAULT_BUDGET);

    // Assert
    expect(result.score).toBeCloseTo(500, 0);
  });

  it("should clamp boost to [-1, 1]", () => {
    // Arrange
    const model = makeBTModel({
      btCapabilities: {
        CODE_GENERATION: { mu: 1000, sigma: 0, comparisons: 100 },
      },
    });
    const req = makeRequirement({
      requiredCapabilities: [{ dimension: "CODE_GENERATION", weight: 1.0 }],
    });
    const overBoost: AdaptiveWeightProvider = { getBoost: () => 5.0 };
    const exactBoost: AdaptiveWeightProvider = { getBoost: () => 1.0 };

    // Act
    const overResult = selectModel([model], req, DEFAULT_BUDGET, overBoost);
    const exactResult = selectModel([model], req, DEFAULT_BUDGET, exactBoost);

    // Assert — both should be clamped to boost=1 → score=2000
    expect(overResult.score).toBeCloseTo(exactResult.score, 1);
  });
});

// ================================================================
// hardFilter (BT)
// ================================================================

describe("selectModel (BT: hardFilter)", () => {
  it("should pass model meeting all conditions", () => {
    // Arrange — model with high mu, sufficient context, tool calling
    const model = makeBTModel({
      id: "pass-all",
      contextWindow: 100_000,
      btCapabilities: {
        CODE_GENERATION: { mu: 800, sigma: 100, comparisons: 20 },
        REASONING: { mu: 700, sigma: 150, comparisons: 15 },
        INSTRUCTION_FOLLOWING: { mu: 900, sigma: 50, comparisons: 30 },
        MULTILINGUAL: { mu: 800, sigma: 100, comparisons: 10 },
      },
      supportsToolCalling: true,
    });
    const req = makeRequirement({
      requiredCapabilities: [
        { dimension: "CODE_GENERATION", weight: 1.0, minimum: 500 },
      ],
      requiresToolCalling: true,
      requiresKorean: true,
    });

    // Act
    const result = selectModel([model], req, DEFAULT_BUDGET);

    // Assert — should not be fallback
    expect((result as FallbackSelectResult).warning).toBeUndefined();
    expect(result.model.id).toBe("pass-all");
  });

  it("should reject model with insufficient contextWindow", () => {
    // Arrange
    const tinyContext = makeBTModel({ id: "tiny", contextWindow: 100 });
    const bigContext = makeBTModel({ id: "big", contextWindow: 100_000 });

    // Act
    const result = selectModel([tinyContext, bigContext], makeRequirement(), DEFAULT_BUDGET);

    // Assert
    expect(result.model.id).toBe("big");
  });

  it("should reject model without required toolCalling", () => {
    // Arrange
    const noTools = makeBTModel({ id: "no-tools", supportsToolCalling: false });
    const withTools = makeBTModel({ id: "with-tools", supportsToolCalling: true });

    // Act
    const result = selectModel(
      [noTools, withTools],
      makeRequirement({ requiresToolCalling: true }),
      DEFAULT_BUDGET,
    );

    // Assert
    expect(result.model.id).toBe("with-tools");
  });

  it("should reject model with low MULTILINGUAL.mu for Korean", () => {
    // Arrange — MULTILINGUAL mu < 500 (equivalent to old < 5)
    const lowMulti = makeBTModel({
      id: "low-multi",
      btCapabilities: { MULTILINGUAL: { mu: 300, sigma: 350, comparisons: 0 } },
    });
    const highMulti = makeBTModel({
      id: "high-multi",
      btCapabilities: { MULTILINGUAL: { mu: 800, sigma: 100, comparisons: 10 } },
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

  it("should reject model with capability mu below minimum", () => {
    // Arrange — minimum=600, model has mu=400
    const low = makeBTModel({
      id: "low-cap",
      btCapabilities: { CODE_GENERATION: { mu: 400, sigma: 100, comparisons: 10 } },
    });
    const high = makeBTModel({
      id: "high-cap",
      btCapabilities: { CODE_GENERATION: { mu: 800, sigma: 100, comparisons: 10 } },
    });
    const req = makeRequirement({
      requiredCapabilities: [{ dimension: "CODE_GENERATION", weight: 1.0, minimum: 600 }],
    });

    // Act
    const result = selectModel([low, high], req, DEFAULT_BUDGET);

    // Assert
    expect(result.model.id).toBe("high-cap");
  });

  it("should reject model exceeding cost budget", () => {
    // Arrange
    const expensive = makeBTModel({
      id: "expensive",
      cost: { inputPer1M: 100.0, outputPer1M: 400.0 },
    });
    const cheap = makeBTModel({
      id: "cheap",
      cost: { inputPer1M: 0.1, outputPer1M: 0.4 },
    });

    // Act
    const result = selectModel([expensive, cheap], makeRequirement(), { perRequest: 0.01 });

    // Assert
    expect(result.model.id).toBe("cheap");
  });

  it("should skip minimum check when undefined", () => {
    // Arrange — no minimum set, any mu should pass
    const model = makeBTModel({
      id: "any-cap",
      btCapabilities: { CODE_GENERATION: { mu: 100, sigma: 350, comparisons: 0 } },
    });
    const req = makeRequirement({
      requiredCapabilities: [{ dimension: "CODE_GENERATION", weight: 1.0 }], // no minimum
    });

    // Act
    const result = selectModel([model], req, DEFAULT_BUDGET);

    // Assert — should not be fallback
    expect((result as FallbackSelectResult).warning).toBeUndefined();
  });

  it("should pass when contextWindow equals totalTokens exactly", () => {
    // Arrange — estimatedInput=2000 + estimatedOutput=1000 → totalTokens=3000
    const exact = makeBTModel({ id: "exact-ctx", contextWindow: 3000 });
    const req = makeRequirement({
      estimatedInputTokens: 2000,
      estimatedOutputTokens: 1000,
    });

    // Act
    const result = selectModel([exact], req, DEFAULT_BUDGET);

    // Assert — contextWindow >= totalTokens → passes
    expect(result.model.id).toBe("exact-ctx");
    expect((result as FallbackSelectResult).warning).toBeUndefined();
  });
});

// ================================================================
// scoredAndRanked (BT)
// ================================================================

describe("selectModel (BT: scoredAndRanked)", () => {
  it("should calculate CE as score/cost", () => {
    // Arrange — single model, cost = (2000*1+1000*4)/1e6 = 0.006
    const model = makeBTModel({
      btCapabilities: {
        CODE_GENERATION: { mu: 1000, sigma: 0, comparisons: 100 },
      },
    });
    const req = makeRequirement({
      requiredCapabilities: [{ dimension: "CODE_GENERATION", weight: 1.0 }],
    });

    // Act
    const result = selectModel([model], req, DEFAULT_BUDGET);

    // Assert — score=1000, cost=0.006, CE=1000/0.006≈166666.7
    expect(result.score).toBeCloseTo(1000, 0);
    expect(result.costEfficiency).toBeGreaterThan(0);
    expect(result.costEfficiency).toBeCloseTo(result.score / result.expectedCost, 0);
  });

  it("should sort by CE descending then score descending", () => {
    // Arrange — same capabilities, different costs → CE decides
    const expensive = makeBTModel({
      id: "expensive",
      cost: { inputPer1M: 10.0, outputPer1M: 40.0 },
      btCapabilities: {
        CODE_GENERATION: { mu: 1000, sigma: 0, comparisons: 100 },
      },
    });
    const cheap = makeBTModel({
      id: "cheap",
      cost: { inputPer1M: 0.5, outputPer1M: 2.0 },
      btCapabilities: {
        CODE_GENERATION: { mu: 1000, sigma: 0, comparisons: 100 },
      },
    });
    const req = makeRequirement({
      requiredCapabilities: [{ dimension: "CODE_GENERATION", weight: 1.0 }],
    });

    // Act
    const result = selectModel([expensive, cheap], req, { perRequest: 10.0 });

    // Assert — cheap has higher CE → wins
    expect(result.model.id).toBe("cheap");
  });

  it("should handle cost=0 as CE=Infinity", () => {
    // Arrange — free model
    const freeModel = makeBTModel({
      id: "free",
      cost: { inputPer1M: 0, outputPer1M: 0 },
      btCapabilities: {
        CODE_GENERATION: { mu: 500, sigma: 0, comparisons: 10 },
      },
    });
    const req = makeRequirement({
      requiredCapabilities: [{ dimension: "CODE_GENERATION", weight: 1.0 }],
    });

    // Act
    const result = selectModel([freeModel], req, DEFAULT_BUDGET);

    // Assert
    expect(result.costEfficiency).toBe(Infinity);
  });
});

// ================================================================
// selectModel end-to-end (BT)
// ================================================================

describe("selectModel (BT: end-to-end)", () => {
  it("should return highest CE model", () => {
    // Arrange
    const modelA = makeBTModel({
      id: "a",
      cost: { inputPer1M: 0.5, outputPer1M: 2.0 },
      btCapabilities: {
        CODE_GENERATION: { mu: 900, sigma: 0, comparisons: 50 },
      },
    });
    const modelB = makeBTModel({
      id: "b",
      cost: { inputPer1M: 5.0, outputPer1M: 20.0 },
      btCapabilities: {
        CODE_GENERATION: { mu: 900, sigma: 0, comparisons: 50 },
      },
    });
    const req = makeRequirement({
      requiredCapabilities: [{ dimension: "CODE_GENERATION", weight: 1.0 }],
    });

    // Act
    const result = selectModel([modelA, modelB], req, { perRequest: 10.0 });

    // Assert
    expect(result.model.id).toBe("a");
  });

  it("should use nullAdaptiveWeight when provider not given", () => {
    // Arrange
    const model = makeBTModel({
      btCapabilities: {
        CODE_GENERATION: { mu: 800, sigma: 0, comparisons: 100 },
      },
    });
    const req = makeRequirement({
      requiredCapabilities: [{ dimension: "CODE_GENERATION", weight: 1.0 }],
    });

    // Act
    const withUndef = selectModel([model], req, DEFAULT_BUDGET, undefined);
    const withoutArg = selectModel([model], req, DEFAULT_BUDGET);

    // Assert
    expect(withUndef.score).toBe(withoutArg.score);
  });

  it("should fallback when all models filtered out", () => {
    // Arrange — budget=0 forces fallback
    const model = makeBTModel({ id: "any" });

    // Act
    const result = selectModel([model], makeRequirement(), { perRequest: 0 });

    // Assert
    expect((result as FallbackSelectResult).warning).toBeDefined();
    expect((result as FallbackSelectResult).relaxedConstraints).toBeDefined();
  });

  it("should return the only model when single candidate", () => {
    // Arrange
    const only = makeBTModel({ id: "single" });
    const req = makeRequirement({
      requiredCapabilities: [{ dimension: "CODE_GENERATION", weight: 1.0 }],
    });

    // Act
    const result = selectModel([only], req, DEFAULT_BUDGET);

    // Assert
    expect(result.model.id).toBe("single");
  });

  it("should return identical result on repeated calls", () => {
    // Arrange
    const model = makeBTModel({ id: "idem" });
    const req = makeRequirement();

    // Act
    const r1 = selectModel([model], req, DEFAULT_BUDGET);
    const r2 = selectModel([model], req, DEFAULT_BUDGET);

    // Assert
    expect(r1.model.id).toBe(r2.model.id);
    expect(r1.score).toBe(r2.score);
  });
});

// ================================================================
// fallbackResult (BT)
// ================================================================

describe("selectModel (BT: fallback)", () => {
  it("should select cheapest model as fallback", () => {
    // Arrange — all models fail budget → fallback picks cheapest
    const expensive = makeBTModel({
      id: "exp",
      cost: { inputPer1M: 100.0, outputPer1M: 400.0 },
    });
    const cheap = makeBTModel({
      id: "chp",
      cost: { inputPer1M: 0.1, outputPer1M: 0.4 },
    });

    // Act
    const result = selectModel([expensive, cheap], makeRequirement(), { perRequest: 0 });

    // Assert
    expect(result.model.id).toBe("chp");
    expect((result as FallbackSelectResult).warning).toBeDefined();
  });

  it("should return No Model Available when models is empty", () => {
    // Act
    const result = selectModel([], makeRequirement(), DEFAULT_BUDGET);

    // Assert
    expect(result.model.name).toBe("No Model Available");
    expect((result as FallbackSelectResult).warning).toBeDefined();
  });

  it("should pick first when multiple models have same cost", () => {
    // Arrange — same cost, budget=0 → all fail → fallback reduce picks first
    const a = makeBTModel({ id: "a", cost: { inputPer1M: 1, outputPer1M: 4 } });
    const b = makeBTModel({ id: "b", cost: { inputPer1M: 1, outputPer1M: 4 } });

    // Act
    const result = selectModel([a, b], makeRequirement(), { perRequest: 0 });

    // Assert — reduce starts from first, same cost → keeps first
    expect(result.model.id).toBe("a");
  });
});
