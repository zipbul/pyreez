/**
 * Unit tests for wire.ts — Integration Wiring.
 *
 * SUT: createChatAdapter, createDeliberateFn
 * All external dependencies (LLMClient, composeTeam, deliberate, prompts) are test-doubled.
 */

import { describe, it, expect, mock } from "bun:test";
import type { ChatMessage } from "../llm/types";
import type {
  DeliberateInput,
  DeliberateOutput,
  TeamComposition,
  SharedContext,
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
  composeTeam: (...args: any[]) => mockComposeTeam(...args),
}));

mock.module("./engine", () => ({
  deliberate: (...args: any[]) => mockDeliberate(...args),
}));

// Import SUT after mocks
const { createChatAdapter, createDeliberateFn } = await import("./wire");
const {
  buildProducerMessages,
  buildReviewerMessages,
  buildLeaderMessages,
} = await import("./prompts");

// -- Fixtures --

const STUB_TEAM: TeamComposition = {
  producer: { model: "openai/gpt-4.1", role: "producer" },
  reviewers: [
    {
      model: "meta/llama-4-scout",
      role: "reviewer",
      perspective: "보안",
    },
    {
      model: "mistralai/mistral-large",
      role: "reviewer",
      perspective: "성능",
    },
  ],
  leader: { model: "openai/gpt-4.1-mini", role: "leader" },
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
  modelsUsed: ["openai/gpt-4.1"],
};

function stubModel(id: string): ModelInfo {
  const dims = {} as any;
  const conf = {} as any;
  return {
    id,
    name: id,
    contextWindow: 128000,
    capabilities: dims,
    confidence: conf,
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
        model: "openai/gpt-4.1",
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
    const result = await adapter("openai/gpt-4.1", [
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
    const callArg = chatFn.mock.calls[0]![0];
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
      getAll: () => [stubModel("openai/gpt-4.1")],
      getById: (id: string) =>
        id === "openai/gpt-4.1" ? stubModel("openai/gpt-4.1") : undefined,
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
      getById: () => stubModel("a/1"),
    };
    const chat = mock(async () => "response");
    const fn = createDeliberateFn({ registry, chat });
    const input: DeliberateInput = {
      task: "task",
      perspectives: ["보안", "성능"],
      team: {
        producer: "openai/gpt-4.1",
        reviewers: ["meta/llama-4-scout", "mistralai/mistral-large"],
        leader: "openai/gpt-4.1-mini",
      },
    };

    // Act
    await fn(input);

    // Assert
    const options = mockComposeTeam.mock.calls[0]![0];
    expect(options.overrides).toEqual({
      producer: "openai/gpt-4.1",
      reviewers: ["meta/llama-4-scout", "mistralai/mistral-large"],
      leader: "openai/gpt-4.1-mini",
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

    const registry = { getAll: () => [], getById: () => undefined };
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
});
