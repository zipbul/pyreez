import { describe, it, expect } from "bun:test";
import {
  eloToMu,
  votesToSigma,
  OPERATIONAL_DIMS,
  costToEfficiency,
  costToSpeed,
} from "./bootstrap-ratings";

describe("bootstrap-ratings", () => {
  describe("eloToMu", () => {
    it("should map min ELO to 0", () => {
      expect(eloToMu(1200, 1200, 1400)).toBe(0);
    });

    it("should map max ELO to 1000", () => {
      expect(eloToMu(1400, 1200, 1400)).toBe(1000);
    });

    it("should map mid ELO to 500", () => {
      expect(eloToMu(1300, 1200, 1400)).toBe(500);
    });

    it("should return 500 when min equals max", () => {
      expect(eloToMu(1300, 1300, 1300)).toBe(500);
    });

    it("should clamp to 0 for ELO below min", () => {
      expect(eloToMu(1000, 1200, 1400)).toBe(0);
    });

    it("should clamp to 1000 for ELO above max", () => {
      expect(eloToMu(1600, 1200, 1400)).toBe(1000);
    });

    it("should handle very large ELO range", () => {
      const result = eloToMu(1500, 1000, 2000);
      expect(result).toBe(500);
    });

    it("should handle very narrow ELO range", () => {
      const result = eloToMu(1201, 1200, 1202);
      expect(result).toBe(500);
    });
  });

  describe("votesToSigma", () => {
    it("should return 350 for 0 votes (maximum uncertainty)", () => {
      expect(votesToSigma(0)).toBe(350);
    });

    it("should decrease with more votes (SCALE=1000)", () => {
      expect(votesToSigma(1000)).toBeCloseTo(350 / Math.sqrt(2), 0); // ~247
      expect(votesToSigma(5000)).toBeCloseTo(350 / Math.sqrt(6), 0); // ~143
    });

    it("should never go below 100 (sigma floor)", () => {
      expect(votesToSigma(10000)).toBeGreaterThanOrEqual(100);
      expect(votesToSigma(100000)).toBe(100);
      expect(votesToSigma(1000000)).toBe(100);
    });

    it("should be monotonically non-increasing", () => {
      const counts = [0, 100, 500, 1000, 5000, 10000, 50000];
      for (let i = 1; i < counts.length; i++) {
        expect(votesToSigma(counts[i]!)).toBeLessThanOrEqual(
          votesToSigma(counts[i - 1]!),
        );
      }
    });

    it("should handle negative votes gracefully (clamp to 0)", () => {
      expect(votesToSigma(-100)).toBe(350);
      expect(votesToSigma(-999)).toBe(350);
    });
  });

  describe("OPERATIONAL_DIMS", () => {
    it("should contain SPEED and COST_EFFICIENCY", () => {
      expect(OPERATIONAL_DIMS.has("SPEED")).toBe(true);
      expect(OPERATIONAL_DIMS.has("COST_EFFICIENCY")).toBe(true);
    });

    it("should not contain quality dimensions", () => {
      expect(OPERATIONAL_DIMS.has("REASONING")).toBe(false);
      expect(OPERATIONAL_DIMS.has("CODE_GENERATION")).toBe(false);
      expect(OPERATIONAL_DIMS.has("CREATIVITY")).toBe(false);
    });
  });

  describe("costToEfficiency", () => {
    it("should return high score for cheap models", () => {
      // Free model: 1000 / (1 + 0/5) = 1000
      expect(costToEfficiency(0, 0)).toBe(1000);
    });

    it("should return lower score for expensive models", () => {
      // opus-4.6: avg = (5+25)/2 = 15, 1000 / (1+15/5) = 1000/4 = 250
      expect(costToEfficiency(5, 25)).toBe(250);
    });

    it("should be monotonically decreasing with cost", () => {
      const cheap = costToEfficiency(0.1, 0.4);
      const mid = costToEfficiency(3, 15);
      const expensive = costToEfficiency(15, 75);
      expect(cheap).toBeGreaterThan(mid);
      expect(mid).toBeGreaterThan(expensive);
    });

    it("should handle negative costs gracefully (clamp to 0)", () => {
      // Negative cost should be treated as 0 → max efficiency
      expect(costToEfficiency(-5, 0)).toBe(1000);
      expect(costToEfficiency(0, -10)).toBe(1000);
      expect(costToEfficiency(-5, -10)).toBe(1000);
    });
  });

  describe("costToSpeed", () => {
    it("should return high score for cheap/fast models", () => {
      expect(costToSpeed(0, 0)).toBe(1000);
    });

    it("should return lower score for expensive models", () => {
      expect(costToSpeed(15, 75)).toBeLessThan(costToSpeed(0.1, 0.4));
    });

    it("should handle negative costs gracefully (clamp to 0)", () => {
      expect(costToSpeed(-5, 0)).toBe(1000);
      expect(costToSpeed(0, -10)).toBe(1000);
    });
  });

  describe("conversion consistency", () => {
    it("should produce mu values that preserve ELO ordering", () => {
      const elos = [1210, 1250, 1300, 1350, 1385];
      const mus = elos.map((e) => eloToMu(e, 1210, 1385));
      for (let i = 1; i < mus.length; i++) {
        expect(mus[i]!).toBeGreaterThan(mus[i - 1]!);
      }
    });

    it("should produce lower sigma for higher vote counts", () => {
      expect(votesToSigma(0)).toBeGreaterThan(votesToSigma(1000));
      expect(votesToSigma(1000)).toBeGreaterThan(votesToSigma(10000));
    });
  });
});
