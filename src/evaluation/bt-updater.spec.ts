/**
 * BT Updater tests.
 */
import { describe, it, expect } from "bun:test";
import {
  btExpected,
  scaledK,
  outcomeToSignal,
  updateRating,
  batchUpdate,
  getRating,
  setRating,
  bootstrapCI,
  K_BASE,
  SIGMA_DECAY,
  SIGMA_MIN,
  ANOMALY_THRESHOLD,
  type RatingsMap,
} from "./bt-updater";
import { SIGMA_BASE } from "../model/types";
import type { DimensionRating, CapabilityDimension } from "../model/types";
import type { PairwiseResult } from "./types";

// -- Helpers --

function makeRating(mu: number, sigma: number = SIGMA_BASE, comparisons: number = 0): DimensionRating {
  return { mu, sigma, comparisons };
}

function makePairwise(
  modelA: string,
  modelB: string,
  outcome: "A>>B" | "A>B" | "A=B" | "B>A" | "B>>A",
  promptId: string = "p1",
): PairwiseResult {
  return {
    promptId,
    modelA,
    modelB,
    judge: "judge",
    outcome,
    swapped: false,
    reasoning: "",
    confidence: 0.9,
  };
}

// ================================================================
// btExpected
// ================================================================

describe("btExpected", () => {
  it("should return 0.5 for equal mu", () => {
    expect(btExpected(500, 500)).toBe(0.5);
  });

  it("should return higher probability for higher mu", () => {
    expect(btExpected(800, 200)).toBe(0.8);
  });

  it("should return 0.5 for both zero", () => {
    expect(btExpected(0, 0)).toBe(0.5);
  });
});

// ================================================================
// scaledK
// ================================================================

describe("scaledK", () => {
  it("should return K_BASE when sigma = SIGMA_BASE", () => {
    expect(scaledK(SIGMA_BASE)).toBe(K_BASE);
  });

  it("should return half K_BASE when sigma = SIGMA_BASE/2", () => {
    expect(scaledK(SIGMA_BASE / 2)).toBe(K_BASE / 2);
  });
});

// ================================================================
// outcomeToSignal
// ================================================================

describe("outcomeToSignal", () => {
  it("should map A>>B to 3.0", () => expect(outcomeToSignal("A>>B")).toBe(3.0));
  it("should map A=B to 0.0", () => expect(outcomeToSignal("A=B")).toBe(0.0));
  it("should map B>>A to -3.0", () => expect(outcomeToSignal("B>>A")).toBe(-3.0));
});

// ================================================================
// updateRating
// ================================================================

describe("updateRating", () => {
  it("should increase winner mu and decrease loser mu on A>>B", () => {
    const a = makeRating(500);
    const b = makeRating(500);
    const { updatedA, updatedB } = updateRating(a, b, "A>>B");
    expect(updatedA.mu).toBeGreaterThan(500);
    expect(updatedB.mu).toBeLessThan(500);
  });

  it("should have larger update for A>>B than A>B", () => {
    const a = makeRating(500);
    const b = makeRating(500);
    const strong = updateRating(a, b, "A>>B");
    const weak = updateRating(a, b, "A>B");
    expect(strong.updatedA.mu - 500).toBeGreaterThan(weak.updatedA.mu - 500);
  });

  it("should not change mu on A=B (tie)", () => {
    const a = makeRating(500);
    const b = makeRating(500);
    const { updatedA, updatedB } = updateRating(a, b, "A=B");
    expect(updatedA.mu).toBe(500);
    expect(updatedB.mu).toBe(500);
  });

  it("should decrease sigma after comparison (surprise-aware decay)", () => {
    const a = makeRating(500, SIGMA_BASE);
    const b = makeRating(500, SIGMA_BASE);
    const { updatedA } = updateRating(a, b, "A>B");
    // Surprise-aware: decay = SIGMA_DECAY + (1 - SIGMA_DECAY) * min(|surprise|/3, 1)
    // For equal ratings, expected=0.5, signal=0.75, surprise=0.75*0.5=0.375
    // decay = 0.97 + 0.03 * min(0.375/3, 1) = 0.97 + 0.03 * 0.125 = 0.97375
    expect(updatedA.sigma).toBeLessThan(SIGMA_BASE);
    expect(updatedA.sigma).toBeGreaterThan(SIGMA_BASE * SIGMA_DECAY);
  });

  it("should not decrease sigma below SIGMA_MIN", () => {
    const a = makeRating(500, SIGMA_MIN);
    const b = makeRating(500, SIGMA_MIN);
    const { updatedA } = updateRating(a, b, "A>B");
    expect(updatedA.sigma).toBe(SIGMA_MIN);
  });

  it("should increment comparisons", () => {
    const a = makeRating(500, SIGMA_BASE, 5);
    const b = makeRating(500, SIGMA_BASE, 3);
    const { updatedA, updatedB } = updateRating(a, b, "A>B");
    expect(updatedA.comparisons).toBe(6);
    expect(updatedB.comparisons).toBe(4);
  });

  it("should clamp mu to [0, 1000]", () => {
    const high = makeRating(990, SIGMA_BASE);
    const low = makeRating(10, SIGMA_BASE);
    const { updatedA } = updateRating(high, low, "A>>B");
    expect(updatedA.mu).toBeLessThanOrEqual(1000);
    const { updatedB } = updateRating(low, high, "B>>A");
    expect(updatedB.mu).toBeGreaterThanOrEqual(0);
  });

  it("should flag anomaly for extreme mu change", () => {
    // Very high sigma → very large K → huge update
    const a = makeRating(500, SIGMA_BASE * 10); // sigma=3500 → K=320
    const b = makeRating(500, SIGMA_BASE);
    const { anomaly } = updateRating(a, b, "A>>B");
    expect(anomaly).toBe(true);
  });

  it("should maintain zero-sum: delta_A + delta_B ≈ 0 when not clamped", () => {
    const a = makeRating(500, 200);
    const b = makeRating(500, 200);
    const { updatedA, updatedB } = updateRating(a, b, "A>B");
    const deltaA = updatedA.mu - a.mu;
    const deltaB = updatedB.mu - b.mu;
    expect(Math.abs(deltaA + deltaB)).toBeLessThan(0.001);
  });

  it("should maintain zero-sum even when A is clamped at boundary", () => {
    // A at 0, very high sigma to produce large K → A would go negative but clamps at 0
    const a = makeRating(0, SIGMA_BASE * 5);
    const b = makeRating(500, SIGMA_BASE * 5);
    const { updatedA, updatedB } = updateRating(a, b, "B>>A");
    // A clamped at 0, B's delta compensates
    const deltaA = updatedA.mu - 0;
    const deltaB = updatedB.mu - 500;
    expect(updatedA.mu).toBe(0); // clamped
    expect(Math.abs(deltaA + deltaB)).toBeLessThan(0.001);
  });

  it("should decay sigma less when result is surprising", () => {
    // Surprising: weak model (200) beats strong model (800)
    const weak = makeRating(200, 200);
    const strong = makeRating(800, 200);
    const { updatedA: surpriseA } = updateRating(weak, strong, "A>>B");

    // Expected: equal models
    const a = makeRating(500, 200);
    const b = makeRating(500, 200);
    const { updatedA: normalA } = updateRating(a, b, "A>B");

    // Surprising result should preserve more uncertainty (higher sigma)
    expect(surpriseA.sigma).toBeGreaterThan(normalA.sigma);
  });
});

// ================================================================
// batchUpdate
// ================================================================

describe("batchUpdate", () => {
  it("should update ratings for all results", () => {
    const ratings: RatingsMap = new Map();
    setRating(ratings, "m1", "CODE_GENERATION", makeRating(500));
    setRating(ratings, "m2", "CODE_GENERATION", makeRating(500));

    const dims = new Map<string, CapabilityDimension[]>([
      ["p1", ["CODE_GENERATION"]],
    ]);

    const { updates } = batchUpdate(
      ratings,
      [makePairwise("m1", "m2", "A>B")],
      dims,
    );
    // 2 updates: one for m1, one for m2
    expect(updates).toHaveLength(2);
    const m1Rating = getRating(ratings, "m1", "CODE_GENERATION");
    expect(m1Rating.mu).toBeGreaterThan(500);
  });

  it("should skip results with unknown promptId", () => {
    const ratings: RatingsMap = new Map();
    const dims = new Map<string, CapabilityDimension[]>();
    const { updates } = batchUpdate(
      ratings,
      [makePairwise("m1", "m2", "A>B", "unknown")],
      dims,
    );
    expect(updates).toHaveLength(0);
  });

  it("should collect anomalies separately", () => {
    const ratings: RatingsMap = new Map();
    setRating(ratings, "m1", "CODE_GENERATION", makeRating(500, SIGMA_BASE * 10));
    setRating(ratings, "m2", "CODE_GENERATION", makeRating(500));

    const dims = new Map<string, CapabilityDimension[]>([
      ["p1", ["CODE_GENERATION"]],
    ]);

    const { anomalies } = batchUpdate(
      ratings,
      [makePairwise("m1", "m2", "A>>B")],
      dims,
    );
    expect(anomalies.length).toBeGreaterThan(0);
  });

  it("should converge sigma over multiple comparisons", () => {
    const ratings: RatingsMap = new Map();
    setRating(ratings, "m1", "CODE_GENERATION", makeRating(600));
    setRating(ratings, "m2", "CODE_GENERATION", makeRating(400));

    const dims = new Map<string, CapabilityDimension[]>([
      ["p1", ["CODE_GENERATION"]],
    ]);

    // 10 comparisons
    for (let i = 0; i < 10; i++) {
      batchUpdate(ratings, [makePairwise("m1", "m2", "A>B")], dims);
    }

    const sigma = getRating(ratings, "m1", "CODE_GENERATION").sigma;
    expect(sigma).toBeLessThan(SIGMA_BASE);
    expect(sigma).toBeGreaterThan(SIGMA_MIN);
  });
});

// ================================================================
// bootstrapCI
// ================================================================

describe("bootstrapCI", () => {
  it("should return lower <= median <= upper", () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      makePairwise("m1", "m2", i < 15 ? "A>B" : "B>A"),
    );
    const dims = new Map<string, CapabilityDimension[]>([
      ["p1", ["CODE_GENERATION"]],
    ]);

    const ci = bootstrapCI(results, "m1", "CODE_GENERATION", dims, 50);
    expect(ci.lower).toBeLessThanOrEqual(ci.median);
    expect(ci.median).toBeLessThanOrEqual(ci.upper);
  });
});
