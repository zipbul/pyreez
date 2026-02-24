import { describe, it, expect, mock } from "bun:test";
import { PyreezMcpServer } from "./server";
import type { PyreezMcpServerConfig } from "./server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { LLMClient } from "../llm/client";
import type { ModelRegistry } from "../model/registry";
import type { Reporter } from "../report/types";
import type { RouteResult } from "../router/router";
import type { BudgetConfig } from "../router/types";
import type { ModelInfo } from "../model/types";
import type { DeliberateInput, DeliberateOutput } from "../deliberation/types";
import type { CalibrationResult } from "../model/calibration";

// --- Test Doubles ---

function stubMcpServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    registerTool: mock(() => {}),
    connect: mock(() => Promise.resolve()),
    close: mock(() => Promise.resolve()),
    ...overrides,
  } as unknown as McpServer;
}

function stubLlmClient(
  overrides: Partial<LLMClient> = {},
): LLMClient {
  return {
    chat: mock(() =>
      Promise.resolve({
        id: "test-id",
        object: "chat.completion",
        created: Date.now(),
        model: "test-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant" as const, content: "test response" },
            finish_reason: "stop" as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    ),
    ...overrides,
  } as unknown as LLMClient;
}

function stubRegistry(
  overrides: Partial<ModelRegistry> = {},
): ModelRegistry {
  return {
    getAll: mock(() => [
      {
        id: "openai/gpt-4.1",
        name: "GPT-4.1",
        contextWindow: 1048576,
        capabilities: {},
        confidence: {},
        cost: { inputPer1M: 2.0, outputPer1M: 8.0 },
        supportsToolCalling: true,
      },
      {
        id: "openai/gpt-4.1-mini",
        name: "GPT-4.1 mini",
        contextWindow: 1048576,
        capabilities: {},
        confidence: {},
        cost: { inputPer1M: 0.4, outputPer1M: 1.6 },
        supportsToolCalling: true,
      },
    ]),
    getById: mock((id: string) => {
      if (id === "openai/gpt-4.1") {
        return {
          id: "openai/gpt-4.1",
          name: "GPT-4.1",
          contextWindow: 1048576,
          capabilities: {},
          confidence: {},
          cost: { inputPer1M: 2.0, outputPer1M: 8.0 },
          supportsToolCalling: true,
        };
      }
      return undefined;
    }),
    ...overrides,
  } as unknown as ModelRegistry;
}

function stubReporter(
  overrides: Partial<Reporter> = {},
): Reporter {
  return {
    record: mock(() => Promise.resolve()),
    ...overrides,
  } as unknown as Reporter;
}

const DEFAULT_ROUTE_RESULT: RouteResult = {
  classification: {
    domain: "DEVELOPMENT",
    taskType: "CODE_WRITE",
    confidence: 0.9,
    keywords: ["implement"],
  },
  requirement: {
    requiredCapabilities: { CODE_GENERATION: 8, REASONING: 7 },
    minContextWindow: 4096,
    requiresToolCalling: false,
  },
  selection: {
    model: {
      id: "openai/gpt-4.1",
      name: "GPT-4.1",
      contextWindow: 1048576,
      capabilities: {},
      confidence: {},
      cost: { inputPer1M: 2.0, outputPer1M: 8.0 },
      supportsToolCalling: true,
    },
    score: 0.85,
    costEfficiency: 42.5,
    expectedCost: 0.02,
    reason: "Best match for CODE_WRITE",
  },
} as unknown as RouteResult;

function stubRouteFn(
  result?: RouteResult | null,
  error?: unknown,
): (prompt: string, budget?: BudgetConfig, hints?: import("../router/types").RouteHints) => RouteResult | null {
  if (error !== undefined) {
    return mock(() => {
      throw error;
    });
  }
  if (result === null) {
    return mock(() => null);
  }
  return mock(() => result ?? DEFAULT_ROUTE_RESULT);
}

function stubTransport(): Transport {
  return {} as unknown as Transport;
}

function validConfig(
  overrides: Partial<PyreezMcpServerConfig> = {},
): PyreezMcpServerConfig {
  return {
    mcpServer: stubMcpServer(),
    llmClient: stubLlmClient(),
    registry: stubRegistry(),
    reporter: stubReporter(),
    routeFn: stubRouteFn(),
    ...overrides,
  };
}

// --- Tests ---

describe("PyreezMcpServer", () => {
  // === Constructor ===

  describe("constructor", () => {
    it("should create instance and register 7 tools when config is valid", () => {
      const mcp = stubMcpServer();
      const server = new PyreezMcpServer(validConfig({ mcpServer: mcp }));

      expect(server).toBeInstanceOf(PyreezMcpServer);
      expect(mcp.registerTool).toHaveBeenCalledTimes(7);

      const calls = (mcp.registerTool as ReturnType<typeof mock>).mock.calls;
      const toolNames = calls.map((c: unknown[]) => c[0]);
      expect(toolNames).toContain("pyreez_route");
      expect(toolNames).toContain("pyreez_ask");
      expect(toolNames).toContain("pyreez_ask_many");
      expect(toolNames).toContain("pyreez_scores");
      expect(toolNames).toContain("pyreez_report");
      expect(toolNames).toContain("pyreez_deliberate");
      expect(toolNames).toContain("pyreez_calibrate");
    });

    it('should throw "mcpServer is required" when mcpServer is missing', () => {
      expect(
        () =>
          new PyreezMcpServer({
            ...validConfig(),
            mcpServer: undefined as unknown as McpServer,
          }),
      ).toThrow("mcpServer is required");
    });

    it('should throw "llmClient is required" when llmClient is missing', () => {
      expect(
        () =>
          new PyreezMcpServer({
            ...validConfig(),
            llmClient: undefined as unknown as LLMClient,
          }),
      ).toThrow("llmClient is required");
    });

    it('should throw "registry is required" when registry is missing', () => {
      expect(
        () =>
          new PyreezMcpServer({
            ...validConfig(),
            registry: undefined as unknown as ModelRegistry,
          }),
      ).toThrow("registry is required");
    });

    it('should throw "reporter is required" when reporter is missing', () => {
      expect(
        () =>
          new PyreezMcpServer({
            ...validConfig(),
            reporter: undefined as unknown as Reporter,
          }),
      ).toThrow("reporter is required");
    });

    it('should throw "routeFn is required" when routeFn is missing', () => {
      expect(
        () =>
          new PyreezMcpServer({
            ...validConfig(),
            routeFn: undefined as unknown as PyreezMcpServerConfig["routeFn"],
          }),
      ).toThrow("routeFn is required");
    });
  });

  // === pyreez_route ===

  describe("pyreez_route", () => {
    it("should return RouteResult JSON when task is valid", async () => {
      const routeFn = stubRouteFn();
      const server = new PyreezMcpServer(validConfig({ routeFn }));

      const result = await server.handleRoute({ task: "implement auth module" });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.classification.domain).toBe("DEVELOPMENT");
      expect(parsed.classification.taskType).toBe("CODE_WRITE");
      expect(parsed.requirement.minContextWindow).toBe(4096);
      expect(parsed.selection.model.id).toBe("openai/gpt-4.1");
      expect(parsed.selection.score).toBe(0.85);
    });

    it("should forward budget to routeFn when budget specified", async () => {
      const routeFn = stubRouteFn();
      const server = new PyreezMcpServer(validConfig({ routeFn }));

      await server.handleRoute({ task: "do something", budget: 0.5 });

      expect(routeFn).toHaveBeenCalledWith("do something", { perRequest: 0.5 }, { domain_hint: undefined, complexity_hint: undefined });
    });

    it("should return error when task is empty", async () => {
      const server = new PyreezMcpServer(validConfig());

      const result = await server.handleRoute({ task: "" });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("task");
    });

    it("should return error when routeFn returns null", async () => {
      const routeFn = stubRouteFn(null);
      const server = new PyreezMcpServer(validConfig({ routeFn }));

      const result = await server.handleRoute({ task: "unclassifiable input" });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "classification",
      );
    });

    it("should return error with Error.message when routeFn throws Error", async () => {
      const routeFn = stubRouteFn(undefined, new Error("route exploded"));
      const server = new PyreezMcpServer(validConfig({ routeFn }));

      const result = await server.handleRoute({ task: "trigger error" });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "route exploded",
      );
    });

    it("should return error with String(value) when routeFn throws non-Error", async () => {
      const routeFn = stubRouteFn(undefined, "raw string failure");
      const server = new PyreezMcpServer(validConfig({ routeFn }));

      const result = await server.handleRoute({ task: "trigger error" });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "raw string failure",
      );
    });

    it("should forward domain_hint to routeFn when provided", async () => {
      const routeFn = stubRouteFn();
      const server = new PyreezMcpServer(validConfig({ routeFn }));

      await server.handleRoute({ task: "build something", domain_hint: "CODING" });

      expect(routeFn).toHaveBeenCalledWith(
        "build something",
        { perRequest: 1.0 },
        { domain_hint: "CODING", complexity_hint: undefined },
      );
    });

    it("should forward complexity_hint to routeFn when provided", async () => {
      const routeFn = stubRouteFn();
      const server = new PyreezMcpServer(validConfig({ routeFn }));

      await server.handleRoute({ task: "hard task", complexity_hint: "complex" });

      expect(routeFn).toHaveBeenCalledWith(
        "hard task",
        { perRequest: 1.0 },
        { domain_hint: undefined, complexity_hint: "complex" },
      );
    });
  });

  // === pyreez_ask ===

  describe("pyreez_ask", () => {
    it("should return response text when model and messages are valid", async () => {
      const llmClient = stubLlmClient();
      const server = new PyreezMcpServer(validConfig({ llmClient }));

      const result = await server.handleAsk({
        model: "openai/gpt-4.1",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.isError).toBeUndefined();
      expect((result.content[0] as { text: string }).text).toBe(
        "test response",
      );
    });

    it("should forward temperature and max_tokens to LLM client", async () => {
      const llmClient = stubLlmClient();
      const server = new PyreezMcpServer(validConfig({ llmClient }));

      await server.handleAsk({
        model: "openai/gpt-4.1",
        messages: [{ role: "user", content: "hello" }],
        temperature: 0.7,
        max_tokens: 500,
      });

      const chatCall = (llmClient.chat as ReturnType<typeof mock>).mock
        .calls[0]![0];
      expect(chatCall.model).toBe("openai/gpt-4.1");
      expect(chatCall.temperature).toBe(0.7);
      expect(chatCall.max_tokens).toBe(500);
    });

    it("should return error when model is empty", async () => {
      const server = new PyreezMcpServer(validConfig());

      const result = await server.handleAsk({
        model: "",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("model");
    });

    it("should return error when messages array is empty", async () => {
      const server = new PyreezMcpServer(validConfig());

      const result = await server.handleAsk({
        model: "openai/gpt-4.1",
        messages: [],
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "messages",
      );
    });

    it("should return error when chat() throws", async () => {
      const llmClient = stubLlmClient({
        chat: mock(() => Promise.reject(new Error("API rate limit"))) as any,
      });
      const server = new PyreezMcpServer(validConfig({ llmClient }));

      const result = await server.handleAsk({
        model: "openai/gpt-4.1",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "API rate limit",
      );
    });

    it("should return error when response has no content", async () => {
      const llmClient = stubLlmClient({
        chat: mock(() =>
          Promise.resolve({
            id: "test",
            object: "chat.completion",
            created: Date.now(),
            model: "test",
            choices: [],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 0,
              total_tokens: 10,
            },
          }),
        ) as any,
      });
      const server = new PyreezMcpServer(validConfig({ llmClient }));

      const result = await server.handleAsk({
        model: "openai/gpt-4.1",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "empty",
      );
    });

    it("should strip think tags from response content", async () => {
      const llmClient = stubLlmClient({
        chat: mock(() =>
          Promise.resolve({
            id: "test",
            object: "chat.completion",
            created: Date.now(),
            model: "test",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content:
                    "<think>internal reasoning</think>actual answer",
                },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          }),
        ) as any,
      });
      const server = new PyreezMcpServer(validConfig({ llmClient }));

      const result = await server.handleAsk({
        model: "deepseek/deepseek-r1",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.isError).toBeUndefined();
      expect((result.content[0] as { text: string }).text).toBe(
        "actual answer",
      );
    });

    it("should return empty text when response contains only think tags", async () => {
      const llmClient = stubLlmClient({
        chat: mock(() =>
          Promise.resolve({
            id: "test",
            object: "chat.completion",
            created: Date.now(),
            model: "test",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "<think>only reasoning here</think>",
                },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          }),
        ) as any,
      });
      const server = new PyreezMcpServer(validConfig({ llmClient }));

      const result = await server.handleAsk({
        model: "deepseek/deepseek-r1",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.isError).toBeUndefined();
      expect((result.content[0] as { text: string }).text).toBe("");
    });
  });

  // === pyreez_ask_many ===

  describe("pyreez_ask_many", () => {
    it("should return result per model when all succeed", async () => {
      const llmClient = stubLlmClient({
        chat: mock((req: { model: string }) =>
          Promise.resolve({
            id: "test",
            object: "chat.completion",
            created: Date.now(),
            model: req.model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: `response from ${req.model}`,
                },
                finish_reason: "stop",
              },
            ],
          }),
        ) as any,
      });
      const server = new PyreezMcpServer(validConfig({ llmClient }));

      const result = await server.handleAskMany({
        models: ["openai/gpt-4.1", "openai/gpt-4.1-mini"],
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].model).toBe("openai/gpt-4.1");
      expect(parsed[0].content).toContain("openai/gpt-4.1");
      expect(parsed[1].model).toBe("openai/gpt-4.1-mini");
    });

    it("should return error when models array is empty", async () => {
      const server = new PyreezMcpServer(validConfig());

      const result = await server.handleAskMany({
        models: [],
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("models");
    });

    it("should return error when messages is empty for ask_many", async () => {
      const server = new PyreezMcpServer(validConfig());

      const result = await server.handleAskMany({
        models: ["openai/gpt-4.1"],
        messages: [],
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "messages",
      );
    });

    it("should include error entries when some models fail", async () => {
      let callIndex = 0;
      const llmClient = stubLlmClient({
        chat: mock(() => {
          callIndex++;
          if (callIndex === 1) {
            return Promise.resolve({
              id: "test",
              object: "chat.completion",
              created: Date.now(),
              model: "openai/gpt-4.1",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "success content" },
                  finish_reason: "stop",
                },
              ],
            });
          }
          return Promise.reject(new Error("model unavailable"));
        }) as any,
      });
      const server = new PyreezMcpServer(validConfig({ llmClient }));

      const result = await server.handleAskMany({
        models: ["openai/gpt-4.1", "openai/gpt-4.1-mini"],
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(2);

      const success = parsed.find(
        (r: { content: string }) => r.content === "success content",
      );
      const failure = parsed.find((r: { error: string }) => r.error);
      expect(success).toBeDefined();
      expect(success.content).toBe("success content");
      expect(failure).toBeDefined();
      expect(failure.error).toContain("model unavailable");
    });

    it("should return all errors when every model fails", async () => {
      const llmClient = stubLlmClient({
        chat: mock(() =>
          Promise.reject(new Error("all models down")),
        ) as any,
      });
      const server = new PyreezMcpServer(validConfig({ llmClient }));

      const result = await server.handleAskMany({
        models: ["openai/gpt-4.1", "openai/gpt-4.1-mini"],
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].error).toContain("all models down");
      expect(parsed[1].error).toContain("all models down");
    });

    it("should strip think tags from each model response", async () => {
      const llmClient = stubLlmClient({
        chat: mock((req: { model: string }) =>
          Promise.resolve({
            id: "test",
            object: "chat.completion",
            created: Date.now(),
            model: req.model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: `<think>reasoning for ${req.model}</think>answer from ${req.model}`,
                },
                finish_reason: "stop",
              },
            ],
          }),
        ) as any,
      });
      const server = new PyreezMcpServer(validConfig({ llmClient }));

      const result = await server.handleAskMany({
        models: ["deepseek/deepseek-r1", "openai/gpt-4.1"],
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed[0].content).toBe("answer from deepseek/deepseek-r1");
      expect(parsed[1].content).toBe("answer from openai/gpt-4.1");
    });

    it("should strip think tags only from models that have them", async () => {
      let callIndex = 0;
      const llmClient = stubLlmClient({
        chat: mock(() => {
          callIndex++;
          const content =
            callIndex === 1
              ? "<think>deep thought</think>stripped answer"
              : "clean answer";
          return Promise.resolve({
            id: "test",
            object: "chat.completion",
            created: Date.now(),
            model: callIndex === 1 ? "deepseek/deepseek-r1" : "openai/gpt-4.1",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content },
                finish_reason: "stop",
              },
            ],
          });
        }) as any,
      });
      const server = new PyreezMcpServer(validConfig({ llmClient }));

      const result = await server.handleAskMany({
        models: ["deepseek/deepseek-r1", "openai/gpt-4.1"],
        messages: [{ role: "user", content: "hello" }],
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed[0].content).toBe("stripped answer");
      expect(parsed[1].content).toBe("clean answer");
    });

    it("should return empty content for model with only think tags", async () => {
      const llmClient = stubLlmClient({
        chat: mock(() =>
          Promise.resolve({
            id: "test",
            object: "chat.completion",
            created: Date.now(),
            model: "deepseek/deepseek-r1",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "<think>only internal reasoning</think>",
                },
                finish_reason: "stop",
              },
            ],
          }),
        ) as any,
      });
      const server = new PyreezMcpServer(validConfig({ llmClient }));

      const result = await server.handleAskMany({
        models: ["deepseek/deepseek-r1"],
        messages: [{ role: "user", content: "hello" }],
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed[0].content).toBe("");
    });
  });

  // === pyreez_scores ===

  describe("pyreez_scores", () => {
    it("should return all model scores when no filter", async () => {
      const registry = stubRegistry();
      const server = new PyreezMcpServer(validConfig({ registry }));

      const result = await server.handleScores({});

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe("openai/gpt-4.1");
      expect(parsed[1].id).toBe("openai/gpt-4.1-mini");
    });

    it("should filter by model when model specified", async () => {
      const registry = stubRegistry();
      const server = new PyreezMcpServer(validConfig({ registry }));

      const result = await server.handleScores({ model: "openai/gpt-4.1" });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe("openai/gpt-4.1");
    });

    it("should filter by dimension when dimension specified", async () => {
      const registry = stubRegistry({
        getAll: mock(() => [
          {
            id: "openai/gpt-4.1",
            name: "GPT-4.1",
            contextWindow: 1048576,
            capabilities: {
              REASONING: { mu: 9, sigma: 70, comparisons: 10 },
              CODE_GENERATION: { mu: 8, sigma: 105, comparisons: 10 },
            },
            cost: { inputPer1M: 2.0, outputPer1M: 8.0 },
            supportsToolCalling: true,
          },
        ] as unknown as ModelInfo[]),
      });
      const server = new PyreezMcpServer(validConfig({ registry }));

      const result = await server.handleScores({ dimension: "REASONING" });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe("openai/gpt-4.1");
      expect(parsed[0].score).toBe(9);
      expect(parsed[0].confidence).toBe(0.8);
    });

    it("should return empty when unknown model specified", async () => {
      const registry = stubRegistry();
      const server = new PyreezMcpServer(validConfig({ registry }));

      const result = await server.handleScores({
        model: "nonexistent/model",
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(0);
    });

    it("should sort by score DESC and return top N when dimension and top specified", async () => {
      const registry = stubRegistry({
        getAll: mock(() => [
          {
            id: "model-a",
            name: "Model A",
            contextWindow: 128000,
            capabilities: { REASONING: 6 },
            confidence: { REASONING: 0.7 },
            cost: { inputPer1M: 1.0, outputPer1M: 2.0 },
            supportsToolCalling: true,
          },
          {
            id: "model-b",
            name: "Model B",
            contextWindow: 128000,
            capabilities: { REASONING: 9 },
            confidence: { REASONING: 0.9 },
            cost: { inputPer1M: 2.0, outputPer1M: 4.0 },
            supportsToolCalling: true,
          },
          {
            id: "model-c",
            name: "Model C",
            contextWindow: 128000,
            capabilities: { REASONING: 7 },
            confidence: { REASONING: 0.8 },
            cost: { inputPer1M: 1.5, outputPer1M: 3.0 },
            supportsToolCalling: true,
          },
        ] as unknown as ModelInfo[]),
      });
      const server = new PyreezMcpServer(validConfig({ registry }));

      const result = await server.handleScores({
        dimension: "REASONING",
        top: 2,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe("model-b");
      expect(parsed[0].score).toBe(9);
      expect(parsed[1].id).toBe("model-c");
      expect(parsed[1].score).toBe(7);
    });

    it("should return only top 1 model by score when top is 1", async () => {
      const registry = stubRegistry({
        getAll: mock(() => [
          {
            id: "model-a",
            name: "Model A",
            contextWindow: 128000,
            capabilities: { CODE_GENERATION: 5 },
            confidence: { CODE_GENERATION: 0.6 },
            cost: { inputPer1M: 1.0, outputPer1M: 2.0 },
            supportsToolCalling: true,
          },
          {
            id: "model-b",
            name: "Model B",
            contextWindow: 128000,
            capabilities: { CODE_GENERATION: 10 },
            confidence: { CODE_GENERATION: 0.95 },
            cost: { inputPer1M: 3.0, outputPer1M: 6.0 },
            supportsToolCalling: true,
          },
        ] as unknown as ModelInfo[]),
      });
      const server = new PyreezMcpServer(validConfig({ registry }));

      const result = await server.handleScores({
        dimension: "CODE_GENERATION",
        top: 1,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe("model-b");
      expect(parsed[0].score).toBe(10);
    });

    it("should ignore top when dimension is not specified", async () => {
      const registry = stubRegistry();
      const server = new PyreezMcpServer(validConfig({ registry }));

      const result = await server.handleScores({ top: 1 });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(2);
    });

    it("should return empty array when top is 0 with dimension", async () => {
      const registry = stubRegistry({
        getAll: mock(() => [
          {
            id: "model-a",
            name: "Model A",
            contextWindow: 128000,
            capabilities: { REASONING: 8 },
            confidence: { REASONING: 0.8 },
            cost: { inputPer1M: 1.0, outputPer1M: 2.0 },
            supportsToolCalling: true,
          },
        ] as unknown as ModelInfo[]),
      });
      const server = new PyreezMcpServer(validConfig({ registry }));

      const result = await server.handleScores({
        dimension: "REASONING",
        top: 0,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(0);
    });

    it("should return all models when top exceeds model count", async () => {
      const registry = stubRegistry({
        getAll: mock(() => [
          {
            id: "model-a",
            name: "Model A",
            contextWindow: 128000,
            capabilities: { REASONING: 8 },
            confidence: { REASONING: 0.8 },
            cost: { inputPer1M: 1.0, outputPer1M: 2.0 },
            supportsToolCalling: true,
          },
          {
            id: "model-b",
            name: "Model B",
            contextWindow: 128000,
            capabilities: { REASONING: 6 },
            confidence: { REASONING: 0.7 },
            cost: { inputPer1M: 0.5, outputPer1M: 1.0 },
            supportsToolCalling: true,
          },
        ] as unknown as ModelInfo[]),
      });
      const server = new PyreezMcpServer(validConfig({ registry }));

      const result = await server.handleScores({
        dimension: "REASONING",
        top: 100,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe("model-a");
      expect(parsed[0].score).toBe(8);
      expect(parsed[1].id).toBe("model-b");
      expect(parsed[1].score).toBe(6);
    });

    it("should return BT format scores with confidence from sigma", async () => {
      // Arrange — model with BT format capabilities {mu, sigma, comparisons}
      const registry = stubRegistry({
        getAll: mock(() => [
          {
            id: "bt-model",
            name: "BT Model",
            contextWindow: 128000,
            capabilities: {
              REASONING: { mu: 750, sigma: 100, comparisons: 20 },
            },
            cost: { inputPer1M: 1.0, outputPer1M: 2.0 },
            supportsToolCalling: true,
          },
        ] as unknown as ModelInfo[]),
      });
      const server = new PyreezMcpServer(validConfig({ registry }));

      // Act
      const result = await server.handleScores({
        dimension: "REASONING",
        top: 1,
      });

      // Assert — should detect BT format and extract mu as score
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe("bt-model");
      expect(parsed[0].score).toBe(750);
      // confidence = round(max(0, 1 - sigma/350) * 100) / 100
      expect(parsed[0].confidence).toBeCloseTo(0.71, 1);
    });
  });

  // === pyreez_report ===

  describe("pyreez_report", () => {
    it("should record call and return { recorded: true }", async () => {
      const reporter = stubReporter();
      const server = new PyreezMcpServer(validConfig({ reporter }));

      const result = await server.handleReport({
        model: "openai/gpt-4.1",
        task_type: "CODE_WRITE",
        quality: 8,
        latency_ms: 1200,
        tokens: { input: 100, output: 200 },
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.recorded).toBe(true);
      expect(reporter.record).toHaveBeenCalledTimes(1);

      const recordCall = (reporter.record as ReturnType<typeof mock>).mock
        .calls[0]![0];
      expect(recordCall.model).toBe("openai/gpt-4.1");
      expect(recordCall.taskType).toBe("CODE_WRITE");
      expect(recordCall.quality).toBe(8);
      expect(recordCall.latencyMs).toBe(1200);
      expect(recordCall.tokens).toEqual({ input: 100, output: 200 });
    });

    it("should return error when required fields missing", async () => {
      const server = new PyreezMcpServer(validConfig());

      const result = await server.handleReport({
        model: "",
        task_type: "CODE_WRITE",
        quality: 8,
        latency_ms: 1200,
        tokens: { input: 100, output: 200 },
      });

      expect(result.isError).toBe(true);
    });

    it("should accept quality=0 as a valid value in report record", async () => {
      // Arrange — quality=0 is a valid score (worst but valid)
      const reporter = stubReporter();
      const server = new PyreezMcpServer(validConfig({ reporter }));

      // Act
      const result = await server.handleReport({
        model: "openai/gpt-4.1",
        task_type: "CODE_WRITE",
        quality: 0,
        latency_ms: 500,
        tokens: { input: 50, output: 100 },
      });

      // Assert — should succeed, not reject quality=0
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.recorded).toBe(true);
      const recordCall = (reporter.record as ReturnType<typeof mock>).mock
        .calls[0]![0];
      expect(recordCall.quality).toBe(0);
    });

    it("should return error when reporter.record() throws", async () => {
      const reporter = stubReporter({
        record: mock(() =>
          Promise.reject(new Error("storage full")),
        ) as any,
      });
      const server = new PyreezMcpServer(validConfig({ reporter }));

      const result = await server.handleReport({
        model: "openai/gpt-4.1",
        task_type: "CODE_WRITE",
        quality: 8,
        latency_ms: 1200,
        tokens: { input: 100, output: 200 },
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "storage full",
      );
    });

    it("should record call with context metrics when context provided", async () => {
      const reporter = stubReporter();
      const server = new PyreezMcpServer(validConfig({ reporter }));

      const result = await server.handleReport({
        model: "openai/gpt-4.1",
        task_type: "CODE_WRITE",
        quality: 8,
        latency_ms: 1200,
        tokens: { input: 100, output: 200 },
        context: { window_size: 128000, utilization: 0.45, estimated_waste: 0.1 },
      });

      expect(result.isError).toBeUndefined();
      const recordCall = (reporter.record as ReturnType<typeof mock>).mock
        .calls[0]![0];
      expect(recordCall.context).toEqual({
        windowSize: 128000,
        utilization: 0.45,
        estimatedWaste: 0.1,
      });
    });

    it("should record call with team metadata when team_id and leader_id provided", async () => {
      const reporter = stubReporter();
      const server = new PyreezMcpServer(validConfig({ reporter }));

      const result = await server.handleReport({
        model: "openai/gpt-4.1",
        task_type: "CODE_WRITE",
        quality: 8,
        latency_ms: 1200,
        tokens: { input: 100, output: 200 },
        team_id: "team-alpha",
        leader_id: "openai/gpt-4.1",
      });

      expect(result.isError).toBeUndefined();
      const recordCall = (reporter.record as ReturnType<typeof mock>).mock
        .calls[0]![0];
      expect(recordCall.teamId).toBe("team-alpha");
      expect(recordCall.leaderId).toBe("openai/gpt-4.1");
    });

    it("should return summary when action is summary", async () => {
      const summaryData = {
        totalRecords: 5,
        models: {
          "openai/gpt-4.1": {
            count: 3,
            avgQuality: 8.5,
            avgLatencyMs: 1000,
            avgTokens: { input: 100, output: 200 },
            avgContextUtilization: 0.4,
          },
        },
      };
      const summaryFn = mock(() => Promise.resolve(summaryData));
      const server = new PyreezMcpServer(validConfig({ summaryFn }));

      const result = await server.handleReport({ action: "summary" });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.totalRecords).toBe(5);
      expect(parsed.models["openai/gpt-4.1"].count).toBe(3);
      expect(summaryFn).toHaveBeenCalledTimes(1);
    });

    it("should return error when action is summary but summaryFn not configured", async () => {
      const server = new PyreezMcpServer(validConfig());

      const result = await server.handleReport({ action: "summary" });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "summary not available",
      );
    });

    it("should return error when summaryFn throws", async () => {
      const summaryFn = mock(() =>
        Promise.reject(new Error("read failed")),
      );
      const server = new PyreezMcpServer(validConfig({ summaryFn }));

      const result = await server.handleReport({ action: "summary" });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "read failed",
      );
    });

    it("should record with partial optional fields mapping correctly", async () => {
      const reporter = stubReporter();
      const server = new PyreezMcpServer(validConfig({ reporter }));

      const result = await server.handleReport({
        model: "openai/gpt-4.1",
        task_type: "CODE_WRITE",
        quality: 7,
        latency_ms: 800,
        tokens: { input: 50, output: 100 },
        context: { window_size: 128000, utilization: 0.3 },
      });

      expect(result.isError).toBeUndefined();
      const recordCall = (reporter.record as ReturnType<typeof mock>).mock
        .calls[0]![0];
      expect(recordCall.context).toEqual({
        windowSize: 128000,
        utilization: 0.3,
      });
      expect(recordCall.teamId).toBeUndefined();
      expect(recordCall.leaderId).toBeUndefined();
    });

    // -- query_deliberation --

    it("should query deliberation store and return results", async () => {
      const mockRecords = [
        {
          id: "d1",
          task: "Write tests",
          timestamp: 1700000000000,
          perspectives: ["보안"],
          consensusReached: true,
          roundsExecuted: 2,
          result: "code here",
          modelsUsed: ["openai/gpt-4.1"],
          totalLLMCalls: 5,
        },
      ];
      const store = {
        save: mock(() => Promise.resolve()),
        query: mock(() => Promise.resolve(mockRecords)),
        getById: mock(() => Promise.resolve(undefined)),
      };
      const server = new PyreezMcpServer(
        validConfig({ deliberationStore: store }),
      );

      const result = await server.handleReport({
        action: "query_deliberation",
        query_task: "tests",
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe("d1");
      expect(store.query).toHaveBeenCalledTimes(1);
    });

    it("should return error when store is not configured for query_deliberation", async () => {
      const server = new PyreezMcpServer(validConfig());

      const result = await server.handleReport({
        action: "query_deliberation",
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("deliberation store");
    });

    it("should return all records when query_deliberation has no filters", async () => {
      const mockRecords = [
        {
          id: "d1",
          task: "A",
          timestamp: 1,
          perspectives: [],
          consensusReached: true,
          roundsExecuted: 1,
          result: "r",
          modelsUsed: [],
          totalLLMCalls: 1,
        },
        {
          id: "d2",
          task: "B",
          timestamp: 2,
          perspectives: [],
          consensusReached: false,
          roundsExecuted: 1,
          result: "r",
          modelsUsed: [],
          totalLLMCalls: 1,
        },
      ];
      const store = {
        save: mock(() => Promise.resolve()),
        query: mock(() => Promise.resolve(mockRecords)),
        getById: mock(() => Promise.resolve(undefined)),
      };
      const server = new PyreezMcpServer(
        validConfig({ deliberationStore: store }),
      );

      const result = await server.handleReport({
        action: "query_deliberation",
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(2);
      // Verify query was called with empty filters (no task/perspective/model)
      const queryArg = (store.query as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(queryArg.task).toBeUndefined();
    });
  });

  // === pyreez_deliberate ===

  describe("pyreez_deliberate", () => {
    const DELIBERATE_OUTPUT = {
      result: "function add(a, b) { return a + b; }",
      roundsExecuted: 2,
      consensusReached: true,
      finalApprovals: [
        { model: "reviewer/a", approved: true, remainingIssues: [] },
      ],
      deliberationLog: { task: "task", team: {}, rounds: [] },
      totalTokens: 0,
      totalLLMCalls: 8,
      modelsUsed: ["producer/m", "reviewer/a", "leader/m"],
    };

    function stubDeliberateFn(
      result?: unknown,
      error?: unknown,
    ): (input: DeliberateInput) => Promise<DeliberateOutput> {
      if (error !== undefined) {
        return mock(() => Promise.reject(error)) as any;
      }
      return mock(() => Promise.resolve(result ?? DELIBERATE_OUTPUT)) as any;
    }

    it("should return DeliberateOutput JSON when task and perspectives valid", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      const result = await server.handleDeliberate({
        task: "Write a sort function",
        perspectives: ["코드 품질", "보안"],
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.result).toBe("function add(a, b) { return a + b; }");
      expect(parsed.roundsExecuted).toBe(2);
      expect(parsed.consensusReached).toBe(true);
      expect(parsed.totalLLMCalls).toBe(8);
    });

    it("should forward producer_instructions as producerInstructions to deliberateFn", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      await server.handleDeliberate({
        task: "task",
        perspectives: ["p"],
        producer_instructions: "Use TypeScript",
      });

      const callArg = (deliberateFn as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(callArg.producerInstructions).toBe("Use TypeScript");
    });

    it("should forward leader_instructions as leaderInstructions to deliberateFn", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      await server.handleDeliberate({
        task: "task",
        perspectives: ["p"],
        leader_instructions: "Be strict",
      });

      const callArg = (deliberateFn as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(callArg.leaderInstructions).toBe("Be strict");
    });

    it("should forward max_rounds and consensus to deliberateFn", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      await server.handleDeliberate({
        task: "task",
        perspectives: ["p"],
        max_rounds: 5,
        consensus: "all_approve",
      });

      const callArg = (deliberateFn as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(callArg.maxRounds).toBe(5);
      expect(callArg.consensus).toBe("all_approve");
    });

    it("should return isError undefined on success", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      const result = await server.handleDeliberate({
        task: "task",
        perspectives: ["p"],
      });

      expect(result.isError).toBeUndefined();
    });

    it("should return error when task is empty", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      const result = await server.handleDeliberate({
        task: "",
        perspectives: ["p"],
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("task");
    });

    it("should return error when perspectives is empty array", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      const result = await server.handleDeliberate({
        task: "task",
        perspectives: [],
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("perspectives");
    });

    it("should return error when deliberateFn is not configured", async () => {
      const server = new PyreezMcpServer(validConfig());

      const result = await server.handleDeliberate({
        task: "task",
        perspectives: ["p"],
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("deliberation not available");
    });

    it("should return error with Error.message when deliberateFn throws Error", async () => {
      const deliberateFn = stubDeliberateFn(undefined, new Error("LLM quota exceeded"));
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      const result = await server.handleDeliberate({
        task: "task",
        perspectives: ["p"],
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("LLM quota exceeded");
    });

    it("should return error with String(value) when deliberateFn throws non-Error", async () => {
      const deliberateFn = stubDeliberateFn(undefined, "raw failure string");
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      const result = await server.handleDeliberate({
        task: "task",
        perspectives: ["p"],
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("raw failure string");
    });

    it("should work with single perspective", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      const result = await server.handleDeliberate({
        task: "task",
        perspectives: ["코드 품질"],
      });

      expect(result.isError).toBeUndefined();
      const callArg = (deliberateFn as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(callArg.perspectives).toEqual(["코드 품질"]);
    });

    it("should check task before perspectives before deliberateFn availability", async () => {
      // No deliberateFn configured, but task is empty → task error first
      const server = new PyreezMcpServer(validConfig());

      const result1 = await server.handleDeliberate({
        task: "",
        perspectives: [],
      });
      expect(result1.isError).toBe(true);
      expect((result1.content[0] as { text: string }).text).toContain("task");

      // Task valid, perspectives empty, no deliberateFn → perspectives error
      const result2 = await server.handleDeliberate({
        task: "task",
        perspectives: [],
      });
      expect(result2.isError).toBe(true);
      expect((result2.content[0] as { text: string }).text).toContain("perspectives");

      // Task valid, perspectives valid, no deliberateFn → deliberation not available
      const result3 = await server.handleDeliberate({
        task: "task",
        perspectives: ["p"],
      });
      expect(result3.isError).toBe(true);
      expect((result3.content[0] as { text: string }).text).toContain("deliberation not available");
    });
  });

  // === Lifecycle ===

  describe("lifecycle", () => {
    it("should delegate start to mcpServer.connect with transport", async () => {
      const mcp = stubMcpServer();
      const transport = stubTransport();
      const server = new PyreezMcpServer(validConfig({ mcpServer: mcp }));

      await server.start(transport);

      expect(mcp.connect).toHaveBeenCalledWith(transport);
    });

    it("should delegate close to mcpServer.close", async () => {
      const mcp = stubMcpServer();
      const server = new PyreezMcpServer(validConfig({ mcpServer: mcp }));

      await server.close();

      expect(mcp.close).toHaveBeenCalledTimes(1);
    });

    it("should propagate error when connect rejects", async () => {
      const mcp = stubMcpServer({
        connect: mock(() =>
          Promise.reject(new Error("connect failed")),
        ),
      } as unknown as Partial<McpServer>);
      const server = new PyreezMcpServer(validConfig({ mcpServer: mcp }));

      await expect(server.start(stubTransport())).rejects.toThrow(
        "connect failed",
      );
    });

    it("should propagate error when close rejects", async () => {
      const mcp = stubMcpServer({
        close: mock(() =>
          Promise.reject(new Error("close failed")),
        ),
      } as unknown as Partial<McpServer>);
      const server = new PyreezMcpServer(validConfig({ mcpServer: mcp }));

      await expect(server.close()).rejects.toThrow("close failed");
    });
  });

  // === Run Logging ===

  describe("run logging", () => {
    it("should log successful tool call via runLogger", async () => {
      const runLogger = {
        log: mock(() => Promise.resolve()),
        query: mock(() => Promise.resolve([])),
      };
      const server = new PyreezMcpServer(validConfig({ runLogger }));

      await server.handleRoute({ task: "test task" });

      expect(runLogger.log).toHaveBeenCalledTimes(1);
      const logged = (runLogger.log as ReturnType<typeof mock>).mock
        .calls[0]![0];
      expect(logged.tool).toBe("route");
      expect(logged.success).toBe(true);
      expect(logged.durationMs).toBeGreaterThanOrEqual(0);
      expect(logged.id).toBeString();
      expect(logged.id.length).toBeGreaterThan(0);
    });

    it("should log failed tool call with error message", async () => {
      const runLogger = {
        log: mock(() => Promise.resolve()),
        query: mock(() => Promise.resolve([])),
      };
      const llmClient = stubLlmClient({
        chat: mock(() => Promise.reject(new Error("API error"))) as any,
      });
      const server = new PyreezMcpServer(
        validConfig({ runLogger, llmClient }),
      );

      await server.handleAsk({
        model: "openai/gpt-4.1",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(runLogger.log).toHaveBeenCalledTimes(1);
      const logged = (runLogger.log as ReturnType<typeof mock>).mock
        .calls[0]![0];
      expect(logged.tool).toBe("ask");
      expect(logged.success).toBe(false);
      expect(logged.error).toContain("API error");
    });

    it("should not fail when runLogger is not configured", async () => {
      const server = new PyreezMcpServer(validConfig());

      const result = await server.handleRoute({ task: "test task" });

      expect(result.isError).toBeUndefined();
    });

    it("should still return result when runLogger.log throws", async () => {
      const runLogger = {
        log: mock(() => Promise.reject(new Error("log write failed"))),
        query: mock(() => Promise.resolve([])),
      };
      const server = new PyreezMcpServer(validConfig({ runLogger }));

      const result = await server.handleRoute({ task: "test task" });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      );
      expect(parsed.selection.model.id).toBe("openai/gpt-4.1");
    });

    it("should propagate original error when both handler and runLogger throw", async () => {
      // Arrange — handler throws, runLogger.log also throws
      const runLogger = {
        log: mock(() => Promise.reject(new Error("log write failed"))),
        query: mock(() => Promise.resolve([])),
      };
      const llmClient = stubLlmClient({
        chat: mock(() => Promise.reject(new Error("LLM API down"))) as any,
      });
      const server = new PyreezMcpServer(
        validConfig({ runLogger, llmClient }),
      );

      // Act — handleAsk will throw from chat, logRun catches logger failure
      const result = await server.handleAsk({
        model: "openai/gpt-4.1",
        messages: [{ role: "user", content: "hello" }],
      });

      // Assert — error should be from the handler, not from runLogger
      expect(result.isError).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain("LLM API down");
      expect(text).not.toContain("log write failed");
    });
  });

  // === pyreez_calibrate ===

  describe("pyreez_calibrate", () => {
    const CALIBRATION_RESULT: CalibrationResult = {
      comparisonsProcessed: 5,
      anomalies: [],
      converged: [{ modelId: "openai/gpt-4.1", dimension: "REASONING", sigma: 80 }],
      stale: [],
    };

    function stubCalibrateFn(
      result?: CalibrationResult,
      error?: unknown,
    ): () => Promise<CalibrationResult> {
      if (error !== undefined) {
        return mock(() => Promise.reject(error)) as any;
      }
      return mock(() => Promise.resolve(result ?? CALIBRATION_RESULT)) as any;
    }

    it("should return CalibrationResult JSON when calibrateFn succeeds", async () => {
      // Arrange
      const calibrateFn = stubCalibrateFn();
      const server = new PyreezMcpServer(validConfig({ calibrateFn }));

      // Act
      const result = await server.handleCalibrate();

      // Assert
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.comparisonsProcessed).toBe(5);
      expect(parsed.converged).toHaveLength(1);
      expect(parsed.converged[0].modelId).toBe("openai/gpt-4.1");
    });

    it("should include all CalibrationResult fields in response", async () => {
      // Arrange
      const full: CalibrationResult = {
        comparisonsProcessed: 3,
        anomalies: [{ modelId: "m1", dimension: "REASONING", muDelta: 150 }],
        converged: [],
        stale: [{ modelId: "m2", dimension: "CODE_GENERATION", sigma: 400 }],
      };
      const server = new PyreezMcpServer(validConfig({ calibrateFn: stubCalibrateFn(full) }));

      // Act
      const result = await server.handleCalibrate();

      // Assert
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.anomalies).toHaveLength(1);
      expect(parsed.stale).toHaveLength(1);
    });

    it("should return error when calibrateFn is not configured", async () => {
      // Arrange — no calibrateFn in config
      const server = new PyreezMcpServer(validConfig());

      // Act
      const result = await server.handleCalibrate();

      // Assert
      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("calibration not available");
    });

    it("should return error with Error.message when calibrateFn throws Error", async () => {
      // Arrange
      const server = new PyreezMcpServer(
        validConfig({ calibrateFn: stubCalibrateFn(undefined, new Error("persist failed")) }),
      );

      // Act
      const result = await server.handleCalibrate();

      // Assert
      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("persist failed");
    });

    it("should return valid JSON when comparisonsProcessed is 0", async () => {
      // Arrange
      const empty: CalibrationResult = { comparisonsProcessed: 0, anomalies: [], converged: [], stale: [] };
      const server = new PyreezMcpServer(validConfig({ calibrateFn: stubCalibrateFn(empty) }));

      // Act
      const result = await server.handleCalibrate();

      // Assert
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.comparisonsProcessed).toBe(0);
    });
  });

});