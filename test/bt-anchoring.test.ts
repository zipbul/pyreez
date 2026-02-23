/**
 * Integration tests for benchmark anchoring — end-to-end.
 */

import { describe, it, expect } from "bun:test";
import { anchorModel, migrateToV2, BENCHMARK_DIMENSION_MAP } from "../src/model/anchoring";
import { ALL_DIMENSIONS, SIGMA_BASE } from "../src/model/types";

describe("BT Anchoring E2E", () => {
  it("should anchor full model from benchmarks end-to-end", () => {
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

    const caps = anchorModel(benchmarks);

    // All 21 dimensions should be present
    for (const dim of ALL_DIMENSIONS) {
      expect(caps[dim]).toBeDefined();
      expect(caps[dim].mu).toBeGreaterThanOrEqual(0);
      expect(caps[dim].mu).toBeLessThanOrEqual(1000);
      expect(caps[dim].sigma).toBeGreaterThan(0);
      expect(caps[dim].comparisons).toBeGreaterThanOrEqual(0);
    }

    // Anchored dimensions should have lower sigma
    const anchoredDims = new Set<string>();
    for (const [, mappings] of Object.entries(BENCHMARK_DIMENSION_MAP)) {
      for (const m of mappings) {
        anchoredDims.add(m.dimension);
      }
    }

    for (const dim of ALL_DIMENSIONS) {
      if (anchoredDims.has(dim)) {
        expect(caps[dim].sigma).toBeLessThan(SIGMA_BASE);
      }
    }
  });

  it("should produce valid v2 JSON with correct mu ranges", () => {
    const v1 = {
      version: 1,
      models: {
        "test/alpha": {
          name: "Alpha",
          contextWindow: 200000,
          supportsToolCalling: true,
          cost: { inputPer1M: 2.0, outputPer1M: 8.0 },
          scores: Object.fromEntries(
            ALL_DIMENSIONS.map((dim) => [
              dim,
              { score: 8, confidence: 0.3, dataPoints: 0 },
            ]),
          ),
        },
      },
    };

    const benchmarks = {
      "test/alpha": [
        { benchmark: "ifeval", score: 88 },
        { benchmark: "humaneval", score: 92 },
      ],
    };

    const v2 = migrateToV2(v1, benchmarks);
    expect(v2.version).toBe(2);

    const model = v2.models["test/alpha"];
    for (const dim of ALL_DIMENSIONS) {
      const rating = model.scores[dim];
      expect(rating.mu).toBeGreaterThanOrEqual(0);
      expect(rating.mu).toBeLessThanOrEqual(1000);
      expect(rating.sigma).toBeGreaterThan(0);
      expect(rating.sigma).toBeLessThanOrEqual(SIGMA_BASE);
    }
  });

  it("should preserve non-score model metadata through migration", () => {
    const v1 = {
      version: 1,
      models: {
        "test/meta": {
          name: "MetaModel",
          contextWindow: 500000,
          supportsToolCalling: false,
          cost: { inputPer1M: 0.5, outputPer1M: 2.0 },
          scores: Object.fromEntries(
            ALL_DIMENSIONS.map((dim) => [
              dim,
              { score: 6, confidence: 0.3, dataPoints: 0 },
            ]),
          ),
        },
      },
    };

    const v2 = migrateToV2(v1);
    const model = v2.models["test/meta"];
    expect(model.name).toBe("MetaModel");
    expect(model.contextWindow).toBe(500000);
    expect(model.supportsToolCalling).toBe(false);
    expect(model.cost).toEqual({ inputPer1M: 0.5, outputPer1M: 2.0 });
  });
});
