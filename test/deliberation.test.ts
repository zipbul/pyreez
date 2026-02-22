/**
 * Integration test — Deliberation E2E pipeline.
 *
 * SUT boundary (real implementations):
 *   wire.ts + team-composer.ts + engine.ts + prompts.ts + shared-context.ts
 *
 * Outside SUT (test-doubled):
 *   chat function — returns deterministic JSON based on role detection
 */

import { describe, it, expect, mock } from "bun:test";
import { createDeliberateFn } from "../src/deliberation/wire";
import type { DeliberateInput } from "../src/deliberation/types";
import type { ChatMessage } from "../src/llm/types";
import type {
  ModelInfo,
  ModelCapabilities,
  ModelConfidence,
  CapabilityDimension,
} from "../src/model/types";
import { ALL_DIMENSIONS } from "../src/model/types";

// ============================================================
// Fixtures — 3 providers × 1 model each (diversity guarantee)
// ============================================================

function makeCapabilities(
  overrides: Partial<Record<CapabilityDimension, number>> = {},
): ModelCapabilities {
  const caps = {} as Record<CapabilityDimension, number>;
  for (const dim of ALL_DIMENSIONS) {
    caps[dim] = overrides[dim] ?? 5;
  }
  return caps as ModelCapabilities;
}

function makeConfidence(value = 0.8): ModelConfidence {
  const conf = {} as Record<CapabilityDimension, number>;
  for (const dim of ALL_DIMENSIONS) {
    conf[dim] = value;
  }
  return conf as ModelConfidence;
}

const MODEL_A: ModelInfo = {
  id: "openai/gpt-4.1",
  name: "GPT-4.1",
  contextWindow: 128000,
  capabilities: makeCapabilities({
    CODE_GENERATION: 9,
    REASONING: 9,
    JUDGMENT: 9,
    INSTRUCTION_FOLLOWING: 9,
    CREATIVITY: 8,
    ANALYSIS: 8,
  }),
  confidence: makeConfidence(0.9),
  cost: { inputPer1M: 2, outputPer1M: 8 },
  supportsToolCalling: true,
};

const MODEL_B: ModelInfo = {
  id: "meta/llama-4-scout",
  name: "Llama 4 Scout",
  contextWindow: 512000,
  capabilities: makeCapabilities({
    HALLUCINATION_RESISTANCE: 8,
    DEBUGGING: 8,
    ANALYSIS: 9,
    SPEED: 9,
    SYSTEM_THINKING: 8,
  }),
  confidence: makeConfidence(0.8),
  cost: { inputPer1M: 0.5, outputPer1M: 1 },
  supportsToolCalling: true,
};

const MODEL_C: ModelInfo = {
  id: "mistralai/mistral-large",
  name: "Mistral Large",
  contextWindow: 128000,
  capabilities: makeCapabilities({
    CREATIVITY: 9,
    SYSTEM_THINKING: 9,
    REASONING: 8,
    SELF_CONSISTENCY: 8,
    CODE_UNDERSTANDING: 8,
  }),
  confidence: makeConfidence(0.85),
  cost: { inputPer1M: 2, outputPer1M: 6 },
  supportsToolCalling: true,
};

const FIXTURE_MODELS = [MODEL_A, MODEL_B, MODEL_C];

function fixtureRegistry() {
  return {
    getAll: () => [...FIXTURE_MODELS],
    getById: (id: string) => FIXTURE_MODELS.find((m) => m.id === id),
  };
}

// ============================================================
// Chat response helpers
// ============================================================

function producerResponse(content: string, revisionNotes?: string): string {
  return JSON.stringify({
    content,
    ...(revisionNotes ? { revisionNotes } : {}),
  });
}

function reviewerResponse(
  approval: boolean,
  reasoning: string,
  issues: { severity: string; description: string }[] = [],
): string {
  return JSON.stringify({ issues, approval, reasoning });
}

function leaderResponse(
  decision: "continue" | "approve" | "escalate",
  opts: {
    consensusStatus?: string;
    keyAgreements?: string[];
    keyDisagreements?: string[];
    actionItems?: string[];
  } = {},
): string {
  return JSON.stringify({
    consensusStatus: opts.consensusStatus ?? "progressing",
    keyAgreements: opts.keyAgreements ?? [],
    keyDisagreements: opts.keyDisagreements ?? [],
    actionItems: opts.actionItems ?? [],
    decision,
  });
}

/** Detect role from system message content */
function detectRole(messages: ChatMessage[]): "producer" | "reviewer" | "leader" {
  const system = messages.find((m) => m.role === "system");
  if (!system?.content) return "producer";
  if (system.content.includes("Producer")) return "producer";
  if (system.content.includes("Reviewer")) return "reviewer";
  if (system.content.includes("Leader")) return "leader";
  return "producer";
}

// ============================================================
// Tests
// ============================================================

describe("Deliberation E2E", () => {
  // ----------------------------------------------------------
  // 1. [HP] single-round consensus
  // ----------------------------------------------------------
  it("should complete single-round consensus with auto-selected team", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "producer") {
        return producerResponse("Hello World function implementation");
      }
      if (role === "reviewer") {
        return reviewerResponse(true, "Looks good");
      }
      return leaderResponse("approve", { consensusStatus: "reached" });
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });
    const input: DeliberateInput = {
      task: "Write a Hello World function",
      perspectives: ["보안", "성능"],
    };

    // Act
    const result = await fn(input);

    // Assert
    expect(result.consensusReached).toBe(true);
    expect(result.roundsExecuted).toBe(1);
    expect(result.result).toBe("Hello World function implementation");
    expect(result.modelsUsed.length).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------
  // 2. [HP] multi-round consensus (continue → approve)
  // ----------------------------------------------------------
  it("should complete multi-round consensus (continue then approve)", async () => {
    // Arrange
    let producerCallCount = 0;
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "producer") {
        producerCallCount++;
        if (producerCallCount === 1) {
          return producerResponse("Draft v1");
        }
        return producerResponse("Revised v2", "Incorporated feedback");
      }
      if (role === "reviewer") {
        if (producerCallCount === 1) {
          return reviewerResponse(false, "Needs improvement", [
            { severity: "major", description: "Missing error handling" },
          ]);
        }
        return reviewerResponse(true, "Improved version");
      }
      // Leader
      if (producerCallCount === 1) {
        return leaderResponse("continue", {
          consensusStatus: "progressing",
          actionItems: ["Add error handling"],
        });
      }
      return leaderResponse("approve", { consensusStatus: "reached" });
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Implement error handler",
      perspectives: ["보안", "품질"],
    });

    // Assert
    expect(result.roundsExecuted).toBe(2);
    expect(result.consensusReached).toBe(true);
    expect(result.result).toBe("Revised v2");
    expect(result.deliberationLog.rounds).toHaveLength(2);
    expect(result.deliberationLog.rounds[0]!.synthesis?.decision).toBe(
      "continue",
    );
    expect(result.deliberationLog.rounds[1]!.synthesis?.decision).toBe(
      "approve",
    );
  });

  // ----------------------------------------------------------
  // 3. [HP] maxRounds exhausted without consensus
  // ----------------------------------------------------------
  it("should exhaust maxRounds without consensus", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "producer") return producerResponse("Attempt");
      if (role === "reviewer") {
        return reviewerResponse(false, "Still not good", [
          { severity: "minor", description: "Style issue" },
        ]);
      }
      return leaderResponse("continue", { consensusStatus: "stalled" });
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Hard problem",
      perspectives: ["보안", "성능"],
      maxRounds: 3,
    });

    // Assert
    expect(result.consensusReached).toBe(false);
    expect(result.roundsExecuted).toBe(3);
    expect(result.deliberationLog.rounds).toHaveLength(3);
  });

  // ----------------------------------------------------------
  // 4. [HP] team override → specified models used
  // ----------------------------------------------------------
  it("should use override models when team is specified", async () => {
    // Arrange
    const calledModels: string[] = [];
    const chatFn = mock(async (model: string, messages: ChatMessage[]) => {
      calledModels.push(model);
      const role = detectRole(messages);
      if (role === "producer") return producerResponse("Override test");
      if (role === "reviewer") return reviewerResponse(true, "OK");
      return leaderResponse("approve", { consensusStatus: "reached" });
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });
    const input: DeliberateInput = {
      task: "Override test",
      perspectives: ["보안", "성능"],
      team: {
        producer: "meta/llama-4-scout",
        reviewers: ["openai/gpt-4.1", "mistralai/mistral-large"],
        leader: "openai/gpt-4.1",
      },
    };

    // Act
    await fn(input);

    // Assert — producer=meta, reviewers=openai+mistral, leader=openai
    expect(calledModels[0]).toBe("meta/llama-4-scout"); // producer
    expect(calledModels).toContain("openai/gpt-4.1"); // reviewer or leader
    expect(calledModels).toContain("mistralai/mistral-large"); // reviewer
  });

  // ----------------------------------------------------------
  // 5. [HP] producerInstructions + leaderInstructions
  // ----------------------------------------------------------
  it("should pass producerInstructions and leaderInstructions to prompts", async () => {
    // Arrange
    let producerUserMsg = "";
    let leaderUserMsg = "";
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
      if (role === "producer") {
        producerUserMsg = userMsg;
        return producerResponse("With instructions");
      }
      if (role === "reviewer") return reviewerResponse(true, "OK");
      leaderUserMsg = userMsg;
      return leaderResponse("approve", { consensusStatus: "reached" });
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    await fn({
      task: "Instruction test",
      perspectives: ["보안", "성능"],
      producerInstructions: "Use TypeScript strictly",
      leaderInstructions: "Prioritize security",
    });

    // Assert
    expect(producerUserMsg).toContain("Use TypeScript strictly");
    expect(leaderUserMsg).toContain("Prioritize security");
  });

  // ----------------------------------------------------------
  // 6. [HP] escalation → immediate stop
  // ----------------------------------------------------------
  it("should stop immediately on escalation", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "producer") return producerResponse("Dangerous code");
      if (role === "reviewer") {
        return reviewerResponse(false, "Critical security flaw", [
          { severity: "critical", description: "SQL injection" },
        ]);
      }
      return leaderResponse("escalate", {
        consensusStatus: "stalled",
        keyDisagreements: ["Fundamental security issue"],
      });
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Risky task",
      perspectives: ["보안", "성능"],
      maxRounds: 5,
    });

    // Assert — stops at round 1 despite maxRounds=5
    expect(result.roundsExecuted).toBe(1);
    expect(result.consensusReached).toBe(false);
    expect(result.deliberationLog.rounds[0]!.synthesis?.decision).toBe(
      "escalate",
    );
  });

  // ----------------------------------------------------------
  // 7. [HP] all_approve consensus mode
  // ----------------------------------------------------------
  it("should reach consensus with all_approve mode", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "producer") return producerResponse("Perfect code");
      if (role === "reviewer") return reviewerResponse(true, "Approved");
      return leaderResponse("approve", { consensusStatus: "reached" });
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "All approve test",
      perspectives: ["보안", "성능"],
      consensus: "all_approve",
    });

    // Assert
    expect(result.consensusReached).toBe(true);
    expect(result.roundsExecuted).toBe(1);
    expect(result.finalApprovals.every((a) => a.approved)).toBe(true);
  });

  // ----------------------------------------------------------
  // 8. [NE] reviewer chat failure → fallback review
  // ----------------------------------------------------------
  it("should produce fallback review when one reviewer chat fails", async () => {
    // Arrange
    let reviewerCallCount = 0;
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "producer") return producerResponse("Test content");
      if (role === "reviewer") {
        reviewerCallCount++;
        if (reviewerCallCount === 1) {
          throw new Error("Network timeout");
        }
        return reviewerResponse(true, "Looks good");
      }
      return leaderResponse("approve", { consensusStatus: "reached" });
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Partial failure test",
      perspectives: ["보안", "성능"],
    });

    // Assert — one fallback review + one real review
    const round = result.deliberationLog.rounds[0]!;
    expect(round.reviews).toHaveLength(2);
    const fallback = round.reviews.find((r) =>
      r.reasoning.includes("Review error"),
    );
    expect(fallback).toBeDefined();
    expect(fallback!.approval).toBe(false);
    // Deliberation should still complete
    expect(result.roundsExecuted).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------
  // 9. [NE] invalid input (empty task) → error propagation
  // ----------------------------------------------------------
  it("should propagate error for invalid input (empty task)", async () => {
    // Arrange
    const chatFn = mock(async () => "unreachable");
    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act & Assert
    expect(
      fn({ task: "", perspectives: ["보안", "성능"] }),
    ).rejects.toThrow("Task description must be a non-empty string");
  });

  // ----------------------------------------------------------
  // 10. [ED] ```json-wrapped responses → parsed correctly
  // ----------------------------------------------------------
  it("should parse json-wrapped LLM responses correctly", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "producer") {
        return "```json\n" + producerResponse("Wrapped content") + "\n```";
      }
      if (role === "reviewer") {
        return "```json\n" + reviewerResponse(true, "OK") + "\n```";
      }
      return "```json\n" + leaderResponse("approve", { consensusStatus: "reached" }) + "\n```";
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "JSON wrap test",
      perspectives: ["보안", "성능"],
    });

    // Assert — properly parsed despite wrapping
    expect(result.result).toBe("Wrapped content");
    expect(result.consensusReached).toBe(true);
  });

  // ----------------------------------------------------------
  // 11. [ED] non-JSON responses → fallback handling
  // ----------------------------------------------------------
  it("should handle non-JSON LLM responses via fallback", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "producer") {
        return "Here is my raw text answer without JSON";
      }
      if (role === "reviewer") {
        return "I think this looks fine but I won't format as JSON";
      }
      // Leader also non-JSON → decision defaults to "continue"
      return "Let's continue discussing";
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Fallback test",
      perspectives: ["보안", "성능"],
      maxRounds: 1,
    });

    // Assert — fallback parsing produces usable data
    expect(result.roundsExecuted).toBe(1);
    // Producer fallback: content = raw text
    expect(result.result).toBe("Here is my raw text answer without JSON");
    // Reviewer fallback: approval = false
    const reviews = result.deliberationLog.rounds[0]!.reviews;
    expect(reviews.every((r) => r.approval === false)).toBe(true);
    // Leader fallback: decision = "continue"
    expect(
      result.deliberationLog.rounds[0]!.synthesis?.decision,
    ).toBe("continue");
  });

  // ----------------------------------------------------------
  // 12. [HP] DeliberateOutput fields populated correctly
  // ----------------------------------------------------------
  it("should populate all DeliberateOutput fields correctly", async () => {
    // Arrange
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      const role = detectRole(messages);
      if (role === "producer") return producerResponse("Final output");
      if (role === "reviewer") {
        return reviewerResponse(true, "Approved", [
          { severity: "suggestion", description: "Consider naming" },
        ]);
      }
      return leaderResponse("approve", {
        consensusStatus: "reached",
        keyAgreements: ["Clean code"],
      });
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result = await fn({
      task: "Output field test",
      perspectives: ["보안", "성능"],
    });

    // Assert — every field in DeliberateOutput
    expect(result.result).toBe("Final output");
    expect(result.roundsExecuted).toBe(1);
    expect(result.consensusReached).toBe(true);
    expect(result.finalApprovals).toHaveLength(2); // 2 reviewers
    for (const approval of result.finalApprovals) {
      expect(typeof approval.model).toBe("string");
      expect(approval.approved).toBe(true);
      expect(approval.remainingIssues).toEqual(["Consider naming"]);
    }
    expect(result.deliberationLog.task).toBe("Output field test");
    expect(result.deliberationLog.team.producer).toBeDefined();
    expect(result.deliberationLog.team.reviewers.length).toBe(2);
    expect(result.deliberationLog.team.leader).toBeDefined();
    expect(result.deliberationLog.rounds).toHaveLength(1);
    // 1 producer + 2 reviewers + 1 leader = 4
    expect(result.totalLLMCalls).toBe(4);
    expect(result.modelsUsed.length).toBeGreaterThanOrEqual(1);
    expect(typeof result.totalTokens).toBe("number");
  });

  // ----------------------------------------------------------
  // 13. [ID] consecutive calls → independent results
  // ----------------------------------------------------------
  it("should produce independent results on consecutive calls", async () => {
    // Arrange
    let globalCallCount = 0;
    const chatFn = mock(async (_model: string, messages: ChatMessage[]) => {
      globalCallCount++;
      const role = detectRole(messages);
      if (role === "producer") return producerResponse(`Output-${globalCallCount}`);
      if (role === "reviewer") return reviewerResponse(true, "OK");
      return leaderResponse("approve", { consensusStatus: "reached" });
    });

    const fn = createDeliberateFn({ registry: fixtureRegistry(), chat: chatFn });

    // Act
    const result1 = await fn({ task: "Call 1", perspectives: ["보안", "성능"] });
    const result2 = await fn({ task: "Call 2", perspectives: ["보안", "성능"] });

    // Assert — different tasks → different contexts
    expect(result1.deliberationLog.task).toBe("Call 1");
    expect(result2.deliberationLog.task).toBe("Call 2");
    // Both reach consensus independently
    expect(result1.consensusReached).toBe(true);
    expect(result2.consensusReached).toBe(true);
    // Results differ (different globalCallCount at producer time)
    expect(result1.result).not.toBe(result2.result);
    // Round counts are independent
    expect(result1.roundsExecuted).toBe(1);
    expect(result2.roundsExecuted).toBe(1);
  });
});
