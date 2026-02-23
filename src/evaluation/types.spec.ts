/**
 * Evaluation types — validation tests.
 */
import { describe, it, expect } from "bun:test";
import {
  validatePrompt,
  ALL_EVAL_DOMAINS,
  CRITERIA_KEYS,
  OUTCOME_SIGNAL,
  ALL_OUTCOMES,
  type EvalPrompt,
  type CriteriaScores,
} from "./types";

// -- Helper --

function makeCriteria(overrides: Partial<CriteriaScores> = {}): CriteriaScores {
  return {
    specificity: 3,
    domainKnowledge: 3,
    complexity: 3,
    problemSolving: 3,
    creativity: 3,
    technicalAccuracy: 3,
    realWorldApplication: 3,
    ...overrides,
  };
}

function makePrompt(overrides: Partial<EvalPrompt> = {}): EvalPrompt {
  return {
    id: "test-001",
    domain: "coding",
    difficulty: "moderate",
    text: "Write a function that reverses a linked list.",
    expectedDimensions: ["CODE_GENERATION"],
    criteria: makeCriteria(),
    verifiable: false,
    ...overrides,
  };
}

// ================================================================
// validatePrompt
// ================================================================

describe("validatePrompt", () => {
  it("should accept a valid prompt", () => {
    expect(validatePrompt(makePrompt())).toBeNull();
  });

  it("should accept verifiable prompt with referenceAnswer", () => {
    const p = makePrompt({
      verifiable: true,
      referenceAnswer: "function reverse(head) { ... }",
    });
    expect(validatePrompt(p)).toBeNull();
  });

  it("should reject empty text", () => {
    expect(validatePrompt(makePrompt({ text: "" }))).toBe("text is required");
    expect(validatePrompt(makePrompt({ text: "  " }))).toBe("text is required");
  });

  it("should reject empty id", () => {
    expect(validatePrompt(makePrompt({ id: "" }))).toBe("id is required");
  });

  it("should reject verifiable prompt without referenceAnswer", () => {
    const p = makePrompt({ verifiable: true, referenceAnswer: undefined });
    expect(validatePrompt(p)).toContain("referenceAnswer");
  });

  it("should reject empty expectedDimensions", () => {
    const p = makePrompt({ expectedDimensions: [] });
    expect(validatePrompt(p)).toContain("expectedDimensions");
  });

  it("should reject criteria outside 0-7 range", () => {
    const tooHigh = makePrompt({ criteria: makeCriteria({ complexity: 8 }) });
    expect(validatePrompt(tooHigh)).toContain("complexity");

    const tooLow = makePrompt({ criteria: makeCriteria({ specificity: -1 }) });
    expect(validatePrompt(tooLow)).toContain("specificity");
  });

  it("should reject invalid domain", () => {
    const p = makePrompt({ domain: "invalid" as any });
    expect(validatePrompt(p)).toContain("invalid domain");
  });

  it("should reject invalid difficulty", () => {
    const p = makePrompt({ difficulty: "extreme" as any });
    expect(validatePrompt(p)).toContain("invalid difficulty");
  });
});

// ================================================================
// Constants
// ================================================================

describe("evaluation constants", () => {
  it("should have 12 eval domains", () => {
    expect(ALL_EVAL_DOMAINS).toHaveLength(12);
  });

  it("should have 7 criteria keys", () => {
    expect(CRITERIA_KEYS).toHaveLength(7);
  });

  it("should have 5 outcomes with correct signals", () => {
    expect(ALL_OUTCOMES).toHaveLength(5);
    expect(OUTCOME_SIGNAL["A>>B"]).toBe(3.0);
    expect(OUTCOME_SIGNAL["A>B"]).toBe(1.0);
    expect(OUTCOME_SIGNAL["A=B"]).toBe(0.0);
    expect(OUTCOME_SIGNAL["B>A"]).toBe(-1.0);
    expect(OUTCOME_SIGNAL["B>>A"]).toBe(-3.0);
  });
});
