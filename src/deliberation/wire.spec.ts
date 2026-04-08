/**
 * Unit tests for wire.ts — Integration Wiring.
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
  scoreModel: (_model: any) => 1,
}));

mock.module("./engine", () => ({
  deliberate: (...args: any[]) => (mockDeliberate as Function)(...args),
  createFallbackPool: () => ({
    getNext: () => undefined,
    getNextByProvider: () => undefined,
    markFailed: () => {},
    isOnCooldown: () => false,
    getEntry: () => undefined,
  }),
}));

// Import SUT after mocks
const { createChatAdapter, createDeliberateFn, stripThinkTags } = await import("./wire");

// -- Fixtures --

const STUB_TEAM: TeamComposition = {
  workers: [
    { model: "openai/gpt-4.1", role: "worker" },
    { model: "deepseek/deepseek-r1", role: "worker" },
  ],
};

const STUB_DELIBERATE_OUTPUT: DeliberateOutput = {
  roundsExecuted: 1,
  totalTokens: { input: 100, output: 200 },
  totalLLMCalls: 2,
  modelsUsed: ["openai/gpt-4.1", "deepseek/deepseek-r1"],
  protocol: "shared_convergence",
};

function makeModelInfo(id: string): ModelInfo {
  return {
    id,
    name: id.split("/")[1] ?? id,
    provider: id.split("/")[0] as any,
    contextWindow: 128_000,
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
    const rawChat = mock(() =>
      Promise.resolve(makeChatResponse("Hello world", 30, 60)),
    );
    const adapter = createChatAdapter(rawChat);

    const result = await adapter("openai/gpt-4.1", [
      { role: "user", content: "Say hello" },
    ]);

    expect(result.content).toBe("Hello world");
    expect(result.inputTokens).toBe(30);
    expect(result.outputTokens).toBe(60);
  });

  it("should throw immediately on any error without retrying", async () => {
    let callCount = 0;
    const rawChat = mock(() => {
      callCount++;
      return Promise.reject(new LLMClientError(429, "Rate limited"));
    });
    const adapter = createChatAdapter(rawChat);

    await expect(
      adapter("openai/gpt-4.1", [{ role: "user", content: "test" }]),
    ).rejects.toThrow("Rate limited");
    expect(callCount).toBe(1);
  });

  it("should strip think tags from response content", async () => {
    const rawChat = mock(() =>
      Promise.resolve(
        makeChatResponse("<think>reasoning</think>Clean answer", 10, 20),
      ),
    );
    const adapter = createChatAdapter(rawChat);

    const result = await adapter("deepseek/deepseek-r1", [
      { role: "user", content: "test" },
    ]);

    expect(result.content).toBe("Clean answer");
  });

  it("should forward GenerationParams to rawChatFn when provided", async () => {
    const rawChat = mock((_req: any) =>
      Promise.resolve(makeChatResponse("ok", 10, 20)),
    );
    const adapter = createChatAdapter(rawChat);

    await adapter(
      "openai/gpt-4.1",
      [{ role: "user", content: "test" }],
      { temperature: 0.5, top_p: 0.9 },
    );

    expect(rawChat).toHaveBeenCalledTimes(1);
    const req = rawChat.mock.calls[0]![0] as any;
    expect(req.temperature).toBe(0.5);
    expect(req.top_p).toBe(0.9);
  });

  it("should set truncated=true when finish_reason is 'length'", async () => {
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

    const result = await adapter("openai/gpt-4.1", [
      { role: "user", content: "Generate a long essay" },
    ]);

    expect(result.truncated).toBe(true);
    expect(result.content).toBe("partial content");
  });

  it("should not set truncated when finish_reason is 'stop'", async () => {
    const rawChat = mock(() =>
      Promise.resolve(makeChatResponse("complete content", 30, 60)),
    );
    const adapter = createChatAdapter(rawChat);

    const result = await adapter("openai/gpt-4.1", [
      { role: "user", content: "Say hello" },
    ]);

    expect(result.truncated).toBeUndefined();
  });

  it("should NOT include generation params keys when params is undefined", async () => {
    const rawChat = mock((_req: any) =>
      Promise.resolve(makeChatResponse("ok", 10, 20)),
    );
    const adapter = createChatAdapter(rawChat);

    await adapter("openai/gpt-4.1", [{ role: "user", content: "test" }]);

    const req = rawChat.mock.calls[0]![0] as any;
    expect(req.temperature).toBeUndefined();
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

  it("should compose team from specified models", async () => {
    mockComposeTeam.mockImplementation((_opts: any, _deps: any) => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    await deliberateFn({ task: "Build a feature", models: ["openai/gpt-4.1", "deepseek/deepseek-r1"], protocol: "shared_convergence" });

    expect(mockComposeTeam).toHaveBeenCalledTimes(1);
    const [composeOpts] = mockComposeTeam.mock.calls[0]!;
    expect(composeOpts.task).toBe("Build a feature");
    expect(composeOpts.modelIds).toEqual(["openai/gpt-4.1", "deepseek/deepseek-r1"]);
  });

  it("should pass input correctly to deliberation engine", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    const input: DeliberateInput = {
      task: "Review this code",
      models: ["openai/gpt-4.1", "deepseek/deepseek-r1"],
      protocol: "shared_convergence",
      workerInstructions: "Focus on security",
      maxRounds: 2,
    };

    await deliberateFn(input);

    expect(mockDeliberate).toHaveBeenCalledTimes(1);
    const [team, passedInput, engineDeps, config] = mockDeliberate.mock.calls[0]!;
    expect(team).toEqual(STUB_TEAM);
    expect(passedInput).toEqual(input);
    expect(typeof engineDeps.chat).toBe("function");
    expect(typeof engineDeps.buildR1Messages).toBe("function");
    expect(config).toMatchObject({ maxRounds: 2 });
  });

  it("should return deliberation output", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    const result = await deliberateFn({ task: "Build something", models: ["openai/gpt-4.1"], protocol: "shared_convergence" });

    expect(result.roundsExecuted).toBe(1);
    expect(result.totalTokens).toEqual({ input: 100, output: 200 });
    expect(result.totalLLMCalls).toBe(2);
    expect(result.modelsUsed).toEqual([
      "openai/gpt-4.1",
      "deepseek/deepseek-r1",
    ]);
  });

  it("should auto-save to store when store is provided", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const mockSave = mock((_record: any) => Promise.resolve());
    const store = { save: mockSave, query: mock(), getById: mock() };
    const deps = makeWireDeps({ store });
    const deliberateFn = createDeliberateFn(deps);

    await deliberateFn({
      task: "Test task",
      models: ["openai/gpt-4.1"],
      protocol: "shared_convergence",
      workerInstructions: "worker instructions",
    });

    expect(mockSave).toHaveBeenCalledTimes(1);
    const savedRecord = mockSave.mock.calls[0]![0] as any;
    expect(savedRecord.task).toBe("Test task");
    expect(savedRecord.roundsExecuted).toBe(1);
    expect(savedRecord.modelsUsed).toEqual([
      "openai/gpt-4.1",
      "deepseek/deepseek-r1",
    ]);
    expect(savedRecord.totalLLMCalls).toBe(2);
    expect(savedRecord.totalTokens).toEqual({ input: 100, output: 200 });
    expect(savedRecord.workerInstructions).toBe("worker instructions");
    expect(savedRecord.id).toBeDefined();
    expect(savedRecord.timestamp).toBeGreaterThan(0);
  });

  it("should duplicate models round-robin when count > models.length", async () => {
    mockComposeTeam.mockImplementation((opts: any) => ({
      workers: opts.modelIds.map((id: string) => ({ model: id, role: "worker" })),
    }));
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    await deliberateFn({ task: "Debate this", models: ["openai/gpt-4.1"], protocol: "shared_convergence", count: 3 });

    const [composeOpts] = mockComposeTeam.mock.calls[0]!;
    expect(composeOpts.modelIds).toEqual(["openai/gpt-4.1", "openai/gpt-4.1", "openai/gpt-4.1"]);
  });

  it("should cap count at 7", async () => {
    mockComposeTeam.mockImplementation((opts: any) => ({
      workers: opts.modelIds.map((id: string) => ({ model: id, role: "worker" })),
    }));
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    await deliberateFn({ task: "Debate", models: ["openai/gpt-4.1"], protocol: "shared_convergence", count: 20 });

    const [composeOpts] = mockComposeTeam.mock.calls[0]!;
    expect(composeOpts.modelIds.length).toBe(7);
  });

  it("should use count models from front when count < models.length", async () => {
    mockComposeTeam.mockImplementation((opts: any) => ({
      workers: opts.modelIds.map((id: string) => ({ model: id, role: "worker" })),
    }));
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    await deliberateFn({
      task: "Debate",
      models: ["openai/gpt-4.1", "deepseek/deepseek-r1", "anthropic/claude-sonnet-4.6"],
      protocol: "shared_convergence",
      count: 2,
    });

    const [composeOpts] = mockComposeTeam.mock.calls[0]!;
    expect(composeOpts.modelIds).toEqual(["openai/gpt-4.1", "deepseek/deepseek-r1"]);
  });

  it("should throw with available models list for unknown model IDs", async () => {
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    await expect(
      deliberateFn({ task: "task", models: ["nonexistent/model"], protocol: "shared_convergence" }),
    ).rejects.toThrow(/Unknown model.*Available/);
  });

  it("should default count to models.length when not specified", async () => {
    mockComposeTeam.mockImplementation((opts: any) => ({
      workers: opts.modelIds.map((id: string) => ({ model: id, role: "worker" })),
    }));
    mockDeliberate.mockImplementation(async () => STUB_DELIBERATE_OUTPUT);
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    await deliberateFn({
      task: "task",
      models: ["openai/gpt-4.1", "deepseek/deepseek-r1"],
      protocol: "shared_convergence",
    });

    const [composeOpts] = mockComposeTeam.mock.calls[0]!;
    expect(composeOpts.modelIds).toEqual(["openai/gpt-4.1", "deepseek/deepseek-r1"]);
  });

  it("should throw when models is empty array", async () => {
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);

    await expect(
      deliberateFn({ task: "task", models: [], protocol: "shared_convergence" }),
    ).rejects.toThrow("models is required");
  });

  // -- Protocol-specific deps wiring --

  it("should wire adversarial_debate deps with buildR2Messages and buildFollowUp", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async (_team, _input, engineDeps) => {
      // Verify adversarial deps have R2 and followUp builders
      expect(typeof engineDeps.buildR1Messages).toBe("function");
      expect(typeof engineDeps.buildR2Messages).toBe("function");
      expect(typeof engineDeps.buildFollowUp).toBe("function");
      return STUB_DELIBERATE_OUTPUT;
    });
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    await deliberateFn({ task: "Debate", models: ["openai/gpt-4.1", "deepseek/deepseek-r1"], protocol: "adversarial_debate" });
  });

  it("should wire specialized protocol deps without R2/followUp", async () => {
    for (const protocol of ["host_interrogation", "sequential_refinement", "evaluation_scoring", "red_team"] as const) {
      mockComposeTeam.mockImplementation(() => STUB_TEAM);
      mockDeliberate.mockImplementation(async (_team, _input, engineDeps) => {
        expect(typeof engineDeps.buildR1Messages).toBe("function");
        expect(engineDeps.buildR2Messages).toBeUndefined();
        expect(engineDeps.buildFollowUp).toBeUndefined();
        return STUB_DELIBERATE_OUTPUT;
      });
      const deps = makeWireDeps();
      const deliberateFn = createDeliberateFn(deps);
      await deliberateFn({ task: "Task", models: ["openai/gpt-4.1", "deepseek/deepseek-r1"], protocol });
    }
  });

  // -- Protocol-specific max rounds --

  it("should use default maxRounds=3 for adversarial_debate", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async (_team, _input, _deps, config) => {
      expect(config.maxRounds).toBe(3);
      return STUB_DELIBERATE_OUTPUT;
    });
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    await deliberateFn({ task: "Task", models: ["openai/gpt-4.1", "deepseek/deepseek-r1"], protocol: "adversarial_debate" });
  });

  it("should use default maxRounds=1 for host_interrogation", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async (_team, _input, _deps, config) => {
      expect(config.maxRounds).toBe(1);
      return STUB_DELIBERATE_OUTPUT;
    });
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    await deliberateFn({ task: "Task", models: ["openai/gpt-4.1", "deepseek/deepseek-r1"], protocol: "host_interrogation" });
  });

  it("should use default maxRounds=2 for red_team", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async (_team, _input, _deps, config) => {
      expect(config.maxRounds).toBe(2);
      return STUB_DELIBERATE_OUTPUT;
    });
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    await deliberateFn({ task: "Task", models: ["openai/gpt-4.1", "deepseek/deepseek-r1"], protocol: "red_team" });
  });

  it("should use default maxRounds=1 for sequential_refinement", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async (_team, _input, _deps, config) => {
      expect(config.maxRounds).toBe(1);
      return STUB_DELIBERATE_OUTPUT;
    });
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    await deliberateFn({ task: "Task", models: ["openai/gpt-4.1", "deepseek/deepseek-r1"], protocol: "sequential_refinement" });
  });

  it("should use default maxRounds=1 for evaluation_scoring", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async (_team, _input, _deps, config) => {
      expect(config.maxRounds).toBe(1);
      return STUB_DELIBERATE_OUTPUT;
    });
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    await deliberateFn({ task: "Task", models: ["openai/gpt-4.1", "deepseek/deepseek-r1"], protocol: "evaluation_scoring" });
  });

  // -- Protocol-specific minimum model validation --

  it("should throw for red_team with less than 2 models", async () => {
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    await expect(
      deliberateFn({ task: "Task", models: ["openai/gpt-4.1"], protocol: "red_team" }),
    ).rejects.toThrow("red_team protocol requires at least 2 models");
  });

  it("should throw for adversarial_debate with less than 2 models", async () => {
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    await expect(
      deliberateFn({ task: "Task", models: ["openai/gpt-4.1"], protocol: "adversarial_debate" }),
    ).rejects.toThrow("adversarial_debate protocol requires at least 2 models");
  });

  // -- Replenish callback --

  it("should pass replenish callback in fallbackDeps", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async (_team, _input, _deps, _config, fallbackDeps) => {
      expect(typeof fallbackDeps.replenish).toBe("function");
      expect(typeof fallbackDeps.pool).toBe("object");
      return STUB_DELIBERATE_OUTPUT;
    });
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    await deliberateFn({ task: "Task", models: ["openai/gpt-4.1", "deepseek/deepseek-r1"], protocol: "shared_convergence" });
  });

  it("should return empty array from replenish when no candidates match", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async (_team, _input, _deps, _config, fallbackDeps) => {
      const result = fallbackDeps.replenish(
        new Set(["openai"]),
        2,
        new Set(["openai/gpt-4.1"]),
      );
      expect(Array.isArray(result)).toBe(true);
      return STUB_DELIBERATE_OUTPUT;
    });
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    await deliberateFn({ task: "Task", models: ["openai/gpt-4.1", "deepseek/deepseek-r1"], protocol: "shared_convergence" });
  });

  it("should return replacement members from replenish when candidates exist", async () => {
    // Team uses only 2 of 3 available models — the 3rd is available for replenishment
    const smallTeam: TeamComposition = {
      workers: [{ model: "openai/gpt-4.1", role: "worker" }],
    };
    mockComposeTeam.mockImplementation(() => smallTeam);
    mockDeliberate.mockImplementation(async (_team, _input, _deps, _config, fallbackDeps) => {
      // Replenish with an alive provider, 1 empty slot, model not yet responded
      const result = fallbackDeps.replenish(
        new Set(["anthropic"]),  // alive provider
        1,                       // 1 empty slot
        new Set(["openai/gpt-4.1"]),  // already responded
      );
      // anthropic/claude-sonnet-4.6 should be a candidate (alive provider, not on team, not responded)
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].role).toBe("worker");
      return STUB_DELIBERATE_OUTPUT;
    });
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    await deliberateFn({ task: "Task", models: ["openai/gpt-4.1"], protocol: "shared_convergence" });
  });

  // -- Invoke deps builders to cover arrow function bodies --

  it("should produce callable buildR2Messages for adversarial_debate", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async (_team, _input, engineDeps) => {
      const fakeRound = {
        number: 1,
        responses: [
          { model: "openai/gpt-4.1", content: "position A", workerIndex: 0 },
          { model: "deepseek/deepseek-r1", content: "position B", workerIndex: 1 },
        ],
      };
      const fakeCtx = { task: "t", team: STUB_TEAM, rounds: [fakeRound], taskNature: "critique" as const };
      const fakeResponses = [{ model: "m", content: "c", workerIndex: 0 }];
      // R1
      const msgs1 = engineDeps.buildR1Messages!(fakeCtx as any, "instructions", { current: 1, max: 3 }, 0);
      expect(Array.isArray(msgs1)).toBe(true);
      // R2
      if (engineDeps.buildR2Messages) {
        const msgs2 = engineDeps.buildR2Messages(fakeCtx as any, fakeResponses, "prev", "instructions", { current: 2, max: 3 }, 0);
        expect(Array.isArray(msgs2)).toBe(true);
      }
      // FollowUp — returns a single ChatMessage, not an array
      if (engineDeps.buildFollowUp) {
        const msg3 = engineDeps.buildFollowUp(fakeCtx as any, fakeResponses, "instructions", { current: 2, max: 3 }, 0);
        expect(msg3).toBeDefined();
        expect(typeof msg3.role).toBe("string");
      }
      return STUB_DELIBERATE_OUTPUT;
    });
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    await deliberateFn({ task: "Task", models: ["openai/gpt-4.1", "deepseek/deepseek-r1"], protocol: "adversarial_debate" });
  });

  it("should produce callable buildR1Messages for specialized protocols", async () => {
    for (const protocol of ["host_interrogation", "sequential_refinement", "evaluation_scoring", "red_team"] as const) {
      mockComposeTeam.mockImplementation(() => STUB_TEAM);
      mockDeliberate.mockImplementation(async (_team, _input, engineDeps) => {
        const fakeCtx = { task: "t", team: STUB_TEAM, rounds: [], taskNature: "critique" as const };
        const msgs = engineDeps.buildR1Messages!(fakeCtx as any, "instructions", { current: 1, max: 1 });
        expect(Array.isArray(msgs)).toBe(true);
        return STUB_DELIBERATE_OUTPUT;
      });
      const deps = makeWireDeps();
      const deliberateFn = createDeliberateFn(deps);
      await deliberateFn({ task: "Task", models: ["openai/gpt-4.1", "deepseek/deepseek-r1"], protocol });
    }
  });

  it("should produce callable buildR1Messages for default (unknown) protocol path", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async (_team, _input, engineDeps) => {
      const fakeCtx = { task: "t", team: STUB_TEAM, rounds: [], taskNature: "critique" as const };
      const msgs = engineDeps.buildR1Messages!(fakeCtx as any, "instructions", { current: 1, max: 1 });
      expect(Array.isArray(msgs)).toBe(true);
      return STUB_DELIBERATE_OUTPUT;
    });
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    // Use shared_convergence (default path) — already tested, but ensures buildR1 body executes
    await deliberateFn({ task: "Task", models: ["openai/gpt-4.1", "deepseek/deepseek-r1"], protocol: "shared_convergence" });
  });

  it("should produce callable buildR2Messages for shared_convergence", async () => {
    mockComposeTeam.mockImplementation(() => STUB_TEAM);
    mockDeliberate.mockImplementation(async (_team, _input, engineDeps) => {
      const fakeRound = {
        number: 1,
        responses: [
          { model: "openai/gpt-4.1", content: "position A", workerIndex: 0 },
          { model: "deepseek/deepseek-r1", content: "position B", workerIndex: 1 },
        ],
      };
      const fakeCtx = { task: "t", team: STUB_TEAM, rounds: [fakeRound], taskNature: "critique" as const };
      const fakeResponses = [{ model: "m", content: "c", workerIndex: 0 }];
      if (engineDeps.buildR2Messages) {
        const msgs = engineDeps.buildR2Messages(fakeCtx as any, fakeResponses, "prev", "instructions", { current: 2, max: 3 }, 0);
        expect(Array.isArray(msgs)).toBe(true);
      }
      return STUB_DELIBERATE_OUTPUT;
    });
    const deps = makeWireDeps();
    const deliberateFn = createDeliberateFn(deps);
    await deliberateFn({ task: "Task", models: ["openai/gpt-4.1", "deepseek/deepseek-r1"], protocol: "shared_convergence" });
  });
});
