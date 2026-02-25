import { describe, it, expect, mock } from "bun:test";
import type { EnsemblePlan, ModelScore, ChatFn } from "./types";
import { SIGMA_BASE } from "../model/types";

// SUT — not yet implemented (RED phase)
import { DivergeSynthProtocol } from "./wrappers";

// -- Helpers --

function makePlan(...modelIds: string[]): EnsemblePlan {
  return {
    models: modelIds.map((id) => ({ modelId: id })),
    strategy: "test",
    estimatedCost: 0,
    reason: "test",
  };
}

function makeScore(modelId: string, judgmentMu = 500, sigma = SIGMA_BASE): ModelScore {
  return {
    modelId,
    dimensions: {
      JUDGMENT: { mu: judgmentMu, sigma },
      ANALYSIS: { mu: judgmentMu * 0.8, sigma },
    },
    overall: judgmentMu,
  };
}

const emptyScores: ModelScore[] = [];

describe("DivergeSynthProtocol", () => {
  // 8. [HP] N(3) 모델 병렬 생성 → synthesizer 통합
  it("should diverge N models in parallel then synthesize", async () => {
    const protocol = new DivergeSynthProtocol();
    const chatCalls: Array<{ modelId: string; input: unknown }> = [];
    const chat = mock(async (modelId: string, input: unknown) => {
      chatCalls.push({ modelId, input });
      if (modelId === "synth") return "synthesized answer";
      return `response from ${modelId}`;
    }) as unknown as ChatFn;

    const plan = makePlan("model-a", "model-b", "model-c");
    const scores = [makeScore("model-a", 400), makeScore("model-b", 300), makeScore("synth", 600)];
    // synth is highest JUDGMENT but not in plan → fallback to plan model with highest score
    const scoresInPlan = [makeScore("model-a", 400), makeScore("model-b", 600), makeScore("model-c", 300)];

    const result = await protocol.deliberate("task", plan, scoresInPlan, chat);

    expect(result.result).toBeTruthy();
    // At least N+1 calls (3 diverge + 1 synth)
    expect(chatCalls.length).toBeGreaterThanOrEqual(4);
  });

  // 9. [HP] synthesizer = JUDGMENT 최고 모델 선택
  it("should select synthesizer with highest JUDGMENT score", async () => {
    const protocol = new DivergeSynthProtocol();
    const synthCalls: string[] = [];
    let callCount = 0;
    const chat = mock(async (modelId: string) => {
      callCount++;
      // Last call is the synthesizer
      if (callCount > 3) synthCalls.push(modelId);
      return `response-${callCount}`;
    }) as unknown as ChatFn;

    const plan = makePlan("model-a", "model-b", "model-c");
    const scores = [
      makeScore("model-a", 300),
      makeScore("model-b", 800), // highest JUDGMENT
      makeScore("model-c", 500),
    ];

    await protocol.deliberate("task", plan, scores, chat);

    expect(synthCalls).toContain("model-b");
  });

  // 10. [HP] modelsUsed에 모든 참여 모델 포함
  it("should include all participating models in modelsUsed", async () => {
    const protocol = new DivergeSynthProtocol();
    const chat = mock(async () => "ok") as unknown as ChatFn;
    const plan = makePlan("model-a", "model-b", "model-c");
    const scores = [makeScore("model-a", 500), makeScore("model-b", 500), makeScore("model-c", 500)];

    const result = await protocol.deliberate("task", plan, scores, chat);

    expect(result.modelsUsed).toContain("model-a");
    expect(result.modelsUsed).toContain("model-b");
    expect(result.modelsUsed).toContain("model-c");
  });

  // 11. [HP] totalLLMCalls = N + 1
  it("should count totalLLMCalls as diverge + synth", async () => {
    const protocol = new DivergeSynthProtocol();
    const chat = mock(async () => "ok") as unknown as ChatFn;
    const plan = makePlan("model-a", "model-b", "model-c");
    const scores = [makeScore("model-a"), makeScore("model-b"), makeScore("model-c")];

    const result = await protocol.deliberate("task", plan, scores, chat);

    expect(result.totalLLMCalls).toBe(4); // 3 diverge + 1 synth
  });

  // 12. [NE] 빈 plan → throw
  it("should throw when plan has no models", async () => {
    const protocol = new DivergeSynthProtocol();
    const chat = mock(async () => "x") as unknown as ChatFn;

    await expect(protocol.deliberate("task", makePlan(), emptyScores, chat)).rejects.toThrow();
  });

  // 13. [NE] 전체 diverge 실패 → throw
  it("should throw when all diverge calls fail", async () => {
    const protocol = new DivergeSynthProtocol();
    const chat = mock(async () => {
      throw new Error("fail");
    }) as unknown as ChatFn;
    const plan = makePlan("model-a", "model-b");

    await expect(protocol.deliberate("task", plan, emptyScores, chat)).rejects.toThrow();
  });

  // 14. [NE] 일부 diverge 실패 → 성공한 응답만 통합
  it("should synthesize only successful diverge responses when some fail", async () => {
    const protocol = new DivergeSynthProtocol();
    let callIdx = 0;
    const chat = mock(async (modelId: string) => {
      callIdx++;
      if (modelId === "model-b") throw new Error("fail");
      return `response from ${modelId}`;
    }) as unknown as ChatFn;

    const plan = makePlan("model-a", "model-b", "model-c");
    const scores = [makeScore("model-a", 600), makeScore("model-b", 500), makeScore("model-c", 400)];

    const result = await protocol.deliberate("task", plan, scores, chat);

    expect(result.result).toBeTruthy();
    // model-b failed → still synthesized with model-a and model-c responses
    expect(result.totalLLMCalls).toBe(3); // 2 diverge succeed + 1 synth
  });

  // 15. [NE] synthesizer chat 실패 → error 전파
  it("should propagate synthesizer chat error", async () => {
    const protocol = new DivergeSynthProtocol();
    let callCount = 0;
    const chat = mock(async () => {
      callCount++;
      if (callCount > 2) throw new Error("synth failed");
      return "diverge response";
    }) as unknown as ChatFn;

    const plan = makePlan("model-a", "model-b");
    const scores = [makeScore("model-a"), makeScore("model-b")];

    await expect(protocol.deliberate("task", plan, scores, chat)).rejects.toThrow("synth failed");
  });

  // 16. [ED] 단일 모델 → shortcut
  it("should shortcut with single model (no synthesis)", async () => {
    const protocol = new DivergeSynthProtocol();
    const chat = mock(async () => "direct answer") as unknown as ChatFn;
    const plan = makePlan("model-a");

    const result = await protocol.deliberate("task", plan, emptyScores, chat);

    expect(result.result).toBe("direct answer");
    expect(result.totalLLMCalls).toBe(1);
    expect(result.modelsUsed).toEqual(["model-a"]);
  });

  // 17. [ED] 모델 2개 → 2 diverge + 1 synth
  it("should handle 2 models with 2 diverge + 1 synth calls", async () => {
    const protocol = new DivergeSynthProtocol();
    const chat = mock(async () => "ok") as unknown as ChatFn;
    const plan = makePlan("model-a", "model-b");
    const scores = [makeScore("model-a"), makeScore("model-b")];

    const result = await protocol.deliberate("task", plan, scores, chat);

    expect(result.totalLLMCalls).toBe(3); // 2 + 1
  });

  // 18. [ED] 빈 scores → fallback synthesizer (마지막 모델)
  it("should fallback to last model as synthesizer when scores are empty", async () => {
    const protocol = new DivergeSynthProtocol();
    const synthCalls: string[] = [];
    let callCount = 0;
    const chat = mock(async (modelId: string) => {
      callCount++;
      if (callCount > 3) synthCalls.push(modelId);
      return `resp-${callCount}`;
    }) as unknown as ChatFn;

    const plan = makePlan("model-a", "model-b", "model-c");

    await protocol.deliberate("task", plan, emptyScores, chat);

    // Fallback: last model in plan
    expect(synthCalls).toContain("model-c");
  });

  // 19. [CO] 단일 모델 + chat 실패 → error 전파
  it("should propagate error when single model chat fails", async () => {
    const protocol = new DivergeSynthProtocol();
    const chat = mock(async () => {
      throw new Error("single fail");
    }) as unknown as ChatFn;

    await expect(
      protocol.deliberate("task", makePlan("model-a"), emptyScores, chat),
    ).rejects.toThrow("single fail");
  });

  // 20. [ID] 동일 입력 → protocol="diverge-synth", roundsExecuted=1
  it("should return consistent structure with protocol diverge-synth", async () => {
    const protocol = new DivergeSynthProtocol();
    const chat = mock(async () => "ok") as unknown as ChatFn;
    const plan = makePlan("model-a", "model-b");
    const scores = [makeScore("model-a"), makeScore("model-b")];

    const result = await protocol.deliberate("task", plan, scores, chat);

    expect(result.protocol).toBe("diverge-synth");
    expect(result.roundsExecuted).toBe(1);
    expect(result.consensusReached).toBe(true);
  });

  // 21. [OR] 모델 순서 변경 → JUDGMENT 기반 선택 순서 무관
  it("should select same synthesizer regardless of model order when using JUDGMENT score", async () => {
    const protocol = new DivergeSynthProtocol();
    const synthCalls1: string[] = [];
    const synthCalls2: string[] = [];
    let callCount = 0;

    const makeChat = (collector: string[]) =>
      mock(async (modelId: string) => {
        callCount++;
        if (callCount % 4 === 0) collector.push(modelId); // 4th call = synth for 3 models
        return "resp";
      }) as unknown as ChatFn;

    const scores = [
      makeScore("model-a", 300),
      makeScore("model-b", 800), // highest
      makeScore("model-c", 500),
    ];

    callCount = 0;
    await protocol.deliberate("task", makePlan("model-a", "model-b", "model-c"), scores, makeChat(synthCalls1));
    callCount = 0;
    await protocol.deliberate("task", makePlan("model-c", "model-a", "model-b"), scores, makeChat(synthCalls2));

    expect(synthCalls1[0]).toBe(synthCalls2[0]); // same synthesizer
  });

  // 22. [OR] fallback synthesizer = 마지막 모델 (순서 의존)
  it("should use last model as fallback synthesizer when no scores match", async () => {
    const protocol = new DivergeSynthProtocol();
    const synthCalls: string[] = [];
    let callCount = 0;
    const chat = mock(async (modelId: string) => {
      callCount++;
      if (callCount > 2) synthCalls.push(modelId);
      return "resp";
    }) as unknown as ChatFn;

    // Scores for models NOT in plan → fallback
    const plan = makePlan("model-x", "model-y");
    const scores = [makeScore("other-model", 800)];

    await protocol.deliberate("task", plan, scores, chat);

    expect(synthCalls).toContain("model-y"); // last in plan
  });
});
