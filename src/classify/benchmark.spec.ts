/**
 * Unit tests for runBenchmark.
 */

import { describe, it, expect } from "bun:test";
import {
  runBenchmark,
  SEED_CASES,
  type BenchmarkCase,
  type BenchmarkResult,
  type ClassifyFn,
} from "./benchmark";
import type { ClassifyResult } from "./types";
import { classifyByRules } from "./classifier";

// -- Helpers --

/** Stub classify that returns a fixed result for any prompt. */
function stubClassify(result: ClassifyResult | null): ClassifyFn {
  return () => result;
}

/** Convenience: build a ClassifyResult. */
function makeResult(
  domain: string,
  taskType: string,
  complexity: ClassifyResult["complexity"] = "simple",
  criticality: ClassifyResult["criticality"] = "medium",
): ClassifyResult {
  return {
    domain: domain as ClassifyResult["domain"],
    taskType: taskType as ClassifyResult["taskType"],
    complexity,
    criticality,
    method: "rule",
  };
}

/** Convenience: build a BenchmarkCase. */
function makeCase(
  prompt: string,
  domain: string,
  taskType: string,
  complexity?: ClassifyResult["complexity"],
  criticality?: ClassifyResult["criticality"],
): BenchmarkCase {
  return {
    prompt,
    expected: {
      domain: domain as BenchmarkCase["expected"]["domain"],
      taskType: taskType as BenchmarkCase["expected"]["taskType"],
      ...(complexity !== undefined ? { complexity } : {}),
      ...(criticality !== undefined ? { criticality } : {}),
    },
  };
}

describe("runBenchmark", () => {
  // 1. [ED] should return zero totals for empty cases array
  it("should return zero totals for empty cases array", () => {
    // Arrange
    const cases: BenchmarkCase[] = [];
    const classify = stubClassify(null);

    // Act
    const result = runBenchmark(cases, classify);

    // Assert
    expect(result.total).toBe(0);
    expect(result.correct).toBe(0);
    expect(result.accuracy).toBe(0);
    expect(result.misclassified).toEqual([]);
    expect(Object.keys(result.domainAccuracy)).toHaveLength(0);
  });

  // 2. [HP] should count single correct case with accuracy 1.0
  it("should count single correct case with accuracy 1.0", () => {
    // Arrange
    const cases = [makeCase("구현해줘", "CODING", "IMPLEMENT_FEATURE")];
    const classify = stubClassify(makeResult("CODING", "IMPLEMENT_FEATURE"));

    // Act
    const result = runBenchmark(cases, classify);

    // Assert
    expect(result.total).toBe(1);
    expect(result.correct).toBe(1);
    expect(result.accuracy).toBe(1.0);
    expect(result.misclassified).toHaveLength(0);
  });

  // 3. [HP] should track per-domain accuracy for multiple domains
  it("should track per-domain accuracy for multiple domains", () => {
    // Arrange
    const cases = [
      makeCase("구현", "CODING", "IMPLEMENT_FEATURE"),
      makeCase("테스트", "TESTING", "UNIT_TEST_WRITE"),
      makeCase("리뷰", "REVIEW", "CODE_REVIEW"),
    ];
    const classify: ClassifyFn = (prompt) => {
      if (prompt === "구현")
        return makeResult("CODING", "IMPLEMENT_FEATURE");
      if (prompt === "테스트")
        return makeResult("TESTING", "UNIT_TEST_WRITE");
      if (prompt === "리뷰") return makeResult("REVIEW", "CODE_REVIEW");
      return null;
    };

    // Act
    const result = runBenchmark(cases, classify);

    // Assert
    expect(result.correct).toBe(3);
    expect(result.accuracy).toBe(1.0);
    expect(result.domainAccuracy["CODING"]).toEqual({
      total: 1,
      correct: 1,
      accuracy: 1.0,
    });
    expect(result.domainAccuracy["TESTING"]).toEqual({
      total: 1,
      correct: 1,
      accuracy: 1.0,
    });
    expect(result.domainAccuracy["REVIEW"]).toEqual({
      total: 1,
      correct: 1,
      accuracy: 1.0,
    });
  });

  // 4. [HP] should pass when optional complexity and criticality both match
  it("should pass when optional complexity and criticality both match", () => {
    // Arrange
    const cases = [
      makeCase("구현", "CODING", "IMPLEMENT_FEATURE", "simple", "medium"),
    ];
    const classify = stubClassify(
      makeResult("CODING", "IMPLEMENT_FEATURE", "simple", "medium"),
    );

    // Act
    const result = runBenchmark(cases, classify);

    // Assert
    expect(result.correct).toBe(1);
    expect(result.misclassified).toHaveLength(0);
  });

  // 5. [HP] should skip optional checks when complexity/criticality undefined
  it("should skip optional checks when complexity/criticality undefined", () => {
    // Arrange — expected has no complexity/criticality, result has different ones
    const cases = [makeCase("구현", "CODING", "IMPLEMENT_FEATURE")];
    const classify = stubClassify(
      makeResult("CODING", "IMPLEMENT_FEATURE", "complex", "critical"),
    );

    // Act
    const result = runBenchmark(cases, classify);

    // Assert — still correct because optional fields are undefined
    expect(result.correct).toBe(1);
    expect(result.misclassified).toHaveLength(0);
  });

  // 6. [NE] should report unclassified when classify returns null
  it("should report unclassified when classify returns null", () => {
    // Arrange
    const cases = [makeCase("xyz", "CODING", "IMPLEMENT_FEATURE")];
    const classify = stubClassify(null);

    // Act
    const result = runBenchmark(cases, classify);

    // Assert
    expect(result.correct).toBe(0);
    expect(result.misclassified).toHaveLength(1);
    expect(result.misclassified[0]!.reason).toBe("unclassified");
    expect(result.misclassified[0]!.actual).toBeNull();
  });

  // 7. [NE] should report wrong-domain when domain mismatches
  it("should report wrong-domain when domain mismatches", () => {
    // Arrange — expected CODING, actual TESTING
    const cases = [makeCase("prompt", "CODING", "IMPLEMENT_FEATURE")];
    const classify = stubClassify(makeResult("TESTING", "UNIT_TEST_WRITE"));

    // Act
    const result = runBenchmark(cases, classify);

    // Assert
    expect(result.misclassified).toHaveLength(1);
    expect(result.misclassified[0]!.reason).toBe("wrong-domain");
    expect(result.misclassified[0]!.actual!.domain).toBe("TESTING");
  });

  // 8. [NE] should report wrong-task-type when domain correct but taskType mismatches
  it("should report wrong-task-type when domain correct but taskType mismatches", () => {
    // Arrange — same domain CODING, different taskType
    const cases = [makeCase("prompt", "CODING", "IMPLEMENT_FEATURE")];
    const classify = stubClassify(makeResult("CODING", "REFACTOR"));

    // Act
    const result = runBenchmark(cases, classify);

    // Assert
    expect(result.misclassified).toHaveLength(1);
    expect(result.misclassified[0]!.reason).toBe("wrong-task-type");
  });

  // 9. [NE] should report wrong-complexity when domain/taskType correct but complexity mismatches
  it("should report wrong-complexity when domain/taskType correct but complexity mismatches", () => {
    // Arrange — expected complexity=simple, actual complexity=complex
    const cases = [
      makeCase("prompt", "CODING", "IMPLEMENT_FEATURE", "simple"),
    ];
    const classify = stubClassify(
      makeResult("CODING", "IMPLEMENT_FEATURE", "complex", "medium"),
    );

    // Act
    const result = runBenchmark(cases, classify);

    // Assert
    expect(result.misclassified).toHaveLength(1);
    expect(result.misclassified[0]!.reason).toBe("wrong-complexity");
  });

  // 10. [NE] should report wrong-criticality when complexity correct but criticality mismatches
  it("should report wrong-criticality when complexity correct but criticality mismatches", () => {
    // Arrange — expected criticality=medium, actual criticality=critical
    const cases = [
      makeCase("prompt", "CODING", "IMPLEMENT_FEATURE", "simple", "medium"),
    ];
    const classify = stubClassify(
      makeResult("CODING", "IMPLEMENT_FEATURE", "simple", "critical"),
    );

    // Act
    const result = runBenchmark(cases, classify);

    // Assert
    expect(result.misclassified).toHaveLength(1);
    expect(result.misclassified[0]!.reason).toBe("wrong-criticality");
  });

  // 11. [NE] should return accuracy 0 when all cases misclassified
  it("should return accuracy 0 when all cases misclassified", () => {
    // Arrange — all return null
    const cases = [
      makeCase("a", "CODING", "IMPLEMENT_FEATURE"),
      makeCase("b", "TESTING", "UNIT_TEST_WRITE"),
      makeCase("c", "REVIEW", "CODE_REVIEW"),
    ];
    const classify = stubClassify(null);

    // Act
    const result = runBenchmark(cases, classify);

    // Assert
    expect(result.total).toBe(3);
    expect(result.correct).toBe(0);
    expect(result.accuracy).toBe(0);
    expect(result.misclassified).toHaveLength(3);
  });

  // 12. [NE] should prioritize wrong-domain over wrong-task-type
  it("should prioritize wrong-domain over wrong-task-type", () => {
    // Arrange — both domain and taskType wrong
    const cases = [makeCase("prompt", "CODING", "IMPLEMENT_FEATURE")];
    const classify = stubClassify(makeResult("TESTING", "REFACTOR"));

    // Act
    const result = runBenchmark(cases, classify);

    // Assert — domain checked first (B4 before B5)
    expect(result.misclassified[0]!.reason).toBe("wrong-domain");
  });

  // 13. [NE] should prioritize wrong-complexity over wrong-criticality
  it("should prioritize wrong-complexity over wrong-criticality", () => {
    // Arrange — correct domain+taskType, wrong complexity AND wrong criticality
    const cases = [
      makeCase("prompt", "CODING", "IMPLEMENT_FEATURE", "simple", "medium"),
    ];
    const classify = stubClassify(
      makeResult("CODING", "IMPLEMENT_FEATURE", "complex", "critical"),
    );

    // Act
    const result = runBenchmark(cases, classify);

    // Assert — complexity checked first (B6/B7 before B8/B9)
    expect(result.misclassified[0]!.reason).toBe("wrong-complexity");
  });

  // 14. [CO] should compute partial accuracy for mixed correct/wrong results
  it("should compute partial accuracy for mixed correct/wrong results", () => {
    // Arrange — 2 correct, 1 wrong
    const cases = [
      makeCase("a", "CODING", "IMPLEMENT_FEATURE"),
      makeCase("b", "TESTING", "UNIT_TEST_WRITE"),
      makeCase("c", "REVIEW", "CODE_REVIEW"),
    ];
    const classify: ClassifyFn = (prompt) => {
      if (prompt === "a")
        return makeResult("CODING", "IMPLEMENT_FEATURE");
      if (prompt === "b")
        return makeResult("TESTING", "UNIT_TEST_WRITE");
      return null; // 'c' fails
    };

    // Act
    const result = runBenchmark(cases, classify);

    // Assert
    expect(result.total).toBe(3);
    expect(result.correct).toBe(2);
    expect(result.accuracy).toBeCloseTo(2 / 3);
    expect(result.misclassified).toHaveLength(1);
    expect(result.misclassified[0]!.case.prompt).toBe("c");
  });

  // 15. [CO] should handle all mismatch types in single run
  it("should handle all mismatch types in single run", () => {
    // Arrange — 5 cases, each hitting a different mismatch reason
    const cases = [
      makeCase("null", "CODING", "IMPLEMENT_FEATURE"),
      makeCase("domain", "CODING", "IMPLEMENT_FEATURE"),
      makeCase("type", "CODING", "IMPLEMENT_FEATURE"),
      makeCase("complex", "CODING", "IMPLEMENT_FEATURE", "simple"),
      makeCase("crit", "CODING", "IMPLEMENT_FEATURE", "simple", "medium"),
    ];
    const classify: ClassifyFn = (prompt) => {
      if (prompt === "null") return null;
      if (prompt === "domain")
        return makeResult("TESTING", "UNIT_TEST_WRITE");
      if (prompt === "type") return makeResult("CODING", "REFACTOR");
      if (prompt === "complex")
        return makeResult("CODING", "IMPLEMENT_FEATURE", "complex", "medium");
      if (prompt === "crit")
        return makeResult(
          "CODING",
          "IMPLEMENT_FEATURE",
          "simple",
          "critical",
        );
      return null;
    };

    // Act
    const result = runBenchmark(cases, classify);

    // Assert — 5 mismatches with 5 distinct reasons
    expect(result.misclassified).toHaveLength(5);
    const reasons = result.misclassified.map((m) => m.reason);
    expect(reasons).toContain("unclassified");
    expect(reasons).toContain("wrong-domain");
    expect(reasons).toContain("wrong-task-type");
    expect(reasons).toContain("wrong-complexity");
    expect(reasons).toContain("wrong-criticality");
  });

  // 16. [ED] should compute domain accuracy totals and ratios correctly
  it("should compute domain accuracy totals and ratios correctly", () => {
    // Arrange — CODING: 2 cases (1 correct, 1 wrong), TESTING: 1 case (correct)
    const cases = [
      makeCase("a", "CODING", "IMPLEMENT_FEATURE"),
      makeCase("b", "CODING", "REFACTOR"),
      makeCase("c", "TESTING", "UNIT_TEST_WRITE"),
    ];
    const classify: ClassifyFn = (prompt) => {
      if (prompt === "a")
        return makeResult("CODING", "IMPLEMENT_FEATURE");
      if (prompt === "b") return null; // wrong
      if (prompt === "c")
        return makeResult("TESTING", "UNIT_TEST_WRITE");
      return null;
    };

    // Act
    const result = runBenchmark(cases, classify);

    // Assert
    expect(result.domainAccuracy["CODING"]).toEqual({
      total: 2,
      correct: 1,
      accuracy: 0.5,
    });
    expect(result.domainAccuracy["TESTING"]).toEqual({
      total: 1,
      correct: 1,
      accuracy: 1.0,
    });
  });

  // 17. [OR] should produce same accuracy regardless of case order
  it("should produce same accuracy regardless of case order", () => {
    // Arrange — same cases in different order
    const caseA = makeCase("a", "CODING", "IMPLEMENT_FEATURE");
    const caseB = makeCase("b", "TESTING", "UNIT_TEST_WRITE");
    const classify: ClassifyFn = (prompt) => {
      if (prompt === "a")
        return makeResult("CODING", "IMPLEMENT_FEATURE");
      return null;
    };

    // Act
    const forward = runBenchmark([caseA, caseB], classify);
    const reversed = runBenchmark([caseB, caseA], classify);

    // Assert — same accuracy
    expect(forward.accuracy).toBe(reversed.accuracy);
    expect(forward.correct).toBe(reversed.correct);
    // But misclassified order may differ
    expect(forward.misclassified[0]!.case.prompt).toBe("b");
    expect(reversed.misclassified[0]!.case.prompt).toBe("b");
  });

  // 18. [ID] should return identical results for identical inputs
  it("should return identical results for identical inputs", () => {
    // Arrange
    const cases = [
      makeCase("구현", "CODING", "IMPLEMENT_FEATURE"),
      makeCase("xyz", "TESTING", "UNIT_TEST_WRITE"),
    ];
    const classify: ClassifyFn = (prompt) => {
      if (prompt === "구현")
        return makeResult("CODING", "IMPLEMENT_FEATURE");
      return null;
    };

    // Act
    const first = runBenchmark(cases, classify);
    const second = runBenchmark(cases, classify);

    // Assert
    expect(first).toEqual(second);
  });

  // 19. [HP] should classify all SEED_CASES correctly with classifyByRules
  it("should classify all SEED_CASES correctly with classifyByRules", () => {
    // Arrange — use real classifyByRules with SEED_CASES
    // Act
    const result = runBenchmark(SEED_CASES, classifyByRules);

    // Assert — all seed cases must be correctly classified
    expect(result.total).toBeGreaterThanOrEqual(25);
    expect(result.accuracy).toBe(1.0);
    expect(result.misclassified).toHaveLength(0);
  });

  // 20. [CO] should satisfy correct + misclassified.length = total invariant
  it("should satisfy correct + misclassified.length = total invariant", () => {
    // Arrange — mixed results
    const cases = [
      makeCase("a", "CODING", "IMPLEMENT_FEATURE"),
      makeCase("b", "TESTING", "UNIT_TEST_WRITE"),
      makeCase("c", "REVIEW", "CODE_REVIEW"),
      makeCase("d", "DEBUGGING", "FIX_IMPLEMENT"),
    ];
    const classify: ClassifyFn = (prompt) => {
      if (prompt === "a")
        return makeResult("CODING", "IMPLEMENT_FEATURE");
      if (prompt === "c") return makeResult("REVIEW", "CODE_REVIEW");
      return null;
    };

    // Act
    const result = runBenchmark(cases, classify);

    // Assert
    expect(result.correct + result.misclassified.length).toBe(result.total);
    expect(result.total).toBe(4);
    expect(result.correct).toBe(2);
    expect(result.misclassified).toHaveLength(2);
  });
});
