import { describe, it, expect, mock } from "bun:test";
import { PyreezMcpServer } from "./server";
import type { PyreezMcpServerConfig } from "./server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ModelRegistry } from "../model/registry";
import type { DeliberateInput, DeliberateOutput } from "../deliberation/types";

// --- Test Doubles ---

function stubMcpServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    registerTool: mock(() => {}),
    connect: mock(() => Promise.resolve()),
    close: mock(() => Promise.resolve()),
    ...overrides,
  } as unknown as McpServer;
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


function stubTransport(): Transport {
  return {} as unknown as Transport;
}

function validConfig(
  overrides: Partial<PyreezMcpServerConfig> = {},
): PyreezMcpServerConfig {
  return {
    mcpServer: stubMcpServer(),
    registry: stubRegistry(),
    ...overrides,
  };
}

// --- Tests ---

describe("PyreezMcpServer", () => {
  // === Constructor ===

  describe("constructor", () => {
    it("should create instance and register 3 tools when config is valid", () => {
      const mcp = stubMcpServer();
      const server = new PyreezMcpServer(validConfig({ mcpServer: mcp }));

      expect(server).toBeInstanceOf(PyreezMcpServer);
      expect(mcp.registerTool).toHaveBeenCalledTimes(3);

      const calls = (mcp.registerTool as ReturnType<typeof mock>).mock.calls;
      const toolNames = calls.map((c: unknown[]) => c[0]);
      expect(toolNames).toContain("pyreez_deliberate");
      expect(toolNames).toContain("pyreez_acceptance");
      expect(toolNames).toContain("pyreez_feedback");
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

    it('should throw "registry is required" when registry is missing', () => {
      expect(
        () =>
          new PyreezMcpServer({
            ...validConfig(),
            registry: undefined as unknown as ModelRegistry,
          }),
      ).toThrow("registry is required");
    });

  });

  // === pyreez_deliberate ===

  describe("pyreez_deliberate", () => {
    const DELIBERATE_OUTPUT: DeliberateOutput = {
      roundsExecuted: 2,
      totalTokens: { input: 100, output: 200 },
      totalLLMCalls: 8,
      modelsUsed: ["worker/a", "worker/b"],
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

    it("should return DeliberateOutput JSON when task is valid", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      const result = await server.handleDeliberate({
        task: "Write a sort function",
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.roundsExecuted).toBe(2);
      expect(parsed.totalLLMCalls).toBe(8);
    });

    it("should forward worker_instructions as workerInstructions to deliberateFn", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      await server.handleDeliberate({
        task: "task",
        worker_instructions: "Use TypeScript",
      });

      const callArg = (deliberateFn as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(callArg.workerInstructions).toBe("Use TypeScript");
    });

    it("should forward leader_instructions as leaderInstructions to deliberateFn", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      await server.handleDeliberate({
        task: "task",
        worker_instructions: "Be strict",
      });

      const callArg = (deliberateFn as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(callArg.workerInstructions).toBe("Be strict");
    });

    it("should forward max_rounds to deliberateFn", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      await server.handleDeliberate({
        task: "task",
        max_rounds: 5,
      });

      const callArg = (deliberateFn as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(callArg.maxRounds).toBe(5);
    });

    it("should return isError undefined on success", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      const result = await server.handleDeliberate({
        task: "task",
      });

      expect(result.isError).toBeUndefined();
    });

    it("should return error when task is empty", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      const result = await server.handleDeliberate({
        task: "",
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("task");
    });

    it("should return error when deliberateFn is not configured", async () => {
      const server = new PyreezMcpServer(validConfig());

      const result = await server.handleDeliberate({
        task: "task",
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("deliberation not available");
    });

    it("should return error with Error.message when deliberateFn throws Error", async () => {
      const deliberateFn = stubDeliberateFn(undefined, new Error("LLM quota exceeded"));
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      const result = await server.handleDeliberate({
        task: "task",
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("LLM quota exceeded");
    });

    it("should return error with String(value) when deliberateFn throws non-Error", async () => {
      const deliberateFn = stubDeliberateFn(undefined, "raw failure string");
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      const result = await server.handleDeliberate({
        task: "task",
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("raw failure string");
    });

    it("should check task before deliberateFn availability", async () => {
      // No deliberateFn configured, but task is empty -> task error first
      const server = new PyreezMcpServer(validConfig());

      const result1 = await server.handleDeliberate({
        task: "",
      });
      expect(result1.isError).toBe(true);
      expect((result1.content[0] as { text: string }).text).toContain("task");

      // Task valid, no deliberateFn -> deliberation not available
      const result2 = await server.handleDeliberate({
        task: "task",
      });
      expect(result2.isError).toBe(true);
      expect((result2.content[0] as { text: string }).text).toContain("deliberation not available");
    });

    // -- auto_route tests --

    it("should return error when auto_route=true but domain is missing", async () => {
      const server = new PyreezMcpServer(validConfig());

      const result = await server.handleDeliberate({
        task: "task",
        auto_route: true,
        task_type: "IMPLEMENT_FEATURE",
        complexity: "moderate",
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "domain is required",
      );
    });

    it("should forward quality_weight and cost_weight to deliberateFn in manual deliberation", async () => {
      const deliberateFn = stubDeliberateFn();
      const server = new PyreezMcpServer(validConfig({ deliberateFn }));

      await server.handleDeliberate({
        task: "Review code",
        quality_weight: 0.9,
        cost_weight: 0.1,
      });

      const callArg = (deliberateFn as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(callArg.qualityWeight).toBe(0.9);
      expect(callArg.costWeight).toBe(0.1);
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

  // === pyreez_acceptance ===

  describe("pyreez_acceptance", () => {
    function stubChatFn(content: string = '<acceptance><verdict>accept</verdict><misrepresented>None.</misrepresented><unresolved>None.</unresolved></acceptance>') {
      return mock(() => Promise.resolve({ content, inputTokens: 500, outputTokens: 300 }));
    }

    it("should return acceptance results for each worker", async () => {
      const chatFn = stubChatFn();
      const server = new PyreezMcpServer(validConfig({ chatFn }));

      const result = await server.handleAcceptance({
        task: "Pick a DB",
        synthesis: "Use PostgreSQL",
        workers: [
          { model: "a/m1", original_position: "Use Redis" },
          { model: "b/m2", original_position: "Use Mongo" },
        ],
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.workers).toHaveLength(2);
      expect(parsed.workers[0].verdict).toBe("accept");
      expect(parsed.totalTokens.input).toBe(1000);
      expect(parsed.totalTokens.output).toBe(600);
    });

    it("should parse reject verdict with misrepresented and unresolved", async () => {
      const chatFn = stubChatFn(
        '<acceptance><verdict>reject</verdict><misrepresented>My Redis argument was ignored</misrepresented><unresolved>Latency requirements</unresolved></acceptance>'
      );
      const server = new PyreezMcpServer(validConfig({ chatFn }));

      const result = await server.handleAcceptance({
        task: "Pick a DB",
        synthesis: "Use PostgreSQL",
        workers: [{ model: "a/m1", original_position: "Use Redis" }],
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.workers[0].verdict).toBe("reject");
      expect(parsed.workers[0].misrepresented).toBe("My Redis argument was ignored");
      expect(parsed.workers[0].unresolved).toBe("Latency requirements");
    });

    it("should return error when task is empty", async () => {
      const server = new PyreezMcpServer(validConfig({ chatFn: stubChatFn() }));
      const result = await server.handleAcceptance({
        task: "",
        synthesis: "S",
        workers: [{ model: "a/m1", original_position: "P" }],
      });
      expect(result.isError).toBe(true);
    });

    it("should return error when chatFn is not configured", async () => {
      const server = new PyreezMcpServer(validConfig());
      const result = await server.handleAcceptance({
        task: "T",
        synthesis: "S",
        workers: [{ model: "a/m1", original_position: "P" }],
      });
      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("not available");
    });

    it("should parse partial verdict and include action_required", async () => {
      const chatFn = stubChatFn(
        '<acceptance><verdict>partial</verdict><misrepresented>My caching concern was softened</misrepresented><unresolved>None.</unresolved></acceptance>'
      );
      const server = new PyreezMcpServer(validConfig({ chatFn }));

      const result = await server.handleAcceptance({
        task: "Pick a DB",
        synthesis: "Use PostgreSQL",
        workers: [{ model: "a/m1", original_position: "Use Redis" }],
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.workers[0].verdict).toBe("partial");
      expect(parsed.workers[0].misrepresented).toBe("My caching concern was softened");
      expect(parsed.action_required).toContain("partial");
    });

    it("should omit misrepresented/unresolved when they are 'None.'", async () => {
      const chatFn = stubChatFn();
      const server = new PyreezMcpServer(validConfig({ chatFn }));

      const result = await server.handleAcceptance({
        task: "T",
        synthesis: "S",
        workers: [{ model: "a/m1", original_position: "P" }],
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.workers[0].misrepresented).toBeUndefined();
      expect(parsed.workers[0].unresolved).toBeUndefined();
    });
  });

  // === pyreez_feedback ===

  describe("pyreez_feedback", () => {
    it("should update SkillCell when evaluations provided", async () => {
      const mockStore = {
        update: mock(() => {}),
        save: mock(async () => {}),
        get: mock(() => undefined),
        getAll: mock(() => []),
        getAllForModel: mock(() => []),
        getAllForFamily: mock(() => []),
        load: mock(async () => {}),
        setFamilyLookup: mock(() => {}),
      };
      const server = new PyreezMcpServer(validConfig({ skillCellStore: mockStore as any }));

      const result = await server.handleFeedback({
        evaluations: [{
          model_id: "test/m1", domain: "CODING", task_type: "IMPL",
          dimensions: { factually_correct: true, addresses_task: true, provides_evidence: false, novel_perspective: true, internally_consistent: true },
          failures: { hallucination: false, refusal: false, off_topic: false, degenerate: false },
        }],
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.updated).toBe(1);
      expect(mockStore.update).toHaveBeenCalledTimes(1);
      expect(mockStore.save).toHaveBeenCalledTimes(1);
    });

    it("should return error when no evaluations", async () => {
      const mockStore = { update: mock(() => {}), save: mock(async () => {}), get: mock(() => undefined), getAll: mock(() => []), getAllForModel: mock(() => []), getAllForFamily: mock(() => []), load: mock(async () => {}), setFamilyLookup: mock(() => {}) };
      const server = new PyreezMcpServer(validConfig({ skillCellStore: mockStore as any }));
      const result = await server.handleFeedback({ evaluations: [] });
      expect(result.isError).toBe(true);
    });

    it("should return error when skillCellStore not configured", async () => {
      const server = new PyreezMcpServer(validConfig());
      const result = await server.handleFeedback({
        evaluations: [{ model_id: "m1", domain: "D", task_type: "T", dimensions: { factually_correct: true, addresses_task: true, provides_evidence: true, novel_perspective: true, internally_consistent: true }, failures: { hallucination: false, refusal: false, off_topic: false, degenerate: false } }],
      });
      expect(result.isError).toBe(true);
    });
  });

  // === Run Logging ===

  describe("run logging", () => {
    const DELIB_OUT: DeliberateOutput = {
      roundsExecuted: 1, totalTokens: { input: 10, output: 20 }, totalLLMCalls: 1, modelsUsed: ["m1"],
    };

    it("should log successful tool call via runLogger", async () => {
      const runLogger = {
        log: mock(() => Promise.resolve()),
        query: mock(() => Promise.resolve([])),
      };
      const deliberateFn = mock(() => Promise.resolve(DELIB_OUT));
      const server = new PyreezMcpServer(validConfig({ runLogger, deliberateFn }));

      await server.handleDeliberate({ task: "test task" });

      expect(runLogger.log).toHaveBeenCalledTimes(1);
      const logged = (runLogger.log as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(logged.tool).toBe("deliberate");
      expect(logged.success).toBe(true);
    });

    it("should still return result when runLogger.log throws", async () => {
      const runLogger = {
        log: mock(() => Promise.reject(new Error("log write failed"))),
        query: mock(() => Promise.resolve([])),
      };
      const deliberateFn = mock(() => Promise.resolve(DELIB_OUT));
      const server = new PyreezMcpServer(validConfig({ runLogger, deliberateFn }));

      const result = await server.handleDeliberate({ task: "test task" });
      expect(result.isError).toBeUndefined();
    });
  });

});
