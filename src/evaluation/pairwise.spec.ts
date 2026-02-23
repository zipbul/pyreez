/**
 * Pairwise comparison tests.
 */
import { describe, it, expect } from "bun:test";
import {
  flipOutcome,
  isConsistent,
  reconcile,
  lengthRatio,
  correctLengthBias,
  anchorPairings,
  roundRobinPairings,
  runPairwise,
} from "./pairwise";
import type {
  PairwiseOutcome,
  EvalPrompt,
  EvalResponse,
  PairwiseJudge,
  PairwiseResult,
  JudgeConfig,
  CriteriaScores,
} from "./types";

// -- Helpers --

function makePrompt(): EvalPrompt {
  return {
    id: "p1",
    domain: "coding",
    difficulty: "moderate",
    text: "test",
    expectedDimensions: ["CODE_GENERATION"],
    criteria: {
      specificity: 3, domainKnowledge: 3, complexity: 3,
      problemSolving: 3, creativity: 3, technicalAccuracy: 3, realWorldApplication: 3,
    },
    verifiable: false,
  };
}

function makeResponse(modelId: string, text: string = "response"): EvalResponse {
  return { promptId: "p1", modelId, response: text, latencyMs: 100, tokenUsage: { input: 10, output: 20 } };
}

function makeJudgeConfig(): JudgeConfig {
  return { judgeModel: "judge/model", temperature: 0, maxTokens: 1000, lengthBiasCorrection: false };
}

function makeMockJudge(outcomes: PairwiseOutcome[]): PairwiseJudge {
  let callIndex = 0;
  return {
    judge: async (prompt, responseA, responseB, config): Promise<PairwiseResult> => ({
      promptId: prompt.id,
      modelA: responseA.modelId,
      modelB: responseB.modelId,
      judge: config.judgeModel,
      outcome: outcomes[callIndex++] ?? "A=B",
      swapped: false,
      reasoning: "test reasoning",
      confidence: 0.9,
    }),
  };
}

// ================================================================
// flipOutcome
// ================================================================

describe("flipOutcome", () => {
  it("should flip A>>B → B>>A", () => expect(flipOutcome("A>>B")).toBe("B>>A"));
  it("should flip A>B → B>A", () => expect(flipOutcome("A>B")).toBe("B>A"));
  it("should keep A=B → A=B", () => expect(flipOutcome("A=B")).toBe("A=B"));
  it("should flip B>A → A>B", () => expect(flipOutcome("B>A")).toBe("A>B"));
  it("should flip B>>A → A>>B", () => expect(flipOutcome("B>>A")).toBe("A>>B"));
});

// ================================================================
// isConsistent & reconcile
// ================================================================

describe("isConsistent", () => {
  it("should be consistent when swapped flips to same", () => {
    // original: A>>B, swapped judge sees (B,A) and says B>>A → flip = A>>B → consistent
    expect(isConsistent("A>>B", "B>>A")).toBe(true);
  });

  it("should be inconsistent when directions disagree", () => {
    // original: A>>B, swapped says A>>B (didn't flip) → flip = B>>A ≠ A>>B
    expect(isConsistent("A>>B", "A>>B")).toBe(false);
  });

  it("should be consistent for ties", () => {
    expect(isConsistent("A=B", "A=B")).toBe(true);
  });
});

describe("reconcile", () => {
  it("should keep original when consistent", () => {
    expect(reconcile("A>B", "B>A")).toBe("A>B");
  });

  it("should return tie when inconsistent", () => {
    expect(reconcile("A>>B", "A>>B")).toBe("A=B");
  });
});

// ================================================================
// lengthRatio & correctLengthBias
// ================================================================

describe("lengthRatio", () => {
  it("should compute ratio of response lengths", () => {
    expect(lengthRatio("aaaa", "aa")).toBe(2.0);
  });

  it("should return 1.0 for both empty", () => {
    expect(lengthRatio("", "")).toBe(1.0);
  });

  it("should return Infinity for empty B", () => {
    expect(lengthRatio("abc", "")).toBe(Infinity);
  });
});

describe("correctLengthBias", () => {
  it("should downgrade A>>B when A is 3x longer", () => {
    expect(correctLengthBias("A>>B", 3.0)).toBe("A>B");
  });

  it("should downgrade B>>A when B is 3x longer", () => {
    expect(correctLengthBias("B>>A", 1 / 3)).toBe("B>A");
  });

  it("should not change outcome when ratio is within threshold", () => {
    expect(correctLengthBias("A>>B", 1.5)).toBe("A>>B");
  });

  it("should not change weak outcomes", () => {
    expect(correctLengthBias("A>B", 3.0)).toBe("A>B");
  });
});

// ================================================================
// Pairing strategies
// ================================================================

describe("anchorPairings", () => {
  it("should pair all models against anchor", () => {
    const pairs = anchorPairings(["a", "b", "c", "anchor"], "anchor");
    expect(pairs).toEqual([["a", "anchor"], ["b", "anchor"], ["c", "anchor"]]);
  });

  it("should return empty if only anchor", () => {
    expect(anchorPairings(["anchor"], "anchor")).toHaveLength(0);
  });
});

describe("roundRobinPairings", () => {
  it("should generate all unique pairs", () => {
    const pairs = roundRobinPairings(["a", "b", "c"]);
    expect(pairs).toEqual([["a", "b"], ["a", "c"], ["b", "c"]]);
  });

  it("should return empty for single model", () => {
    expect(roundRobinPairings(["a"])).toHaveLength(0);
  });

  it("should return n*(n-1)/2 pairs", () => {
    expect(roundRobinPairings(["a", "b", "c", "d"])).toHaveLength(6);
  });
});

// ================================================================
// runPairwise with position swap
// ================================================================

describe("runPairwise", () => {
  it("should run without swap and return original outcome", async () => {
    const judge = makeMockJudge(["A>B"]);
    const result = await runPairwise(
      judge, makePrompt(), makeResponse("m1"), makeResponse("m2"),
      makeJudgeConfig(), false,
    );
    expect(result.reconciled).toBe("A>B");
    expect(result.consistent).toBe(true);
    expect(result.swapped).toBeUndefined();
  });

  it("should reconcile consistent swap results", async () => {
    // Original: A>B, Swapped (B,A): B>A → flip = A>B → consistent
    const judge = makeMockJudge(["A>B", "B>A"]);
    const result = await runPairwise(
      judge, makePrompt(), makeResponse("m1"), makeResponse("m2"),
      makeJudgeConfig(), true,
    );
    expect(result.reconciled).toBe("A>B");
    expect(result.consistent).toBe(true);
  });

  it("should reconcile inconsistent swap to tie", async () => {
    // Original: A>B, Swapped (B,A): A>B → flip = B>A ≠ A>B → inconsistent → tie
    const judge = makeMockJudge(["A>B", "A>B"]);
    const result = await runPairwise(
      judge, makePrompt(), makeResponse("m1"), makeResponse("m2"),
      makeJudgeConfig(), true,
    );
    expect(result.reconciled).toBe("A=B");
    expect(result.consistent).toBe(false);
  });

  it("should apply length bias correction when enabled", async () => {
    const judge = makeMockJudge(["A>>B", "B>>A"]); // consistent → A>>B
    const longA = makeResponse("m1", "a".repeat(300));
    const shortB = makeResponse("m2", "b".repeat(100));
    const config = { ...makeJudgeConfig(), lengthBiasCorrection: true };
    const result = await runPairwise(
      judge, makePrompt(), longA, shortB, config, true,
    );
    // ratio = 300/100 = 3.0 > 2.0 → A>>B downgraded to A>B
    expect(result.reconciled).toBe("A>B");
  });
});
