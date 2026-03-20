import { describe, it, expect } from "bun:test";
import {
  getFailureSeverity,
  applyFailureSeverity,
  getDomainWeights,
  DOMAIN_DIMENSION_WEIGHTS,
  BINARY_DIMENSIONS,
  type BinaryDimensions,
  type FailureFlags,
} from "./types";

const ALL_PASS: BinaryDimensions = {
  factually_correct: true,
  addresses_task: true,
  provides_evidence: true,
  novel_perspective: true,
  internally_consistent: true,
};

const NO_FAILURES: FailureFlags = {
  hallucination: false,
  refusal: false,
  off_topic: false,
  degenerate: false,
};

describe("getDomainWeights", () => {
  it("should return domain-specific weights for known domains", () => {
    const w = getDomainWeights("IDEATION");
    expect(w["novel_perspective"]).toBe(0.40);
    expect(w["factually_correct"]).toBe(0.10);
  });

  it("should return equal weights for unknown domains", () => {
    const w = getDomainWeights("NONEXISTENT");
    for (const dim of BINARY_DIMENSIONS) {
      expect(w[dim]).toBe(0.20);
    }
  });

  it("should sum to 1.0 for every domain", () => {
    for (const [_domain, weights] of Object.entries(DOMAIN_DIMENSION_WEIGHTS)) {
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-6);
    }
  });

  it("should have weights for all 12 domains", () => {
    const domains = [
      "IDEATION", "PLANNING", "REQUIREMENTS", "ARCHITECTURE",
      "CODING", "TESTING", "REVIEW", "DOCUMENTATION",
      "DEBUGGING", "OPERATIONS", "RESEARCH", "COMMUNICATION",
    ];
    for (const d of domains) {
      expect(DOMAIN_DIMENSION_WEIGHTS[d]).toBeDefined();
    }
  });
});

describe("getFailureSeverity", () => {
  it("should return neutral for IDEATION hallucination", () => {
    expect(getFailureSeverity("IDEATION", "hallucination")).toBe("neutral");
  });

  it("should return warning for PLANNING hallucination", () => {
    expect(getFailureSeverity("PLANNING", "hallucination")).toBe("warning");
  });

  it("should return warning for DOCUMENTATION hallucination", () => {
    expect(getFailureSeverity("DOCUMENTATION", "hallucination")).toBe("warning");
  });

  it("should return warning for COMMUNICATION hallucination", () => {
    expect(getFailureSeverity("COMMUNICATION", "hallucination")).toBe("warning");
  });

  it("should return warning for COMMUNICATION refusal", () => {
    expect(getFailureSeverity("COMMUNICATION", "refusal")).toBe("warning");
  });

  it("should return critical for unlisted combinations", () => {
    expect(getFailureSeverity("CODING", "hallucination")).toBe("critical");
    expect(getFailureSeverity("REVIEW", "refusal")).toBe("critical");
    expect(getFailureSeverity("IDEATION", "off_topic")).toBe("critical");
    expect(getFailureSeverity("IDEATION", "degenerate")).toBe("critical");
  });
});

describe("applyFailureSeverity", () => {
  it("should not modify dimensions when no failures", () => {
    const result = applyFailureSeverity("CODING", ALL_PASS, NO_FAILURES);
    expect(result).toEqual(ALL_PASS);
  });

  it("should override ALL dimensions to false on critical failure", () => {
    const failures: FailureFlags = { ...NO_FAILURES, hallucination: true };
    const result = applyFailureSeverity("CODING", ALL_PASS, failures);
    expect(result.factually_correct).toBe(false);
    expect(result.addresses_task).toBe(false);
    expect(result.provides_evidence).toBe(false);
    expect(result.novel_perspective).toBe(false);
    expect(result.internally_consistent).toBe(false);
  });

  it("should override only factually_correct on warning failure", () => {
    const failures: FailureFlags = { ...NO_FAILURES, hallucination: true };
    const result = applyFailureSeverity("PLANNING", ALL_PASS, failures);
    expect(result.factually_correct).toBe(false);
    expect(result.addresses_task).toBe(true);
    expect(result.provides_evidence).toBe(true);
    expect(result.novel_perspective).toBe(true);
    expect(result.internally_consistent).toBe(true);
  });

  it("should not modify dimensions on neutral failure (IDEATION hallucination)", () => {
    const failures: FailureFlags = { ...NO_FAILURES, hallucination: true };
    const result = applyFailureSeverity("IDEATION", ALL_PASS, failures);
    expect(result).toEqual(ALL_PASS);
  });

  it("should use worst severity when multiple failures present", () => {
    // COMMUNICATION: hallucination=warning, off_topic=critical
    const failures: FailureFlags = { hallucination: true, refusal: false, off_topic: true, degenerate: false };
    const result = applyFailureSeverity("COMMUNICATION", ALL_PASS, failures);
    // off_topic is critical → all false
    expect(result.factually_correct).toBe(false);
    expect(result.addresses_task).toBe(false);
  });

  it("should short-circuit on critical even when another flag is neutral (IDEATION)", () => {
    // IDEATION: hallucination=neutral, off_topic=critical
    const failures: FailureFlags = { hallucination: true, refusal: false, off_topic: true, degenerate: false };
    const result = applyFailureSeverity("IDEATION", ALL_PASS, failures);
    // off_topic is critical → all false, despite hallucination being neutral
    expect(result.factually_correct).toBe(false);
    expect(result.addresses_task).toBe(false);
    expect(result.novel_perspective).toBe(false);
  });

  it("should handle warning + neutral (worst = warning)", () => {
    // IDEATION: hallucination=neutral, refusal=critical. But refusal is false.
    // Use COMMUNICATION: hallucination=warning, refusal=warning
    const failures: FailureFlags = { hallucination: true, refusal: true, off_topic: false, degenerate: false };
    const result = applyFailureSeverity("COMMUNICATION", ALL_PASS, failures);
    expect(result.factually_correct).toBe(false);
    expect(result.addresses_task).toBe(true); // only factual overridden
  });
});
