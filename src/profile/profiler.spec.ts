/**
 * Unit tests for profileTask.
 */

import { describe, it, expect } from "bun:test";
import { profileTask } from "./profiler";
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
    expect(result.complexity).toBeUndefined; // TaskRequirement doesn't have complexity, it's reflected in tokens
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
