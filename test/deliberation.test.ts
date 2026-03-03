/**
 * Integration test — Deliberation E2E pipeline.
 *
 * SUT boundary (real implementations):
 *   wire.ts + team-composer.ts + engine.ts + prompts.ts + shared-context.ts
 *
 * Outside SUT (test-doubled):
 *   chat function — returns deterministic ChatResult based on role detection
 */

import { describe, it, expect, mock } from "bun:test";
import { createDeliberateFn } from "../src/deliberation/wire";
import type { DeliberateInput } from "../src/deliberation/types";
import type { ChatMessage } from "../src/llm/types";
import type { ChatResult } from "../src/deliberation/engine";
import type {
  ModelInfo,
  ModelCapabilities,
  DimensionRating,
  CapabilityDimension,
} from "../src/model/types";
import { ALL_DIMENSIONS } from "../src/model/types";

// ============================================================
// Fixtures — 3 providers x 1 model each (diversity guarantee)
// ============================================================

const DEFAULT_RATING: DimensionRating = { mu: 500, sigma: 350, comparisons: 0 };

function makeCapabilities(
  overrides: Partial<Record<CapabilityDimension, number>> = {},
): ModelCapabilities {
  const caps = {} as Record<CapabilityDimension, DimensionRating>;
  for (const dim of ALL_DIMENSIONS) {
    const v = overrides[dim];
    caps[dim] = v !== undefined
      ? { mu: v * 100, sigma: 350, comparisons: 0 }
      : DEFAULT_RATING;
  }
  return caps as ModelCapabilities;
}

const MODEL_A: ModelInfo = {
  id: "openai/gpt-4.1",
  name: "GPT-4.1",
  provider: "anthropic",
  contextWindow: 128000,
  capabilities: makeCapabilities({
    CODE_GENERATION: 9,
    REASONING: 9,
    JUDGMENT: 9,
    INSTRUCTION_FOLLOWING: 9,
    CREATIVITY: 8,
    ANALYSIS: 8,
  }),
  cost: { inputPer1M: 2, outputPer1M: 8 },
  supportsToolCalling: true,
};

const MODEL_B: ModelInfo = {
  id: "meta/llama-4-scout",
  name: "Llama 4 Scout",
  provider: "anthropic",
  contextWindow: 512000,
  capabilities: makeCapabilities({
    HALLUCINATION_RESISTANCE: 8,
    DEBUGGING: 8,
    ANALYSIS: 9,
    SPEED: 9,
    SYSTEM_THINKING: 8,
  }),
  cost: { inputPer1M: 0.5, outputPer1M: 1 },
  supportsToolCalling: true,
};

const MODEL_C: ModelInfo = {
  id: "mistralai/mistral-large",
  name: "Mistral Large",
  provider: "anthropic",
  contextWindow: 128000,
  capabilities: makeCapabilities({
    CREATIVITY: 9,
    SYSTEM_THINKING: 9,
    REASONING: 8,
    SELF_CONSISTENCY: 8,
    CODE_UNDERSTANDING: 8,
  }),
  cost: { inputPer1M: 2, outputPer1M: 6 },
  supportsToolCalling: true,
};

const FIXTURE_MODELS = [MODEL_A, MODEL_B, MODEL_C];

function fixtureRegistry() {
  return {
    getAll: () => [...FIXTURE_MODELS],
    getAvailable: () => [...FIXTURE_MODELS],
    getById: (id: string) => FIXTURE_MODELS.find((m) => m.id === id),
  };
}

// ============================================================
// Chat response helpers
// ============================================================

/** Detect role from system message content */
function detectRole(messages: ChatMessage[]): "worker" | "leader" {
  const system = messages.find((m) => m.role === "system");
  if (!system?.content) return "worker";
  if (system.content.includes("multiple responses")) return "leader";
  return "worker";
}

function chatResult(content: string, input = 10, output = 20): ChatResult {
  return { content, inputTokens: input, outputTokens: output };
}

// ============================================================
// Tests
// ============================================================

describe("Deliberation E2E", () => {
  // ----------------------------------------------------------
  // 1. [HP] single-round completion
  // ----------------------------------------------------------
  it("should complete single-round (workers respond, leader synthesizes, result)", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "leader") {
        return chatResult("Leader synthesis of all responses");
      }
      return chatResult("Worker response content");
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });
    const input: DeliberateInput = {
      task: "Write a Hello World function",
    };

    // Act
    const result = await fn(input);

    // Assert
    expect(result.consensusReached).toBe(true);
    expect(result.roundsExecuted).toBe(1);
    expect(result.result).toBe("Leader synthesis of all responses");
    expect(result.modelsUsed.length).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------
  // 2. [HP] multi-round with consensus mode (leader_decides)
  // ----------------------------------------------------------
  it("should complete multi-round consensus (continue then approve)", async () => {
    // Arrange
    let roundCount = 0;
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "leader") {
        roundCount++;
        if (roundCount === 1) {
          // Round 1: continue
          return chatResult(JSON.stringify({
            result: "Draft v1",
            decision: "continue",
          }));
        }
        // Round 2: approve
        return chatResult(JSON.stringify({
          result: "Revised v2",
          decision: "approve",
        }));
      }
      return chatResult("Worker response");
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Implement error handler",
      maxRounds: 3,
      consensus: "leader_decides",
    });

    // Assert
    expect(result.roundsExecuted).toBe(2);
    expect(result.consensusReached).toBe(true);
    expect(result.result).toBe("Revised v2");
  });

  // ----------------------------------------------------------
  // 3. [HP] maxRounds exhausted without consensus mode
  // ----------------------------------------------------------
  it("should run all rounds and report consensusReached=true when no consensus mode", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "leader") {
        return chatResult("Leader synthesis");
      }
      return chatResult("Worker attempt");
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Hard problem",
      maxRounds: 3,
    });

    // Assert — no consensus mode means completing all rounds = consensusReached
    expect(result.consensusReached).toBe(true);
    expect(result.roundsExecuted).toBe(3);
  });

  // ----------------------------------------------------------
  // 4. [HP] workerInstructions and leaderInstructions passed to prompts
  // ----------------------------------------------------------
  it("should pass workerInstructions and leaderInstructions to prompts", async () => {
    // Arrange
    const capturedSystemMessages: string[] = [];
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
      capturedSystemMessages.push(systemMsg);
      const role = detectRole(messages);
      if (role === "leader") {
        return chatResult("Leader output");
      }
      return chatResult("Worker output");
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    await fn({
      task: "Instruction test",
      workerInstructions: "Use TypeScript strictly",
      leaderInstructions: "Prioritize security",
    });

    // Assert — worker instructions appear in worker calls, leader instructions in leader call
    const workerMsgs = capturedSystemMessages.filter(
      (msg) => msg === "Use TypeScript strictly",
    );
    const leaderMsgs = capturedSystemMessages.filter(
      (msg) => msg === "Prioritize security",
    );
    expect(workerMsgs.length).toBeGreaterThanOrEqual(1);
    expect(leaderMsgs.length).toBe(1);
  });

  // ----------------------------------------------------------
  // 5. [NE] worker failure (partial — some succeed, some fail)
  // ----------------------------------------------------------
  it("should produce result when one worker chat fails (partial failure)", async () => {
    // Arrange
    let workerCallCount = 0;
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "leader") {
        return chatResult("Leader synthesis despite partial failure");
      }
      workerCallCount++;
      if (workerCallCount === 1) {
        throw new Error("Network timeout");
      }
      return chatResult("Surviving worker response");
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Partial failure test",
    });

    // Assert — deliberation should still complete with partial worker responses
    expect(result.roundsExecuted).toBeGreaterThanOrEqual(1);
    expect(result.result).toBeTruthy();
  });

  // ----------------------------------------------------------
  // 6. [NE] empty task → error
  // ----------------------------------------------------------
  it("should propagate error for invalid input (empty task)", async () => {
    // Arrange
    const chatFn = mock(async () => chatResult("unreachable"));
    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act & Assert
    expect(
      fn({ task: "" }),
    ).rejects.toThrow("Task description must be a non-empty string");
  });

  // ----------------------------------------------------------
  // 7. [ED] non-JSON leader responses → content returned as-is
  // ----------------------------------------------------------
  it("should return non-JSON leader response as-is when no consensus mode", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "leader") {
        return chatResult("Here is my plain text synthesis without JSON");
      }
      return chatResult("Worker plain text answer");
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Non-JSON test",
      maxRounds: 1,
    });

    // Assert — no JSON parsing attempted without consensus mode
    expect(result.roundsExecuted).toBe(1);
    expect(result.result).toBe("Here is my plain text synthesis without JSON");
    expect(result.consensusReached).toBe(true);
  });

  // ----------------------------------------------------------
  // 8. [HP] all output fields populated correctly
  // ----------------------------------------------------------
  it("should populate all DeliberateOutput fields correctly", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "leader") {
        return chatResult("Final leader output", 50, 100);
      }
      return chatResult("Worker output", 30, 60);
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Output field test",
    });

    // Assert — every field in DeliberateOutput
    expect(result.result).toBe("Final leader output");
    expect(result.roundsExecuted).toBe(1);
    expect(result.consensusReached).toBe(true);
    expect(result.totalTokens.input).toBeGreaterThan(0);
    expect(result.totalTokens.output).toBeGreaterThan(0);
    // workers + leader = at least 2 LLM calls
    expect(result.totalLLMCalls).toBeGreaterThanOrEqual(2);
    expect(result.modelsUsed.length).toBeGreaterThanOrEqual(1);
    // Verify modelsUsed contains valid model IDs
    for (const modelId of result.modelsUsed) {
      expect(typeof modelId).toBe("string");
      expect(modelId).toMatch(/\w+\/\w+/);
    }
  });

  // ----------------------------------------------------------
  // 9. [ID] consecutive independent calls
  // ----------------------------------------------------------
  it("should produce independent results on consecutive calls", async () => {
    // Arrange
    let globalCallCount = 0;
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      globalCallCount++;
      const role = detectRole(messages);
      if (role === "leader") {
        return chatResult(`Leader-${globalCallCount}`);
      }
      return chatResult(`Worker-${globalCallCount}`);
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result1 = await fn({ task: "Call 1" });
    const result2 = await fn({ task: "Call 2" });

    // Assert — different tasks, different contexts
    // Both reach consensus independently
    expect(result1.consensusReached).toBe(true);
    expect(result2.consensusReached).toBe(true);
    // Results differ (different globalCallCount at leader time)
    expect(result1.result).not.toBe(result2.result);
    // Round counts are independent
    expect(result1.roundsExecuted).toBe(1);
    expect(result2.roundsExecuted).toBe(1);
  });

  // ----------------------------------------------------------
  // 10. [HP] token accumulation across rounds
  // ----------------------------------------------------------
  it("should accumulate tokens across multiple rounds", async () => {
    // Arrange
    let leaderRound = 0;
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "leader") {
        leaderRound++;
        if (leaderRound < 3) {
          return chatResult(
            JSON.stringify({ result: `Round ${leaderRound}`, decision: "continue" }),
            50,
            100,
          );
        }
        return chatResult(
          JSON.stringify({ result: "Final", decision: "approve" }),
          50,
          100,
        );
      }
      return chatResult("Worker response", 30, 60);
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Token accumulation test",
      maxRounds: 5,
      consensus: "leader_decides",
    });

    // Assert — tokens should accumulate across rounds
    expect(result.roundsExecuted).toBeGreaterThan(1);
    // Each round has workers + leader, so tokens accumulate multiplicatively
    // With 3 rounds, minimum tokens = 3 * (N_workers * 30 + 50) input
    expect(result.totalTokens.input).toBeGreaterThan(100);
    expect(result.totalTokens.output).toBeGreaterThan(100);
    // Total LLM calls = rounds * (workers + 1 leader)
    expect(result.totalLLMCalls).toBeGreaterThanOrEqual(result.roundsExecuted * 2);
  });
});
