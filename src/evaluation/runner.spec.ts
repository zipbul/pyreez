/**
 * Eval runner tests.
 */
import { describe, it, expect } from "bun:test";
import { runSingle, runPromptAcrossModels, runMatrix } from "./runner";
import type { EvalPrompt, EvalResponse, ModelRunner, CriteriaScores } from "./types";

// -- Helpers --

function makePrompt(id: string = "p1"): EvalPrompt {
  return {
    id,
    domain: "coding",
    difficulty: "moderate",
    text: "test prompt",
    expectedDimensions: ["CODE_GENERATION"],
    criteria: {
      specificity: 3, domainKnowledge: 3, complexity: 3,
      problemSolving: 3, creativity: 3, technicalAccuracy: 3, realWorldApplication: 3,
    },
    verifiable: false,
  };
}

function makeMockRunner(responses?: Map<string, string>): ModelRunner {
  return {
    generate: async (modelId: string, prompt: string): Promise<EvalResponse> => ({
      promptId: "",
      modelId,
      response: responses?.get(modelId) ?? `response from ${modelId}`,
      latencyMs: 50,
      tokenUsage: { input: 10, output: 20 },
    }),
  };
}

function makeFailingRunner(): ModelRunner {
  return {
    generate: async () => { throw new Error("LLM call failed"); },
  };
}

// ================================================================
// runSingle
// ================================================================

describe("runSingle", () => {
  it("should return response with correct promptId and modelId", async () => {
    const runner = makeMockRunner();
    const result = await runSingle(runner, makePrompt("p1"), "model-a");
    expect(result.promptId).toBe("p1");
    expect(result.modelId).toBe("model-a");
    expect(result.response).toContain("model-a");
  });

  it("should propagate runner errors", async () => {
    const runner = makeFailingRunner();
    expect(runSingle(runner, makePrompt(), "m1")).rejects.toThrow("LLM call failed");
  });
});

// ================================================================
// runPromptAcrossModels
// ================================================================

describe("runPromptAcrossModels", () => {
  it("should collect responses from all models", async () => {
    const runner = makeMockRunner();
    const results = await runPromptAcrossModels(runner, makePrompt(), ["m1", "m2", "m3"]);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.modelId).sort()).toEqual(["m1", "m2", "m3"]);
  });

  it("should throw on empty modelIds", async () => {
    const runner = makeMockRunner();
    expect(runPromptAcrossModels(runner, makePrompt(), [])).rejects.toThrow("modelIds");
  });
});

// ================================================================
// runMatrix
// ================================================================

describe("runMatrix", () => {
  it("should run all prompts × all models", async () => {
    const runner = makeMockRunner();
    const prompts = [makePrompt("p1"), makePrompt("p2")];
    const results = await runMatrix(runner, prompts, ["m1", "m2"]);
    expect(results).toHaveLength(4);
  });

  it("should call progress callback", async () => {
    const runner = makeMockRunner();
    const progress: Array<[number, number]> = [];
    await runMatrix(
      runner,
      [makePrompt("p1"), makePrompt("p2")],
      ["m1"],
      1,
      (completed, total) => progress.push([completed, total]),
    );
    expect(progress).toEqual([[1, 2], [2, 2]]);
  });

  it("should throw on empty prompts", async () => {
    const runner = makeMockRunner();
    expect(runMatrix(runner, [], ["m1"])).rejects.toThrow("prompts");
  });

  it("should throw on empty modelIds", async () => {
    const runner = makeMockRunner();
    expect(runMatrix(runner, [makePrompt()], [])).rejects.toThrow("modelIds");
  });

  it("should record token usage from runner", async () => {
    const runner = makeMockRunner();
    const results = await runMatrix(runner, [makePrompt()], ["m1"]);
    expect(results[0].tokenUsage).toEqual({ input: 10, output: 20 });
  });
});
