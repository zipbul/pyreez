/**
 * Calibration Loop tests.
 */
import { describe, it, expect } from "bun:test";
import {
  taskToDimensions,
  extractPairwise,
  calibrate,
  STRONG_QUALITY_DIFF,
  MIN_QUALITY_DIFF,
  SIGMA_CONVERGED,
  SIGMA_STALE,
} from "./calibration";
import { getRating, setRating, type RatingsMap } from "../evaluation/bt-updater";
import { SIGMA_BASE } from "./types";
import type { CallRecord } from "../report/types";

// -- Helpers --

function makeRecord(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    model: "openai/gpt-4.1",
    taskType: "CODE_WRITE",
    quality: 7,
    latencyMs: 500,
    tokens: { input: 100, output: 200 },
    ...overrides,
  };
}

// ================================================================
// taskToDimensions
// ================================================================

describe("taskToDimensions", () => {
  it("should map CODE_WRITE to CODE_GENERATION + REASONING", () => {
    const dims = taskToDimensions("CODE_WRITE");
    expect(dims).toContain("CODE_GENERATION");
    expect(dims).toContain("REASONING");
  });

  it("should map CODE_DEBUG to DEBUGGING + CODE_UNDERSTANDING", () => {
    const dims = taskToDimensions("CODE_DEBUG");
    expect(dims).toContain("DEBUGGING");
    expect(dims).toContain("CODE_UNDERSTANDING");
  });

  it("should default to REASONING for unknown taskType", () => {
    expect(taskToDimensions("UNKNOWN_TASK")).toEqual(["REASONING"]);
  });

  it("should map TRANSLATE to MULTILINGUAL + INSTRUCTION_FOLLOWING", () => {
    const dims = taskToDimensions("TRANSLATE");
    expect(dims).toContain("MULTILINGUAL");
    expect(dims).toContain("INSTRUCTION_FOLLOWING");
  });
});

// ================================================================
// extractPairwise
// ================================================================

describe("extractPairwise", () => {
  it("should extract pairwise when quality diff >= MIN_QUALITY_DIFF", () => {
    const records = [
      makeRecord({ model: "m1", quality: 8, taskType: "CODE_WRITE" }),
      makeRecord({ model: "m2", quality: 5, taskType: "CODE_WRITE" }),
    ];
    const results = extractPairwise(records);
    expect(results).toHaveLength(1);
    expect(results[0].modelA).toBe("m1");
    expect(results[0].modelB).toBe("m2");
  });

  it("should produce A>>B for strong quality difference", () => {
    const records = [
      makeRecord({ model: "m1", quality: 9, taskType: "CODE_WRITE" }),
      makeRecord({ model: "m2", quality: 3, taskType: "CODE_WRITE" }),
    ];
    const results = extractPairwise(records);
    expect(results[0].outcome).toBe("A>>B");
  });

  it("should produce A>B for weak quality difference", () => {
    const records = [
      makeRecord({ model: "m1", quality: 7, taskType: "CODE_WRITE" }),
      makeRecord({ model: "m2", quality: 5, taskType: "CODE_WRITE" }),
    ];
    const results = extractPairwise(records);
    expect(results[0].outcome).toBe("A>B");
  });

  it("should skip when same model", () => {
    const records = [
      makeRecord({ model: "m1", quality: 8, taskType: "CODE_WRITE" }),
      makeRecord({ model: "m1", quality: 5, taskType: "CODE_WRITE" }),
    ];
    expect(extractPairwise(records)).toHaveLength(0);
  });

  it("should skip when quality diff below threshold", () => {
    const records = [
      makeRecord({ model: "m1", quality: 7.0, taskType: "CODE_WRITE" }),
      makeRecord({ model: "m2", quality: 7.4, taskType: "CODE_WRITE" }),
    ];
    expect(extractPairwise(records)).toHaveLength(0);
  });

  it("should not compare across different task types", () => {
    const records = [
      makeRecord({ model: "m1", quality: 9, taskType: "CODE_WRITE" }),
      makeRecord({ model: "m2", quality: 3, taskType: "TRANSLATE" }),
    ];
    expect(extractPairwise(records)).toHaveLength(0);
  });

  it("should produce B>>A when B is much better", () => {
    const records = [
      makeRecord({ model: "m1", quality: 2, taskType: "CODE_WRITE" }),
      makeRecord({ model: "m2", quality: 9, taskType: "CODE_WRITE" }),
    ];
    const results = extractPairwise(records);
    expect(results[0].outcome).toBe("B>>A");
  });

  it("should produce B>A for weak reverse quality diff", () => {
    // Arrange — m1.quality < m2.quality, |diff| >= MIN_QUALITY_DIFF but < STRONG_QUALITY_DIFF
    const records = [
      makeRecord({ model: "m1", quality: 5, taskType: "CODE_WRITE" }),
      makeRecord({ model: "m2", quality: 7, taskType: "CODE_WRITE" }),
    ];

    // Act
    const results = extractPairwise(records);

    // Assert — diff = 5-7 = -2, |diff|=2 >= MIN_QUALITY_DIFF(0.5) but < STRONG_QUALITY_DIFF(3)
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe("B>A");
  });
});

// ================================================================
// calibrate
// ================================================================

describe("calibrate", () => {
  it("should update ratings from call records", () => {
    const ratings: RatingsMap = new Map();
    setRating(ratings, "m1", "CODE_GENERATION", { mu: 500, sigma: SIGMA_BASE, comparisons: 0 });
    setRating(ratings, "m2", "CODE_GENERATION", { mu: 500, sigma: SIGMA_BASE, comparisons: 0 });

    const records = [
      makeRecord({ model: "m1", quality: 9, taskType: "CODE_WRITE" }),
      makeRecord({ model: "m2", quality: 3, taskType: "CODE_WRITE" }),
    ];

    const result = calibrate(ratings, records);
    expect(result.comparisonsProcessed).toBe(1);

    const m1 = getRating(ratings, "m1", "CODE_GENERATION");
    expect(m1.mu).toBeGreaterThan(500);
    expect(m1.comparisons).toBeGreaterThan(0);
  });

  it("should return empty result for no records", () => {
    const ratings: RatingsMap = new Map();
    const result = calibrate(ratings, []);
    expect(result.comparisonsProcessed).toBe(0);
    expect(result.anomalies).toHaveLength(0);
  });

  it("should detect converged models", () => {
    const ratings: RatingsMap = new Map();
    setRating(ratings, "m1", "CODE_GENERATION", { mu: 700, sigma: 80, comparisons: 50 });
    setRating(ratings, "m2", "CODE_GENERATION", { mu: 500, sigma: SIGMA_BASE, comparisons: 0 });

    const result = calibrate(ratings, []);
    expect(result.converged.some((c) => c.modelId === "m1")).toBe(true);
  });

  it("should detect stale models", () => {
    const ratings: RatingsMap = new Map();
    setRating(ratings, "m1", "CODE_GENERATION", { mu: 500, sigma: SIGMA_STALE, comparisons: 0 });

    const result = calibrate(ratings, []);
    expect(result.stale.some((s) => s.modelId === "m1")).toBe(true);
  });

  it("should converge sigma over multiple calibration cycles", () => {
    const ratings: RatingsMap = new Map();
    setRating(ratings, "m1", "CODE_GENERATION", { mu: 600, sigma: SIGMA_BASE, comparisons: 0 });
    setRating(ratings, "m2", "CODE_GENERATION", { mu: 400, sigma: SIGMA_BASE, comparisons: 0 });

    // Run multiple calibration cycles
    for (let i = 0; i < 20; i++) {
      const records = [
        makeRecord({ model: "m1", quality: 8, taskType: "CODE_WRITE" }),
        makeRecord({ model: "m2", quality: 5, taskType: "CODE_WRITE" }),
      ];
      calibrate(ratings, records);
    }

    const m1Sigma = getRating(ratings, "m1", "CODE_GENERATION").sigma;
    expect(m1Sigma).toBeLessThan(SIGMA_BASE);
  });

  it("should collect anomalies when updateRating detects anomaly", () => {
    // Arrange — create a big upset: m1 has very high rating but loses strongly
    const ratings: RatingsMap = new Map();
    setRating(ratings, "m1", "CODE_GENERATION", { mu: 900, sigma: 100, comparisons: 50 });
    setRating(ratings, "m2", "CODE_GENERATION", { mu: 100, sigma: 100, comparisons: 50 });

    // m2 wins strongly (B>>A): m1 quality=2, m2 quality=9
    const records = [
      makeRecord({ model: "m1", quality: 2, taskType: "CODE_WRITE" }),
      makeRecord({ model: "m2", quality: 9, taskType: "CODE_WRITE" }),
    ];

    // Act
    const result = calibrate(ratings, records);

    // Assert — m1 had mu=900 but lost strongly, should trigger anomaly detection
    expect(result.comparisonsProcessed).toBe(1);
    // The mu of m1 should have decreased (big upset)
    const m1Rating = getRating(ratings, "m1", "CODE_GENERATION");
    expect(m1Rating.mu).toBeLessThan(900);
  });
});
