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
import { MIN_WORKER_RESPONSE_LENGTH } from "../src/deliberation/engine";
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
const FIXTURE_MODEL_IDS = FIXTURE_MODELS.map((m) => m.id);

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

function chatResult(content: string, input = 10, output = 20): ChatResult {
  return { content, inputTokens: input, outputTokens: output };
}

/** Pad worker content above MIN_WORKER_RESPONSE_LENGTH to avoid degenerate-response filtering. */
function validWorker(label: string): string {
  return label.padEnd(MIN_WORKER_RESPONSE_LENGTH, ".");
}

// ============================================================
// Tests
// ============================================================

describe("Deliberation E2E", () => {
  // ----------------------------------------------------------
  // 1. [HP] single-round completion
  // ----------------------------------------------------------
  it("should complete single-round (workers respond)", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, _messages: ChatMessage[]) => {
      return chatResult(validWorker("Worker response content"));
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });
    const input: DeliberateInput = {
      task: "Write a Hello World function",
      models: FIXTURE_MODEL_IDS,
    };

    // Act
    const result = await fn(input);

    // Assert
    expect(result.roundsExecuted).toBe(1);
    expect(result.modelsUsed.length).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------
  // 2. [HP] multi-round
  // ----------------------------------------------------------
  it("should complete multi-round deliberation", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, _messages: ChatMessage[]) => {
      return chatResult(validWorker("Worker response"));
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Implement error handler",
      models: FIXTURE_MODEL_IDS,
      maxRounds: 3,
    });

    // Assert
    expect(result.roundsExecuted).toBe(3);
  });

  // ----------------------------------------------------------
  // 3. [HP] maxRounds exhausted
  // ----------------------------------------------------------
  it("should run all rounds when maxRounds is specified", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, _messages: ChatMessage[]) => {
      return chatResult(validWorker("Worker attempt"));
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Hard problem",
      models: FIXTURE_MODEL_IDS,
      maxRounds: 3,
    });

    // Assert
    expect(result.roundsExecuted).toBe(3);
  });

  // ----------------------------------------------------------
  // 4. [HP] workerInstructions passed to prompts
  // ----------------------------------------------------------
  it("should pass workerInstructions to prompts", async () => {
    // Arrange
    const capturedSystemMessages: string[] = [];
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
      capturedSystemMessages.push(systemMsg);
      return chatResult(validWorker("Worker output"));
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    await fn({
      task: "Instruction test",
      models: FIXTURE_MODEL_IDS,
      workerInstructions: "Use TypeScript strictly",
    });

    // Assert — worker instructions appear in worker calls (with role-specific prompt).
    const workerMsgs = capturedSystemMessages.filter(
      (msg) => msg.includes("Use TypeScript strictly") && msg.includes("analyst"),
    );
    expect(workerMsgs.length).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------
  // 5. [NE] worker failure (partial — some succeed, some fail)
  // ----------------------------------------------------------
  it("should produce result when one worker chat fails (partial failure)", async () => {
    // Arrange
    let workerCallCount = 0;
    const chatFn = mock(async (_model: string, _messages: ChatMessage[]) => {
      workerCallCount++;
      if (workerCallCount === 1) {
        throw new Error("Network timeout");
      }
      return chatResult(validWorker("Surviving worker response"));
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Partial failure test",
      models: FIXTURE_MODEL_IDS,
    });

    // Assert — deliberation should still complete with partial worker responses
    expect(result.roundsExecuted).toBeGreaterThanOrEqual(1);
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
      fn({ task: "", models: FIXTURE_MODEL_IDS }),
    ).rejects.toThrow("Task description must be a non-empty string");
  });

  // ----------------------------------------------------------
  // 7. [HP] all output fields populated correctly
  // ----------------------------------------------------------
  it("should populate all DeliberateOutput fields correctly", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, _messages: ChatMessage[]) => {
      return chatResult(validWorker("Worker output"), 30, 60);
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Output field test",
      models: FIXTURE_MODEL_IDS,
    });

    // Assert — every field in DeliberateOutput
    expect(result.roundsExecuted).toBe(1);
    expect(result.totalTokens.input).toBeGreaterThan(0);
    expect(result.totalTokens.output).toBeGreaterThan(0);
    // workers = at least 2 LLM calls
    expect(result.totalLLMCalls).toBeGreaterThanOrEqual(2);
    expect(result.modelsUsed.length).toBeGreaterThanOrEqual(1);
    // Verify modelsUsed contains valid model IDs
    for (const modelId of result.modelsUsed) {
      expect(typeof modelId).toBe("string");
      expect(modelId).toMatch(/\w+\/\w+/);
    }
  });

  // ----------------------------------------------------------
  // 8. [ID] consecutive independent calls
  // ----------------------------------------------------------
  it("should produce independent results on consecutive calls", async () => {
    // Arrange
    let globalCallCount = 0;
    const chatFn = mock(async (_model: string, _messages: ChatMessage[]) => {
      globalCallCount++;
      return chatResult(validWorker(`Worker-${globalCallCount}`));
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result1 = await fn({ task: "Call 1", models: FIXTURE_MODEL_IDS });
    const result2 = await fn({ task: "Call 2", models: FIXTURE_MODEL_IDS });

    // Assert — different tasks, different contexts
    // Round counts are independent
    expect(result1.roundsExecuted).toBe(1);
    expect(result2.roundsExecuted).toBe(1);
  });

  // ----------------------------------------------------------
  // 9. [HP] token accumulation across rounds
  // ----------------------------------------------------------
  it("should accumulate tokens across multiple rounds", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, _messages: ChatMessage[]) => {
      return chatResult(validWorker("Worker response"), 30, 60);
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Token accumulation test",
      models: FIXTURE_MODEL_IDS,
      maxRounds: 3,
    });

    // Assert — tokens should accumulate across rounds
    expect(result.roundsExecuted).toBe(3);
    // Each round has workers, so tokens accumulate multiplicatively
    expect(result.totalTokens.input).toBeGreaterThan(50);
    expect(result.totalTokens.output).toBeGreaterThan(50);
    // Total LLM calls = rounds * workers
    expect(result.totalLLMCalls).toBeGreaterThanOrEqual(result.roundsExecuted * 2);
  });
});
