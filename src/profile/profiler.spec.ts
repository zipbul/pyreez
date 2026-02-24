/**
 * Unit tests for profileTask.
 */

import { describe, it, expect } from "bun:test";
import { profileTask, nonLatinRatio, NON_LATIN_TOKEN_EXPANSION } from "./profiler";
import type { ClassifyResult } from "../classify/types";
import type { TaskRequirement } from "./types";

// -- Helpers --

function makeClassifyResult(
  overrides: Partial<ClassifyResult> = {},
): ClassifyResult {
  return {
    domain: "CODING",
    taskType: "IMPLEMENT_FEATURE",
    complexity: "moderate",
    criticality: "medium",
    method: "rule",
    ...overrides,
  };
}

function weightOf(
  req: TaskRequirement,
  dimension: string,
): number | undefined {
  const cap = req.requiredCapabilities.find((c) => c.dimension === dimension);
  return cap?.weight;
}

describe("profileTask", () => {
  // -- HP: domain defaults --

  it("should return IDEATION domain default weights for BRAINSTORM", () => {
    // Arrange
    const input = makeClassifyResult({
      domain: "IDEATION",
      taskType: "BRAINSTORM",
    });

    // Act
    const result = profileTask(input, "브레인스토밍 해줘");

    // Assert
    expect(weightOf(result, "CREATIVITY")).toBe(0.3);
    expect(weightOf(result, "ANALYSIS")).toBe(0.25);
    expect(weightOf(result, "REASONING")).toBe(0.2);
  });

  it("should return CODING domain default weights for IMPLEMENT_FEATURE", () => {
    // Arrange
    const input = makeClassifyResult({
      domain: "CODING",
      taskType: "IMPLEMENT_FEATURE",
    });

    // Act
    const result = profileTask(input, "implement a feature");

    // Assert
    expect(weightOf(result, "CODE_GENERATION")).toBeGreaterThan(0);
    expect(weightOf(result, "REASONING")).toBeGreaterThan(0);
    expect(result.domain).toBe("CODING");
    expect(result.taskType).toBe("IMPLEMENT_FEATURE");
  });

  it("should return COMMUNICATION domain default weights for EXPLAIN", () => {
    // Arrange
    const input = makeClassifyResult({
      domain: "COMMUNICATION",
      taskType: "EXPLAIN",
    });

    // Act
    const result = profileTask(input, "explain this code");

    // Assert
    expect(result.requiredCapabilities.length).toBeGreaterThan(0);
    expect(result.domain).toBe("COMMUNICATION");
  });

  // -- HP: task type overrides --

  it("should return FEASIBILITY_QUICK override with JUDGMENT and REASONING weights", () => {
    // Arrange
    const input = makeClassifyResult({
      domain: "IDEATION",
      taskType: "FEASIBILITY_QUICK",
    });

    // Act
    const result = profileTask(input, "실현 가능성 검토");

    // Assert
    expect(weightOf(result, "JUDGMENT")).toBe(0.25);
    expect(weightOf(result, "REASONING")).toBe(0.3);
    expect(weightOf(result, "CREATIVITY")).toBe(0.1);
  });

  it("should return IMPLEMENT_ALGORITHM override with CODE_GENERATION=0.35", () => {
    // Arrange
    const input = makeClassifyResult({
      domain: "CODING",
      taskType: "IMPLEMENT_ALGORITHM",
    });

    // Act
    const result = profileTask(input, "implement sorting algorithm");

    // Assert
    expect(weightOf(result, "CODE_GENERATION")).toBe(0.35);
    expect(weightOf(result, "REASONING")).toBe(0.3);
    expect(weightOf(result, "MATH_REASONING")).toBe(0.2);
  });

  it("should return TRANSLATE override with MULTILINGUAL=0.40", () => {
    // Arrange
    const input = makeClassifyResult({
      domain: "COMMUNICATION",
      taskType: "TRANSLATE",
    });

    // Act
    const result = profileTask(input, "번역 해줘");

    // Assert
    expect(weightOf(result, "MULTILINGUAL")).toBe(0.4);
    expect(weightOf(result, "INSTRUCTION_FOLLOWING")).toBe(0.3);
    expect(weightOf(result, "HALLUCINATION_RESISTANCE")).toBe(0.2);
  });

  // -- HP: complexity → token estimates --

  it('should return low token estimates for complexity="simple"', () => {
    // Arrange
    const input = makeClassifyResult({ complexity: "simple" });

    // Act
    const result = profileTask(input, "간단한 작업");

    // Assert
    expect(result.estimatedInputTokens).toBeLessThan(1000);
    expect(result.estimatedOutputTokens).toBeLessThan(500);
  });

  it('should return medium token estimates for complexity="moderate"', () => {
    // Arrange
    const input = makeClassifyResult({ complexity: "moderate" });

    // Act
    const result = profileTask(input, "중간 수준 작업");

    // Assert
    expect(result.estimatedInputTokens).toBeGreaterThanOrEqual(1000);
    expect(result.estimatedInputTokens).toBeLessThan(5000);
  });

  it('should return high token estimates for complexity="complex"', () => {
    // Arrange
    const input = makeClassifyResult({ complexity: "complex" });

    // Act
    const result = profileTask(input, "복잡한 작업");

    // Assert
    expect(result.estimatedInputTokens).toBeGreaterThanOrEqual(5000);
    expect(result.estimatedOutputTokens).toBeGreaterThanOrEqual(2000);
  });

  // -- HP: Korean detection --

  it("should set requiresKorean=true for Korean prompt", () => {
    // Arrange
    const input = makeClassifyResult();

    // Act
    const result = profileTask(input, "한국어 프롬프트입니다");

    // Assert
    expect(result.requiresKorean).toBe(true);
  });

  it("should set requiresKorean=false for English prompt", () => {
    // Arrange
    const input = makeClassifyResult();

    // Act
    const result = profileTask(input, "this is an English prompt");

    // Assert
    expect(result.requiresKorean).toBe(false);
  });

  // -- HP: structured output flag --

  it("should set requiresStructuredOutput=true for REQUIREMENT_STRUCTURING", () => {
    // Arrange
    const input = makeClassifyResult({
      domain: "REQUIREMENTS",
      taskType: "REQUIREMENT_STRUCTURING",
    });

    // Act
    const result = profileTask(input, "요구사항 구조화");

    // Assert
    expect(result.requiresStructuredOutput).toBe(true);
  });

  // -- HP: tool calling flag --

  it("should set requiresToolCalling=true for CI_CD_CONFIG", () => {
    // Arrange
    const input = makeClassifyResult({
      domain: "OPERATIONS",
      taskType: "CI_CD_CONFIG",
    });

    // Act
    const result = profileTask(input, "CI/CD 설정");

    // Assert
    expect(result.requiresToolCalling).toBe(true);
  });

  // -- NE: fallback to domain default --

  it("should use domain default when taskType has no override", () => {
    // Arrange — SCAFFOLD has no task-level override
    const input = makeClassifyResult({
      domain: "CODING",
      taskType: "SCAFFOLD",
    });

    // Act
    const result = profileTask(input, "scaffold a project");

    // Assert — same as CODING domain default
    const featureResult = profileTask(
      makeClassifyResult({
        domain: "CODING",
        taskType: "IMPLEMENT_FEATURE",
      }),
      "implement feature",
    );
    expect(weightOf(result, "CODE_GENERATION")).toBe(
      weightOf(featureResult, "CODE_GENERATION"),
    );
  });

  // -- CO: all flags active --

  it("should handle override + complex + Korean + structuredOutput + toolCalling", () => {
    // Arrange — TRANSLATE override + complex + Korean
    const input = makeClassifyResult({
      domain: "COMMUNICATION",
      taskType: "TRANSLATE",
      complexity: "complex",
    });

    // Act
    const result = profileTask(input, "이 문서를 영어로 번역해주세요");

    // Assert
    expect(weightOf(result, "MULTILINGUAL")).toBe(0.4);
    expect(result.requiresKorean).toBe(true);
    expect(result.estimatedInputTokens).toBeGreaterThanOrEqual(5000);
    expect((result as any).complexity).toBeUndefined(); // TaskRequirement doesn't have complexity, it's reflected in tokens
  });

  // -- CO: minimal flags --

  it("should handle domain default + simple + English + no flags", () => {
    // Arrange
    const input = makeClassifyResult({
      domain: "IDEATION",
      taskType: "BRAINSTORM",
      complexity: "simple",
    });

    // Act
    const result = profileTask(input, "brainstorm ideas");

    // Assert
    expect(result.requiresKorean).toBe(false);
    expect(result.requiresStructuredOutput).toBe(false);
    expect(result.requiresToolCalling).toBe(false);
    expect(result.estimatedInputTokens).toBeLessThan(1000);
  });

  // -- ID: idempotency --

  it("should return identical result for same input on repeated calls", () => {
    // Arrange
    const input = makeClassifyResult();
    const prompt = "implement feature";

    // Act
    const result1 = profileTask(input, prompt);
    const result2 = profileTask(input, prompt);

    // Assert
    expect(result1).toEqual(result2);
  });

  // -- ED: fallback branch for unrecognized complexity --

  it("should fallback to moderate tokens when complexity is unrecognized", () => {
    // Arrange — complexity value not in COMPLEXITY_TOKENS map
    const input = makeClassifyResult({
      complexity: "unknown" as any,
    });

    // Act
    const result = profileTask(input, "test prompt");

    // Assert — moderate = { input: 2000, output: 1000 }
    expect(result.estimatedInputTokens).toBe(2000);
    expect(result.estimatedOutputTokens).toBe(1000);
  });
});

// -- nonLatinRatio unit tests --

describe("nonLatinRatio", () => {
  // -- HP --

  it("should return ~1.0 for fully Korean text", () => {
    // Arrange
    const text = "한국어입니다";

    // Act
    const ratio = nonLatinRatio(text);

    // Assert
    expect(ratio).toBeCloseTo(1.0, 1);
  });

  it("should return 0.0 for fully English text", () => {
    // Arrange
    const text = "hello world";

    // Act
    const ratio = nonLatinRatio(text);

    // Assert
    expect(ratio).toBe(0);
  });

  it("should return ratio between 0 and 1 for mixed text", () => {
    // Arrange — 2 non-Latin + 5 ASCII = "안녕hello"
    const text = "안녕hello";

    // Act
    const ratio = nonLatinRatio(text);

    // Assert
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeCloseTo(2 / 7, 2);
  });

  it("should count Korean jamo characters as non-Latin", () => {
    // Arrange — ㅎㅎㅎ (compatibility jamo \u3130-\u318F range)
    const text = "ㅎㅎㅎ";

    // Act
    const ratio = nonLatinRatio(text);

    // Assert
    expect(ratio).toBeCloseTo(1.0, 1);
  });

  it("should return ~1.0 for CJK Chinese text", () => {
    // Arrange
    const text = "你好世界";

    // Act
    const ratio = nonLatinRatio(text);

    // Assert
    expect(ratio).toBeCloseTo(1.0, 1);
  });

  it("should return ~1.0 for Japanese hiragana text", () => {
    // Arrange
    const text = "こんにちは";

    // Act
    const ratio = nonLatinRatio(text);

    // Assert
    expect(ratio).toBeCloseTo(1.0, 1);
  });

  it("should return ~1.0 for Arabic text", () => {
    // Arrange
    const text = "مرحبا";

    // Act
    const ratio = nonLatinRatio(text);

    // Assert
    expect(ratio).toBeCloseTo(1.0, 1);
  });

  // -- NE --

  it("should return 0.0 for empty string", () => {
    // Arrange / Act
    const ratio = nonLatinRatio("");

    // Assert
    expect(ratio).toBe(0);
  });

  it("should return 0.0 for whitespace-only text", () => {
    // Arrange / Act
    const ratio = nonLatinRatio("   ");

    // Assert
    expect(ratio).toBe(0);
  });

  it("should return 0.0 for special characters only", () => {
    // Arrange / Act
    const ratio = nonLatinRatio("!@#$%^&*()");

    // Assert
    expect(ratio).toBe(0);
  });

  // -- ED --

  it("should return 1.0 for single emoji", () => {
    // Arrange — emoji is non-ASCII (code point > 0x7F)
    const text = "🎉";

    // Act
    const ratio = nonLatinRatio(text);

    // Assert
    expect(ratio).toBe(1.0);
  });

  it("should return 0.0 for ASCII tilde \\x7E", () => {
    // Arrange — \x7E = "~", last ASCII printable character
    const text = "~";

    // Act
    const ratio = nonLatinRatio(text);

    // Assert
    expect(ratio).toBe(0);
  });

  it("should return 1.0 for first non-ASCII \\x80", () => {
    // Arrange — \x80 = first character above ASCII range
    const text = "\x80";

    // Act
    const ratio = nonLatinRatio(text);

    // Assert
    expect(ratio).toBe(1.0);
  });

  it("should return partial ratio for accented Latin text", () => {
    // Arrange — "caf\u00E9" = 3 ASCII + 1 non-ASCII (\u00E9)
    const text = "caf\u00e9";

    // Act
    const ratio = nonLatinRatio(text);

    // Assert
    expect(ratio).toBeCloseTo(1 / 4, 2);
  });

  it("should recognize start of Korean unicode range \\uAC00", () => {
    // Arrange — \uAC00 = "가", non-ASCII = non-Latin
    const text = "\uAC00";

    // Act
    const ratio = nonLatinRatio(text);

    // Assert
    expect(ratio).toBe(1.0);
  });
});

// -- profileTask non-Latin token expansion tests --

describe("profileTask (non-Latin token expansion)", () => {
  // -- HP --

  it("should expand tokens for Korean prompt with simple complexity", () => {
    // Arrange — simple base: input=500, output=200
    const input = makeClassifyResult({ complexity: "simple" });
    const prompt = "간단한 작업을 해주세요";

    // Act
    const result = profileTask(input, prompt);

    // Assert — tokens should be greater than base due to expansion
    expect(result.estimatedInputTokens).toBeGreaterThan(500);
    expect(result.estimatedOutputTokens).toBeGreaterThan(200);
    expect(result.requiresKorean).toBe(true);
  });

  it("should expand tokens for Korean prompt with moderate complexity", () => {
    // Arrange — moderate base: input=2000, output=1000
    const input = makeClassifyResult({ complexity: "moderate" });
    const prompt = "중간 수준의 작업입니다";

    // Act
    const result = profileTask(input, prompt);

    // Assert
    expect(result.estimatedInputTokens).toBeGreaterThan(2000);
    expect(result.estimatedOutputTokens).toBeGreaterThan(1000);
  });

  it("should expand tokens for Korean prompt with complex complexity", () => {
    // Arrange — complex base: input=8000, output=4000
    const input = makeClassifyResult({ complexity: "complex" });
    const prompt = "복잡한 작업을 수행해주세요";

    // Act
    const result = profileTask(input, prompt);

    // Assert
    expect(result.estimatedInputTokens).toBeGreaterThan(8000);
    expect(result.estimatedOutputTokens).toBeGreaterThan(4000);
  });

  it("should not expand tokens for English-only prompt", () => {
    // Arrange
    const input = makeClassifyResult({ complexity: "moderate" });
    const prompt = "implement a feature in TypeScript";

    // Act
    const result = profileTask(input, prompt);

    // Assert — exact base values, no expansion
    expect(result.estimatedInputTokens).toBe(2000);
    expect(result.estimatedOutputTokens).toBe(1000);
    expect(result.requiresKorean).toBe(false);
  });

  it("should partially expand tokens for mixed Korean-English prompt", () => {
    // Arrange — mixed text, ratio between 0 and 1
    const input = makeClassifyResult({ complexity: "moderate" });
    const prompt = "안녕 implement this feature";

    // Act
    const result = profileTask(input, prompt);

    // Assert — expanded but less than full non-Latin expansion
    const fullNonLatinInput = Math.ceil(2000 * NON_LATIN_TOKEN_EXPANSION);
    expect(result.estimatedInputTokens).toBeGreaterThan(2000);
    expect(result.estimatedInputTokens).toBeLessThan(fullNonLatinInput);
  });

  it("should expand tokens for CJK Chinese prompt", () => {
    // Arrange — Chinese text is non-Latin, should expand
    const input = makeClassifyResult({ complexity: "moderate" });
    const prompt = "请实现这个功能";

    // Act
    const result = profileTask(input, prompt);

    // Assert
    expect(result.estimatedInputTokens).toBeGreaterThan(2000);
    expect(result.estimatedOutputTokens).toBeGreaterThan(1000);
  });

  it("should expand tokens for emoji-only prompt", () => {
    // Arrange — emoji is non-Latin (code point > 0x7F)
    const input = makeClassifyResult({ complexity: "simple" });
    const prompt = "🎉🚀🔥";

    // Act
    const result = profileTask(input, prompt);

    // Assert
    expect(result.estimatedInputTokens).toBeGreaterThan(500);
    expect(result.estimatedOutputTokens).toBeGreaterThan(200);
  });

  // -- CO --

  it("should not expand tokens when prompt is empty", () => {
    // Arrange
    const input = makeClassifyResult({ complexity: "moderate" });
    const prompt = "";

    // Act
    const result = profileTask(input, prompt);

    // Assert — empty prompt → ratio=0 → no expansion
    expect(result.estimatedInputTokens).toBe(2000);
    expect(result.estimatedOutputTokens).toBe(1000);
  });

  it("should expand tokens with fallback moderate when complexity is unrecognized and prompt is non-Latin", () => {
    // Arrange — unrecognized complexity → fallback to moderate (2000/1000)
    const input = makeClassifyResult({ complexity: "unknown" as any });
    const prompt = "한국어 프롬프트입니다";

    // Act
    const result = profileTask(input, prompt);

    // Assert — moderate base (2000/1000) + non-Latin expansion
    expect(result.estimatedInputTokens).toBeGreaterThan(2000);
    expect(result.estimatedOutputTokens).toBeGreaterThan(1000);
  });
});
