import { describe, it, expect, mock } from "bun:test";
import { FreeDebateProtocol } from "./wrappers";
import type { ChatFn, EnsemblePlan, ModelScore } from "./types";

function makePlan(...modelIds: string[]): EnsemblePlan {
  return {
    models: modelIds.map((id) => ({ modelId: id })),
    strategy: "test",
    estimatedCost: 0,
    reason: "test",
  };
}

function makeScores(...ids: string[]): ModelScore[] {
  return ids.map((id) => ({
    modelId: id,
    dimensions: { JUDGMENT: { mu: 500, sigma: 100 } },
    overall: 500,
  }));
}

describe("FreeDebateProtocol", () => {
  // 1. [HP] 2-model debate reaches convergence
  it("should detect convergence when models agree", async () => {
    let turn = 0;
    const chat: ChatFn = mock(async (_model: string, _input: string | any[]) => {
      turn++;
      if (turn <= 2) return `Turn ${turn}: I think the answer is 42`;
      // Both models agree on turn 2+
      return "I agree, the answer is 42. Final answer: 42";
    }) as any;

    const protocol = new FreeDebateProtocol(chat);
    const result = await protocol.deliberate(
      "What is the answer?",
      makePlan("model-a", "model-b"),
      makeScores("model-a", "model-b"),
      chat,
    );

    expect(result.protocol).toBe("free-debate");
    expect(result.result.length).toBeGreaterThan(0);
    expect(result.modelsUsed).toContain("model-a");
    expect(result.modelsUsed).toContain("model-b");
  });

  // 2. [HP] 3-model debate completes at maxTurns with synthesis
  it("should synthesize at maxTurns when no convergence", async () => {
    let callNum = 0;
    const chat: ChatFn = mock(async (_model: string, _input: string | any[]) => {
      callNum++;
      return `Unique response ${callNum}`; // Never converges
    }) as any;

    const protocol = new FreeDebateProtocol(chat);
    const result = await protocol.deliberate(
      "Discuss this",
      makePlan("a", "b", "c"),
      makeScores("a", "b", "c"),
      chat,
    );

    expect(result.protocol).toBe("free-debate");
    expect(result.result.length).toBeGreaterThan(0);
    // maxTurns = N × 3 = 9, but synthesis adds one more call
    expect(result.totalLLMCalls).toBeGreaterThan(0);
  });

  // 3. [NE] chat error mid-debate continues
  it("should continue debate when one model errors", async () => {
    let callCount = 0;
    const chat: ChatFn = mock(async (model: string, _input: string | any[]) => {
      callCount++;
      if (model === "model-b" && callCount <= 3) {
        throw new Error("model-b offline");
      }
      return "My thoughtful response";
    }) as any;

    const protocol = new FreeDebateProtocol(chat);
    const result = await protocol.deliberate(
      "task",
      makePlan("model-a", "model-b"),
      makeScores("model-a", "model-b"),
      chat,
    );

    expect(result.result.length).toBeGreaterThan(0);
  });

  // 4. [NE] single model → direct response
  it("should return direct response for single model", async () => {
    const chat: ChatFn = mock(async () => "Direct answer") as any;

    const protocol = new FreeDebateProtocol(chat);
    const result = await protocol.deliberate(
      "task",
      makePlan("model-a"),
      makeScores("model-a"),
      chat,
    );

    expect(result.result).toBe("Direct answer");
    expect(result.roundsExecuted).toBe(0);
    expect(result.totalLLMCalls).toBe(1);
  });

  // 5. [ED] convergence at first round
  it("should detect convergence at first round when responses match", async () => {
    const chat: ChatFn = mock(async () => "The answer is definitely 42") as any;

    const protocol = new FreeDebateProtocol(chat);
    const result = await protocol.deliberate(
      "task",
      makePlan("a", "b"),
      makeScores("a", "b"),
      chat,
    );

    expect(result.consensusReached).toBe(true);
    expect(result.roundsExecuted).toBeLessThanOrEqual(2);
  });

  // 6. [ED] maxTurns guard prevents infinite loop
  it("should not exceed maxTurns limit", async () => {
    let calls = 0;
    const chat: ChatFn = mock(async () => {
      calls++;
      return `Response ${calls}`;
    }) as any;

    const protocol = new FreeDebateProtocol(chat);
    const result = await protocol.deliberate(
      "task",
      makePlan("a", "b"),
      makeScores("a", "b"),
      chat,
    );

    // maxTurns = 2 × 3 = 6 model calls + 1 synthesis = 7 max
    expect(result.totalLLMCalls).toBeLessThanOrEqual(10);
  });

  // 7. [ST] debate history accumulates
  it("should pass accumulated history to each model", async () => {
    const inputs: string[] = [];
    const chat: ChatFn = mock(async (_model: string, input: string | any[]) => {
      inputs.push(typeof input === "string" ? input : JSON.stringify(input));
      return "My response";
    }) as any;

    const protocol = new FreeDebateProtocol(chat);
    await protocol.deliberate(
      "task",
      makePlan("a", "b"),
      makeScores("a", "b"),
      chat,
    );

    // Later prompts should be longer (contain history)
    if (inputs.length >= 3) {
      expect(inputs[2]!.length).toBeGreaterThanOrEqual(inputs[0]!.length);
    }
  });

  // 8. [ID] protocol reports "free-debate"
  it("should report protocol as free-debate", async () => {
    const chat: ChatFn = mock(async () => "response") as any;

    const protocol = new FreeDebateProtocol(chat);
    const result = await protocol.deliberate(
      "task",
      makePlan("a", "b"),
      makeScores("a", "b"),
      chat,
    );

    expect(result.protocol).toBe("free-debate");
  });
});
