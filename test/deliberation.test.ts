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
import type { ModelInfo } from "../src/model/types";

// ============================================================
// Fixtures — 3 providers x 1 model each (diversity guarantee)
// ============================================================

const MODEL_A: ModelInfo = {
  id: "openai/gpt-4.1",
  name: "GPT-4.1",
  provider: "anthropic",
  contextWindow: 128000,
  cost: { inputPer1M: 2, outputPer1M: 8 },
  supportsToolCalling: true,
};

const MODEL_B: ModelInfo = {
  id: "meta/llama-4-scout",
  name: "Llama 4 Scout",
  provider: "anthropic",
  contextWindow: 512000,
  cost: { inputPer1M: 0.5, outputPer1M: 1 },
  supportsToolCalling: true,
};

const MODEL_C: ModelInfo = {
  id: "mistralai/mistral-large",
  name: "Mistral Large",
  provider: "anthropic",
  contextWindow: 128000,
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

function validWorker(label: string): string {
  return label;
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
      models: FIXTURE_MODEL_IDS, protocol: "shared_convergence" as const,
      maxRounds: 1,
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
    let callNum = 0;
    const chatFn = mock(async (_model: string, _messages: ChatMessage[]) => {
      return chatResult(validWorker(`Worker response ${++callNum} ${"x".repeat(callNum * 40)}`));
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Implement error handler",
      models: FIXTURE_MODEL_IDS, protocol: "shared_convergence" as const,
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
    let callNum = 0;
    const chatFn = mock(async (_model: string, _messages: ChatMessage[]) => {
      return chatResult(validWorker(`Worker attempt ${++callNum} ${"y".repeat(callNum * 40)}`));
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Hard problem",
      models: FIXTURE_MODEL_IDS, protocol: "shared_convergence" as const,
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
    const capturedUserMessages: string[] = [];
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
      capturedUserMessages.push(userMsg);
      return chatResult(validWorker("Worker output"));
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    await fn({
      task: "Instruction test",
      models: FIXTURE_MODEL_IDS, protocol: "shared_convergence" as const,
      workerInstructions: "Use TypeScript strictly",
    });

    // Assert — worker instructions appear in user message (moved from system for caching).
    const workerMsgs = capturedUserMessages.filter(
      (msg) => msg.includes("Use TypeScript strictly"),
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
      models: FIXTURE_MODEL_IDS, protocol: "shared_convergence" as const,
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
      fn({ task: "", models: FIXTURE_MODEL_IDS, protocol: "shared_convergence" }),
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
      models: FIXTURE_MODEL_IDS, protocol: "shared_convergence" as const,
      maxRounds: 1,
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
    const result1 = await fn({ task: "Call 1", models: FIXTURE_MODEL_IDS, protocol: "shared_convergence", maxRounds: 1 });
    const result2 = await fn({ task: "Call 2", models: FIXTURE_MODEL_IDS, protocol: "shared_convergence", maxRounds: 1 });

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
    let callNum = 0;
    const chatFn = mock(async (_model: string, _messages: ChatMessage[]) => {
      return chatResult(validWorker(`Worker response ${++callNum} ${"t".repeat(callNum * 40)}`), 30, 60);
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Token accumulation test",
      models: FIXTURE_MODEL_IDS, protocol: "shared_convergence" as const,
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

  // ----------------------------------------------------------
  // 10. [HP] sequential_refinement — workers run sequentially
  // ----------------------------------------------------------
  it("should run sequential refinement (A→B→C chain)", async () => {
    const callOrder: string[] = [];
    const chatFn = mock(async (model: string, messages: ChatMessage[]) => {
      callOrder.push(model);
      const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
      // After first worker, should see <previous-version>
      if (callOrder.length > 1) {
        expect(userMsg).toContain("<previous-version>");
      }
      return chatResult(`Output from ${model}`);
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });
    const result = await fn({
      task: "Refactor this function",
      models: FIXTURE_MODEL_IDS, protocol: "sequential_refinement" as const,
      maxRounds: 1,
    });

    expect(result.roundsExecuted).toBe(1);
    expect(result.protocol).toBe("sequential_refinement");
    // Workers should run sequentially — callOrder reflects insertion order
    expect(callOrder.length).toBe(3);
  });

  // ----------------------------------------------------------
  // 11. [HP] host_interrogation — workers get questions
  // ----------------------------------------------------------
  it("should run host interrogation with different questions", async () => {
    const receivedQuestions: string[] = [];
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
      const qMatch = userMsg.match(/<question>(.*?)<\/question>/);
      if (qMatch) receivedQuestions.push(qMatch[1]!);
      return chatResult("Answer to the question");
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });
    const result = await fn({
      task: "Analyze system bottlenecks",
      models: FIXTURE_MODEL_IDS, protocol: "host_interrogation" as const,
      maxRounds: 1,
      questions: ["DB bottleneck?", "Network latency?", "Memory pressure?"],
    });

    expect(result.roundsExecuted).toBe(1);
    expect(result.protocol).toBe("host_interrogation");
    expect(receivedQuestions).toContain("DB bottleneck?");
    expect(receivedQuestions).toContain("Network latency?");
    expect(receivedQuestions).toContain("Memory pressure?");
  });

  // ----------------------------------------------------------
  // 12. [HP] evaluation_scoring — independent scoring + aggregation
  // ----------------------------------------------------------
  it("should run evaluation scoring with aggregation", async () => {
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
      expect(userMsg).toContain("<evaluation-criteria>");
      expect(userMsg).toContain("<subject>");
      return chatResult("score: 8\nverdict: Good quality implementation");
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });
    const result = await fn({
      task: "Evaluate this code",
      models: FIXTURE_MODEL_IDS, protocol: "evaluation_scoring" as const,
      maxRounds: 1,
      criteria: "correctness, readability, performance",
      subject: "function sort(arr) { return arr.sort(); }",
    });

    expect(result.roundsExecuted).toBe(1);
    expect(result.protocol).toBe("evaluation_scoring");
    expect(result.aggregation).toBeDefined();
    expect(result.aggregation!.method).toBe("voting");
    expect(result.aggregation!.results.length).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------
  // 13. [HP] red_team — generator then attacker
  // ----------------------------------------------------------
  it("should run red team with generator/attacker rounds", async () => {
    let roundNum = 0;
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      roundNum++;
      const sysMsg = messages.find((m) => m.role === "system")?.content ?? "";
      // First round: generators produce
      // Second round: attackers analyze
      if (sysMsg.includes("Find vulnerabilities")) {
        const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
        expect(userMsg).toContain("<target-output>");
        return chatResult("Found SQL injection vulnerability");
      }
      return chatResult("Secure login implementation");
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });
    const result = await fn({
      task: "Build authentication system",
      models: FIXTURE_MODEL_IDS, protocol: "red_team" as const,
      maxRounds: 2,
    });

    expect(result.roundsExecuted).toBe(2);
    expect(result.protocol).toBe("red_team");
  });

  // ----------------------------------------------------------
  // 14. [HP] adversarial_debate — steelman constraints present
  // ----------------------------------------------------------
  it("should include steelman constraints in adversarial debate R2", async () => {
    let callNum = 0;
    const capturedR2Messages: string[] = [];
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      callNum++;
      if (callNum > 3) { // R2 messages — get last user message (follow-up)
        const userMessages = messages.filter((m) => m.role === "user");
        const lastUser = userMessages[userMessages.length - 1]?.content ?? "";
        capturedR2Messages.push(lastUser);
      }
      return chatResult(`Response call ${callNum} ${"x".repeat(callNum * 40)}`);
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });
    await fn({
      task: "Compare Kafka vs RabbitMQ",
      models: FIXTURE_MODEL_IDS, protocol: "adversarial_debate" as const,
      maxRounds: 2,
    });

    // R2 messages should contain adversarial constraints
    expect(capturedR2Messages.length).toBeGreaterThan(0);
    const hassteelman = capturedR2Messages.some((msg) =>
      msg.includes("steelman") || msg.includes("strongest form")
    );
    expect(hassteelman).toBe(true);
  });

  // ----------------------------------------------------------
  // 15. [HP] sparse sharing — R2 workers don't see all positions
  // ----------------------------------------------------------
  it("should apply sparse sharing in R2 (not full mesh)", async () => {
    let round = 0;
    const r2AnalystCounts: number[] = [];
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      round++;
      const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
      if (round > 3) { // R2
        const analystCount = (userMsg.match(/One analyst argues/g) ?? []).length;
        r2AnalystCounts.push(analystCount);
      }
      return chatResult(`Position ${round}: unique content ${"y".repeat(round * 50)}`);
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });
    await fn({
      task: "Architecture decision",
      models: FIXTURE_MODEL_IDS, protocol: "shared_convergence" as const,
      maxRounds: 2,
    });

    // With 3 workers and groupSize=2, each worker should see at most 2 others
    for (const count of r2AnalystCounts) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });
});
