/**
 * Unit tests for poll-judge.ts — PoLL (Panel of LLM Judges).
 *
 * SUT: evaluateWithPoll, selectJudges
 * All external dependencies (chatFn, getAvailableModels) are test-doubled.
 */

import { describe, it, expect, mock } from "bun:test";
import { evaluateWithPoll, selectJudges } from "./poll-judge";
import type { PollJudgeConfig } from "./poll-judge";
import type { ModelInfo } from "../model/types";
import type { WorkerResponse } from "./types";

// -- Fixtures --

function makeModel(id: string, cost = 1): ModelInfo {
  return {
    id,
    name: id.split("/")[1] ?? id,
    provider: id.split("/")[0] as any,
    contextWindow: 128_000,
    capabilities: {} as any,
    cost: { inputPer1M: cost, outputPer1M: cost },
    supportsToolCalling: true,
  };
}

const WORKER_RESPONSES: WorkerResponse[] = [
  { model: "anthropic/claude-sonnet-4.6", content: "Response A content" },
  { model: "google/gemini-2.5-pro", content: "Response B content" },
];

function makeJudgeResponse(scores: { id: number; score: number }[]): string {
  return JSON.stringify(
    scores.map((s) => ({
      id: s.id,
      relevance: s.score,
      accuracy: s.score,
      completeness: s.score,
      score: s.score,
    })),
  );
}

function makeConfig(overrides?: {
  chatFn?: PollJudgeConfig["chatFn"];
  models?: ModelInfo[];
}): PollJudgeConfig {
  const models = overrides?.models ?? [
    makeModel("openai/gpt-4.1", 2),
    makeModel("deepseek/deepseek-r1", 1),
    makeModel("mistral/mistral-large", 3),
  ];

  return {
    chatFn: overrides?.chatFn ?? mock(async () => ({
      content: makeJudgeResponse([
        { id: 0, score: 7 },
        { id: 1, score: 5 },
      ]),
      inputTokens: 100,
      outputTokens: 50,
    })),
    getAvailableModels: () => models,
  };
}

// -- Tests --

describe("evaluateWithPoll", () => {
  it("should produce median scores and pairwise comparisons from 3-model panel", async () => {
    // Arrange — 3 judges return slightly different scores
    let callCount = 0;
    const chatFn = mock(async () => {
      callCount++;
      const scores = [
        [{ id: 0, score: 8 }, { id: 1, score: 4 }], // judge 1
        [{ id: 0, score: 7 }, { id: 1, score: 5 }], // judge 2
        [{ id: 0, score: 9 }, { id: 1, score: 3 }], // judge 3
      ];
      return {
        content: makeJudgeResponse(scores[callCount - 1]!),
        inputTokens: 100,
        outputTokens: 50,
      };
    });

    const teamIds = new Set(["anthropic/claude-sonnet-4.6", "google/gemini-2.5-pro"]);
    const config = makeConfig({ chatFn });

    // Act
    const result = await evaluateWithPoll("Test task", WORKER_RESPONSES, teamIds, config);

    // Assert
    expect(result.judgeModels).toHaveLength(3);
    expect(result.workerScores).toHaveLength(2);
    expect(result.workerScores[0]!.model).toBe("anthropic/claude-sonnet-4.6");
    expect(result.workerScores[0]!.score).toBe(8); // median of [8, 7, 9]
    expect(result.workerScores[1]!.score).toBe(4); // median of [4, 5, 3]

    // Diff = 8 - 4 = 4 ≥ 3 → A>>B
    expect(result.pairwise).toHaveLength(1);
    expect(result.pairwise[0]!.outcome).toBe("A>>B");
    expect(result.pairwise[0]!.dimension).toBe("JUDGMENT");
  });

  it("should work with only 2 available judges", async () => {
    // Arrange — only 2 cross-family models available
    let callCount = 0;
    const chatFn = mock(async () => {
      callCount++;
      const scores = [
        [{ id: 0, score: 6 }, { id: 1, score: 4 }],
        [{ id: 0, score: 8 }, { id: 1, score: 4 }],
      ];
      return {
        content: makeJudgeResponse(scores[callCount - 1]!),
        inputTokens: 100,
        outputTokens: 50,
      };
    });

    const teamIds = new Set(["anthropic/claude-sonnet-4.6", "google/gemini-2.5-pro"]);
    const config = makeConfig({
      chatFn,
      models: [
        makeModel("openai/gpt-4.1", 2),
        makeModel("deepseek/deepseek-r1", 1),
      ],
    });

    // Act
    const result = await evaluateWithPoll("Test task", WORKER_RESPONSES, teamIds, config);

    // Assert
    expect(result.judgeModels).toHaveLength(2);
    expect(result.workerScores).toHaveLength(2);
    // median of [6, 8] = 7, median of [4, 4] = 4
    expect(result.workerScores[0]!.score).toBe(7);
    expect(result.workerScores[1]!.score).toBe(4);
  });

  it("should return empty result when fewer than 2 judges available", async () => {
    // Arrange — only 1 non-team model available
    const teamIds = new Set(["anthropic/claude-sonnet-4.6", "google/gemini-2.5-pro"]);
    const config = makeConfig({
      models: [makeModel("openai/gpt-4.1", 2)],
    });

    // Act
    const result = await evaluateWithPoll("Test task", WORKER_RESPONSES, teamIds, config);

    // Assert
    expect(result.workerScores).toHaveLength(0);
    expect(result.pairwise).toHaveLength(0);
    expect(result.judgeModels).toHaveLength(0);
  });

  it("should handle 1 judge error and still aggregate from remaining", async () => {
    // Arrange — first judge fails, other 2 succeed
    let callCount = 0;
    const chatFn = mock(async () => {
      callCount++;
      if (callCount === 1) throw new Error("API timeout");
      return {
        content: makeJudgeResponse([
          { id: 0, score: 7 },
          { id: 1, score: 5 },
        ]),
        inputTokens: 100,
        outputTokens: 50,
      };
    });

    const teamIds = new Set(["anthropic/claude-sonnet-4.6", "google/gemini-2.5-pro"]);
    const config = makeConfig({ chatFn });

    // Act
    const result = await evaluateWithPoll("Test task", WORKER_RESPONSES, teamIds, config);

    // Assert
    expect(result.judgeModels).toHaveLength(2); // 1 failed, 2 succeeded
    expect(result.workerScores).toHaveLength(2);
    expect(result.workerScores[0]!.score).toBe(7);
    expect(result.workerScores[1]!.score).toBe(5);
  });

  it("should exclude judge with invalid JSON and use remaining", async () => {
    // Arrange — first judge returns invalid JSON
    let callCount = 0;
    const chatFn = mock(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: "I cannot evaluate these responses as a JSON array.",
          inputTokens: 100,
          outputTokens: 50,
        };
      }
      return {
        content: makeJudgeResponse([
          { id: 0, score: 6 },
          { id: 1, score: 4 },
        ]),
        inputTokens: 100,
        outputTokens: 50,
      };
    });

    const teamIds = new Set(["anthropic/claude-sonnet-4.6", "google/gemini-2.5-pro"]);
    const config = makeConfig({ chatFn });

    // Act
    const result = await evaluateWithPoll("Test task", WORKER_RESPONSES, teamIds, config);

    // Assert
    expect(result.judgeModels).toHaveLength(2); // 1 bad JSON, 2 succeeded
    expect(result.workerScores[0]!.score).toBe(6);
  });

  it("should exclude same-provider models from judge panel (cross-family)", () => {
    // Arrange — team uses anthropic and google
    const available = [
      makeModel("anthropic/claude-haiku-4.5", 1),  // same provider as team
      makeModel("google/gemini-2.0-flash", 1),      // same provider as team
      makeModel("openai/gpt-4.1", 2),
      makeModel("deepseek/deepseek-r1", 1),
      makeModel("mistral/mistral-large", 3),
    ];

    const teamIds = new Set(["anthropic/claude-sonnet-4.6", "google/gemini-2.5-pro"]);

    // Act
    const judges = selectJudges(available, teamIds);

    // Assert — anthropic and google models excluded
    expect(judges.map((j) => j.id)).not.toContain("anthropic/claude-haiku-4.5");
    expect(judges.map((j) => j.id)).not.toContain("google/gemini-2.0-flash");
    expect(judges).toHaveLength(3);
    expect(judges.map((j) => j.id)).toEqual([
      "deepseek/deepseek-r1",
      "openai/gpt-4.1",
      "mistral/mistral-large",
    ]);
  });

  it("should not generate pairwise when score difference < 1 (tie)", async () => {
    // Arrange — judges give nearly equal scores
    const chatFn = mock(async () => ({
      content: makeJudgeResponse([
        { id: 0, score: 7 },
        { id: 1, score: 7 },
      ]),
      inputTokens: 100,
      outputTokens: 50,
    }));

    const teamIds = new Set(["anthropic/claude-sonnet-4.6", "google/gemini-2.5-pro"]);
    const config = makeConfig({ chatFn });

    // Act
    const result = await evaluateWithPoll("Test task", WORKER_RESPONSES, teamIds, config);

    // Assert — no pairwise generated for tie
    expect(result.pairwise).toHaveLength(0);
    expect(result.workerScores).toHaveLength(2);
  });

  it("should generate strong signal A>>B when difference >= 3", async () => {
    // Arrange — judges give large score gap
    const chatFn = mock(async () => ({
      content: makeJudgeResponse([
        { id: 0, score: 9 },
        { id: 1, score: 3 },
      ]),
      inputTokens: 100,
      outputTokens: 50,
    }));

    const teamIds = new Set(["anthropic/claude-sonnet-4.6", "google/gemini-2.5-pro"]);
    const config = makeConfig({ chatFn });

    // Act
    const result = await evaluateWithPoll("Test task", WORKER_RESPONSES, teamIds, config);

    // Assert — diff = 9 - 3 = 6 ≥ 3 → A>>B (strong signal)
    expect(result.pairwise).toHaveLength(1);
    expect(result.pairwise[0]!.outcome).toBe("A>>B");
    expect(result.pairwise[0]!.modelAId).toBe("anthropic/claude-sonnet-4.6");
    expect(result.pairwise[0]!.modelBId).toBe("google/gemini-2.5-pro");
  });

  it("should pass temperature=0 and max_tokens=1024 to judge chatFn", async () => {
    // Arrange
    const chatCalls: { model: string; params: any }[] = [];
    const chatFn = mock(async (_model: string, _messages: any, params?: any) => {
      chatCalls.push({ model: _model, params });
      return {
        content: makeJudgeResponse([
          { id: 0, score: 7 },
          { id: 1, score: 5 },
        ]),
        inputTokens: 100,
        outputTokens: 50,
      };
    });

    const teamIds = new Set(["anthropic/claude-sonnet-4.6", "google/gemini-2.5-pro"]);
    const config = makeConfig({ chatFn });

    // Act
    await evaluateWithPoll("Test task", WORKER_RESPONSES, teamIds, config);

    // Assert — every judge call should have T=0 and max_tokens=1024
    expect(chatCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of chatCalls) {
      expect(call.params).toEqual({ temperature: 0, max_tokens: 1024 });
    }
  });
});
