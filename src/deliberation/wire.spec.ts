/**
 * Unit tests for wire.ts — Integration Wiring (Diverge-Synth model).
 *
 * SUT: stripThinkTags, createChatAdapter, createDeliberateFn
 * All external dependencies (composeTeam, deliberate, prompts) are test-doubled.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { LLMClientError } from "../llm/errors";
import type {
  DeliberateInput,
  DeliberateOutput,
  TeamComposition,
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
    retryDeps?: any,
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
const { buildWorkerMessages: _buildWorkerMessages, buildLeaderMessages: _buildLeaderMessages } = await import("./prompts");

// -- Fixtures --

const STUB_TEAM: TeamComposition = {
  workers: [
    { model: "openai/gpt-4.1", role: "worker" },
    { model: "deepseek/deepseek-r1", role: "worker" },
  ],
  leader: { model: "anthropic/claude-sonnet-4.6", role: "leader" },
};

const STUB_DELIBERATE_OUTPUT: DeliberateOutput = {
  result: "deliberation result",
  roundsExecuted: 1,
  consensusReached: null,
  totalTokens: { input: 100, output: 200 },
  totalLLMCalls: 3,
  modelsUsed: ["openai/gpt-4.1", "deepseek/deepseek-r1", "anthropic/claude-sonnet-4.6"],
};

function makeModelInfo(id: string): ModelInfo {
  return {
    id,
    name: id.split("/")[1] ?? id,
    provider: id.split("/")[0] as any,
    contextWindow: 128_000,
    capabilities: {} as any,
    cost: { inputPer1M: 2, outputPer1M: 8 },
    supportsToolCalling: true,
  };
}

function makeChatResponse(content: string, promptTokens = 50, completionTokens = 100) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: Date.now(),
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content },
        finish_reason: "stop" as const,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

// ================================================================
// stripThinkTags
// ================================================================

describe("stripThinkTags", () => {
  it("should strip basic think block", () => {
    const input = "<think>internal reasoning</think>Final answer here.";
    expect(stripThinkTags(input)).toBe("Final answer here.");
  });

  it("should strip multiple think blocks", () => {
    const input = "<think>block 1</think>Middle text<think>block 2</think>End.";
    expect(stripThinkTags(input)).toBe("Middle textEnd.");
  });

  it("should return original text when no think tags present", () => {
    const input = "No think tags in this text.";
    expect(stripThinkTags(input)).toBe("No think tags in this text.");
  });

  it("should handle nested content inside think tags", () => {
    const input = "<think>outer <b>nested</b> content</think>Visible.";
    expect(stripThinkTags(input)).toBe("Visible.");
  });

  it("should strip unclosed <think> tag at end of text", () => {
    const input = "Before thinking<think>partial thoughts that never close";
    expect(stripThinkTags(input)).toBe("Before thinking");
  });

  it("should strip closed and unclosed think tags together", () => {
    const input = "<think>closed</think>Content<think>unclosed trailing";
    expect(stripThinkTags(input)).toBe("Content");
  });
});

// ================================================================
// createChatAdapter
// ================================================================

describe("createChatAdapter", () => {
  it("should return ChatResult with content and token usage on success", async () => {
    // Arrange
    const rawChat = mock(() =>
      Promise.resolve(makeChatResponse("Hello world", 30, 60)),
    );
    const adapter = createChatAdapter(rawChat);

    // Act
    const result = await adapter("openai/gpt-4.1", [
      { role: "user", content: "Say hello" },
    ]);

    // Assert
    expect(result.content).toBe("Hello world");
    expect(result.inputTokens).toBe(30);
    expect(result.outputTokens).toBe(60);
  });

  it("should retry on 429 rate limit error", async () => {
    // Arrange
    let callCount = 0;
    const rawChat = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new LLMClientError(429, "Rate limited"));
      }
      return Promise.resolve(makeChatResponse("Retry success", 10, 20));
    });
    const adapter = createChatAdapter(rawChat, {
      maxRetries: 3,
      baseDelayMs: 1,
      randomFn: () => 0,
    });

    // Act
    const result = await adapter("openai/gpt-4.1", [
      { role: "user", content: "test" },
    ]);

    // Assert
    expect(result.content).toBe("Retry success");
    expect(callCount).toBe(2);
  });

  it("should throw after maxRetries exhausted", async () => {
    // Arrange
    const rawChat = mock(() =>
      Promise.reject(new LLMClientError(429, "Rate limited")),
    );
    const adapter = createChatAdapter(rawChat, {
      maxRetries: 2,
      baseDelayMs: 1,
      randomFn: () => 0,
    });

    // Act & Assert
    await expect(
      adapter("openai/gpt-4.1", [{ role: "user", content: "test" }]),
    ).rejects.toThrow("Rate limited");
  });

  it("should invoke onRetry callback on retryable error", async () => {
    // Arrange
    const retryEvents: any[] = [];
    let callCount = 0;
    const rawChat = mock(() => {
      callCount++;
      if (callCount <= 1) {
        return Promise.reject(new LLMClientError(429, "Rate limited"));
      }
      return Promise.resolve(makeChatResponse("ok", 10, 20));
    });
    const adapter = createChatAdapter(rawChat, {
      maxRetries: 3,
      baseDelayMs: 1,
      randomFn: () => 0,
      onRetry: (event) => retryEvents.push(event),
    });

    // Act
    await adapter("openai/gpt-4.1", [{ role: "user", content: "test" }]);

    // Assert
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0].status).toBe(429);
    expect(retryEvents[0].attempt).toBe(1);
    expect(retryEvents[0].model).toBe("openai/gpt-4.1");
    expect(retryEvents[0].willRetry).toBe(true);
  });

  it("should strip think tags from response content", async () => {
    // Arrange
    const rawChat = mock(() =>
      Promise.resolve(
        makeChatResponse("<think>reasoning</think>Clean answer", 10, 20),
      ),
    );
    const adapter = createChatAdapter(rawChat);

    // Act
    const result = await adapter("deepseek/deepseek-r1", [
      { role: "user", content: "test" },
    ]);

    // Assert
    expect(result.content).toBe("Clean answer");
  });

  it("should forward GenerationParams to rawChatFn when provided", async () => {
    // Arrange
    const rawChat = mock((_req: any) =>
      Promise.resolve(makeChatResponse("ok", 10, 20)),
    );
    const adapter = createChatAdapter(rawChat);

    // Act
    await adapter(
      "openai/gpt-4.1",
      [{ role: "user", content: "test" }],
      { temperature: 0.5, max_tokens: 1024, top_p: 0.9 },
    );

    // Assert
    expect(rawChat).toHaveBeenCalledTimes(1);
    const req = rawChat.mock.calls[0]![0] as any;
    expect(req.temperature).toBe(0.5);
    expect(req.max_tokens).toBe(1024);
    expect(req.top_p).toBe(0.9);
  });

  it("should set truncated=true when finish_reason is 'length'", async () => {
    // Arrange
    const rawChat = mock(() =>
      Promise.resolve({
        ...makeChatResponse("partial content", 30, 60),
        choices: [
          {
            index: 0,
            message: { role: "assistant" as const, content: "partial content" },
            finish_reason: "length" as const,
          },
        ],
      }),
    );
    const adapter = createChatAdapter(rawChat);

    // Act
    const result = await adapter("openai/gpt-4.1", [
      { role: "user", content: "Generate a long essay" },
    ]);

    // Assert
    expect(result.truncated).toBe(true);
    expect(result.content).toBe("partial content");
  });

  it("should not set truncated when finish_reason is 'stop'", async () => {
    // Arrange
    const rawChat = mock(() =>
      Promise.resolve(makeChatResponse("complete content", 30, 60)),
    );
    const adapter = createChatAdapter(rawChat);

    // Act
    const result = await adapter("openai/gpt-4.1", [
      { role: "user", content: "Say hello" },
    ]);

    // Assert
    expect(result.truncated).toBeUndefined();
  });

  it("should NOT include generation params keys when params is undefined", async () => {
    // Arrange
    const rawChat = mock((_req: any) =>
      Promise.resolve(makeChatResponse("ok", 10, 20)),
    );
    const adapter = createChatAdapter(rawChat);

    // Act
    await adapter("openai/gpt-4.1", [{ role: "user", content: "test" }]);

    // Assert
    const req = rawChat.mock.calls[0]![0] as any;
    expect(req.temperature).toBeUndefined();
    expect(req.max_tokens).toBeUndefined();
    expect(req.top_p).toBeUndefined();
  });
});

// ================================================================
// createDeliberateFn
// ================================================================

describe("createDeliberateFn", () => {
  beforeEach(() => {
    mockComposeTeam.mockReset();
    mockDeliberate.mockReset();
  });

  const STUB_MODELS: ModelInfo[] = [
    makeModelInfo("openai/gpt-4.1"),
    makeModelInfo("deepseek/deepseek-r1"),
    makeModelInfo("anthropic/claude-sonnet-4.6"),
  ];

  function makeWireDeps(overrides?: { store?: any }) {
    return {
      registry: {
        getAll: () => STUB_MODELS,
        getAvailable: () => STUB_MODELS,
        getById: (id: string) => STUB_MODELS.find((m) => m.id === id),
      },
      chat: mock(() =>
        Promise.resolve({ content: "response", inputTokens: 10, outputTokens: 20 }),
      ),
      ...overrides,
    };
  }

  it("should compose team from registry available models", async () => {
    // Arrange
    mockComposeTeam.mockImplementation((_opts: any, _deps: any) => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    // Act
    await deliberateFn({ task: "Build a feature" });

    // Assert
    expect(mockComposeTeam).toHaveBeenCalledTimes(1);
    const [composeOpts, composeDeps] = mockComposeTeam.mock.calls[0]!;
    expect(composeOpts.task).toBe("Build a feature");
    expect(composeOpts.modelIds).toEqual(STUB_MODELS.map((m) => m.id));
    expect(typeof composeDeps.getModels).toBe("function");
    expect(typeof composeDeps.getById).toBe("function");
  });

  it("should pass input correctly to deliberation engine", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    const input: DeliberateInput = {
      task: "Review this code",
      workerInstructions: "Focus on security",
      leaderInstructions: "Synthesize findings",
      maxRounds: 2,
      consensus: "leader_decides",
    };

    // Act
    await deliberateFn(input);

    // Assert
    expect(mockDeliberate).toHaveBeenCalledTimes(1);
    const [team, passedInput, engineDeps, config] = mockDeliberate.mock.calls[0]!;
    expect(team).toEqual(STUB_TEAM);
    expect(passedInput).toEqual(input);
    expect(typeof engineDeps.chat).toBe("function");
    expect(typeof engineDeps.buildWorkerMessages).toBe("function");
    expect(typeof engineDeps.buildLeaderMessages).toBe("function");
    expect(config).toMatchObject({ maxRounds: 2, consensus: "leader_decides" });
    // Default taskNature is "critique" → structuralTags should be set
    expect(config.structuralTags).toEqual(["verification", "adopted", "novel", "result"]);
  });

  it("should return deliberation output", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    // Act
    const result = await deliberateFn({ task: "Build something" });

    // Assert
    expect(result.result).toBe("deliberation result");
    expect(result.roundsExecuted).toBe(1);
    expect(result.consensusReached).toBeNull();
    expect(result.totalTokens).toEqual({ input: 100, output: 200 });
    expect(result.totalLLMCalls).toBe(3);
    expect(result.modelsUsed).toEqual([
      "openai/gpt-4.1",
      "deepseek/deepseek-r1",
      "anthropic/claude-sonnet-4.6",
    ]);
  });

  it("should auto-save to store when store is provided", async () => {
    // Arrange
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const mockSave = mock((_record: any) => Promise.resolve());
    const store = { save: mockSave, query: mock(), getById: mock() };
    const deps = makeWireDeps({ store });
    const deliberateFn = createDeliberateFn(deps);

    // Act
    await deliberateFn({
      task: "Test task",
      workerInstructions: "worker instructions",
      leaderInstructions: "leader instructions",
      consensus: "leader_decides",
    });

    // Assert
    expect(mockSave).toHaveBeenCalledTimes(1);
    const savedRecord = mockSave.mock.calls[0]![0] as any;
    expect(savedRecord.task).toBe("Test task");
    expect(savedRecord.result).toBe("deliberation result");
    expect(savedRecord.consensusReached).toBeNull();
    expect(savedRecord.roundsExecuted).toBe(1);
    expect(savedRecord.modelsUsed).toEqual([
      "openai/gpt-4.1",
      "deepseek/deepseek-r1",
      "anthropic/claude-sonnet-4.6",
    ]);
    expect(savedRecord.totalLLMCalls).toBe(3);
    expect(savedRecord.totalTokens).toEqual({ input: 100, output: 200 });
    expect(savedRecord.workerInstructions).toBe("worker instructions");
    expect(savedRecord.leaderInstructions).toBe("leader instructions");
    expect(savedRecord.consensus).toBe("leader_decides");
    expect(savedRecord.id).toBeDefined();
    expect(savedRecord.timestamp).toBeGreaterThan(0);
  });

  it("should set worker max_tokens to 2048", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    await deliberateFn({ task: "Analyze this code" });

    const [, , , config] = mockDeliberate.mock.calls[0]!;
    expect(config.workerGenParams.max_tokens).toBe(2048);
  });

  it("should set artifact worker max_tokens to 2048", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    await deliberateFn({ task: "Write code", taskNature: "artifact" });

    const [, , , config] = mockDeliberate.mock.calls[0]!;
    expect(config.workerGenParams.max_tokens).toBe(2048);
  });

  it("should not set max_tokens for artifact leader (unconstrained output)", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    await deliberateFn({ task: "Write code", taskNature: "artifact" });

    const [, , , config] = mockDeliberate.mock.calls[0]!;
    expect(config.leaderGenParams.max_tokens).toBeUndefined();
  });

  it("should set critique leader max_tokens to 8192", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    await deliberateFn({ task: "Review code", taskNature: "critique" });

    const [, , , config] = mockDeliberate.mock.calls[0]!;
    expect(config.leaderGenParams.max_tokens).toBe(8192);
  });

  it("should set structuralTags to undefined for artifact tasks", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    await deliberateFn({ task: "Write code", taskNature: "artifact" });

    const [, , , config] = mockDeliberate.mock.calls[0]!;
    expect(config.structuralTags).toBeUndefined();
  });

  it("should set structuralTags to critique tags for critique tasks", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    await deliberateFn({ task: "Review code", taskNature: "critique" });

    const [, , , config] = mockDeliberate.mock.calls[0]!;
    expect(config.structuralTags).toEqual(["verification", "adopted", "novel", "result"]);
  });
});
