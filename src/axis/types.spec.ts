import { describe, it, expect } from "bun:test";
import {
  getFailureSeverity,
  applyFailureSeverity,
  DIMENSION_WEIGHTS,
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

describe("DIMENSION_WEIGHTS", () => {
  it("should have equal weights for all dimensions", () => {
    for (const dim of BINARY_DIMENSIONS) {
      expect(DIMENSION_WEIGHTS[dim]).toBe(0.20);
    }
  });

  it("should sum to 1.0", () => {
    const sum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-6);
  });
});

describe("getFailureSeverity", () => {
  it("should return critical for hallucination", () => {
    expect(getFailureSeverity("hallucination")).toBe("critical");
  });

  it("should return warning for refusal", () => {
    expect(getFailureSeverity("refusal")).toBe("warning");
  });

  it("should return critical for off_topic", () => {
    expect(getFailureSeverity("off_topic")).toBe("critical");
  });

  it("should return critical for degenerate", () => {
    expect(getFailureSeverity("degenerate")).toBe("critical");
  });

  it("should return critical for unknown flags", () => {
    expect(getFailureSeverity("unknown_flag")).toBe("critical");
  });
});

describe("applyFailureSeverity", () => {
  it("should not modify dimensions when no failures", () => {
    const result = applyFailureSeverity(ALL_PASS, NO_FAILURES);
    expect(result).toEqual(ALL_PASS);
  });

  it("should override ALL dimensions to false on critical failure", () => {
    const failures: FailureFlags = { ...NO_FAILURES, hallucination: true };
    const result = applyFailureSeverity(ALL_PASS, failures);
    expect(result.factually_correct).toBe(false);
    expect(result.addresses_task).toBe(false);
    expect(result.provides_evidence).toBe(false);
    expect(result.novel_perspective).toBe(false);
    expect(result.internally_consistent).toBe(false);
  });

  it("should override only factually_correct on warning failure (refusal)", () => {
    const failures: FailureFlags = { ...NO_FAILURES, refusal: true };
    const result = applyFailureSeverity(ALL_PASS, failures);
    expect(result.factually_correct).toBe(false);
    expect(result.addresses_task).toBe(true);
    expect(result.provides_evidence).toBe(true);
    expect(result.novel_perspective).toBe(true);
    expect(result.internally_consistent).toBe(true);
  });

  it("should use worst severity when multiple failures present", () => {
    // hallucination=critical, refusal=warning → critical wins
    const failures: FailureFlags = { hallucination: true, refusal: true, off_topic: false, degenerate: false };
    const result = applyFailureSeverity(ALL_PASS, failures);
    // hallucination is critical → all false
    expect(result.factually_correct).toBe(false);
    expect(result.addresses_task).toBe(false);
  });

  it("should short-circuit on critical even with warning flags", () => {
    // off_topic=critical, refusal=warning
    const failures: FailureFlags = { hallucination: false, refusal: true, off_topic: true, degenerate: false };
    const result = applyFailureSeverity(ALL_PASS, failures);
    // off_topic is critical → all false
    expect(result.factually_correct).toBe(false);
    expect(result.addresses_task).toBe(false);
    expect(result.novel_perspective).toBe(false);
  });

  it("should handle multiple warning flags", () => {
    // refusal=warning is the only warning flag; others are critical
    const failures: FailureFlags = { hallucination: false, refusal: true, off_topic: false, degenerate: false };
    const result = applyFailureSeverity(ALL_PASS, failures);
    expect(result.factually_correct).toBe(false);
    expect(result.addresses_task).toBe(true); // only factual overridden
  });
});
