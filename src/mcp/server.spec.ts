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
} as RouteResult;

function stubRouteFn(
  result?: RouteResult | null,
  error?: unknown,
): (prompt: string, budget?: BudgetConfig) => RouteResult | null {
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
    it("should create instance and register 5 tools when config is valid", () => {
      const mcp = stubMcpServer();
      const server = new PyreezMcpServer(validConfig({ mcpServer: mcp }));

      expect(server).toBeInstanceOf(PyreezMcpServer);
      expect(mcp.registerTool).toHaveBeenCalledTimes(5);

      const calls = (mcp.registerTool as ReturnType<typeof mock>).mock.calls;
      const toolNames = calls.map((c: unknown[]) => c[0]);
      expect(toolNames).toContain("pyreez_route");
      expect(toolNames).toContain("pyreez_ask");
      expect(toolNames).toContain("pyreez_ask_many");
      expect(toolNames).toContain("pyreez_scores");
      expect(toolNames).toContain("pyreez_report");
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
      expect(result.content[0].type).toBe("text");

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.classification).toBeDefined();
      expect(parsed.requirement).toBeDefined();
      expect(parsed.selection).toBeDefined();
    });

    it("should forward budget to routeFn when budget specified", async () => {
      const routeFn = stubRouteFn();
      const server = new PyreezMcpServer(validConfig({ routeFn }));

      await server.handleRoute({ task: "do something", budget: 0.5 });

      expect(routeFn).toHaveBeenCalledWith("do something", { perRequest: 0.5 });
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
        .calls[0][0];
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
            capabilities: { REASONING: 9, CODE_GENERATION: 8 },
            confidence: { REASONING: 0.8, CODE_GENERATION: 0.7 },
            cost: { inputPer1M: 2.0, outputPer1M: 8.0 },
            supportsToolCalling: true,
          },
        ]),
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
        .calls[0][0];
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
});
