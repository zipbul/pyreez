/**
 * PromptRegistry tests.
 */
import { describe, it, expect } from "bun:test";
import { PromptRegistry } from "./prompts";
import type { EvalPrompt, CriteriaScores } from "./types";

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
    text: "Write a function",
    expectedDimensions: ["CODE_GENERATION"],
    criteria: makeCriteria(),
    verifiable: false,
    ...overrides,
  };
}

describe("PromptRegistry", () => {
  it("should register and retrieve a prompt by id", () => {
    const reg = new PromptRegistry();
    const p = makePrompt();
    reg.register(p);
    expect(reg.get("test-001")).toBe(p);
    expect(reg.size).toBe(1);
  });

  it("should throw on duplicate id", () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ id: "dup" }));
    expect(() => reg.register(makePrompt({ id: "dup" }))).toThrow("Duplicate");
  });

  it("should throw on invalid prompt", () => {
    const reg = new PromptRegistry();
    expect(() => reg.register(makePrompt({ text: "" }))).toThrow("Invalid");
  });

  it("should filter by domain", () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ id: "c1", domain: "coding" }));
    reg.register(makePrompt({ id: "m1", domain: "math" }));
    expect(reg.query({ domain: "coding" })).toHaveLength(1);
    expect(reg.query({ domain: "math" })).toHaveLength(1);
  });

  it("should filter by difficulty", () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ id: "s1", difficulty: "simple" }));
    reg.register(makePrompt({ id: "c1", difficulty: "complex" }));
    expect(reg.query({ difficulty: "simple" })).toHaveLength(1);
    expect(reg.query({ difficulty: "complex" })).toHaveLength(1);
  });

  it("should filter by dimension", () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ id: "cg", expectedDimensions: ["CODE_GENERATION"] }));
    reg.register(makePrompt({ id: "r", expectedDimensions: ["REASONING"] }));
    expect(reg.query({ dimension: "CODE_GENERATION" })).toHaveLength(1);
    expect(reg.query({ dimension: "REASONING" })).toHaveLength(1);
  });

  it("should return empty array for unmatched filter", () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ id: "c1", domain: "coding" }));
    expect(reg.query({ domain: "math" })).toHaveLength(0);
  });

  it("should support compound filter (domain + difficulty)", () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ id: "cs", domain: "coding", difficulty: "simple" }));
    reg.register(makePrompt({ id: "cc", domain: "coding", difficulty: "complex" }));
    reg.register(makePrompt({ id: "ms", domain: "math", difficulty: "simple" }));
    expect(reg.query({ domain: "coding", difficulty: "simple" })).toHaveLength(1);
  });

  it("should compute dimension coverage", () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ id: "a", expectedDimensions: ["CODE_GENERATION", "REASONING"] }));
    reg.register(makePrompt({ id: "b", expectedDimensions: ["REASONING", "MATH_REASONING"] }));
    const coverage = reg.dimensionCoverage();
    expect(coverage.size).toBe(3);
    expect(coverage.has("CODE_GENERATION")).toBe(true);
    expect(coverage.has("REASONING")).toBe(true);
    expect(coverage.has("MATH_REASONING")).toBe(true);
  });

  it("should compute domain stats", () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ id: "c1", domain: "coding", difficulty: "simple" }));
    reg.register(makePrompt({ id: "c2", domain: "coding", difficulty: "complex" }));
    reg.register(makePrompt({ id: "m1", domain: "math", difficulty: "simple" }));
    const stats = reg.domainStats();
    expect(stats).toHaveLength(2);
    const coding = stats.find((s) => s.domain === "coding")!;
    expect(coding.count).toBe(2);
    expect(coding.byDifficulty.simple).toBe(1);
    expect(coding.byDifficulty.complex).toBe(1);
  });

  it("should filter verifiable only", () => {
    const reg = new PromptRegistry();
    reg.register(makePrompt({ id: "v", verifiable: true, referenceAnswer: "42" }));
    reg.register(makePrompt({ id: "nv", verifiable: false }));
    expect(reg.query({ verifiableOnly: true })).toHaveLength(1);
    expect(reg.query({ verifiableOnly: true })[0].id).toBe("v");
  });
});
