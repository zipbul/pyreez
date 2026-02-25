import { describe, it, expect, mock } from "bun:test";
import type { EnsemblePlan, ModelScore, ChatFn, DeliberationResult } from "./types";

// SUT — not yet implemented (RED phase)
import { SingleBestProtocol } from "./wrappers";

// -- Helpers --

function makePlan(...modelIds: string[]): EnsemblePlan {
  return {
    models: modelIds.map((id) => ({ modelId: id })),
    strategy: "test",
    estimatedCost: 0,
    reason: "test",
  };
}

const emptyScores: ModelScore[] = [];

describe("SingleBestProtocol", () => {
  // 1. [HP] 단일 모델 chat 호출 → result 반환
  it("should return chat result from the first model in plan", async () => {
    const protocol = new SingleBestProtocol();
    const chat = mock(async (_modelId: string, _input: string) => "hello world") as unknown as ChatFn;
    const plan = makePlan("model-a");

    const result = await protocol.deliberate("say hello", plan, emptyScores, chat);

    expect(result.result).toBe("hello world");
    expect(chat).toHaveBeenCalledTimes(1);
  });

  // 2. [HP] roundsExecuted=0, totalLLMCalls=1, modelsUsed=[modelId], protocol="single-best"
  it("should return correct metadata fields", async () => {
    const protocol = new SingleBestProtocol();
    const chat = mock(async () => "response") as unknown as ChatFn;
    const plan = makePlan("model-x");

    const result = await protocol.deliberate("task", plan, emptyScores, chat);

    expect(result.roundsExecuted).toBe(0);
    expect(result.consensusReached).toBe(true);
    expect(result.totalLLMCalls).toBe(1);
    expect(result.modelsUsed).toEqual(["model-x"]);
    expect(result.protocol).toBe("single-best");
  });

  // 3. [NE] 빈 plan.models → throw
  it("should throw when plan has no models", async () => {
    const protocol = new SingleBestProtocol();
    const chat = mock(async () => "x") as unknown as ChatFn;
    const plan = makePlan(); // empty

    await expect(protocol.deliberate("task", plan, emptyScores, chat)).rejects.toThrow();
  });

  // 4. [NE] chat 실패 → error 전파
  it("should propagate chat error", async () => {
    const protocol = new SingleBestProtocol();
    const chat = mock(async () => {
      throw new Error("network error");
    }) as unknown as ChatFn;
    const plan = makePlan("model-a");

    await expect(protocol.deliberate("task", plan, emptyScores, chat)).rejects.toThrow("network error");
  });

  // 5. [ED] plan.models 여러 개 → 첫 번째만 사용
  it("should use only the first model when plan has multiple models", async () => {
    const protocol = new SingleBestProtocol();
    const calls: string[] = [];
    const chat = mock(async (modelId: string) => {
      calls.push(modelId);
      return "result";
    }) as unknown as ChatFn;
    const plan = makePlan("model-a", "model-b", "model-c");

    const result = await protocol.deliberate("task", plan, emptyScores, chat);

    expect(calls).toEqual(["model-a"]);
    expect(result.modelsUsed).toEqual(["model-a"]);
    expect(result.totalLLMCalls).toBe(1);
  });

  // 6. [ED] 빈 task 문자열 → chat에 그대로 전달
  it("should pass empty task string to chat as-is", async () => {
    const protocol = new SingleBestProtocol();
    let receivedTask: unknown;
    const chat = mock(async (_modelId: string, input: string) => {
      receivedTask = input;
      return "ok";
    }) as unknown as ChatFn;
    const plan = makePlan("model-a");

    await protocol.deliberate("", plan, emptyScores, chat);

    expect(receivedTask).toBe("");
  });

  // 7. [ID] 동일 입력 → 동일 결과 구조
  it("should produce identical structure for repeated calls with same input", async () => {
    const protocol = new SingleBestProtocol();
    const chat = mock(async () => "deterministic") as unknown as ChatFn;
    const plan = makePlan("model-a");

    const r1 = await protocol.deliberate("task", plan, emptyScores, chat);
    const r2 = await protocol.deliberate("task", plan, emptyScores, chat);

    expect(r1.protocol).toBe(r2.protocol);
    expect(r1.roundsExecuted).toBe(r2.roundsExecuted);
    expect(r1.consensusReached).toBe(r2.consensusReached);
    expect(r1.totalLLMCalls).toBe(r2.totalLLMCalls);
    expect(r1.modelsUsed).toEqual(r2.modelsUsed);
  });
});
