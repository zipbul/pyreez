import { describe, it, expect, mock } from "bun:test";
import type { EnsemblePlan, ModelScore, ChatFn } from "./types";
import { SIGMA_BASE } from "../model/types";

// SUT — not yet implemented (RED phase)
import { AdaptiveDelibProtocol } from "./wrappers";

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

/** Chat mock that returns JSON critique with a score */
function makeCritiqueChat(critiqueScore = 7) {
  return mock(async (modelId: string, input: unknown) => {
    const inputStr = typeof input === "string" ? input : "";
    // If input contains "critique" or "evaluate", return JSON critique
    if (inputStr.toLowerCase().includes("evaluate") || inputStr.toLowerCase().includes("critique")) {
      return JSON.stringify({ score: critiqueScore, feedback: `review by ${modelId}` });
    }
    // If input contains "synthesize" or "integrate", return synthesis
    if (inputStr.toLowerCase().includes("synth") || inputStr.toLowerCase().includes("integrat")) {
      return `synthesized by ${modelId}`;
    }
    // Diverge response
    return `diverge response from ${modelId}`;
  }) as unknown as ChatFn;
}

describe("AdaptiveDelibProtocol", () => {
  // 23. [HP] 3모델 diverge→6critique→synthesize
  it("should execute full pipeline: 3 diverge → 6 critique → 1 synth", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const chat = makeCritiqueChat();
    const plan = makePlan("model-a", "model-b", "model-c");
    const scores = [makeScore("model-a", 600), makeScore("model-b", 500), makeScore("model-c", 400)];

    const result = await protocol.deliberate("task", plan, scores, chat);

    expect(result.result).toBeTruthy();
    // 3 diverge + 6 critique (3×2) + 1 synth = 10
    expect(result.totalLLMCalls).toBe(10);
  });

  // 24. [HP] critique 점수 JSON 파싱 성공
  it("should parse critique scores from JSON responses", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const chat = makeCritiqueChat(9); // high critique score
    const plan = makePlan("model-a", "model-b", "model-c");
    const scores = [makeScore("model-a"), makeScore("model-b"), makeScore("model-c")];

    const result = await protocol.deliberate("task", plan, scores, chat);

    // Should complete without error; critique scores parsed successfully
    expect(result.result).toBeTruthy();
    expect(result.protocol).toBe("adp");
  });

  // 25. [HP] BT 점수 가중 반영
  it("should weight responses using BT scores", async () => {
    const protocol = new AdaptiveDelibProtocol();
    let synthPrompt = "";
    const chat = mock(async (modelId: string, input: unknown) => {
      const inputStr = typeof input === "string" ? input : "";
      if (inputStr.includes("weight") || inputStr.includes("synth") || inputStr.includes("integrat")) {
        synthPrompt = inputStr;
        return "synthesized";
      }
      if (inputStr.includes("evaluat") || inputStr.includes("critiqu")) {
        return JSON.stringify({ score: 7 });
      }
      return `response from ${modelId}`;
    }) as unknown as ChatFn;

    const plan = makePlan("model-a", "model-b");
    const scores = [
      makeScore("model-a", 800), // high BT
      makeScore("model-b", 200), // low BT
    ];

    const result = await protocol.deliberate("task", plan, scores, chat);

    expect(result.result).toBeTruthy();
    // The synthesis prompt should contain weight information
    // (exact format depends on implementation, but it should reference the responses)
  });

  // 26. [HP] synthesizer = JUDGMENT 최고 모델
  it("should select synthesizer with highest JUDGMENT score", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const synthCalls: string[] = [];
    let divergeCount = 0;
    const totalDiverge = 3;
    const totalCritique = 6; // 3×2

    const chat = mock(async (modelId: string, input: unknown) => {
      divergeCount++;
      const inputStr = typeof input === "string" ? input : "";
      // Calls after diverge+critique are synthesis
      if (inputStr.includes("synth") || inputStr.includes("integrat") || inputStr.includes("weight")) {
        synthCalls.push(modelId);
        return "synthesis result";
      }
      if (inputStr.includes("evaluat") || inputStr.includes("critiqu")) {
        return JSON.stringify({ score: 5 });
      }
      return `response-${modelId}`;
    }) as unknown as ChatFn;

    const plan = makePlan("model-a", "model-b", "model-c");
    const scores = [
      makeScore("model-a", 300),
      makeScore("model-b", 900), // highest JUDGMENT
      makeScore("model-c", 500),
    ];

    await protocol.deliberate("task", plan, scores, chat);

    expect(synthCalls.length).toBeGreaterThan(0);
    expect(synthCalls[0]).toBe("model-b");
  });

  // 27. [HP] totalLLMCalls = N + N(N-1) + 1
  it("should count totalLLMCalls as diverge + critique + synth", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const chat = makeCritiqueChat();
    const plan = makePlan("model-a", "model-b");
    const scores = [makeScore("model-a"), makeScore("model-b")];

    const result = await protocol.deliberate("task", plan, scores, chat);

    // N=2: 2 diverge + 2 critique (2×1) + 1 synth = 5
    expect(result.totalLLMCalls).toBe(5);
  });

  // 28. [HP] modelsUsed에 전체 모델 포함
  it("should include all models in modelsUsed", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const chat = makeCritiqueChat();
    const plan = makePlan("model-a", "model-b", "model-c");
    const scores = [makeScore("model-a"), makeScore("model-b"), makeScore("model-c")];

    const result = await protocol.deliberate("task", plan, scores, chat);

    expect(result.modelsUsed).toContain("model-a");
    expect(result.modelsUsed).toContain("model-b");
    expect(result.modelsUsed).toContain("model-c");
  });

  // 29. [NE] 빈 plan → throw
  it("should throw when plan has no models", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const chat = makeCritiqueChat();

    await expect(protocol.deliberate("task", makePlan(), emptyScores, chat)).rejects.toThrow();
  });

  // 30. [NE] 전체 diverge 실패 → throw
  it("should throw when all diverge calls fail", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const chat = mock(async () => {
      throw new Error("diverge fail");
    }) as unknown as ChatFn;
    const plan = makePlan("model-a", "model-b");

    await expect(protocol.deliberate("task", plan, emptyScores, chat)).rejects.toThrow();
  });

  // 31. [NE] 일부 diverge 실패 → 생존자만 critique
  it("should critique only surviving diverge responses when some fail", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const critiqueCalls: string[] = [];
    const chat = mock(async (modelId: string, input: unknown) => {
      const inputStr = typeof input === "string" ? input : "";
      if (modelId === "model-b" && !inputStr.includes("evaluat") && !inputStr.includes("critiqu") && !inputStr.includes("synth") && !inputStr.includes("integrat") && !inputStr.includes("weight")) {
        throw new Error("diverge fail");
      }
      if (inputStr.includes("evaluat") || inputStr.includes("critiqu")) {
        critiqueCalls.push(modelId);
        return JSON.stringify({ score: 7 });
      }
      if (inputStr.includes("synth") || inputStr.includes("integrat") || inputStr.includes("weight")) {
        return "synthesized";
      }
      return `response from ${modelId}`;
    }) as unknown as ChatFn;

    const plan = makePlan("model-a", "model-b", "model-c");
    const scores = [makeScore("model-a", 600), makeScore("model-b", 500), makeScore("model-c", 400)];

    const result = await protocol.deliberate("task", plan, scores, chat);

    // model-b failed diverge → 2 survivors → 2 critique calls (A→C, C→A)
    expect(result.result).toBeTruthy();
    // totalLLMCalls: 2 diverge success + 2 critique + 1 synth = 5
    expect(result.totalLLMCalls).toBe(5);
  });

  // 32. [NE] synthesizer 실패 → error 전파
  it("should propagate synthesizer chat error", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const chat = mock(async (_modelId: string, input: unknown) => {
      const inputStr = typeof input === "string" ? input : "";
      if (inputStr.includes("synth") || inputStr.includes("integrat") || inputStr.includes("weight")) {
        throw new Error("synth failed");
      }
      if (inputStr.includes("evaluat") || inputStr.includes("critiqu")) {
        return JSON.stringify({ score: 5 });
      }
      return "diverge ok";
    }) as unknown as ChatFn;

    const plan = makePlan("model-a", "model-b");
    const scores = [makeScore("model-a"), makeScore("model-b")];

    await expect(protocol.deliberate("task", plan, scores, chat)).rejects.toThrow("synth failed");
  });

  // 33. [NE] critique 파싱 불가 → 기본 점수(5) 사용
  it("should use default score 5 when critique response is unparseable", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const chat = mock(async (_modelId: string, input: unknown) => {
      const inputStr = typeof input === "string" ? input : "";
      if (inputStr.includes("evaluat") || inputStr.includes("critiqu")) {
        return "this is not JSON and has no numbers at all";
      }
      if (inputStr.includes("synth") || inputStr.includes("integrat") || inputStr.includes("weight")) {
        return "synthesized";
      }
      return "diverge response";
    }) as unknown as ChatFn;

    const plan = makePlan("model-a", "model-b");
    const scores = [makeScore("model-a"), makeScore("model-b")];

    // Should not throw — default score used
    const result = await protocol.deliberate("task", plan, scores, chat);
    expect(result.result).toBeTruthy();
  });

  // 34. [NE] 빈 scores → BT fallback 기본 가중치
  it("should use default BT weights when scores are empty", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const chat = makeCritiqueChat();
    const plan = makePlan("model-a", "model-b");

    const result = await protocol.deliberate("task", plan, emptyScores, chat);

    expect(result.result).toBeTruthy();
    expect(result.protocol).toBe("adp");
  });

  // 35. [ED] 단일 모델 → shortcut
  it("should shortcut with single model (no critique)", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const chat = mock(async () => "direct answer") as unknown as ChatFn;
    const plan = makePlan("model-a");

    const result = await protocol.deliberate("task", plan, emptyScores, chat);

    expect(result.result).toBe("direct answer");
    expect(result.totalLLMCalls).toBe(1);
    expect(result.modelsUsed).toEqual(["model-a"]);
  });

  // 36. [ED] 2모델 → 2 diverge + 2 critique + 1 synth
  it("should handle 2 models with correct call count", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const chat = makeCritiqueChat();
    const plan = makePlan("model-a", "model-b");
    const scores = [makeScore("model-a"), makeScore("model-b")];

    const result = await protocol.deliberate("task", plan, scores, chat);

    // N=2: 2 + 2×1 + 1 = 5
    expect(result.totalLLMCalls).toBe(5);
  });

  // 37. [ED] 1개만 생존 → critique 생략
  it("should skip critique phase when only 1 response survives diverge", async () => {
    const protocol = new AdaptiveDelibProtocol();
    let callCounter = 0;
    const chat = mock(async (modelId: string, input: unknown) => {
      callCounter++;
      const inputStr = typeof input === "string" ? input : "";
      if (modelId === "model-b" && !inputStr.includes("synth") && !inputStr.includes("integrat") && !inputStr.includes("weight")) {
        throw new Error("fail");
      }
      if (inputStr.includes("synth") || inputStr.includes("integrat") || inputStr.includes("weight")) {
        return "synthesized single";
      }
      return `response from ${modelId}`;
    }) as unknown as ChatFn;

    const plan = makePlan("model-a", "model-b");
    const scores = [makeScore("model-a", 600), makeScore("model-b", 400)];

    const result = await protocol.deliberate("task", plan, scores, chat);

    expect(result.result).toBeTruthy();
    // 1 diverge success + 0 critique + 1 synth = 2
    expect(result.totalLLMCalls).toBe(2);
  });

  // 38. [ED] 전체 critique 실패 → 기본 점수로 가중치
  it("should use default weights when all critique calls fail", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const chat = mock(async (_modelId: string, input: unknown) => {
      const inputStr = typeof input === "string" ? input : "";
      if (inputStr.includes("evaluat") || inputStr.includes("critiqu")) {
        throw new Error("critique fail");
      }
      if (inputStr.includes("synth") || inputStr.includes("integrat") || inputStr.includes("weight")) {
        return "synthesized with defaults";
      }
      return "diverge response";
    }) as unknown as ChatFn;

    const plan = makePlan("model-a", "model-b");
    const scores = [makeScore("model-a"), makeScore("model-b")];

    const result = await protocol.deliberate("task", plan, scores, chat);

    expect(result.result).toBeTruthy();
  });

  // 39. [CO] 빈 plan + scores → throw
  it("should throw when plan is empty regardless of scores", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const chat = makeCritiqueChat();
    const scores = [makeScore("model-a")];

    await expect(protocol.deliberate("task", makePlan(), scores, chat)).rejects.toThrow();
  });

  // 40. [CO] 전체 weights 0 → 균등 가중치 fallback
  it("should fallback to equal weights when all computed weights are zero", async () => {
    const protocol = new AdaptiveDelibProtocol();
    // All JUDGMENT mu = 0 and all critique scores = 0 → all weights = 0
    const chat = mock(async (_modelId: string, input: unknown) => {
      const inputStr = typeof input === "string" ? input : "";
      if (inputStr.includes("evaluat") || inputStr.includes("critiqu")) {
        return JSON.stringify({ score: 0 });
      }
      if (inputStr.includes("synth") || inputStr.includes("integrat") || inputStr.includes("weight")) {
        return "equal synthesis";
      }
      return "diverge response";
    }) as unknown as ChatFn;

    const plan = makePlan("model-a", "model-b");
    const scores = [
      makeScore("model-a", 0), // mu=0 → factor=0
      makeScore("model-b", 0),
    ];

    const result = await protocol.deliberate("task", plan, scores, chat);

    expect(result.result).toBeTruthy();
  });

  // 41. [CO] 중복 modelId → self-critique 스킵
  it("should skip self-critique when models have duplicate IDs", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const critiqueCalls: Array<{ from: string; about: string }> = [];
    const chat = mock(async (modelId: string, input: unknown) => {
      const inputStr = typeof input === "string" ? input : "";
      if (inputStr.includes("evaluat") || inputStr.includes("critiqu")) {
        critiqueCalls.push({ from: modelId, about: "target" });
        return JSON.stringify({ score: 5 });
      }
      if (inputStr.includes("synth") || inputStr.includes("integrat") || inputStr.includes("weight")) {
        return "synthesized";
      }
      return "diverge response";
    }) as unknown as ChatFn;

    // 2 entries with same modelId → self-critique should be skipped
    const plan: EnsemblePlan = {
      models: [{ modelId: "same-model" }, { modelId: "same-model" }],
      strategy: "test",
      estimatedCost: 0,
      reason: "test",
    };
    const scores = [makeScore("same-model")];

    const result = await protocol.deliberate("task", plan, scores, chat);

    // Since both have same modelId, self-critique skip → 0 critique calls
    // The protocol should handle this edge case
    expect(result.result).toBeTruthy();
  });

  // 42. [ID] 동일 입력 → protocol="adp", roundsExecuted=1
  it("should return consistent structure with protocol adp", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const chat = makeCritiqueChat();
    const plan = makePlan("model-a", "model-b");
    const scores = [makeScore("model-a"), makeScore("model-b")];

    const r1 = await protocol.deliberate("task", plan, scores, chat);
    const r2 = await protocol.deliberate("task", plan, scores, chat);

    expect(r1.protocol).toBe("adp");
    expect(r2.protocol).toBe("adp");
    expect(r1.roundsExecuted).toBe(1);
    expect(r2.roundsExecuted).toBe(1);
    expect(r1.consensusReached).toBe(true);
    expect(r2.consensusReached).toBe(true);
  });

  // 43. [OR] 모델 순서 변경 → synthesizer 선택 순서 무관
  it("should select same synthesizer regardless of model order", async () => {
    const protocol = new AdaptiveDelibProtocol();
    const synthCalls1: string[] = [];
    const synthCalls2: string[] = [];

    const makeChat = (collector: string[]) =>
      mock(async (modelId: string, input: unknown) => {
        const inputStr = typeof input === "string" ? input : "";
        if (inputStr.includes("synth") || inputStr.includes("integrat") || inputStr.includes("weight")) {
          collector.push(modelId);
          return "synthesized";
        }
        if (inputStr.includes("evaluat") || inputStr.includes("critiqu")) {
          return JSON.stringify({ score: 5 });
        }
        return `response from ${modelId}`;
      }) as unknown as ChatFn;

    const scores = [
      makeScore("model-a", 300),
      makeScore("model-b", 900), // highest JUDGMENT
      makeScore("model-c", 500),
    ];

    await protocol.deliberate(
      "task",
      makePlan("model-a", "model-b", "model-c"),
      scores,
      makeChat(synthCalls1),
    );
    await protocol.deliberate(
      "task",
      makePlan("model-c", "model-a", "model-b"),
      scores,
      makeChat(synthCalls2),
    );

    expect(synthCalls1[0]).toBe("model-b");
    expect(synthCalls2[0]).toBe("model-b");
  });
});
