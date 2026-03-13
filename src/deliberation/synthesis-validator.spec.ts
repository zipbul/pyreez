/**
 * Unit tests — Synthesis Structural Validator (XML tag-based).
 *
 * SUT: validateSynthesisStructure, buildRetryHint
 */

import { describe, it, expect } from "bun:test";
import { validateSynthesisStructure, buildRetryHint, REQUIRED_XML_TAGS } from "./synthesis-validator";

// -- Fixture: well-formed XML synthesis --

const VALID_SYNTHESIS = `<synthesis>
  <verification>
  Worker 1 claims O(n log n) is optimal — substantiated by comparison-based lower bound theorem.
  Worker 2 claims hash map approach is O(n) — speculative, depends on hash collision rate.
  </verification>
  <adopted>
  Adopted Worker 1's comparison sort analysis and improved by adding amortized analysis.
  Adopted Worker 2's practical API design and improved by adding type safety.
  </adopted>
  <novel>
  1. Hybrid approach: use hash-based pre-filter then comparison sort for remaining elements.
  None.
  </novel>
  <result>
  The integrated solution uses a comparison-based sort with hash pre-filtering for near-sorted inputs.
  </result>
</synthesis>`;

describe("validateSynthesisStructure", () => {
  it("should return valid for a well-formed XML synthesis", () => {
    const result = validateSynthesisStructure(VALID_SYNTHESIS);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("should detect missing <verification> tag", () => {
    const content = VALID_SYNTHESIS.replace("<verification>", "<verify>").replace("</verification>", "</verify>");
    const result = validateSynthesisStructure(content);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("<verification>");
  });

  it("should detect missing <adopted> tag", () => {
    const content = VALID_SYNTHESIS.replace("<adopted>", "<strengths>").replace("</adopted>", "</strengths>");
    const result = validateSynthesisStructure(content);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("<adopted>");
  });

  it("should detect missing <result> tag", () => {
    const content = VALID_SYNTHESIS.replace("<result>", "<conclusion>").replace("</result>", "</conclusion>");
    const result = validateSynthesisStructure(content);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("<result>");
  });

  it("should detect missing <novel> tag", () => {
    const content = VALID_SYNTHESIS.replace("<novel>", "<ideas>").replace("</novel>", "</ideas>");
    const result = validateSynthesisStructure(content);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("<novel>");
  });

  it("should handle empty content gracefully", () => {
    const result = validateSynthesisStructure("");
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBe(4); // verification, adopted, novel, result
  });

  it("should report multiple missing tags simultaneously", () => {
    const result = validateSynthesisStructure("Just some text with no XML tags.");
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBe(4);
  });

  it("should return valid for empty tags array (skip validation)", () => {
    const result = validateSynthesisStructure("Just raw code output", []);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("should validate against provided tags", () => {
    const result = validateSynthesisStructure("No tags here", ["verification", "adopted", "novel", "result"]);
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBe(4);
  });

  it("should use default REQUIRED_XML_TAGS when tags is undefined", () => {
    const result = validateSynthesisStructure("No tags here");
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBe(REQUIRED_XML_TAGS.length);
  });

  it("should validate against custom subset of tags", () => {
    const content = "<foo>bar</foo>";
    const result = validateSynthesisStructure(content, ["foo"]);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });
});

describe("buildRetryHint", () => {
  it("should include all missing tag names in the hint", () => {
    const hint = buildRetryHint(["<verification>", "<result>"]);
    expect(hint).toContain("<verification>");
    expect(hint).toContain("<result>");
    expect(hint).toContain("STRUCTURAL REQUIREMENT");
  });
});
