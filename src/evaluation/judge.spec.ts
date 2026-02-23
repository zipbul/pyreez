/**
 * LLM-as-Judge tests.
 */
import { describe, it, expect } from "bun:test";
import {
  buildJudgePrompt,
  parseJudgeResponse,
  createLLMJudge,
  isValidOutcome,
} from "./judge";
import type { EvalPrompt, EvalResponse, JudgeConfig } from "./types";

// -- Helpers --

function makePrompt(overrides: Partial<EvalPrompt> = {}): EvalPrompt {
  return {
    id: "p1",
    domain: "coding",
    difficulty: "moderate",
    text: "Implement binary search",
    expectedDimensions: ["CODE_GENERATION"],
    criteria: {
      specificity: 4, domainKnowledge: 3, complexity: 3,
      problemSolving: 4, creativity: 2, technicalAccuracy: 5, realWorldApplication: 3,
    },
    verifiable: false,
    ...overrides,
  };
}

function makeResponse(modelId: string, text: string): EvalResponse {
  return {
    promptId: "p1",
    modelId,
    response: text,
    latencyMs: 100,
    tokenUsage: { input: 50, output: 100 },
  };
}

function makeConfig(overrides: Partial<JudgeConfig> = {}): JudgeConfig {
  return {
    judgeModel: "judge/o3",
    temperature: 0,
    maxTokens: 2000,
    lengthBiasCorrection: false,
    ...overrides,
  };
}

// ================================================================
// buildJudgePrompt
// ================================================================

describe("buildJudgePrompt", () => {
  it("should include prompt text and both responses", () => {
    const result = buildJudgePrompt(makePrompt(), "Response A text", "Response B text");
    expect(result).toContain("Implement binary search");
    expect(result).toContain("Response A text");
    expect(result).toContain("Response B text");
  });

  it("should include checklist when provided", () => {
    const p = makePrompt({ checklist: ["Check edge cases", "Verify O(log n)"] });
    const result = buildJudgePrompt(p, "A", "B");
    expect(result).toContain("Check edge cases");
    expect(result).toContain("Verify O(log n)");
  });

  it("should not include checklist section when not provided", () => {
    const result = buildJudgePrompt(makePrompt(), "A", "B");
    expect(result).not.toContain("Evaluation Checklist");
  });

  it("should include all 5 verdict options", () => {
    const result = buildJudgePrompt(makePrompt(), "A", "B");
    expect(result).toContain("A>>B");
    expect(result).toContain("A>B");
    expect(result).toContain("A=B");
    expect(result).toContain("B>A");
    expect(result).toContain("B>>A");
  });
});

// ================================================================
// parseJudgeResponse
// ================================================================

describe("parseJudgeResponse", () => {
  it("should parse well-formatted response", () => {
    const raw = `REASONING: Response A has better structure and handles edge cases.
CONFIDENCE: 0.85
VERDICT: A>B`;
    const { outcome, reasoning, confidence } = parseJudgeResponse(raw);
    expect(outcome).toBe("A>B");
    expect(reasoning).toContain("better structure");
    expect(confidence).toBe(0.85);
  });

  it("should parse A>>B strong preference", () => {
    const raw = "REASONING: A is far superior\nCONFIDENCE: 0.95\nVERDICT: A>>B";
    expect(parseJudgeResponse(raw).outcome).toBe("A>>B");
  });

  it("should parse B>>A strong preference", () => {
    const raw = "REASONING: B wins\nCONFIDENCE: 0.9\nVERDICT: B>>A";
    expect(parseJudgeResponse(raw).outcome).toBe("B>>A");
  });

  it("should parse tie A=B", () => {
    const raw = "REASONING: Both are equal\nCONFIDENCE: 0.7\nVERDICT: A=B";
    expect(parseJudgeResponse(raw).outcome).toBe("A=B");
  });

  it("should default to A=B when no verdict found", () => {
    const raw = "I think both responses are about the same quality.";
    expect(parseJudgeResponse(raw).outcome).toBe("A=B");
  });

  it("should default confidence to 0.5 when not found", () => {
    const raw = "VERDICT: A>B";
    expect(parseJudgeResponse(raw).confidence).toBe(0.5);
  });

  it("should clamp confidence to [0, 1]", () => {
    expect(parseJudgeResponse("CONFIDENCE: 1.5\nVERDICT: A>B").confidence).toBe(1.0);
    expect(parseJudgeResponse("CONFIDENCE: -0.5\nVERDICT: A>B").confidence).toBe(0.0);
  });

  it("should extract reasoning even without labels", () => {
    const raw = "This is all reasoning text\nVERDICT: B>A";
    const { reasoning } = parseJudgeResponse(raw);
    expect(reasoning.length).toBeGreaterThan(0);
  });
});

// ================================================================
// createLLMJudge
// ================================================================

describe("createLLMJudge", () => {
  it("should create a judge that calls the generator", async () => {
    const generator = async () => "REASONING: A is better\nCONFIDENCE: 0.8\nVERDICT: A>B";
    const judge = createLLMJudge(generator);
    const result = await judge.judge(
      makePrompt(),
      makeResponse("m1", "good answer"),
      makeResponse("m2", "bad answer"),
      makeConfig(),
    );
    expect(result.outcome).toBe("A>B");
    expect(result.modelA).toBe("m1");
    expect(result.modelB).toBe("m2");
    expect(result.judge).toBe("judge/o3");
  });

  it("should apply length bias correction when enabled", async () => {
    const generator = async () => "VERDICT: A>>B";
    const judge = createLLMJudge(generator);
    const result = await judge.judge(
      makePrompt(),
      makeResponse("m1", "a".repeat(300)), // 3x longer
      makeResponse("m2", "b".repeat(100)),
      makeConfig({ lengthBiasCorrection: true }),
    );
    // A>>B downgraded to A>B due to length bias
    expect(result.outcome).toBe("A>B");
  });

  it("should not apply length bias when disabled", async () => {
    const generator = async () => "VERDICT: A>>B";
    const judge = createLLMJudge(generator);
    const result = await judge.judge(
      makePrompt(),
      makeResponse("m1", "a".repeat(300)),
      makeResponse("m2", "b".repeat(100)),
      makeConfig({ lengthBiasCorrection: false }),
    );
    expect(result.outcome).toBe("A>>B");
  });
});

// ================================================================
// isValidOutcome
// ================================================================

describe("isValidOutcome", () => {
  it("should accept all valid outcomes", () => {
    expect(isValidOutcome("A>>B")).toBe(true);
    expect(isValidOutcome("A>B")).toBe(true);
    expect(isValidOutcome("A=B")).toBe(true);
    expect(isValidOutcome("B>A")).toBe(true);
    expect(isValidOutcome("B>>A")).toBe(true);
  });

  it("should reject invalid strings", () => {
    expect(isValidOutcome("A>>>B")).toBe(false);
    expect(isValidOutcome("tie")).toBe(false);
    expect(isValidOutcome("")).toBe(false);
  });
});
