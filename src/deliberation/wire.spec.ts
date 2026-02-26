/**
 * Unit tests for wire.ts — Integration Wiring.
 *
 * SUT: createChatAdapter, createDeliberateFn
 * All external dependencies (LLMClient, composeTeam, deliberate, prompts) are test-doubled.
 */

import { describe, it, expect, mock } from "bun:test";
import type { ChatMessage } from "../llm/types";
import { LLMClientError } from "../llm/errors";
import type {
  DeliberateInput,
  DeliberateOutput,
  TeamComposition,
  SharedContext,
  Round,
} from "./types";
import type { ModelInfo } from "../model/types";

// -- Mock modules (TST-MOCK-STRATEGY: mock.module for module-level imports) --

const mockComposeTeam = mock<(options: any, deps: any) => TeamComposition>(
  () => {
    throw new Error("mockComposeTeam not configured");
  },
);
const mockDeliberate = mock<
  (
    team: TeamComposition,
    input: DeliberateInput,
    deps: any,
    config?: any,
  ) => Promise<DeliberateOutput>
>(() => {
  throw new Error("mockDeliberate not configured");
});

mock.module("./team-composer", () => ({
  composeTeam: (...args: any[]) => (mockComposeTeam as Function)(...args),
}));

mock.module("./engine", () => ({
  deliberate: (...args: any[]) => (mockDeliberate as Function)(...args),
}));

// Import SUT after mocks
const { createChatAdapter, createDeliberateFn, stripThinkTags } = await import("./wire");
const {
  buildProducerMessages,
  buildReviewerMessages,
  buildLeaderMessages,
} = await import("./prompts");

// -- Fixtures --

const STUB_TEAM: TeamComposition = {
  producer: { model: "anthropic/claude-sonnet-4.6", role: "producer" },
  reviewers: [
    {
      model: "google/gemini-2.5-pro",
      role: "reviewer",
      perspective: "보안",
    },
    {
      model: "google/gemini-2.5-flash",
      role: "reviewer",
      perspective: "성능",
    },
  ],
  leader: { model: "anthropic/claude-haiku-4.5", role: "leader" },
};

const STUB_OUTPUT: DeliberateOutput = {
  result: "generated content",
  roundsExecuted: 1,
  consensusReached: true,
  finalApprovals: [],
  deliberationLog: {
    task: "test",
    team: STUB_TEAM,
    rounds: [],
  },
  totalTokens: 0,
  totalLLMCalls: 3,
  modelsUsed: ["anthropic/claude-sonnet-4.6"],
};

function stubModel(id: string): ModelInfo {
  const dims = {} as any;
  return {
    id,
    name: id,
    provider: "anthropic",
    contextWindow: 128000,
    capabilities: dims,
    cost: { inputPer1M: 0, outputPer1M: 0 },
    supportsToolCalling: true,
  };
}

// =============================================================
// createChatAdapter
// =============================================================

describe("createChatAdapter", () => {
  it("should return content string when LLMClient.chat succeeds", async () => {
    // Arrange
    const chatFn = mock(() =>
      Promise.resolve({
        id: "1",
        object: "chat.completion",
        created: 0,
        model: "anthropic/claude-sonnet-4.6",
        choices: [
          {
            index: 0,
            message: { role: "assistant" as const, content: "hello world" },
            finish_reason: "stop" as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    const adapter = createChatAdapter(chatFn);

    // Act
    const result = await adapter("anthropic/claude-sonnet-4.6", [
      { role: "user", content: "hi" },
    ]);

    // Assert
    expect(result).toBe("hello world");
  });

  it("should pass model and messages to LLMClient.chat", async () => {
    // Arrange
    const chatFn = mock(() =>
      Promise.resolve({
        id: "1",
        object: "chat.completion",
        created: 0,
        model: "test-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant" as const, content: "ok" },
            finish_reason: "stop" as const,
          },
        ],
      }),
    );
    const adapter = createChatAdapter(chatFn);
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ];

    // Act
    await adapter("test-model", messages);

    // Assert
    expect(chatFn).toHaveBeenCalledTimes(1);
    const callArg = (chatFn.mock.calls[0] as any[])[0];
    expect(callArg.model).toBe("test-model");
    expect(callArg.messages).toEqual(messages);
  });

  it("should propagate LLMClient.chat error", async () => {
    // Arrange
    const chatFn = mock(() => Promise.reject(new Error("API down")));
    const adapter = createChatAdapter(chatFn);

    // Act & Assert
    expect(
      adapter("model", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow("API down");
  });

  it("should return empty string when choices array is empty", async () => {
    // Arrange
    const chatFn = mock(() =>
      Promise.resolve({
        id: "1",
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [],
      }),
    );
    const adapter = createChatAdapter(chatFn);

    // Act
    const result = await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert
    expect(result).toBe("");
  });

  it("should return empty string when content is null", async () => {
    // Arrange
    const chatFn = mock(() =>
      Promise.resolve({
        id: "1",
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [
          {
            index: 0,
            message: { role: "assistant" as const, content: null },
            finish_reason: "stop" as const,
          },
        ],
      }),
    );
    const adapter = createChatAdapter(chatFn);

    // Act
    const result = await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert
    expect(result).toBe("");
  });

  it("should return empty string when choices empty and content null simultaneously", async () => {
    // Arrange — empty choices (no element to access)
    const chatFn = mock(() =>
      Promise.resolve({
        id: "1",
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [],
      }),
    );
    const adapter = createChatAdapter(chatFn);

    // Act
    const result = await adapter("m", [{ role: "user", content: "test" }]);

    // Assert
    expect(result).toBe("");
  });
});

// =============================================================
// createDeliberateFn
// =============================================================

describe("createDeliberateFn", () => {
  it("should compose team and run deliberation with correct deps", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_OUTPUT);

    const registry = {
      getAll: () => [stubModel("anthropic/claude-sonnet-4.6")],
      getAvailable: () => [stubModel("anthropic/claude-sonnet-4.6")],
      getById: (id: string) =>
        id === "anthropic/claude-sonnet-4.6" ? stubModel("anthropic/claude-sonnet-4.6") : undefined,
    };
    const chat = mock(async () => "response");
    const fn = createDeliberateFn({ registry, chat });
    const input: DeliberateInput = {
      task: "Write tests",
      perspectives: ["보안", "성능"],
    };

    // Act
    const result = await fn(input);

    // Assert
    expect(mockComposeTeam).toHaveBeenCalledTimes(1);
    expect(mockDeliberate).toHaveBeenCalledTimes(1);
    expect(result).toEqual(STUB_OUTPUT);

    // Verify composeTeam was called with correct registry deps
    const composeDeps = mockComposeTeam.mock.calls[0]![1];
    expect(typeof composeDeps.getModels).toBe("function");
    expect(typeof composeDeps.getById).toBe("function");

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  it("should pass team overrides from input.team to composeTeam", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_OUTPUT);

    const registry = {
      getAll: () => [stubModel("a/1")],
      getAvailable: () => [stubModel("a/1")],
      getById: () => stubModel("a/1"),
    };
    const chat = mock(async () => "response");
    const fn = createDeliberateFn({ registry, chat });
    const input: DeliberateInput = {
      task: "task",
      perspectives: ["보안", "성능"],
      team: {
        producer: "anthropic/claude-sonnet-4.6",
        reviewers: ["google/gemini-2.5-pro", "google/gemini-2.5-flash"],
        leader: "anthropic/claude-haiku-4.5",
      },
    };

    // Act
    await fn(input);

    // Assert
    const options = mockComposeTeam.mock.calls[0]![0];
    expect(options.overrides).toEqual({
      producer: "anthropic/claude-sonnet-4.6",
      reviewers: ["google/gemini-2.5-pro", "google/gemini-2.5-flash"],
      leader: "anthropic/claude-haiku-4.5",
    });

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  it("should wire prompt builders into engineDeps", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_OUTPUT);

    const registry = {
      getAll: () => [stubModel("a/1")],
      getAvailable: () => [stubModel("a/1")],
      getById: () => stubModel("a/1"),
    };
    const chat = mock(async () => "response");
    const fn = createDeliberateFn({ registry, chat });

    // Act
    await fn({ task: "t", perspectives: ["a", "b"] });

    // Assert — verify engineDeps passed to deliberate
    const engineDeps = mockDeliberate.mock.calls[0]![2];
    expect(engineDeps.buildProducerMessages).toBe(buildProducerMessages);
    expect(engineDeps.buildReviewerMessages).toBe(buildReviewerMessages);
    expect(engineDeps.buildLeaderMessages).toBe(buildLeaderMessages);

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  it("should propagate composeTeam errors", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => {
      throw new Error("Task description must be a non-empty string");
    });

    const registry = { getAll: () => [], getAvailable: () => [], getById: () => undefined };
    const chat = mock(async () => "response");
    const fn = createDeliberateFn({ registry, chat });

    // Act & Assert
    expect(
      fn({ task: "", perspectives: ["a", "b"] }),
    ).rejects.toThrow("Task description must be a non-empty string");

    // Cleanup
    mockComposeTeam.mockReset();
  });

  it("should propagate deliberate errors", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => {
      throw new Error("Chat failed");
    });

    const registry = {
      getAll: () => [stubModel("a/1")],
      getAvailable: () => [stubModel("a/1")],
      getById: () => stubModel("a/1"),
    };
    const chat = mock(async () => "response");
    const fn = createDeliberateFn({ registry, chat });

    // Act & Assert
    expect(
      fn({ task: "task", perspectives: ["a", "b"] }),
    ).rejects.toThrow("Chat failed");

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  it("should pass config=undefined when maxRounds and consensus not provided", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_OUTPUT);

    const registry = {
      getAll: () => [stubModel("a/1")],
      getAvailable: () => [stubModel("a/1")],
      getById: () => stubModel("a/1"),
    };
    const fn = createDeliberateFn({ registry, chat: mock(async () => "") });

    // Act
    await fn({ task: "t", perspectives: ["a", "b"] });

    // Assert — 4th arg (config) should be undefined
    const config = mockDeliberate.mock.calls[0]![3];
    expect(config).toBeUndefined();

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  it("should build config with maxRounds only (consensus defaults to leader_decides)", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_OUTPUT);

    const registry = {
      getAll: () => [stubModel("a/1")],
      getAvailable: () => [stubModel("a/1")],
      getById: () => stubModel("a/1"),
    };
    const fn = createDeliberateFn({ registry, chat: mock(async () => "") });

    // Act
    await fn({ task: "t", perspectives: ["a", "b"], maxRounds: 5 });

    // Assert
    const config = mockDeliberate.mock.calls[0]![3];
    expect(config).toEqual({ maxRounds: 5, consensus: "leader_decides" });

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  it("should build config with consensus only (maxRounds defaults to 3)", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_OUTPUT);

    const registry = {
      getAll: () => [stubModel("a/1")],
      getAvailable: () => [stubModel("a/1")],
      getById: () => stubModel("a/1"),
    };
    const fn = createDeliberateFn({ registry, chat: mock(async () => "") });

    // Act
    await fn({
      task: "t",
      perspectives: ["a", "b"],
      consensus: "all_approve",
    });

    // Assert
    const config = mockDeliberate.mock.calls[0]![3];
    expect(config).toEqual({ maxRounds: 3, consensus: "all_approve" });

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  it("should pass undefined overrides when input.team is absent", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_OUTPUT);

    const registry = {
      getAll: () => [stubModel("a/1")],
      getAvailable: () => [stubModel("a/1")],
      getById: () => stubModel("a/1"),
    };
    const fn = createDeliberateFn({ registry, chat: mock(async () => "") });

    // Act
    await fn({ task: "t", perspectives: ["a", "b"] });

    // Assert — overrides should be undefined
    const options = mockComposeTeam.mock.calls[0]![0];
    expect(options.overrides).toBeUndefined();

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  it("should produce identical team composition for identical inputs", async () => {
    // Arrange
    let callCount = 0;
    mockComposeTeam.mockImplementation(() => {
      callCount++;
      return STUB_TEAM;
    });
    mockDeliberate.mockImplementation(async () => STUB_OUTPUT);

    const registry = {
      getAll: () => [stubModel("a/1")],
      getAvailable: () => [stubModel("a/1")],
      getById: () => stubModel("a/1"),
    };
    const fn = createDeliberateFn({ registry, chat: mock(async () => "") });
    const input: DeliberateInput = {
      task: "test",
      perspectives: ["보안", "성능"],
    };

    // Act
    const result1 = await fn(input);
    const result2 = await fn(input);

    // Assert — both calls produce same team, same output
    expect(callCount).toBe(2);
    const options1 = mockComposeTeam.mock.calls[0]![0];
    const options2 = mockComposeTeam.mock.calls[1]![0];
    expect(options1).toEqual(options2);
    expect(result1).toEqual(result2);

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  // -- Store integration (D7) --

  it("should call store.save after successful deliberation", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_OUTPUT);

    const storeSave = mock(() => Promise.resolve());
    const registry = {
      getAll: () => [stubModel("a/1")],
      getAvailable: () => [stubModel("a/1")],
      getById: () => stubModel("a/1"),
    };
    const fn = createDeliberateFn({
      registry,
      chat: mock(async () => ""),
      store: { save: storeSave, query: mock(), getById: mock() },
    });

    // Act
    await fn({ task: "test", perspectives: ["보안", "성능"] });

    // Assert
    expect(storeSave).toHaveBeenCalledTimes(1);

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  it("should return deliberation result even when store.save throws", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_OUTPUT);

    const storeSave = mock(() => Promise.reject(new Error("store error")));
    const registry = {
      getAll: () => [stubModel("a/1")],
      getAvailable: () => [stubModel("a/1")],
      getById: () => stubModel("a/1"),
    };
    const fn = createDeliberateFn({
      registry,
      chat: mock(async () => ""),
      store: { save: storeSave, query: mock(), getById: mock() },
    });

    // Act
    const result = await fn({ task: "test", perspectives: ["보안", "성능"] });

    // Assert — result returned despite store error
    expect(result).toEqual(STUB_OUTPUT);
    expect(storeSave).toHaveBeenCalledTimes(1);

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  it("should not call save when store is not provided", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_OUTPUT);

    const registry = {
      getAll: () => [stubModel("a/1")],
      getAvailable: () => [stubModel("a/1")],
      getById: () => stubModel("a/1"),
    };
    // No store in deps
    const fn = createDeliberateFn({
      registry,
      chat: mock(async () => ""),
    });

    // Act — should not throw
    const result = await fn({ task: "test", perspectives: ["보안", "성능"] });

    // Assert
    expect(result).toEqual(STUB_OUTPUT);

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  // -- Store rounds persistence (P0-5) --

  it("should include deliberationLog.rounds in store.save call when rounds exist", async () => {
    // Arrange
    const stubRound1: Round = {
      number: 1,
      production: { model: "anthropic/claude-sonnet-4.6", content: "content 1" },
      reviews: [],
      synthesis: undefined,
    };
    const stubRound2: Round = {
      number: 2,
      production: { model: "anthropic/claude-sonnet-4.6", content: "content 2" },
      reviews: [],
      synthesis: undefined,
    };
    const outputWithRounds: DeliberateOutput = {
      ...STUB_OUTPUT,
      deliberationLog: { ...STUB_OUTPUT.deliberationLog, rounds: [stubRound1, stubRound2] },
    };
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => outputWithRounds);

    const storeSave = mock(() => Promise.resolve());
    const registry = {
      getAll: () => [stubModel("a/1")],
      getAvailable: () => [stubModel("a/1")],
      getById: () => stubModel("a/1"),
    };
    const fn = createDeliberateFn({
      registry,
      chat: mock(async () => ""),
      store: { save: storeSave, query: mock(), getById: mock() },
    });

    // Act
    await fn({ task: "test", perspectives: ["보안", "성능"] });

    // Assert
    expect(storeSave).toHaveBeenCalledTimes(1);
    const savedRecord = (storeSave as ReturnType<typeof mock>).mock.calls[0]![0] as any;
    expect(savedRecord.rounds).toHaveLength(2);
    expect(savedRecord.rounds[0]).toEqual(stubRound1);
    expect(savedRecord.rounds[1]).toEqual(stubRound2);

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  it("should include empty rounds array in store.save call when deliberationLog.rounds is empty", async () => {
    // Arrange — STUB_OUTPUT has deliberationLog.rounds = []
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_OUTPUT);

    const storeSave = mock(() => Promise.resolve());
    const registry = {
      getAll: () => [stubModel("a/1")],
      getAvailable: () => [stubModel("a/1")],
      getById: () => stubModel("a/1"),
    };
    const fn = createDeliberateFn({
      registry,
      chat: mock(async () => ""),
      store: { save: storeSave, query: mock(), getById: mock() },
    });

    // Act
    await fn({ task: "test", perspectives: ["보안", "성능"] });

    // Assert
    expect(storeSave).toHaveBeenCalledTimes(1);
    const savedRecord = (storeSave as ReturnType<typeof mock>).mock.calls[0]![0] as any;
    expect(savedRecord.rounds).toEqual([]);

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  it("should pass retryDeps as 5th argument to deliberate", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_OUTPUT);

    const registry = {
      getAll: () => [stubModel("a/1")],
      getAvailable: () => [stubModel("a/1")],
      getById: () => stubModel("a/1"),
    };
    const fn = createDeliberateFn({ registry, chat: mock(async () => "") });

    // Act
    await fn({ task: "t", perspectives: ["p"] });

    // Assert — 5th argument (retryDeps) must be defined
    const callArgs = mockDeliberate.mock.calls[0] as unknown[];
    expect(callArgs).toHaveLength(5);
    const retryDeps = callArgs[4] as { cooldown: unknown; getModels: () => unknown[] };
    expect(retryDeps).toBeDefined();
    expect(typeof retryDeps.cooldown).toBe("object");
    expect(typeof retryDeps.getModels).toBe("function");

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  it("should delegate retryDeps.getModels to registry.getAvailable", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_OUTPUT);

    const available = [stubModel("a/1"), stubModel("b/2")];
    const getAvailable = mock(() => available);
    const registry = {
      getAll: () => [],
      getAvailable,
      getById: () => undefined,
    };
    const fn = createDeliberateFn({ registry, chat: mock(async () => "") });

    // Act
    await fn({ task: "t", perspectives: ["p"] });

    // Assert — retryDeps.getModels() returns registry.getAvailable() result
    const callArgs = mockDeliberate.mock.calls[0] as unknown[];
    const retryDeps = callArgs[4] as { getModels: () => unknown[] };
    const models = retryDeps.getModels();
    expect(models).toEqual(available);

    // Cleanup
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });
});

// =============================================================
// stripThinkTags
// =============================================================

describe("stripThinkTags", () => {
  it("should strip single think block from response", () => {
    // Arrange
    const input = "<think>internal reasoning here</think>actual content";

    // Act
    const result = stripThinkTags(input);

    // Assert
    expect(result).toBe("actual content");
  });

  it("should return text unchanged when no think tags present", () => {
    // Arrange
    const input = "just normal text without any tags";

    // Act
    const result = stripThinkTags(input);

    // Assert
    expect(result).toBe("just normal text without any tags");
  });

  it("should strip multiple think blocks", () => {
    // Arrange
    const input = "<think>first</think>middle <think>second</think>end";

    // Act
    const result = stripThinkTags(input);

    // Assert
    expect(result).toBe("middle end");
  });

  it("should handle think block with newlines", () => {
    // Arrange
    const input = "<think>line 1\nline 2\nline 3</think>actual output";

    // Act
    const result = stripThinkTags(input);

    // Assert
    expect(result).toBe("actual output");
  });

  it("should preserve JSON content after think block", () => {
    // Arrange
    const input =
      '<think>reasoning about JSON structure</think>{"content": "hello"}';

    // Act
    const result = stripThinkTags(input);

    // Assert
    expect(result).toBe('{"content": "hello"}');
  });

  it("should leave incomplete think tags unchanged", () => {
    // Arrange — no closing tag
    const input = "<think>never closes, so this stays";

    // Act
    const result = stripThinkTags(input);

    // Assert
    expect(result).toBe("<think>never closes, so this stays");
  });

  it("should return empty string when response is only think block", () => {
    // Arrange
    const input = "<think>all thinking, no output</think>";

    // Act
    const result = stripThinkTags(input);

    // Assert
    expect(result).toBe("");
  });

  it("should trim whitespace after stripping think block", () => {
    // Arrange
    const input = "<think>reasoning</think>   actual content   ";

    // Act
    const result = stripThinkTags(input);

    // Assert
    expect(result).toBe("actual content");
  });
});

// -- createChatAdapter + stripThinkTags integration --

describe("createChatAdapter", () => {
  it("should strip think tags in chat adapter response", async () => {
    // Arrange — mock LLM returns response with think tags
    const chatFn = mock(() =>
      Promise.resolve({
        id: "1",
        object: "chat.completion" as const,
        created: 0,
        model: "anthropic/claude-opus-4.6",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant" as const,
              content: "<think>deep reasoning</think>clean answer",
            },
            finish_reason: "stop" as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    const adapter = createChatAdapter(chatFn);

    // Act
    const result = await adapter("anthropic/claude-opus-4.6", [
      { role: "user", content: "test" },
    ]);

    // Assert — think tags should be stripped
    expect(result).toBe("clean answer");
  });
});

// =============================================================
// createChatAdapter — retry on 429
// =============================================================

describe("createChatAdapter", () => {
  // Helper: create a successful chat response
  function okResponse(content: string) {
    return {
      id: "1",
      object: "chat.completion" as const,
      created: 0,
      model: "m",
      choices: [
        {
          index: 0,
          message: { role: "assistant" as const, content },
          finish_reason: "stop" as const,
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  }

  it("should retry on 429 and return result on success", async () => {
    // Arrange — first call: 429, second call: success
    let callCount = 0;
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new LLMClientError(429, "Rate limit exceeded.", "rate_limit_error", 100));
      }
      return Promise.resolve(okResponse("success"));
    });
    const adapter = createChatAdapter(chatFn, { maxRetries: 3, baseDelayMs: 1 });

    // Act
    const result = await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert
    expect(result).toBe("success");
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it("should use retryAfterMs delay when present in LLMClientError", async () => {
    // Arrange — 429 with retryAfterMs=50 (short for test speed)
    let callCount = 0;
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new LLMClientError(429, "limit", "rate_limit_error", 50));
      }
      return Promise.resolve(okResponse("ok"));
    });
    const startTime = Date.now();
    const adapter = createChatAdapter(chatFn, { maxRetries: 3, baseDelayMs: 1, randomFn: () => 1 });

    // Act
    await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert — should wait at least ~50ms (retryAfterMs)
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow some tolerance
  });

  it("should use exponential backoff when retryAfterMs not available", async () => {
    // Arrange — 429 without retryAfterMs, baseDelay=10ms
    let callCount = 0;
    const chatFn = mock(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.reject(new LLMClientError(429, "limit", "rate_limit_error"));
      }
      return Promise.resolve(okResponse("ok"));
    });
    const startTime = Date.now();
    const adapter = createChatAdapter(chatFn, { maxRetries: 3, baseDelayMs: 10, randomFn: () => 1 });

    // Act
    await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert — 2 retries: 10ms + 20ms = 30ms minimum
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(20); // allow tolerance
    expect(chatFn).toHaveBeenCalledTimes(3);
  });

  it("should throw original error after max retries exceeded", async () => {
    // Arrange — always 429
    const chatFn = mock(() =>
      Promise.reject(new LLMClientError(429, "limit", "rate_limit_error")),
    );
    const adapter = createChatAdapter(chatFn, { maxRetries: 2, baseDelayMs: 1 });

    // Act & Assert
    await expect(
      adapter("m", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow("limit");
    // 1 initial + 2 retries = 3 calls
    expect(chatFn).toHaveBeenCalledTimes(3);
  });

  it("should throw immediately on non-429 error without retry", async () => {
    // Arrange — 500 error
    const chatFn = mock(() =>
      Promise.reject(new LLMClientError(500, "Server error")),
    );
    const adapter = createChatAdapter(chatFn, { maxRetries: 3, baseDelayMs: 1 });

    // Act & Assert
    await expect(
      adapter("m", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow("Server error");
    expect(chatFn).toHaveBeenCalledTimes(1);
  });

  it("should propagate response content after successful retry", async () => {
    // Arrange — first: 429, second: success with specific content
    let callCount = 0;
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new LLMClientError(429, "limit", "rate_limit_error"));
      }
      return Promise.resolve(okResponse("<think>reasoning</think>clean output"));
    });
    const adapter = createChatAdapter(chatFn, { maxRetries: 3, baseDelayMs: 1 });

    // Act
    const result = await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert — should also strip think tags after retry
    expect(result).toBe("clean output");
  });

  it("should retry up to configured max retries", async () => {
    // Arrange — 429 three times, then success
    let callCount = 0;
    const chatFn = mock(() => {
      callCount++;
      if (callCount <= 3) {
        return Promise.reject(new LLMClientError(429, "limit", "rate_limit_error"));
      }
      return Promise.resolve(okResponse("finally"));
    });
    const adapter = createChatAdapter(chatFn, { maxRetries: 3, baseDelayMs: 1 });

    // Act
    const result = await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert — 1 initial + 3 retries = 4 calls total
    expect(result).toBe("finally");
    expect(chatFn).toHaveBeenCalledTimes(4);
  });

  // =============================================================
  // Retry 강화 — 503, jitter, retryableStatuses
  // =============================================================

  it("should retry on 503 and return result on success", async () => {
    // Arrange — first call: 503, second call: success
    let callCount = 0;
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new LLMClientError(503, "Service Unavailable"));
      }
      return Promise.resolve(okResponse("recovered"));
    });
    const adapter = createChatAdapter(chatFn, { maxRetries: 3, baseDelayMs: 1, retryableStatuses: [429, 503], randomFn: () => 1 });

    // Act
    const result = await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert
    expect(result).toBe("recovered");
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it("should retry on 503 with Retry-After header delay", async () => {
    // Arrange — 503 with retryAfterMs
    let callCount = 0;
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new LLMClientError(503, "Unavailable", undefined, 50));
      }
      return Promise.resolve(okResponse("ok"));
    });
    const startTime = Date.now();
    const adapter = createChatAdapter(chatFn, { maxRetries: 3, baseDelayMs: 1, retryableStatuses: [429, 503], randomFn: () => 1 });

    // Act
    await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert — should wait at least ~50ms (retryAfterMs * jitter, jitter=1→factor=1.0)
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it("should retry when 429 and 503 errors alternate", async () => {
    // Arrange — 429 → 503 → success
    let callCount = 0;
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new LLMClientError(429, "rate limit", "rate_limit_error"));
      if (callCount === 2) return Promise.reject(new LLMClientError(503, "unavailable"));
      return Promise.resolve(okResponse("finally"));
    });
    const adapter = createChatAdapter(chatFn, { maxRetries: 3, baseDelayMs: 1, retryableStatuses: [429, 503], randomFn: () => 1 });

    // Act
    const result = await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert
    expect(result).toBe("finally");
    expect(chatFn).toHaveBeenCalledTimes(3);
  });

  it("should use custom retryableStatuses list", async () => {
    // Arrange — retryableStatuses=[429,503,502], error=502
    let callCount = 0;
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new LLMClientError(502, "Bad Gateway"));
      return Promise.resolve(okResponse("ok"));
    });
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 3,
      baseDelayMs: 1,
      retryableStatuses: [429, 503, 502],
      randomFn: () => 1,
    });

    // Act
    const result = await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert
    expect(result).toBe("ok");
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it("should apply jitter to backoff delay", async () => {
    // Arrange — randomFn returns 0 → jitter = (0.5 + 0 * 0.5) = 0.5 → delay halved
    let callCount = 0;
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new LLMClientError(429, "limit", "rate_limit_error"));
      return Promise.resolve(okResponse("ok"));
    });
    const startTime = Date.now();
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 3,
      baseDelayMs: 100,
      randomFn: () => 0,
    });

    // Act
    await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert — delay = 100 * (0.5 + 0*0.5) = 50ms (halved by jitter)
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(100);
  });

  it("should throw after max retries exceeded on 503", async () => {
    // Arrange — always 503
    const chatFn = mock(() =>
      Promise.reject(new LLMClientError(503, "Service Unavailable")),
    );
    const adapter = createChatAdapter(chatFn, { maxRetries: 2, baseDelayMs: 1, retryableStatuses: [429, 503], randomFn: () => 1 });

    // Act & Assert
    await expect(
      adapter("m", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow("Service Unavailable");
    expect(chatFn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("should throw immediately on non-retryable status when retryableStatuses=[429]", async () => {
    // Arrange — 500 error, default retryableStatuses=[429]
    const chatFn = mock(() =>
      Promise.reject(new LLMClientError(500, "Server Error")),
    );
    const adapter = createChatAdapter(chatFn, { maxRetries: 3, baseDelayMs: 1, randomFn: () => 1 });

    // Act & Assert
    await expect(
      adapter("m", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow("Server Error");
    expect(chatFn).toHaveBeenCalledTimes(1);
  });

  it("should throw immediately when retryableStatuses is empty", async () => {
    // Arrange — empty retryableStatuses → no retry ever
    const chatFn = mock(() =>
      Promise.reject(new LLMClientError(429, "limit", "rate_limit_error")),
    );
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 3,
      baseDelayMs: 1,
      retryableStatuses: [],
      randomFn: () => 1,
    });

    // Act & Assert
    await expect(
      adapter("m", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow("limit");
    expect(chatFn).toHaveBeenCalledTimes(1);
  });

  it("should retry exactly once when maxRetries=1 and 503 occurs", async () => {
    // Arrange — maxRetries=1, 503 once then success
    let callCount = 0;
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new LLMClientError(503, "unavailable"));
      return Promise.resolve(okResponse("ok"));
    });
    const adapter = createChatAdapter(chatFn, { maxRetries: 1, baseDelayMs: 1, retryableStatuses: [429, 503], randomFn: () => 1 });

    // Act
    const result = await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert
    expect(result).toBe("ok");
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it("should throw immediately for 429 when retryableStatuses=[503]", async () => {
    // Arrange — only 503 is retryable, 429 is not
    const chatFn = mock(() =>
      Promise.reject(new LLMClientError(429, "rate limit", "rate_limit_error")),
    );
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 3,
      baseDelayMs: 1,
      retryableStatuses: [503],
      randomFn: () => 1,
    });

    // Act & Assert
    await expect(
      adapter("m", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow("rate limit");
    expect(chatFn).toHaveBeenCalledTimes(1);
  });

  // =============================================================
  // RetryEvent + onRetry 콜백
  // =============================================================

  it("should call onRetry with correct RetryEvent fields on each retry", async () => {
    // Arrange — 429 twice, then success
    const events: import("./wire").RetryEvent[] = [];
    let callCount = 0;
    const chatFn = mock(() => {
      callCount++;
      if (callCount <= 2) return Promise.reject(new LLMClientError(429, "limit", "rate_limit_error"));
      return Promise.resolve(okResponse("ok"));
    });
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 3,
      baseDelayMs: 1,
      randomFn: () => 1,
      onRetry: (e) => events.push(e),
    });

    // Act
    await adapter("test-model", [{ role: "user", content: "hi" }]);

    // Assert — 2 retryable errors → 2 onRetry calls
    expect(events).toHaveLength(2);
    expect(events[0]!.status).toBe(429);
    expect(events[0]!.attempt).toBe(1);
    expect(events[0]!.model).toBe("test-model");
    expect(events[0]!.willRetry).toBe(true);
    expect(events[0]!.delayMs).toBeGreaterThan(0);
    expect(events[1]!.attempt).toBe(2);
    expect(events[1]!.willRetry).toBe(true);
  });

  it("should call onRetry with willRetry=false on final retryable failure", async () => {
    // Arrange — always 429, maxRetries=2
    const events: import("./wire").RetryEvent[] = [];
    const chatFn = mock(() =>
      Promise.reject(new LLMClientError(429, "limit", "rate_limit_error")),
    );
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 2,
      baseDelayMs: 1,
      randomFn: () => 1,
      onRetry: (e) => events.push(e),
    });

    // Act
    await adapter("m", [{ role: "user", content: "hi" }]).catch(() => {});

    // Assert — 3 attempts (0,1,2): attempt 0,1 → willRetry=true; attempt 2 → willRetry=false
    expect(events).toHaveLength(3);
    expect(events[0]!.willRetry).toBe(true);
    expect(events[1]!.willRetry).toBe(true);
    expect(events[2]!.willRetry).toBe(false);
    expect(events[2]!.delayMs).toBe(0);
  });

  it("should not retry 503 by default (retryableStatuses=[429])", async () => {
    // Arrange — 503 error, default retryableStatuses
    const chatFn = mock(() =>
      Promise.reject(new LLMClientError(503, "Service Unavailable")),
    );
    const adapter = createChatAdapter(chatFn, { maxRetries: 3, baseDelayMs: 1, randomFn: () => 1 });

    // Act & Assert — should throw immediately, no retry
    await expect(
      adapter("m", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow("Service Unavailable");
    expect(chatFn).toHaveBeenCalledTimes(1);
  });

  it("should not call onRetry on non-retryable error", async () => {
    // Arrange — 500 error, not in retryableStatuses
    const events: import("./wire").RetryEvent[] = [];
    const chatFn = mock(() =>
      Promise.reject(new LLMClientError(500, "Server Error")),
    );
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 3,
      baseDelayMs: 1,
      randomFn: () => 1,
      onRetry: (e) => events.push(e),
    });

    // Act
    await adapter("m", [{ role: "user", content: "hi" }]).catch(() => {});

    // Assert — no onRetry calls
    expect(events).toHaveLength(0);
  });

  it("should not call onRetry on first-attempt success", async () => {
    // Arrange — immediate success
    const events: import("./wire").RetryEvent[] = [];
    const chatFn = mock(() => Promise.resolve(okResponse("ok")));
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 3,
      baseDelayMs: 1,
      randomFn: () => 1,
      onRetry: (e) => events.push(e),
    });

    // Act
    await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert
    expect(events).toHaveLength(0);
  });

  it("should propagate error when onRetry callback throws", async () => {
    // Arrange — onRetry throws on call
    let callCount = 0;
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new LLMClientError(429, "limit", "rate_limit_error"));
      return Promise.resolve(okResponse("ok"));
    });
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 3,
      baseDelayMs: 1,
      randomFn: () => 1,
      onRetry: () => { throw new Error("callback boom"); },
    });

    // Act & Assert — callback error propagates
    await expect(
      adapter("m", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow("callback boom");
  });

  it("should call onRetry with willRetry=false when maxRetries=0 and retryable error occurs", async () => {
    // Arrange — maxRetries=0, retryable 429 error
    const events: import("./wire").RetryEvent[] = [];
    const chatFn = mock(() =>
      Promise.reject(new LLMClientError(429, "limit", "rate_limit_error")),
    );
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 0,
      baseDelayMs: 1,
      randomFn: () => 1,
      onRetry: (e) => events.push(e),
    });

    // Act
    await adapter("m", [{ role: "user", content: "hi" }]).catch(() => {});

    // Assert — 1 call with willRetry=false (retryable but no retries allowed)
    expect(events).toHaveLength(1);
    expect(events[0]!.willRetry).toBe(false);
    expect(events[0]!.delayMs).toBe(0);
  });

  // =============================================================
  // maxRetryAfterMs cap
  // =============================================================

  it("should cap delay to maxRetryAfterMs when retryAfterMs exceeds cap", async () => {
    // Arrange — retryAfterMs=200, cap=100 → delay should be ≤ 100 * jitter
    let callCount = 0;
    const delays: number[] = [];
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1)
        return Promise.reject(
          new LLMClientError(429, "limit", "rate_limit_error", 200),
        );
      return Promise.resolve(okResponse("ok"));
    });
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxRetryAfterMs: 100,
      randomFn: () => 1,
      onRetry: (e) => delays.push(e.delayMs),
    });

    // Act
    await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert — reported delay must be ≤ cap (100)
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBeLessThanOrEqual(100);
  });

  it("should not cap delay when retryAfterMs is below maxRetryAfterMs", async () => {
    // Arrange — retryAfterMs=50, cap=100 → delay should use 50 (uncapped)
    let callCount = 0;
    const delays: number[] = [];
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1)
        return Promise.reject(
          new LLMClientError(429, "limit", "rate_limit_error", 50),
        );
      return Promise.resolve(okResponse("ok"));
    });
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxRetryAfterMs: 100,
      randomFn: () => 1,
      onRetry: (e) => delays.push(e.delayMs),
    });

    // Act
    await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert — delay is based on uncapped retryAfterMs=50 * jitter (randomFn=1 → 1.0 multiplier)
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBe(50 * 1.0);
  });

  it("should use retryAfterMs unchanged when maxRetryAfterMs is undefined", async () => {
    // Arrange — no cap, retryAfterMs=50
    let callCount = 0;
    const delays: number[] = [];
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1)
        return Promise.reject(
          new LLMClientError(429, "limit", "rate_limit_error", 50),
        );
      return Promise.resolve(okResponse("ok"));
    });
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 3,
      baseDelayMs: 1,
      // maxRetryAfterMs: undefined (not set)
      randomFn: () => 1,
      onRetry: (e) => delays.push(e.delayMs),
    });

    // Act
    await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert — delay is 50 * jitter (randomFn=1 → multiplier=(0.5+1*0.5)=1.0)
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBe(50 * 1.0);
  });

  it("should cap delay to 0 when maxRetryAfterMs is 0", async () => {
    // Arrange — cap=0 → delay always 0 regardless of retryAfterMs
    let callCount = 0;
    const delays: number[] = [];
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1)
        return Promise.reject(
          new LLMClientError(429, "limit", "rate_limit_error", 200),
        );
      return Promise.resolve(okResponse("ok"));
    });
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxRetryAfterMs: 0,
      randomFn: () => 1,
      onRetry: (e) => delays.push(e.delayMs),
    });

    // Act
    await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert — delay reported as 0 (cap applied before jitter)
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBe(0);
  });

  it("should result in same delay when retryAfterMs equals maxRetryAfterMs", async () => {
    // Arrange — retryAfterMs=100, cap=100 → min(100, 100) = 100, then jitter
    let callCount = 0;
    const delays: number[] = [];
    const chatFn = mock(() => {
      callCount++;
      if (callCount === 1)
        return Promise.reject(
          new LLMClientError(429, "limit", "rate_limit_error", 100),
        );
      return Promise.resolve(okResponse("ok"));
    });
    const adapter = createChatAdapter(chatFn, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxRetryAfterMs: 100,
      randomFn: () => 1,
      onRetry: (e) => delays.push(e.delayMs),
    });

    // Act
    await adapter("m", [{ role: "user", content: "hi" }]);

    // Assert — delay = 100 * jitter (randomFn=1 → 1.0 multiplier)
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBe(100 * 1.0);
  });
});
