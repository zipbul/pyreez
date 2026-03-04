import { describe, it, expect } from "bun:test";
import {
  computeWeighted,
  computeWeightedThompson,
  computeComposite,
  poolCostEfficiency,
  computeAvgSigma,
  rankModels,
  gaussianSample,
  truncatedNormalSample,
} from "./composite-score";
import type { ModelScore, AxisTaskRequirement, BudgetConfig } from "../axis/types";
import type { ModelInfo } from "../model/types";
import { SIGMA_BASE } from "../model/types";

function makeScore(modelId: string, mu = 700, sigma = 100): ModelScore {
  return {
    modelId,
    dimensions: {
      REASONING: { mu, sigma },
      CODE_GENERATION: { mu: mu - 50, sigma },
    },
    overall: mu,
  };
}

function makeInfo(id: string, inputPer1M = 2.0, outputPer1M = 8.0): ModelInfo {
  return {
    id,
    name: id,
    provider: "openai",
    contextWindow: 128000,
    capabilities: {} as any,
    cost: { inputPer1M, outputPer1M },
    supportsToolCalling: true,
  };
}

describe("composite-score", () => {
  describe("computeWeighted", () => {
    it("should weight dimensions by capability weights", () => {
      const score = makeScore("m1", 800, 100);
      const result = computeWeighted(score, { REASONING: 0.6, CODE_GENERATION: 0.4 });
      expect(result).toBeGreaterThan(0);
    });

    it("should return overall when no capabilities specified", () => {
      const score = makeScore("m1", 800);
      expect(computeWeighted(score, {})).toBe(800);
    });

    it("should penalize high-sigma dimensions with confidence floor", () => {
      const calibrated = makeScore("m1", 800, 50);
      const uncalibrated = makeScore("m2", 800, SIGMA_BASE);
      const caps = { REASONING: 1.0 };
      expect(computeWeighted(calibrated, caps)).toBeGreaterThan(
        computeWeighted(uncalibrated, caps),
      );
    });

    it("should clamp confidence to [MIN_CONFIDENCE, 1] when sigma > SIGMA_BASE", () => {
      // sigma=500 > SIGMA_BASE=350 → raw confidence = 1 - 500/350 = -0.43
      // Should be clamped to MIN_CONFIDENCE (0.15), not negative
      const overSigma = makeScore("m1", 800, 500);
      const caps = { REASONING: 1.0 };
      const result = computeWeighted(overSigma, caps);
      expect(result).toBeGreaterThan(0); // not negative
      expect(result).toBeCloseTo(800 * 0.15 * 1.0, 5); // MIN_CONFIDENCE applied
    });
  });

  describe("truncatedNormalSample", () => {
    it("should always return values within [lo, hi]", () => {
      for (let i = 0; i < 1000; i++) {
        const v = truncatedNormalSample(100, 350, 0, 1000);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1000);
      }
    });

    it("should return mu when sampleFn always returns 0", () => {
      const v = truncatedNormalSample(500, 200, 0, 1000, () => 0);
      expect(v).toBe(500);
    });

    it("should reject draws outside bounds and return valid sample", () => {
      // First 3 draws outside, 4th inside
      let call = 0;
      const sampleFn = () => {
        call++;
        // draws: 500+200*(-5)=-500, 500+200*(-4)=-300, 500+200*(-3)=-100, 500+200*(0.5)=600
        return [-5, -4, -3, 0.5][call - 1]!;
      };
      const v = truncatedNormalSample(500, 200, 0, 1000, sampleFn);
      expect(v).toBe(600);
      expect(call).toBe(4); // took 4 attempts
    });

    it("should fall back to clamped mu after maxIter", () => {
      // Always draws outside bounds
      const v = truncatedNormalSample(500, 200, 0, 1000, () => -100, 10);
      expect(v).toBe(500); // mu clamped to [0,1000] = 500
    });

    it("should produce consistent mean for low-mu/high-sigma (no mass pile-up at 0)", () => {
      // Truncated N(100, 350) on [0,1000]: left tail removed, not piled at 0.
      // E[X|0≤X≤1000] ≈ 312 (analytically). Clamp would give ~195 (39% zeros).
      // Truncated normal is the correct conditional distribution.
      const N = 10_000;
      let sum = 0;
      let zeroCount = 0;
      for (let i = 0; i < N; i++) {
        const v = truncatedNormalSample(100, 350, 0, 1000);
        sum += v;
        if (v === 0) zeroCount++;
      }
      const mean = sum / N;
      // Should be around 312 (truncated normal conditional mean)
      expect(mean).toBeGreaterThan(250);
      expect(mean).toBeLessThan(400);
      // Should never pile mass at 0 (unlike clamp which gives 0 ~39% of the time)
      expect(zeroCount).toBe(0);
    });
  });

  describe("computeWeightedThompson", () => {
    it("should return deterministic result with fixed sampleFn", () => {
      const score = makeScore("m1", 800, 100);
      const caps = { REASONING: 0.6, CODE_GENERATION: 0.4 };
      // Fixed sample: always return 0 → uses raw mu (no confidence multiplier)
      const result = computeWeightedThompson(score, caps, () => 0);
      // Expected: 800 * 0.6 + 750 * 0.4 = 780 (raw mu × weight, no confidence)
      expect(result).toBeCloseTo(780, 5);
    });

    it("should increase score with positive sample", () => {
      const score = makeScore("m1", 800, 100);
      const caps = { REASONING: 1.0 };
      const base = computeWeightedThompson(score, caps, () => 0);
      const boosted = computeWeightedThompson(score, caps, () => 1);
      expect(boosted).toBeGreaterThan(base);
    });

    it("should clamp sampled mu to [0, 1000]", () => {
      const score = makeScore("m1", 50, 200);
      const caps = { REASONING: 1.0 };
      // Very negative sample → mu should be clamped to 0
      const result = computeWeightedThompson(score, caps, () => -10);
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it("should return overall when no capabilities specified", () => {
      const score = makeScore("m1", 800);
      expect(computeWeightedThompson(score, {})).toBe(800);
    });
  });

  describe("poolCostEfficiency", () => {
    it("should return 1.0 for cheapest model", () => {
      expect(poolCostEfficiency(0.001, 0.001, 1.0)).toBe(1);
    });

    it("should return 0.0 for most expensive model", () => {
      expect(poolCostEfficiency(1.0, 0.001, 1.0)).toBeCloseTo(0, 2);
    });

    it("should return 1.0 when all costs are equal", () => {
      expect(poolCostEfficiency(0.5, 0.5, 0.5)).toBe(1);
    });

    it("should return 0.5 for mid-range cost", () => {
      expect(poolCostEfficiency(0.5, 0, 1.0)).toBeCloseTo(0.5, 5);
    });

    it("should return 1.0 when all models are free (cost=0)", () => {
      expect(poolCostEfficiency(0, 0, 0)).toBe(1);
    });
  });

  describe("computeComposite", () => {
    // costEff parameter is now pre-normalized (0=expensive, 1=cheap)
    it("should blend quality and cost efficiency", () => {
      const result = computeComposite(500, 1000, 0.8, 0.7, 0.3);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(1.0);
    });

    it("should prefer cheaper model when cost weight is higher", () => {
      const cheap = computeComposite(500, 1000, 1.0, 0.3, 0.7);   // costEff=1.0
      const expensive = computeComposite(500, 1000, 0.0, 0.3, 0.7); // costEff=0.0
      expect(cheap).toBeGreaterThan(expensive);
    });

    it("should prefer better model when quality weight is higher", () => {
      const highQ = computeComposite(900, 1000, 0.5, 0.9, 0.1);
      const lowQ = computeComposite(300, 1000, 0.5, 0.9, 0.1);
      expect(highQ).toBeGreaterThan(lowQ);
    });

    it("should be unchanged when latency args are not provided", () => {
      const without = computeComposite(500, 1000, 0.8, 0.7, 0.3);
      const withUndef = computeComposite(500, 1000, 0.8, 0.7, 0.3, undefined, undefined);
      expect(without).toBe(withUndef);
    });

    it("should boost score when latency efficiency is high", () => {
      const base = computeComposite(500, 1000, 0.8, 0.7, 0.3);
      const withLat = computeComposite(500, 1000, 0.8, 0.7, 0.3, 0.9, 0.2);
      expect(withLat).toBeGreaterThan(base);
    });

    it("should prefer fast model with latency weight", () => {
      const fast = computeComposite(500, 1000, 0.8, 0.5, 0.3, 0.9, 0.2);
      const slow = computeComposite(500, 1000, 0.8, 0.5, 0.3, 0.1, 0.2);
      expect(fast).toBeGreaterThan(slow);
    });
  });

  describe("computeAvgSigma", () => {
    it("should average sigma across dimensions", () => {
      const score = makeScore("m1", 700, 150);
      expect(computeAvgSigma(score)).toBe(150);
    });

    it("should return SIGMA_BASE when no dimensions", () => {
      const score: ModelScore = { modelId: "m1", dimensions: {}, overall: 500 };
      expect(computeAvgSigma(score)).toBe(SIGMA_BASE);
    });
  });

  // ==========================================================================
  // Risk 1: Thompson Sampling probabilistic verification
  // ==========================================================================

  describe("gaussianSample distribution", () => {
    it("should produce samples with mean ≈ 0 and stddev ≈ 1", () => {
      const N = 10_000;
      let sum = 0;
      let sumSq = 0;
      for (let i = 0; i < N; i++) {
        const s = gaussianSample();
        sum += s;
        sumSq += s * s;
      }
      const mean = sum / N;
      const variance = sumSq / N - mean * mean;
      const stddev = Math.sqrt(variance);
      // Tolerances for N=10000: mean within ±0.05, stddev within ±0.1
      expect(Math.abs(mean)).toBeLessThan(0.05);
      expect(Math.abs(stddev - 1)).toBeLessThan(0.1);
    });

    it("should never return NaN or Infinity", () => {
      for (let i = 0; i < 1000; i++) {
        const s = gaussianSample();
        expect(Number.isFinite(s)).toBe(true);
      }
    });
  });

  describe("Thompson exploration behavior", () => {
    it("should produce non-deterministic scores (variance > 0)", () => {
      const score = makeScore("m1", 800, 100);
      const caps = { REASONING: 1.0 };

      const N = 100;
      const results = new Set<number>();
      for (let i = 0; i < N; i++) {
        results.add(computeWeightedThompson(score, caps));
      }

      // With real randomness, we should get many distinct values
      expect(results.size).toBeGreaterThan(50);
    });

    it("should produce higher variance for high-sigma models than low-sigma models", () => {
      const lowSigma = makeScore("calibrated", 800, 30);
      const highSigma = makeScore("uncertain", 800, 200);
      const caps = { REASONING: 1.0 };

      const N = 500;
      const lowScores: number[] = [];
      const highScores: number[] = [];
      for (let i = 0; i < N; i++) {
        lowScores.push(computeWeightedThompson(lowSigma, caps));
        highScores.push(computeWeightedThompson(highSigma, caps));
      }

      // Compute variance
      const variance = (arr: number[]) => {
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
      };

      // High-sigma model should have substantially more variance in Thompson scores
      expect(variance(highScores)).toBeGreaterThan(variance(lowScores) * 2);
    });

    it("should occasionally change ranking between similar-quality models", () => {
      // Two models with same base mu but different sigma
      const modelA = makeScore("a", 800, 80);
      const modelB = makeScore("b", 790, 80);
      const caps = { REASONING: 1.0 };

      const N = 500;
      let aWins = 0;
      for (let i = 0; i < N; i++) {
        const scoreA = computeWeightedThompson(modelA, caps);
        const scoreB = computeWeightedThompson(modelB, caps);
        if (scoreA > scoreB) aWins++;
      }

      // Neither model should always dominate — Thompson introduces stochasticity
      expect(aWins).toBeGreaterThan(N * 0.1);   // A wins at least 10%
      expect(aWins).toBeLessThan(N * 0.9);      // A doesn't win more than 90%
    });

    it("should produce deterministic results with a seeded PRNG", () => {
      // Mulberry32 PRNG for reproducibility
      function mulberry32(seed: number): () => number {
        let state = seed;
        return () => {
          state |= 0;
          state = (state + 0x6d2b79f5) | 0;
          let t = Math.imul(state ^ (state >>> 15), 1 | state);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }

      // Convert uniform → normal via Box-Muller
      function seededGaussian(rng: () => number): () => number {
        return () => {
          const u1 = Math.max(1e-10, rng());
          const u2 = rng();
          return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        };
      }

      const score = makeScore("m1", 800, 100);
      const caps = { REASONING: 0.6, CODE_GENERATION: 0.4 };

      const run1 = computeWeightedThompson(score, caps, seededGaussian(mulberry32(42)));
      const run2 = computeWeightedThompson(score, caps, seededGaussian(mulberry32(42)));

      expect(run1).toBe(run2);
    });
  });

  describe("rankModels", () => {
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 0.6, CODE_GENERATION: 0.4 },
      constraints: {},
      budget: {},
    };
    const budget: BudgetConfig = { perRequest: 1.0 };

    it("should rank models by composite score descending", () => {
      const scores = [makeScore("m1", 600), makeScore("m2", 800)];
      const registry = {
        getById: (id: string) => makeInfo(id),
      };
      const ranked = rankModels(scores, req, budget, {
        registry,
        routing: { qualityWeight: 0.7, costWeight: 0.3 },
      });

      expect(ranked.length).toBe(2);
      expect(ranked[0]!.modelId).toBe("m2");
      expect(ranked[0]!.composite).toBeGreaterThan(ranked[1]!.composite);
    });

    it("should filter by budget", () => {
      const scores = [makeScore("cheap", 700), makeScore("expensive", 800)];
      const registry = {
        getById: (id: string) =>
          id === "cheap" ? makeInfo(id, 0.1, 0.1) : makeInfo(id, 100, 400),
      };
      const ranked = rankModels(scores, req, { perRequest: 0.01 }, {
        registry,
        routing: { qualityWeight: 0.7, costWeight: 0.3 },
      });

      expect(ranked.length).toBe(1);
      expect(ranked[0]!.modelId).toBe("cheap");
    });

    it("should skip models not in registry", () => {
      const scores = [makeScore("known"), makeScore("unknown")];
      const registry = {
        getById: (id: string) => (id === "known" ? makeInfo(id) : undefined),
      };
      const ranked = rankModels(scores, req, budget, {
        registry,
        routing: { qualityWeight: 0.7, costWeight: 0.3 },
      });

      expect(ranked.length).toBe(1);
      expect(ranked[0]!.modelId).toBe("known");
    });

    it("should prefer fast models when latencyWeight is set", () => {
      const scores = [makeScore("fast", 700), makeScore("slow", 700)];
      const registry = {
        getById: (id: string) => makeInfo(id),
      };
      const latencyData = new Map([
        ["fast", 200],
        ["slow", 5000],
      ]);
      const ranked = rankModels(scores, req, budget, {
        registry,
        routing: { qualityWeight: 0.5, costWeight: 0.3, latencyWeight: 0.2 },
        latencyData,
      });

      expect(ranked[0]!.modelId).toBe("fast");
    });

    it("should use per-request weight overrides from requirement budget", () => {
      // m1 slightly worse quality, much cheaper; m2 slightly better quality, very expensive
      const scores = [makeScore("m1", 750), makeScore("m2", 800)];
      const registry = {
        getById: (id: string) =>
          id === "m1" ? makeInfo(id, 0.1, 0.1) : makeInfo(id, 500, 2000),
      };
      // Heavy cost weight should prefer cheaper model
      const costReq = { ...req, budget: { qualityWeight: 0.1, costWeight: 0.9 } };
      const ranked = rankModels(scores, costReq, budget, {
        registry,
        routing: { qualityWeight: 0.7, costWeight: 0.3 },
      });

      expect(ranked[0]!.modelId).toBe("m1");
    });
  });
});
