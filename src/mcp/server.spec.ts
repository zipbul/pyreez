import { describe, it, expect, mock } from "bun:test";
import { PyreezMcpServer } from "./server";
import type { PyreezMcpServerConfig } from "./server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ModelRegistry } from "../model/registry";
import type { ModelInfo } from "../model/types";
import type { DeliberateInput, DeliberateOutput } from "../deliberation/types";
import type { PyreezEngine } from "../axis/engine";
import type { SlotTrace, DeliberationResult } from "../axis/types";

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

const DEFAULT_TRACE_RESULT: SlotTrace = {
  scores: [
    {
      modelId: "openai/gpt-4.1",
      dimensions: { REASONING: { mu: 750, sigma: 100 } },
      overall: 750,
    },
  ],
  classified: {
    domain: "CODING",
    taskType: "IMPLEMENT_FEATURE",
    complexity: "moderate",
  },
  requirement: {
    capabilities: { REASONING: 0.4, CODE_GENERATION: 0.6 },
    constraints: {},
    budget: { maxPerRequest: 1.0 },
  },
  plan: {
    models: [
      { modelId: "openai/gpt-4.1", role: "producer", weight: 1.0 },
    ],
    strategy: "single",
    estimatedCost: 0.02,
    reason: "Best match for IMPLEMENT_FEATURE",
  },
};

const DEFAULT_RUN_RESULT: DeliberationResult = {
  result: "function add(a, b) { return a + b; }",
  roundsExecuted: 1,
  consensusReached: null,
  totalLLMCalls: 1,
  modelsUsed: ["openai/gpt-4.1"],
  protocol: "single",
};

function stubEngine(overrides: Partial<PyreezEngine> = {}): PyreezEngine {
  return {
    traceOnly: mock(() => Promise.resolve(DEFAULT_TRACE_RESULT)),
    run: mock(() => Promise.resolve(DEFAULT_RUN_RESULT)),
    runWithTrace: mock(() => Promise.resolve({ ...DEFAULT_TRACE_RESULT, result: DEFAULT_RUN_RESULT })),
    ...overrides,
  } as unknown as PyreezEngine;
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
    engine: stubEngine(),
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
      expect(toolNames).toContain("pyreez_route");
      expect(toolNames).toContain("pyreez_scores");
      expect(toolNames).toContain("pyreez_deliberate");
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

    it('should throw "engine is required" when engine is missing', () => {
      expect(
        () =>
          new PyreezMcpServer({
            ...validConfig(),
            engine: undefined as unknown as PyreezEngine,
          }),
      ).toThrow("engine is required");
    });
  });

  // === pyreez_route ===

  describe("pyreez_route", () => {
    it("should return trace result JSON when task and classification are valid", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      const result = await server.handleRoute({
        task: "implement auth module",
        domain: "CODING",
        task_type: "IMPLEMENT_FEATURE",
        complexity: "moderate",
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.classification.domain).toBe("CODING");
      expect(parsed.classification.taskType).toBe("IMPLEMENT_FEATURE");
      expect(parsed.classification.complexity).toBe("moderate");
      expect(parsed.requirement.capabilities.REASONING).toBe(0.4);
      expect(parsed.selection.models).toHaveLength(1);
      expect(parsed.selection.models[0].modelId).toBe("openai/gpt-4.1");
      expect(parsed.selection.strategy).toBe("single");
      expect(parsed.selection.reason).toBe("Best match for IMPLEMENT_FEATURE");
    });

    it("should forward budget to engine.traceOnly when budget specified", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      await server.handleRoute({
        task: "do something",
        budget: 0.5,
        domain: "CODING",
        task_type: "IMPLEMENT_FEATURE",
        complexity: "moderate",
      });

      const call = (engine.traceOnly as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[0]).toBe("do something");
      expect(call[1]).toEqual({ perRequest: 0.5 });
      expect(call[2].domain).toBe("CODING");
      expect(call[2].taskType).toBe("IMPLEMENT_FEATURE");
      expect(call[2].complexity).toBe("moderate");
    });

    it("should use default budget when budget not specified", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      await server.handleRoute({
        task: "do something",
        domain: "CODING",
        task_type: "IMPLEMENT_FEATURE",
        complexity: "moderate",
      });

      const call = (engine.traceOnly as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[0]).toBe("do something");
      expect(call[1]).toEqual({ perRequest: 1.0 });
      expect(call[2].domain).toBe("CODING");
      expect(call[2].taskType).toBe("IMPLEMENT_FEATURE");
      expect(call[2].complexity).toBe("moderate");
    });

    it("should return error when task is empty", async () => {
      const server = new PyreezMcpServer(validConfig());

      const result = await server.handleRoute({
        task: "",
        domain: "CODING",
        task_type: "IMPLEMENT_FEATURE",
        complexity: "moderate",
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("task");
    });

    it("should return error with Error.message when engine.traceOnly throws Error", async () => {
      const engine = stubEngine({
        traceOnly: mock(() => Promise.reject(new Error("trace exploded"))),
      } as unknown as Partial<PyreezEngine>);
      const server = new PyreezMcpServer(validConfig({ engine }));

      const result = await server.handleRoute({
        task: "trigger error",
        domain: "CODING",
        task_type: "IMPLEMENT_FEATURE",
        complexity: "moderate",
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "trace exploded",
      );
    });

    it("should return error with String(value) when engine.traceOnly throws non-Error", async () => {
      const engine = stubEngine({
        traceOnly: mock(() => Promise.reject("raw string failure")),
      } as unknown as Partial<PyreezEngine>);
      const server = new PyreezMcpServer(validConfig({ engine }));

      const result = await server.handleRoute({
        task: "trigger error",
        domain: "CODING",
        task_type: "IMPLEMENT_FEATURE",
        complexity: "moderate",
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "raw string failure",
      );
    });

    it("should pass domain, task_type, and complexity as TaskClassification to engine", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      await server.handleRoute({
        task: "find edge cases",
        domain: "TESTING",
        task_type: "EDGE_CASE_DISCOVERY",
        complexity: "complex",
      });

      const call = (engine.traceOnly as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[2].domain).toBe("TESTING");
      expect(call[2].taskType).toBe("EDGE_CASE_DISCOVERY");
      expect(call[2].complexity).toBe("complex");
    });

    // --- Phase 2: Optional fields ---

    it("should use IMPLEMENT_FEATURE default when CODING domain without task_type", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      const result = await server.handleRoute({
        task: "write a function",
        domain: "CODING",
      });

      const call = (engine.traceOnly as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[2].taskType).toBe("IMPLEMENT_FEATURE");
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.classification.method).toBe("default");
    });

    it("should infer 'simple' complexity for short tasks", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      await server.handleRoute({
        task: "fix bug",
        domain: "DEBUGGING",
      });

      const call = (engine.traceOnly as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[2].complexity).toBe("simple");
      expect(call[2].taskType).toBe("FIX_IMPLEMENT");
    });

    it("should infer 'complex' complexity for long tasks", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      await server.handleRoute({
        task: "x".repeat(1001),
        domain: "ARCHITECTURE",
      });

      const call = (engine.traceOnly as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[2].complexity).toBe("complex");
    });

    it("should pass context.language to classification", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      await server.handleRoute({
        task: "implement a function",
        domain: "CODING",
        context: { language: "typescript" },
      });

      const call = (engine.traceOnly as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[2].language).toBe("typescript");
    });

    it("should report method as 'default' when task_type omitted", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      const result = await server.handleRoute({
        task: "write tests",
        domain: "TESTING",
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.classification.method).toBe("default");
      expect(parsed.classification.taskType).toBe("UNIT_TEST_WRITE");
    });

    it("should report method as 'host' when task_type provided", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      const result = await server.handleRoute({
        task: "review code",
        domain: "REVIEW",
        task_type: "SECURITY_REVIEW",
        complexity: "complex",
      });

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.classification.method).toBe("host");
      expect(parsed.classification.taskType).toBe("SECURITY_REVIEW");
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

  // === pyreez_deliberate ===

  describe("pyreez_deliberate", () => {
    const DELIBERATE_OUTPUT: DeliberateOutput = {
      result: "function add(a, b) { return a + b; }",
      roundsExecuted: 2,
      consensusReached: null,
      totalTokens: { input: 100, output: 200 },
      totalLLMCalls: 8,
      modelsUsed: ["worker/a", "worker/b", "leader/m"],
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
      expect(parsed.result).toBe("function add(a, b) { return a + b; }");
      expect(parsed.roundsExecuted).toBe(2);
      expect(parsed.consensusReached).toBeNull();
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
        max_rounds: 5,
        consensus: "leader_decides",
      });

      const callArg = (deliberateFn as ReturnType<typeof mock>).mock.calls[0]![0];
      expect(callArg.maxRounds).toBe(5);
      expect(callArg.consensus).toBe("leader_decides");
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

    it("should use engine.run when auto_route=true with classification", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      const result = await server.handleDeliberate({
        task: "Implement sorting",
        auto_route: true,
        domain: "CODING",
        task_type: "IMPLEMENT_ALGORITHM",
        complexity: "moderate",
      });

      expect(result.isError).toBeUndefined();
      const call = (engine.runWithTrace as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[0]).toBe("Implement sorting");
      expect(call[1]).toEqual({ perRequest: 1.0 });
      expect(call[2].domain).toBe("CODING");
      expect(call[2].taskType).toBe("IMPLEMENT_ALGORITHM");
      expect(call[2].complexity).toBe("moderate");
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.result).toBe(DEFAULT_RUN_RESULT.result);
    });

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

    it("should use domain default when auto_route=true but task_type omitted", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      const result = await server.handleDeliberate({
        task: "task",
        auto_route: true,
        domain: "CODING",
      });

      expect(result.isError).toBeUndefined();
      const call = (engine.runWithTrace as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[2].taskType).toBe("IMPLEMENT_FEATURE");
      expect(call[2].complexity).toBe("simple"); // "task" is < 200 chars
    });

    it("should infer complexity when auto_route=true but complexity omitted", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      const result = await server.handleDeliberate({
        task: "task",
        auto_route: true,
        domain: "CODING",
        task_type: "IMPLEMENT_FEATURE",
      });

      expect(result.isError).toBeUndefined();
      const call = (engine.runWithTrace as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[2].complexity).toBe("simple"); // inferred from short task
    });

    it("should forward budget to engine.run when auto_route=true with budget specified", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      await server.handleDeliberate({
        task: "Sort an array",
        auto_route: true,
        domain: "CODING",
        task_type: "IMPLEMENT_ALGORITHM",
        complexity: "simple",
        budget: 0.25,
      });

      const call = (engine.runWithTrace as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[0]).toBe("Sort an array");
      expect(call[1]).toEqual({ perRequest: 0.25 });
      expect(call[2].domain).toBe("CODING");
      expect(call[2].taskType).toBe("IMPLEMENT_ALGORITHM");
      expect(call[2].complexity).toBe("simple");
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

    it("should forward quality_weight and cost_weight to engine.run via classification in auto_route mode", async () => {
      const engine = stubEngine();
      const server = new PyreezMcpServer(validConfig({ engine }));

      await server.handleDeliberate({
        task: "Optimize query",
        auto_route: true,
        domain: "CODING",
        task_type: "OPTIMIZE",
        complexity: "moderate",
        quality_weight: 0.8,
        cost_weight: 0.2,
      });

      const call = (engine.runWithTrace as ReturnType<typeof mock>).mock.calls[0]!;
      expect(call[2].qualityWeight).toBe(0.8);
      expect(call[2].costWeight).toBe(0.2);
    });

    it("should return error with Error.message when engine.runWithTrace throws Error in auto_route mode", async () => {
      const engine = stubEngine({
        runWithTrace: mock(() => Promise.reject(new Error("pipeline failed"))),
      } as unknown as Partial<PyreezEngine>);
      const server = new PyreezMcpServer(validConfig({ engine }));

      const result = await server.handleDeliberate({
        task: "task",
        auto_route: true,
        domain: "CODING",
        task_type: "IMPLEMENT_FEATURE",
        complexity: "complex",
      });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain("pipeline failed");
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

      await server.handleRoute({
        task: "test task",
        domain: "CODING",
        task_type: "IMPLEMENT_FEATURE",
        complexity: "moderate",
      });

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
      const engine = stubEngine({
        traceOnly: mock(() => Promise.reject(new Error("engine error"))),
      } as unknown as Partial<PyreezEngine>);
      const server = new PyreezMcpServer(
        validConfig({ runLogger, engine }),
      );

      await server.handleRoute({
        task: "test task",
        domain: "CODING",
        task_type: "IMPLEMENT_FEATURE",
        complexity: "moderate",
      });

      expect(runLogger.log).toHaveBeenCalledTimes(1);
      const logged = (runLogger.log as ReturnType<typeof mock>).mock
        .calls[0]![0];
      expect(logged.tool).toBe("route");
      expect(logged.success).toBe(false);
      expect(logged.error).toContain("engine error");
    });

    it("should not fail when runLogger is not configured", async () => {
      const server = new PyreezMcpServer(validConfig());

      const result = await server.handleRoute({
        task: "test task",
        domain: "CODING",
        task_type: "IMPLEMENT_FEATURE",
        complexity: "moderate",
      });

      expect(result.isError).toBeUndefined();
    });

    it("should still return result when runLogger.log throws", async () => {
      const runLogger = {
        log: mock(() => Promise.reject(new Error("log write failed"))),
        query: mock(() => Promise.resolve([])),
      };
      const server = new PyreezMcpServer(validConfig({ runLogger }));

      const result = await server.handleRoute({
        task: "test task",
        domain: "CODING",
        task_type: "IMPLEMENT_FEATURE",
        complexity: "moderate",
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(
        (result.content[0] as { text: string }).text,
      );
      expect(parsed.selection.models[0].modelId).toBe("openai/gpt-4.1");
    });

    it("should propagate original error when both handler and runLogger throw", async () => {
      // Arrange — handler throws, runLogger.log also throws
      const runLogger = {
        log: mock(() => Promise.reject(new Error("log write failed"))),
        query: mock(() => Promise.resolve([])),
      };
      const engine = stubEngine({
        traceOnly: mock(() => Promise.reject(new Error("engine down"))),
      } as unknown as Partial<PyreezEngine>);
      const server = new PyreezMcpServer(
        validConfig({ runLogger, engine }),
      );

      // Act — handleRoute will get error from engine, logRun catches logger failure
      const result = await server.handleRoute({
        task: "test task",
        domain: "CODING",
        task_type: "IMPLEMENT_FEATURE",
        complexity: "moderate",
      });

      // Assert — error should be from the handler, not from runLogger
      expect(result.isError).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain("engine down");
      expect(text).not.toContain("log write failed");
    });
  });

});
