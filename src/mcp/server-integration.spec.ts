/**
 * Integration tests: MCP tool call → server handler → wire → engine → fallback pool → output.
 *
 * Uses real MCP transport (InMemoryTransport) with mock chat function (no actual LLM calls).
 */

import { describe, it, expect, afterEach } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PyreezMcpServer } from "./server";
import { createDeliberateFn } from "../deliberation/wire";
import type { ModelInfo } from "../model/types";
import type { ChatMessage } from "../llm/types";
import type { GenerationParams } from "../deliberation/types";

// -- Mock Model Factory --

function makeModel(id: string, provider: string, overrides: Partial<ModelInfo> = {}): ModelInfo {
  const defaultCaps: Record<string, { mu: number; sigma: number; comparisons: number }> = {};
  for (const dim of [
    "REASONING", "MATH_REASONING", "MULTI_STEP_DEPTH", "CREATIVITY", "ANALYSIS", "JUDGMENT",
    "CODE_GENERATION", "CODE_UNDERSTANDING", "DEBUGGING", "SYSTEM_THINKING", "TOOL_USE",
    "HALLUCINATION_RESISTANCE", "CONFIDENCE_CALIBRATION", "SELF_CONSISTENCY", "AMBIGUITY_HANDLING",
    "INSTRUCTION_FOLLOWING", "STRUCTURED_OUTPUT", "LONG_CONTEXT", "MULTILINGUAL",
    "SPEED", "COST_EFFICIENCY",
  ] as const) {
    defaultCaps[dim] = { mu: 600, sigma: 100, comparisons: 5 };
  }
  return {
    id,
    name: id.split("/")[1] ?? id,
    provider: provider as ModelInfo["provider"],
    contextWindow: 128_000,
    capabilities: defaultCaps as unknown as ModelInfo["capabilities"],
    cost: { inputPer1M: 1.0, outputPer1M: 3.0 },
    supportsToolCalling: true,
    available: true,
    ...overrides,
  };
}

// -- 5 Mock Models (different providers) --

const MODELS: ModelInfo[] = [
  makeModel("openai/gpt-4.1", "openai"),
  makeModel("anthropic/claude-sonnet-4-20250514", "anthropic"),
  makeModel("google/gemini-2.5-pro", "google"),
  makeModel("deepseek/deepseek-r1", "deepseek"),
  makeModel("mistral/mistral-large", "mistral"),
];

// -- Mock Registry --

function createMockRegistry(models: ModelInfo[] = MODELS) {
  return {
    getAll: () => [...models],
    getAvailable: () => models.filter((m) => m.available !== false),
    getById: (id: string) => models.find((m) => m.id === id),
  };
}

// -- Long enough response to pass MIN_WORKER_RESPONSE_LENGTH (200 chars) --

function longResponse(model: string): string {
  const base = `This is a detailed response from ${model} providing analysis and recommendations. `;
  return base.repeat(5); // ~400 chars
}

// -- Test Harness --

interface TestHarness {
  client: Client;
  cleanup: () => Promise<void>;
}

async function createHarness(opts: {
  chatFn: (model: string, messages: ChatMessage[], params?: GenerationParams) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;
  models?: ModelInfo[];
}): Promise<TestHarness> {
  const models = opts.models ?? MODELS;
  const registry = createMockRegistry(models);

  const deliberateFn = createDeliberateFn({
    registry,
    chat: opts.chatFn,
  });

  const mcpServer = new McpServer({ name: "pyreez-test", version: "0.0.1" });

  new PyreezMcpServer({
    mcpServer,
    registry: registry as any,
    deliberateFn,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "0.0.1" });

  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    cleanup: async () => {
      await client.close();
      await mcpServer.close();
    },
  };
}

// -- Tests --

describe("MCP Server Integration", () => {
  let harness: TestHarness;

  afterEach(async () => {
    if (harness) {
      await harness.cleanup();
    }
  });

  // === Test 1: modelSwaps when worker fails and is replaced ===

  it("pyreez_deliberate should return modelSwaps when worker fails and is replaced", async () => {
    const failModel = "openai/gpt-4.1";
    // Need extra models beyond team size so fallback pool has candidates
    const extendedModels = [
      ...MODELS,
      makeModel("cohere/command-r-plus", "cohere"),
      makeModel("meta/llama-4-maverick", "meta"),
    ];

    harness = await createHarness({
      chatFn: async (model, _messages, _params) => {
        if (model === failModel) {
          throw new Error("spending cap");
        }
        return {
          content: longResponse(model),
          inputTokens: 100,
          outputTokens: 200,
        };
      },
      models: extendedModels,
    });

    const result = await harness.client.callTool({
      name: "pyreez_deliberate",
      arguments: {
        task: "Analyze the tradeoffs between microservices and monolith architecture for a startup with 5 engineers",
        models: ["openai/gpt-4.1", "anthropic/claude-sonnet-4-20250514", "google/gemini-2.5-pro"],
      },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    const parsed = JSON.parse(text);

    // Should have completed
    expect(parsed.roundsExecuted).toBeGreaterThanOrEqual(1);
    expect(parsed.modelsUsed).toBeArray();
    expect(parsed.modelsUsed.length).toBeGreaterThanOrEqual(2);

    // modelSwaps: the failed model should appear
    expect(parsed.modelSwaps).toBeArray();
    expect(parsed.modelSwaps.length).toBeGreaterThanOrEqual(1);

    // Model IDs are anonymized — find swap by error message instead of real model ID
    const swap = parsed.modelSwaps.find((s: { error: string }) => s.error.includes("spending cap"));
    expect(swap).toBeDefined();
    expect(swap.round).toBe(1);
    expect(swap.original).toMatch(/^[A-Z]$/);
    // replacement is no longer exposed — only swapped boolean
    expect(swap.swapped).toBe(true);
    expect(swap.replacement).toBeUndefined();
  });

  // === Test 2: End-to-end deliberation with no failures ===

  it("pyreez_deliberate should work end-to-end with no failures", async () => {
    harness = await createHarness({
      chatFn: async (model) => ({
        content: longResponse(model),
        inputTokens: 150,
        outputTokens: 300,
      }),
    });

    const result = await harness.client.callTool({
      name: "pyreez_deliberate",
      arguments: {
        task: "Design a caching strategy for a high-traffic API with mixed read-write workloads",
        models: ["openai/gpt-4.1", "anthropic/claude-sonnet-4-20250514", "google/gemini-2.5-pro"],
      },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    const parsed = JSON.parse(text);

    // Basic structure
    expect(parsed.roundsExecuted).toBe(1);
    expect(parsed.modelsUsed).toBeArray();
    expect(parsed.modelsUsed.length).toBeGreaterThanOrEqual(3);
    expect(parsed.totalLLMCalls).toBeGreaterThanOrEqual(3);

    // Token usage
    expect(parsed.totalTokens).toBeDefined();
    expect(parsed.totalTokens.input).toBeGreaterThan(0);
    expect(parsed.totalTokens.output).toBeGreaterThan(0);

    // Rounds with responses
    expect(parsed.rounds).toBeArray();
    expect(parsed.rounds.length).toBe(1);
    const round = parsed.rounds[0];
    expect(round.number).toBe(1);
    expect(round.responses).toBeArray();
    expect(round.responses.length).toBeGreaterThanOrEqual(3);

    // Each response has model and content
    for (const resp of round.responses) {
      expect(resp.model).toBeDefined();
      expect(resp.content).toBeDefined();
      expect(resp.content.length).toBeGreaterThan(0);
    }

    // No model swaps when everything succeeds
    if (parsed.modelSwaps) {
      expect(parsed.modelSwaps.length).toBe(0);
    }
  });

  // === Test 3: technique + debate ===

  it("pyreez_deliberate with technique should include technique instruction and anti-conformity in user message", async () => {
    const capturedMessages: { model: string; messages: ChatMessage[] }[] = [];
    let callCount = 0;

    harness = await createHarness({
      chatFn: async (model, messages) => {
        capturedMessages.push({ model, messages });
        return {
          content: `Response ${++callCount} with analysis: ${"x".repeat(callCount * 80)}`.padEnd(200, "."),
          inputTokens: 100,
          outputTokens: 200,
        };
      },
    });

    const result = await harness.client.callTool({
      name: "pyreez_deliberate",
      arguments: {
        task: "Evaluate microservices vs monolith",
        models: ["openai/gpt-4.1", "anthropic/claude-sonnet-4-20250514"],
        protocol: "debate",
        max_rounds: 2,
        technique: "challenge",
      },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as { type: string; text: string }[])[0]!.text);
    expect(parsed.roundsExecuted).toBe(2);

    // R2 messages should contain technique instruction + anti-conformity + confidence in user message
    // Session continuation: R2 messages have full history, so check the LAST user message
    const r2Messages = capturedMessages.filter((_, i) => i >= 2); // R2 calls
    for (const { messages } of r2Messages) {
      const userMsgs = messages.filter(m => m.role === "user");
      const lastUserMsg = userMsgs[userMsgs.length - 1]?.content ?? "";
      expect(lastUserMsg).toContain("Focus on identifying weaknesses"); // challenge instruction
      expect(lastUserMsg).toContain("conformity"); // anti-conformity
      expect(lastUserMsg).toContain("confidence"); // confidence/uncertainty

      // System message should NOT contain technique or anti-conformity
      const sysMsg = messages.find(m => m.role === "system")?.content ?? "";
      expect(sysMsg).not.toContain("Focus on identifying weaknesses");
      expect(sysMsg).not.toContain("conformity");
    }
  });

  // === Test 4: technique=accept uses accept variant anti-conformity ===

  it("pyreez_deliberate with technique=accept should use accept variant anti-conformity", async () => {
    const capturedMessages: { model: string; messages: ChatMessage[] }[] = [];
    let callCount = 0;

    harness = await createHarness({
      chatFn: async (model, messages) => {
        capturedMessages.push({ model, messages });
        return {
          content: `Accept response ${++callCount}: ${"a".repeat(callCount * 80)}`.padEnd(200, "."),
          inputTokens: 100,
          outputTokens: 200,
        };
      },
    });

    const result = await harness.client.callTool({
      name: "pyreez_deliberate",
      arguments: {
        task: "Find consensus on caching strategy",
        models: ["openai/gpt-4.1", "anthropic/claude-sonnet-4-20250514"],
        protocol: "debate",
        max_rounds: 2,
        technique: "accept",
      },
    });

    expect(result.isError).toBeFalsy();

    // R2 messages should have accept variant, NOT basic anti-conformity
    const r2Messages = capturedMessages.filter((_, i) => i >= 2);
    for (const { messages } of r2Messages) {
      const userMsgs = messages.filter(m => m.role === "user");
      const lastUserMsg = userMsgs[userMsgs.length - 1]?.content ?? "";
      expect(lastUserMsg).toContain("Seek valid points to incorporate"); // accept variant
      expect(lastUserMsg).not.toContain("You may not rely on the principle of conformity"); // NOT basic
    }
  });

  // === Test 5: per-round technique ===

  it("pyreez_deliberate with per-round technique array should use different techniques per round", async () => {
    const capturedMessages: ChatMessage[][] = [];
    let callCount = 0;

    harness = await createHarness({
      chatFn: async (_model, messages) => {
        capturedMessages.push([...messages]);
        return {
          content: `Per-round response ${++callCount}: ${"p".repeat(callCount * 80)}`.padEnd(200, "."),
          inputTokens: 100,
          outputTokens: 200,
        };
      },
    });

    const result = await harness.client.callTool({
      name: "pyreez_deliberate",
      arguments: {
        task: "Design API versioning strategy",
        models: ["openai/gpt-4.1"],
        count: 1,
        protocol: "debate",
        max_rounds: 3,
        technique: ["propose", "challenge", "defend"],
      },
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as { type: string; text: string }[])[0]!.text);
    expect(parsed.roundsExecuted).toBe(3);

    // R1: propose instruction (single user message)
    const r1Users = capturedMessages[0]?.filter(m => m.role === "user") ?? [];
    expect(r1Users[r1Users.length - 1]?.content ?? "").toContain("Focus on offering a new approach");

    // R2: challenge instruction (last user message in session history)
    const r2Users = capturedMessages[1]?.filter(m => m.role === "user") ?? [];
    expect(r2Users[r2Users.length - 1]?.content ?? "").toContain("Focus on identifying weaknesses");

    // R3: defend instruction (last user message in session history)
    const r3Users = capturedMessages[2]?.filter(m => m.role === "user") ?? [];
    expect(r3Users[r3Users.length - 1]?.content ?? "").toContain("Focus on defending your position");
  });
});
