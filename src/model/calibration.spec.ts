/**
 * Calibration Loop tests.
 */
import { describe, it, expect, mock } from "bun:test";
import {
  taskToDimensions,
  extractPairwise,
  calibrate,
  extractRatingsMap,
  persistRatings,
  STRONG_QUALITY_DIFF,
  MIN_QUALITY_DIFF,
  SIGMA_CONVERGED,
  SIGMA_STALE,
} from "./calibration";
import { getRating, setRating, type RatingsMap } from "../evaluation/bt-updater";
import { SIGMA_BASE, ALL_DIMENSIONS } from "./types";
import type { ModelInfo, CapabilityDimension, DimensionRating } from "./types";
import type { CallRecord } from "../report/types";

// -- Helpers --

function makeRecord(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    model: "anthropic/claude-sonnet-4.6",
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
    expect(results[0]!.modelA).toBe("m1");
    expect(results[0]!.modelB).toBe("m2");
  });

  it("should produce A>>B for strong quality difference", () => {
    const records = [
      makeRecord({ model: "m1", quality: 9, taskType: "CODE_WRITE" }),
      makeRecord({ model: "m2", quality: 3, taskType: "CODE_WRITE" }),
    ];
    const results = extractPairwise(records);
    expect(results[0]!.outcome).toBe("A>>B");
  });

  it("should produce A>B for weak quality difference", () => {
    const records = [
      makeRecord({ model: "m1", quality: 7, taskType: "CODE_WRITE" }),
      makeRecord({ model: "m2", quality: 5, taskType: "CODE_WRITE" }),
    ];
    const results = extractPairwise(records);
    expect(results[0]!.outcome).toBe("A>B");
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
    expect(results[0]!.outcome).toBe("B>>A");
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
    expect(results[0]!.outcome).toBe("B>A");
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
    // sigma must be high enough that scaledK produces mu change > ANOMALY_THRESHOLD(100)
    // K = K_BASE(32) * sigma/SIGMA_BASE(350); sigma=1200 → K≈109.7 → max change≈109 > 100
    const ratings: RatingsMap = new Map();
    setRating(ratings, "m1", "CODE_GENERATION", { mu: 900, sigma: 1200, comparisons: 50 });
    setRating(ratings, "m2", "CODE_GENERATION", { mu: 100, sigma: 1200, comparisons: 50 });

    // m2 wins strongly (B>>A): m1 quality=2, m2 quality=9
    const records = [
      makeRecord({ model: "m1", quality: 2, taskType: "CODE_WRITE" }),
      makeRecord({ model: "m2", quality: 9, taskType: "CODE_WRITE" }),
    ];

    // Act
    const result = calibrate(ratings, records);

    // Assert — m1 had mu=900 but lost strongly, should trigger anomaly detection
    expect(result.comparisonsProcessed).toBe(1);
    expect(result.anomalies.length).toBeGreaterThan(0);
    expect(result.anomalies).toContainEqual(
      expect.objectContaining({ modelId: "m1", dimension: "CODE_GENERATION" }),
    );
    // The mu of m1 should have decreased (big upset)
    const m1Rating = getRating(ratings, "m1", "CODE_GENERATION");
    expect(m1Rating.mu).toBeLessThan(900);
  });
});

// ================================================================
// Helpers for extractRatingsMap / persistRatings
// ================================================================

function makeModelInfo(id: string, mu = 500): ModelInfo {
  const capabilities = {} as Record<CapabilityDimension, DimensionRating>;
  for (const dim of ALL_DIMENSIONS) {
    capabilities[dim] = { mu, sigma: SIGMA_BASE, comparisons: 0 };
  }
  return {
    id,
    name: id,
    provider: "anthropic",
    contextWindow: 128000,
    capabilities: capabilities as any,
    cost: { inputPer1M: 1, outputPer1M: 4 },
    supportsToolCalling: true,
  };
}

function makeModelsJson(models: ModelInfo[]): string {
  const out: Record<string, unknown> = {};
  for (const m of models) {
    const scores: Record<string, unknown> = {};
    for (const [dim, r] of Object.entries(m.capabilities as Record<string, DimensionRating>)) {
      scores[dim] = { mu: (r as DimensionRating).mu, sigma: (r as DimensionRating).sigma, comparisons: (r as DimensionRating).comparisons };
    }
    out[m.id] = { name: m.name, contextWindow: m.contextWindow, supportsToolCalling: m.supportsToolCalling, cost: m.cost, scores };
  }
  return JSON.stringify({ version: 2, models: out }, null, 2);
}

// ================================================================
// extractRatingsMap
// ================================================================

describe("extractRatingsMap", () => {
  it("should map 3 models with capabilities to RatingsMap with 3 entries", () => {
    // Arrange
    const models = [makeModelInfo("m1"), makeModelInfo("m2"), makeModelInfo("m3")];

    // Act
    const map = extractRatingsMap(models);

    // Assert
    expect(map.has("m1")).toBe(true);
    expect(map.has("m2")).toBe(true);
    expect(map.has("m3")).toBe(true);
    expect(map.size).toBe(3);
  });

  it("should copy mu=900 from capabilities.REASONING into RatingsMap", () => {
    // Arrange
    const model = makeModelInfo("m1", 900);

    // Act
    const map = extractRatingsMap([model]);

    // Assert
    const rating = getRating(map, "m1", "REASONING");
    expect(rating.mu).toBe(900);
    expect(rating.sigma).toBe(SIGMA_BASE);
    expect(rating.comparisons).toBe(0);
  });

  it("should return empty Map when models array is empty", () => {
    // Arrange / Act
    const map = extractRatingsMap([]);

    // Assert
    expect(map.size).toBe(0);
  });

  it("should store no dims for model with empty capabilities", () => {
    // Arrange — ModelInfo with no capability entries
    const emptyModel: ModelInfo = {
      id: "empty",
      name: "empty",
      provider: "anthropic",
      contextWindow: 128000,
      capabilities: {} as any,
      cost: { inputPer1M: 0, outputPer1M: 0 },
      supportsToolCalling: false,
    };

    // Act
    const map = extractRatingsMap([emptyModel]);

    // Assert — entry exists but has no dim entries
    expect(map.has("empty")).toBe(true);
    const dimMap = map.get("empty")!;
    expect(dimMap.size).toBe(0);
  });

  it("should preserve mu=0/sigma=0/comparisons=0 exactly as stored", () => {
    // Arrange
    const model = makeModelInfo("m1", 0);
    (model.capabilities as any)["REASONING"] = { mu: 0, sigma: 0, comparisons: 0 };

    // Act
    const map = extractRatingsMap([model]);

    // Assert — edge zero values preserved
    const rating = getRating(map, "m1", "REASONING");
    expect(rating.mu).toBe(0);
    expect(rating.sigma).toBe(0);
    expect(rating.comparisons).toBe(0);
  });

  it("should produce identical RatingsMap on repeated calls with same input", () => {
    // Arrange
    const models = [makeModelInfo("m1", 700)];

    // Act
    const map1 = extractRatingsMap(models);
    const map2 = extractRatingsMap(models);

    // Assert
    expect(getRating(map1, "m1", "REASONING").mu).toBe(getRating(map2, "m1", "REASONING").mu);
    expect(map1.size).toBe(map2.size);
  });
});

// ================================================================
// persistRatings
// ================================================================

describe("persistRatings", () => {
  it("should update single model single dim and call writeFile once", async () => {
    // Arrange
    const model = makeModelInfo("m1", 500);
    const jsonStr = makeModelsJson([model]);
    const io = {
      readFile: mock(() => Promise.resolve(jsonStr)),
      writeFile: mock(() => Promise.resolve()),
    };
    const ratings: RatingsMap = new Map();
    setRating(ratings, "m1", "CODE_GENERATION", { mu: 800, sigma: 200, comparisons: 5 });

    // Act
    await persistRatings("scores/models.json", ratings, io);

    // Assert
    expect(io.writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenData] = (io.writeFile as ReturnType<typeof mock>).mock.calls[0]!;
    expect(writtenPath).toBe("scores/models.json");
    const parsed = JSON.parse(writtenData as string);
    expect(parsed.models["m1"].scores["CODE_GENERATION"]).toEqual({ mu: 800, sigma: 200, comparisons: 5 });
  });

  it("should update all dims for a model and write once", async () => {
    // Arrange
    const model = makeModelInfo("m1", 500);
    const jsonStr = makeModelsJson([model]);
    const io = {
      readFile: mock(() => Promise.resolve(jsonStr)),
      writeFile: mock(() => Promise.resolve()),
    };
    const ratings = extractRatingsMap([makeModelInfo("m1", 900)]);

    // Act
    await persistRatings("scores/models.json", ratings, io);

    // Assert — all dims updated, writeFile called once
    expect(io.writeFile).toHaveBeenCalledTimes(1);
    const [, writtenData] = (io.writeFile as ReturnType<typeof mock>).mock.calls[0]!;
    const parsed = JSON.parse(writtenData as string);
    for (const dim of ALL_DIMENSIONS) {
      expect(parsed.models["m1"].scores[dim].mu).toBe(900);
    }
  });

  it("should propagate io.readFile error", async () => {
    // Arrange
    const io = {
      readFile: mock(() => Promise.reject(new Error("ENOENT: file not found"))),
      writeFile: mock(() => Promise.resolve()),
    };

    // Act + Assert
    await expect(persistRatings("missing.json", new Map(), io)).rejects.toThrow("ENOENT");
    expect(io.writeFile).not.toHaveBeenCalled();
  });

  it("should propagate JSON.parse SyntaxError", async () => {
    // Arrange
    const io = {
      readFile: mock(() => Promise.resolve("not valid json {{{")),
      writeFile: mock(() => Promise.resolve()),
    };

    // Act + Assert
    await expect(persistRatings("bad.json", new Map(), io)).rejects.toThrow(SyntaxError);
    expect(io.writeFile).not.toHaveBeenCalled();
  });

  it("should propagate io.writeFile error", async () => {
    // Arrange
    const model = makeModelInfo("m1");
    const jsonStr = makeModelsJson([model]);
    const io = {
      readFile: mock(() => Promise.resolve(jsonStr)),
      writeFile: mock(() => Promise.reject(new Error("disk full"))),
    };
    const ratings = extractRatingsMap([model]);

    // Act + Assert
    await expect(persistRatings("scores/models.json", ratings, io)).rejects.toThrow("disk full");
  });

  it("should write unchanged JSON when ratings Map is empty", async () => {
    // Arrange
    const model = makeModelInfo("m1", 500);
    const jsonStr = makeModelsJson([model]);
    const io = {
      readFile: mock(() => Promise.resolve(jsonStr)),
      writeFile: mock(() => Promise.resolve()),
    };

    // Act
    await persistRatings("scores/models.json", new Map(), io);

    // Assert — writeFile called even with no updates
    expect(io.writeFile).toHaveBeenCalledTimes(1);
    const [, writtenData] = (io.writeFile as ReturnType<typeof mock>).mock.calls[0]!;
    const parsed = JSON.parse(writtenData as string);
    expect(parsed.models["m1"].scores["CODE_GENERATION"].mu).toBe(500);
  });

  it("should skip model not present in json.models", async () => {
    // Arrange — json has "m1", ratings has "ghost-model"
    const model = makeModelInfo("m1", 500);
    const jsonStr = makeModelsJson([model]);
    const io = {
      readFile: mock(() => Promise.resolve(jsonStr)),
      writeFile: mock(() => Promise.resolve()),
    };
    const ratings: RatingsMap = new Map();
    setRating(ratings, "ghost-model", "REASONING", { mu: 999, sigma: 1, comparisons: 100 });

    // Act
    await persistRatings("scores/models.json", ratings, io);

    // Assert — write called, but m1 unchanged, ghost-model not added
    const [, writtenData] = (io.writeFile as ReturnType<typeof mock>).mock.calls[0]!;
    const parsed = JSON.parse(writtenData as string);
    expect(parsed.models["ghost-model"]).toBeUndefined();
    expect(parsed.models["m1"].scores["REASONING"].mu).toBe(500);
  });
});
