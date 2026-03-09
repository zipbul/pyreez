/**
 * Unit tests — Synthesis Structural Validator.
 *
 * SUT: validateSynthesisStructure, buildRetryHint
 */

import { describe, it, expect } from "bun:test";
import { validateSynthesisStructure, buildRetryHint } from "./synthesis-validator";

// -- Fixture: well-formed synthesis --

const VALID_SYNTHESIS = `## Premise Check
The question is well-framed. We are solving the right problem.

## Per-Worker Analysis

### Worker 1
**Adopted Strengths**: Strong architectural reasoning.
**Weakness Reexamination**: The concern about scalability is actually an unexplored angle worth investigating.
**Self-Doubt Review**: Valid concern about edge cases.

### Worker 2
**Adopted Strengths**: Excellent security analysis.
**Weakness Reexamination**: The performance trade-off is a real flaw, not an unexplored angle.
**Self-Doubt Review**: Over-cautious about backward compatibility.

## Ideas from Weaknesses (max 2)
1. Use worker 1's scalability concern to design a progressive loading strategy.
2. Combine the performance trade-off with a lazy evaluation approach.

## Synthesis
The integrated solution combines worker 1's architecture with worker 2's security model, enhanced by progressive loading.`;

describe("validateSynthesisStructure", () => {
  it("should return valid for a well-formed synthesis", () => {
    const result = validateSynthesisStructure(VALID_SYNTHESIS, 2);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("should detect missing Premise Check section", () => {
    const content = VALID_SYNTHESIS.replace("## Premise Check", "## Something Else");
    const result = validateSynthesisStructure(content, 2);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("## Premise Check");
  });

  it("should detect missing Per-Worker Analysis section", () => {
    const content = VALID_SYNTHESIS.replace("## Per-Worker Analysis", "## Worker Notes");
    const result = validateSynthesisStructure(content, 2);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("## Per-Worker Analysis");
  });

  it("should detect missing Ideas from Weaknesses section", () => {
    const content = VALID_SYNTHESIS.replace("## Ideas from Weaknesses", "## Extra Ideas");
    const result = validateSynthesisStructure(content, 2);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("## Ideas from Weaknesses");
  });

  it("should detect missing Synthesis section", () => {
    const content = VALID_SYNTHESIS.replace("## Synthesis", "## Conclusion");
    const result = validateSynthesisStructure(content, 2);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("## Synthesis");
  });

  it("should detect insufficient per-worker Adopted Strengths", () => {
    // Remove one worker's Adopted Strengths
    const content = VALID_SYNTHESIS.replace(
      "**Adopted Strengths**: Excellent security analysis.",
      "**Key Points**: Excellent security analysis.",
    );
    const result = validateSynthesisStructure(content, 2);
    expect(result.valid).toBe(false);
    expect(result.missing.some((m) => m.includes("Adopted Strengths") && m.includes("1/2"))).toBe(true);
  });

  it("should detect insufficient per-worker Weakness Reexamination", () => {
    // Remove both Weakness Reexamination entries
    const content = VALID_SYNTHESIS
      .replace("**Weakness Reexamination**: The concern about scalability", "**Issues**: The concern about scalability")
      .replace("**Weakness Reexamination**: The performance trade-off", "**Issues**: The performance trade-off");
    const result = validateSynthesisStructure(content, 2);
    expect(result.valid).toBe(false);
    expect(result.missing.some((m) => m.includes("Weakness Reexamination") && m.includes("0/2"))).toBe(true);
  });

  it("should warn on more than 2 ideas from weaknesses (padding)", () => {
    const padded = VALID_SYNTHESIS.replace(
      "## Ideas from Weaknesses (max 2)\n" +
      "1. Use worker 1's scalability concern to design a progressive loading strategy.\n" +
      "2. Combine the performance trade-off with a lazy evaluation approach.",
      "## Ideas from Weaknesses (max 2)\n" +
      "1. Idea one.\n" +
      "2. Idea two.\n" +
      "3. Idea three.",
    );
    const result = validateSynthesisStructure(padded, 2);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]).toContain("padding");
  });

  it("should not warn when ideas count is at or below 2", () => {
    const result = validateSynthesisStructure(VALID_SYNTHESIS, 2);
    expect(result.warnings).toEqual([]);
  });

  it("should handle empty content gracefully", () => {
    const result = validateSynthesisStructure("", 2);
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBeGreaterThanOrEqual(4);
  });

  it("should report multiple missing sections simultaneously", () => {
    const result = validateSynthesisStructure("Just some text with no sections.", 3);
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBe(4); // all 4 top-level sections
  });

  it("should skip validation and return valid for artifact taskNature", () => {
    const result = validateSynthesisStructure("Just raw code output", 2, "artifact");
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("should still validate for critique taskNature", () => {
    const result = validateSynthesisStructure("No sections here", 2, "critique");
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBeGreaterThanOrEqual(4);
  });

  it("should still validate when taskNature is undefined (backward compat)", () => {
    const result = validateSynthesisStructure("No sections here", 2);
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBeGreaterThanOrEqual(4);
  });
});

describe("buildRetryHint", () => {
  it("should include all missing section names in the hint", () => {
    const hint = buildRetryHint(["## Premise Check", "## Synthesis"]);
    expect(hint).toContain("## Premise Check");
    expect(hint).toContain("## Synthesis");
    expect(hint).toContain("STRUCTURAL REQUIREMENT");
  });
});
