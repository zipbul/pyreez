import { describe, it, expect, mock } from "bun:test";
import { LLMExternalEvaluator, type EvaluatorDeps } from "./external-evaluator";
import type { ModelInfo } from "../model/types";

function makeModel(id: string, provider: string, inputCost = 1, outputCost = 1): ModelInfo {
  return {
    id,
    name: id,
    provider: provider as any,
    contextWindow: 100000,
    capabilities: {} as any,
    cost: { inputPer1M: inputCost, outputPer1M: outputCost },
    supportsToolCalling: true,
    available: true,
  };
}

const VALID_RESPONSE = JSON.stringify({
  dimensions: {
    factually_correct: true,
    addresses_task: true,
    provides_evidence: false,
    novel_perspective: true,
    internally_consistent: true,
  },
  failures: {
    hallucination: false,
    refusal: false,
    off_topic: false,
    degenerate: false,
  },
});

function makeDeps(overrides?: Partial<EvaluatorDeps>): EvaluatorDeps {
  return {
    chat: mock(async () => ({ content: VALID_RESPONSE, inputTokens: 100, outputTokens: 50 })),
    getAvailableModels: () => [
      makeModel("cheap/eval-1", "provA", 0.5, 0.5),
      makeModel("cheap/eval-2", "provB", 1, 1),
      makeModel("expensive/eval-3", "provC", 10, 10),
    ],
    ...overrides,
  };
}

describe("LLMExternalEvaluator", () => {
  it("should return a valid FeedbackRecord", async () => {
    const evaluator = new LLMExternalEvaluator(makeDeps());
    const record = await evaluator.evaluate(
      "test task", "worker/model-1", "worker response content",
      "ARCHITECTURE", "SYSTEM_DESIGN", "delib-1", new Set(["provX"]),
    );

    expect(record.model_id).toBe("worker/model-1");
    expect(record.domain).toBe("ARCHITECTURE");
    expect(record.task_type).toBe("SYSTEM_DESIGN");
    expect(record.dimensions.factually_correct).toBe(true);
    expect(record.dimensions.provides_evidence).toBe(false);
    expect(record.failures.hallucination).toBe(false);
    expect(record.evaluator_id).toBe("cheap/eval-1"); // cheapest
  });

  it("should select evaluator from different provider than team", async () => {
    const deps = makeDeps();
    const evaluator = new LLMExternalEvaluator(deps);

    // Team uses provA — evaluator should be from provB (next cheapest)
    await evaluator.evaluate(
      "task", "w1", "content", "D", "T", "d1", new Set(["provA"]),
    );

    const chatMock = deps.chat as ReturnType<typeof mock>;
    const calledModel = chatMock.mock.calls[0]![0];
    expect(calledModel).toBe("cheap/eval-2"); // provB, not provA
  });

  it("should rotate evaluator provider", async () => {
    const deps = makeDeps();
    const evaluator = new LLMExternalEvaluator(deps);

    // First call: team=provX, last=null → picks cheapest (provA)
    await evaluator.evaluate("t", "w1", "c", "D", "T", "d1", new Set(["provX"]));
    // Second call: team=provX, last=provA → picks provB (rotation)
    await evaluator.evaluate("t", "w2", "c", "D", "T", "d2", new Set(["provX"]));

    const chatMock = deps.chat as ReturnType<typeof mock>;
    expect(chatMock.mock.calls[0]![0]).toBe("cheap/eval-1"); // provA
    expect(chatMock.mock.calls[1]![0]).toBe("cheap/eval-2"); // provB (rotated)
  });

  it("should fallback when all providers match team", async () => {
    const deps = makeDeps({
      getAvailableModels: () => [makeModel("only/model", "provA")],
    });
    const evaluator = new LLMExternalEvaluator(deps);

    // Team uses provA, only model is provA — should still work (last resort)
    const record = await evaluator.evaluate(
      "t", "w1", "c", "D", "T", "d1", new Set(["provA"]),
    );
    expect(record.evaluator_id).toBe("only/model");
  });

  it("should throw on invalid JSON response", async () => {
    const deps = makeDeps({
      chat: mock(async () => ({ content: "not json at all", inputTokens: 0, outputTokens: 0 })),
    });
    const evaluator = new LLMExternalEvaluator(deps);

    await expect(
      evaluator.evaluate("t", "w1", "c", "D", "T", "d1", new Set()),
    ).rejects.toThrow("Failed to parse evaluator response");
  });

  it("should throw when no models available", async () => {
    const deps = makeDeps({ getAvailableModels: () => [] });
    const evaluator = new LLMExternalEvaluator(deps);

    await expect(
      evaluator.evaluate("t", "w1", "c", "D", "T", "d1", new Set()),
    ).rejects.toThrow("No evaluator model available");
  });

  it("should handle JSON wrapped in markdown fences", async () => {
    const deps = makeDeps({
      chat: mock(async () => ({
        content: "```json\n" + VALID_RESPONSE + "\n```",
        inputTokens: 0, outputTokens: 0,
      })),
    });
    const evaluator = new LLMExternalEvaluator(deps);
    const record = await evaluator.evaluate("t", "w1", "c", "D", "T", "d1", new Set());
    expect(record.dimensions.factually_correct).toBe(true);
  });

  it("should default missing dimension fields to false", async () => {
    const partial = JSON.stringify({
      dimensions: { factually_correct: true },
      failures: {},
    });
    const deps = makeDeps({
      chat: mock(async () => ({ content: partial, inputTokens: 0, outputTokens: 0 })),
    });
    const evaluator = new LLMExternalEvaluator(deps);
    const record = await evaluator.evaluate("t", "w1", "c", "D", "T", "d1", new Set());
    expect(record.dimensions.factually_correct).toBe(true);
    expect(record.dimensions.addresses_task).toBe(false); // missing → false
    expect(record.dimensions.provides_evidence).toBe(false);
    expect(record.failures.hallucination).toBe(false); // missing → false
  });

  it("should rotate evaluator across providers within same deliberation", async () => {
    const deps = makeDeps();
    const evaluator = new LLMExternalEvaluator(deps);

    // Evaluate 3 workers in sequence (like wire.ts loop)
    await evaluator.evaluate("t", "w1", "c", "D", "T", "d1", new Set(["provX"]));
    await evaluator.evaluate("t", "w2", "c", "D", "T", "d1", new Set(["provX"]));
    await evaluator.evaluate("t", "w3", "c", "D", "T", "d1", new Set(["provX"]));

    const chatMock = deps.chat as ReturnType<typeof mock>;
    const evaluators = chatMock.mock.calls.map((c: any) => c[0]);
    // Should rotate: provA, provB, provA (or similar pattern)
    expect(evaluators[0]).not.toBe(evaluators[1]); // different evaluator for 2nd call
  });

  it("should use temperature 0 for deterministic evaluation", async () => {
    const deps = makeDeps();
    const evaluator = new LLMExternalEvaluator(deps);
    await evaluator.evaluate("t", "w1", "c", "D", "T", "d1", new Set());

    const chatMock = deps.chat as ReturnType<typeof mock>;
    const params = chatMock.mock.calls[0]![2];
    expect(params).toEqual({ temperature: 0, max_tokens: 512 });
  });
});
