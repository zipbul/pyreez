/**
 * MoE Dimension Gating tests.
 */
import { describe, it, expect } from "bun:test";
import {
  patternSimilarity,
  softmax,
  gate,
  toCapabilityRequirements,
  DEFAULT_EXPERTS,
  type Expert,
} from "./gating";

// ================================================================
// patternSimilarity
// ================================================================

describe("patternSimilarity", () => {
  it("should return 1.0 for exact match", () => {
    expect(patternSimilarity("coding", "coding")).toBe(1.0);
  });

  it("should return 0.8 for substring match", () => {
    expect(patternSimilarity("code_write coding", "coding")).toBe(0.8);
  });

  it("should return 0.0 for no match", () => {
    expect(patternSimilarity("translation", "math")).toBe(0.0);
  });

  it("should be case-insensitive", () => {
    expect(patternSimilarity("CODING", "coding")).toBe(1.0);
  });

  it("should handle partial word overlap", () => {
    const score = patternSimilarity("code_review analysis", "code");
    expect(score).toBeGreaterThan(0);
  });
});

// ================================================================
// softmax
// ================================================================

describe("softmax", () => {
  it("should return probabilities summing to 1.0", () => {
    const result = softmax([1.0, 2.0, 3.0]);
    const sum = result.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-10);
  });

  it("should return empty for empty input", () => {
    expect(softmax([])).toEqual([]);
  });

  it("should give highest probability to largest value", () => {
    const result = softmax([1.0, 3.0, 2.0]);
    expect(result[1]).toBeGreaterThan(result[0]);
    expect(result[1]).toBeGreaterThan(result[2]);
  });

  it("should return uniform for equal values", () => {
    const result = softmax([1.0, 1.0, 1.0]);
    expect(Math.abs(result[0] - result[1])).toBeLessThan(1e-10);
    expect(Math.abs(result[1] - result[2])).toBeLessThan(1e-10);
  });
});

// ================================================================
// gate
// ================================================================

describe("gate", () => {
  it("should activate coding expert for coding task", () => {
    const result = gate("CODE_WRITE", "coding");
    expect(result.weights.CODE_GENERATION).toBeDefined();
    expect(result.weights.CODE_GENERATION!).toBeGreaterThan(0);
    const topExpert = result.activeExperts[0];
    expect(topExpert.expertId).toBe("coding");
  });

  it("should activate math expert for math task", () => {
    const result = gate("MATH", "math");
    expect(result.weights.MATH_REASONING).toBeDefined();
    expect(result.weights.MATH_REASONING!).toBeGreaterThan(0.1);
  });

  it("should activate translation expert for translation task", () => {
    const result = gate("TRANSLATE", "translation");
    expect(result.weights.MULTILINGUAL).toBeDefined();
    expect(result.weights.MULTILINGUAL!).toBeGreaterThan(0.1);
  });

  it("should normalize weights to sum to 1.0", () => {
    const result = gate("CODE_WRITE", "coding");
    const sum = Object.values(result.weights).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-6);
  });

  it("should use uniform distribution when no expert matches", () => {
    const result = gate("COMPLETELY_UNKNOWN", "alien_domain");
    expect(result.activeExperts.length).toBe(DEFAULT_EXPERTS.length);
  });

  it("should support custom experts", () => {
    const custom: Expert[] = [
      { id: "security", pattern: "security", weights: { HALLUCINATION_RESISTANCE: 0.5, REASONING: 0.5 } },
    ];
    const result = gate("SECURITY_AUDIT", "security", custom);
    expect(result.weights.HALLUCINATION_RESISTANCE).toBeGreaterThan(0);
  });
});

// ================================================================
// toCapabilityRequirements
// ================================================================

describe("toCapabilityRequirements", () => {
  it("should convert gating result to sorted requirements", () => {
    const result = gate("CODE_WRITE", "coding");
    const reqs = toCapabilityRequirements(result);
    expect(reqs.length).toBeGreaterThan(0);
    // Should be sorted by weight descending
    for (let i = 1; i < reqs.length; i++) {
      expect(reqs[i - 1].weight).toBeGreaterThanOrEqual(reqs[i].weight);
    }
  });

  it("should filter out dimensions below minWeight", () => {
    const result = gate("CODE_WRITE", "coding");
    const reqs = toCapabilityRequirements(result, 0.2);
    for (const r of reqs) {
      expect(r.weight).toBeGreaterThanOrEqual(0.2);
    }
  });

  it("should return empty for no matching weights", () => {
    const result = gate("CODE_WRITE", "coding");
    const reqs = toCapabilityRequirements(result, 0.99);
    expect(reqs).toHaveLength(0);
  });
});
