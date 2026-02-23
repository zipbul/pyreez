/**
 * Unit tests for benchmark anchoring module.
 * 36 tests: normalizeScore(8), anchorDimension(10), anchorModel(8), migrateToV2(10).
 */

import { describe, it, expect } from "bun:test";
import {
  normalizeScore,
  anchorDimension,
  anchorModel,
  migrateToV2,
  BENCHMARK_DIMENSION_MAP,
  SIGMA_ANCHORED,
} from "./anchoring";
import { SIGMA_BASE, ALL_DIMENSIONS } from "./types";
import type { CapabilityDimension, DimensionRating } from "./types";

// -- Helpers --

function makeV1Scores(
  overrides: Partial<Record<CapabilityDimension, number>> = {},
): Record<string, { score: number; confidence: number; dataPoints: number }> {
  const scores: Record<string, { score: number; confidence: number; dataPoints: number }> = {};
  for (const dim of ALL_DIMENSIONS) {
    scores[dim] = { score: overrides[dim] ?? 5, confidence: 0.3, dataPoints: 0 };
  }
  return scores;
}

function makeV1Data(
  models: Record<string, { name: string; scores?: Record<string, any> }> = {},
) {
  const result: Record<string, any> = {};
  for (const [id, entry] of Object.entries(models)) {
    result[id] = {
      name: entry.name,
      contextWindow: 128000,
      supportsToolCalling: true,
      cost: { inputPer1M: 1.0, outputPer1M: 4.0 },
      scores: entry.scores ?? makeV1Scores(),
    };
  }
  return { version: 1 as number, models: result };
}

// -- normalizeScore --

describe("normalizeScore", () => {
  it("should convert 50% to mu 500", () => {
    expect(normalizeScore(50, "ifeval")).toBe(500);
  });

  it("should handle decimal 33.5% to mu 335", () => {
    expect(normalizeScore(33.5, "bbh")).toBe(335);
  });

  it("should convert 100% to mu 1000", () => {
    expect(normalizeScore(100, "math")).toBe(1000);
  });

  it("should clamp negative input to 0", () => {
    expect(normalizeScore(-5, "ifeval")).toBe(0);
  });

  it("should clamp input over 100 to 1000", () => {
    expect(normalizeScore(105, "bbh")).toBe(1000);
  });

  it("should handle NaN as 0", () => {
    expect(normalizeScore(NaN, "math")).toBe(0);
  });

  it("should return 0 for 0% input", () => {
    expect(normalizeScore(0, "gpqa")).toBe(0);
  });

  it("should return same result for same input", () => {
    const a = normalizeScore(85, "ifeval");
    const b = normalizeScore(85, "ifeval");
    expect(a).toBe(b);
  });
});

// -- anchorDimension --

describe("anchorDimension", () => {
  it("should anchor from single benchmark score", () => {
    const scores = [{ benchmark: "ifeval", score: 85 }];
    const result = anchorDimension(scores, "INSTRUCTION_FOLLOWING");
    expect(result.mu).toBe(850);
    expect(result.sigma).toBe(SIGMA_ANCHORED);
    expect(result.comparisons).toBe(1);
  });

  it("should compute weighted average from multiple benchmarks", () => {
    // BBH maps to REASONING with weight 0.5, GPQA maps to REASONING with weight 0.4
    const scores = [
      { benchmark: "bbh", score: 80 },
      { benchmark: "gpqa", score: 60 },
    ];
    const result = anchorDimension(scores, "REASONING");
    // Weighted avg: (800*0.5 + 600*0.4) / (0.5+0.4) = (400+240)/0.9 = 711.11
    expect(result.mu).toBeGreaterThan(600);
    expect(result.mu).toBeLessThan(850);
    expect(result.sigma).toBeLessThan(SIGMA_ANCHORED); // multiple sources → lower sigma
    expect(result.comparisons).toBe(2);
  });

  it("should handle 4+ benchmark sources", () => {
    const scores = [
      { benchmark: "bbh", score: 80 },
      { benchmark: "gpqa", score: 70 },
      { benchmark: "musr", score: 60 },
      { benchmark: "mmlu_pro", score: 75 },
    ];
    const result = anchorDimension(scores, "REASONING");
    expect(result.mu).toBeGreaterThan(0);
    expect(result.comparisons).toBeGreaterThanOrEqual(4);
  });

  it("should return fallback rating when no scores provided", () => {
    const result = anchorDimension([], "REASONING");
    expect(result.mu).toBe(0);
    expect(result.sigma).toBe(SIGMA_BASE);
    expect(result.comparisons).toBe(0);
  });

  it("should return fallback when no benchmarks map to dimension", () => {
    // TOOL_USE has no benchmark mapping
    const scores = [{ benchmark: "ifeval", score: 90 }];
    const result = anchorDimension(scores, "TOOL_USE");
    expect(result.mu).toBe(0);
    expect(result.sigma).toBe(SIGMA_BASE);
    expect(result.comparisons).toBe(0);
  });

  it("should return mu=0 for 0% score", () => {
    const scores = [{ benchmark: "ifeval", score: 0 }];
    const result = anchorDimension(scores, "INSTRUCTION_FOLLOWING");
    expect(result.mu).toBe(0);
  });

  it("should return mu=1000 for 100% score", () => {
    const scores = [{ benchmark: "humaneval", score: 100 }];
    const result = anchorDimension(scores, "CODE_GENERATION");
    expect(result.mu).toBe(1000);
  });

  it("should set lower sigma for anchored vs fallback", () => {
    const anchored = anchorDimension(
      [{ benchmark: "ifeval", score: 80 }],
      "INSTRUCTION_FOLLOWING",
    );
    const fallback = anchorDimension([], "INSTRUCTION_FOLLOWING");
    expect(anchored.sigma).toBeLessThan(fallback.sigma);
  });

  it("should return same rating for same input", () => {
    const scores = [{ benchmark: "bbh", score: 72 }];
    const a = anchorDimension(scores, "REASONING");
    const b = anchorDimension(scores, "REASONING");
    expect(a).toEqual(b);
  });

  it("should return same result regardless of score order", () => {
    const a = anchorDimension(
      [{ benchmark: "bbh", score: 80 }, { benchmark: "gpqa", score: 60 }],
      "REASONING",
    );
    const b = anchorDimension(
      [{ benchmark: "gpqa", score: 60 }, { benchmark: "bbh", score: 80 }],
      "REASONING",
    );
    expect(a).toEqual(b);
  });
});

// -- anchorModel --

describe("anchorModel", () => {
  it("should anchor all dimensions when full benchmarks available", () => {
    const benchmarks = [
      { benchmark: "ifeval", score: 85 },
      { benchmark: "bbh", score: 80 },
      { benchmark: "math", score: 90 },
      { benchmark: "gpqa", score: 70 },
      { benchmark: "musr", score: 65 },
      { benchmark: "mmlu_pro", score: 75 },
      { benchmark: "humaneval", score: 95 },
      { benchmark: "swe_bench", score: 50 },
    ];
    const result = anchorModel(benchmarks);

    // Cognitive dims should be anchored (BBH, GPQA, MATH, etc. map to them)
    expect(result.REASONING.sigma).toBeLessThan(SIGMA_BASE);
    expect(result.MATH_REASONING.sigma).toBeLessThan(SIGMA_BASE);
    expect(result.CODE_GENERATION.sigma).toBeLessThan(SIGMA_BASE);
    expect(result.INSTRUCTION_FOLLOWING.sigma).toBeLessThan(SIGMA_BASE);
  });

  it("should anchor partial dimensions with partial benchmarks", () => {
    const benchmarks = [
      { benchmark: "ifeval", score: 85 },
      { benchmark: "humaneval", score: 90 },
    ];
    const result = anchorModel(benchmarks);

    // INSTRUCTION_FOLLOWING anchored (ifeval)
    expect(result.INSTRUCTION_FOLLOWING.sigma).toBeLessThan(SIGMA_BASE);
    // CODE_GENERATION anchored (humaneval)
    expect(result.CODE_GENERATION.sigma).toBeLessThan(SIGMA_BASE);
    // TOOL_USE not anchored
    expect(result.TOOL_USE.sigma).toBe(SIGMA_BASE);
  });

  it("should anchor single benchmark to mapped dimensions only", () => {
    const benchmarks = [{ benchmark: "math", score: 90 }];
    const result = anchorModel(benchmarks);

    // MATH_REASONING should be anchored
    expect(result.MATH_REASONING.mu).toBe(900);
    expect(result.MATH_REASONING.sigma).toBeLessThan(SIGMA_BASE);
    // Unrelated dimensions should be fallback
    expect(result.TOOL_USE.mu).toBe(0);
    expect(result.TOOL_USE.sigma).toBe(SIGMA_BASE);
  });

  it("should return all fallback ratings when no benchmarks", () => {
    const result = anchorModel([]);
    for (const dim of ALL_DIMENSIONS) {
      expect(result[dim].mu).toBe(0);
      expect(result[dim].sigma).toBe(SIGMA_BASE);
      expect(result[dim].comparisons).toBe(0);
    }
  });

  it("should treat unknown benchmark names as no data", () => {
    const benchmarks = [{ benchmark: "unknown_bench", score: 90 }];
    const result = anchorModel(benchmarks);
    // All dimensions should be fallback since "unknown_bench" maps to nothing
    for (const dim of ALL_DIMENSIONS) {
      expect(result[dim].sigma).toBe(SIGMA_BASE);
    }
  });

  it("should use lower sigma for anchored dims and higher for unanchored", () => {
    const benchmarks = [{ benchmark: "ifeval", score: 80 }];
    const result = anchorModel(benchmarks);

    // INSTRUCTION_FOLLOWING anchored → low sigma
    expect(result.INSTRUCTION_FOLLOWING.sigma).toBeLessThan(SIGMA_BASE);
    // TOOL_USE unanchored → SIGMA_BASE
    expect(result.TOOL_USE.sigma).toBe(SIGMA_BASE);
  });

  it("should handle model with zero benchmark scores", () => {
    const benchmarks = [
      { benchmark: "ifeval", score: 0 },
      { benchmark: "bbh", score: 0 },
    ];
    const result = anchorModel(benchmarks);
    expect(result.INSTRUCTION_FOLLOWING.mu).toBe(0);
    expect(result.REASONING.mu).toBe(0);
    // Still anchored (sigma < SIGMA_BASE) — zero is valid data
    expect(result.INSTRUCTION_FOLLOWING.sigma).toBeLessThan(SIGMA_BASE);
  });

  it("should return same result for same input", () => {
    const benchmarks = [{ benchmark: "ifeval", score: 80 }];
    const a = anchorModel(benchmarks);
    const b = anchorModel(benchmarks);
    expect(a).toEqual(b);
  });
});

// -- migrateToV2 --

describe("migrateToV2", () => {
  it("should migrate v1 data with benchmark anchoring", () => {
    const v1 = makeV1Data({ "test/model": { name: "Test" } });
    const benchmarks = {
      "test/model": [{ benchmark: "ifeval", score: 85 }],
    };
    const result = migrateToV2(v1, benchmarks);
    expect(result.version).toBe(2);
    // INSTRUCTION_FOLLOWING should be anchored from ifeval
    expect(result.models["test/model"]!.scores.INSTRUCTION_FOLLOWING!.mu).toBe(850);
    expect(result.models["test/model"]!.scores.INSTRUCTION_FOLLOWING!.sigma).toBe(SIGMA_ANCHORED);
  });

  it("should migrate v1 data without benchmarks using score*100", () => {
    const v1 = makeV1Data({
      "test/model": { name: "Test", scores: makeV1Scores({ REASONING: 8 }) },
    });
    const result = migrateToV2(v1);
    expect(result.version).toBe(2);
    expect(result.models["test/model"]!.scores.REASONING!.mu).toBe(800);
    expect(result.models["test/model"]!.scores.REASONING!.sigma).toBe(SIGMA_BASE);
  });

  it("should update version field from 1 to 2", () => {
    const v1 = makeV1Data({ "m/a": { name: "A" } });
    const result = migrateToV2(v1);
    expect(result.version).toBe(2);
  });

  it("should handle empty models object", () => {
    const v1 = { version: 1, models: {} };
    const result = migrateToV2(v1);
    expect(result.version).toBe(2);
    expect(Object.keys(result.models)).toHaveLength(0);
  });

  it("should handle model with missing dimension scores", () => {
    const v1 = {
      version: 1,
      models: {
        "test/m": {
          name: "T",
          contextWindow: 128000,
          supportsToolCalling: true,
          cost: { inputPer1M: 1.0, outputPer1M: 4.0 },
          scores: {
            REASONING: { score: 7, confidence: 0.3, dataPoints: 0 },
            // Only 1 of 21 dimensions present
          },
        },
      },
    };
    const result = migrateToV2(v1 as any);
    expect(result.models["test/m"]!.scores.REASONING!.mu).toBe(700);
    // Missing dimensions should get defaults
    expect(result.models["test/m"]!.scores.TOOL_USE!.mu).toBe(0);
    expect(result.models["test/m"]!.scores.TOOL_USE!.sigma).toBe(SIGMA_BASE);
  });

  it("should pass through already-v2 data unchanged", () => {
    const v2 = {
      version: 2,
      models: {
        "test/m": {
          name: "T",
          contextWindow: 128000,
          supportsToolCalling: true,
          cost: { inputPer1M: 1.0, outputPer1M: 4.0 },
          scores: {
            REASONING: { mu: 800, sigma: 150, comparisons: 3 },
          },
        },
      },
    };
    const result = migrateToV2(v2 as any);
    expect(result).toEqual(v2);
  });

  it("should migrate exact version=1", () => {
    const v1 = makeV1Data({ "m/a": { name: "A" } });
    expect(v1.version).toBe(1);
    const result = migrateToV2(v1);
    expect(result.version).toBe(2);
  });

  it("should handle v1 with empty benchmark data", () => {
    const v1 = makeV1Data({ "m/a": { name: "A" } });
    const result = migrateToV2(v1, {});
    expect(result.version).toBe(2);
    // All dimensions should fall back to score*100
    expect(result.models["m/a"]!.scores.REASONING!.mu).toBe(500); // default score=5 → 500
    expect(result.models["m/a"]!.scores.REASONING!.sigma).toBe(SIGMA_BASE);
  });

  it("should produce same result when called twice", () => {
    const v1 = makeV1Data({ "m/a": { name: "A" } });
    const a = migrateToV2(v1);
    const b = migrateToV2(v1);
    expect(a).toEqual(b);
  });

  it("should produce same result regardless of model order", () => {
    const v1a = makeV1Data({
      "m/a": { name: "A", scores: makeV1Scores({ REASONING: 9 }) },
      "m/b": { name: "B", scores: makeV1Scores({ REASONING: 7 }) },
    });
    const v1b = makeV1Data({
      "m/b": { name: "B", scores: makeV1Scores({ REASONING: 7 }) },
      "m/a": { name: "A", scores: makeV1Scores({ REASONING: 9 }) },
    });
    const a = migrateToV2(v1a);
    const b = migrateToV2(v1b);
    // Both should have same model data
    expect(a.models["m/a"]).toEqual(b.models["m/a"]);
    expect(a.models["m/b"]).toEqual(b.models["m/b"]);
  });
});
