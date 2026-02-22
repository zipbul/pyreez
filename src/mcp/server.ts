/**
 * PyreezMcpServer — MCP server exposing 5 infrastructure tools.
 *
 * Tools: pyreez_route, pyreez_ask, pyreez_ask_many, pyreez_scores, pyreez_report
 * Architecture: pyreez = Infrastructure layer, Host = Orchestrator.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { LLMClient } from "../llm/client";
import type { ModelRegistry } from "../model/registry";
import type { ModelInfo } from "../model/types";
import type { Reporter, CallRecord } from "../report/types";
import type { RouteResult } from "../router/router";
import type { BudgetConfig } from "../router/types";

export interface PyreezMcpServerConfig {
  mcpServer: McpServer;
  llmClient: LLMClient;
  registry: ModelRegistry;
  reporter: Reporter;
  routeFn: (prompt: string, budget?: BudgetConfig) => RouteResult | null;
}

const DEFAULT_BUDGET: BudgetConfig = { perRequest: 1.0 };

export class PyreezMcpServer {
  private readonly mcpServer: McpServer;
  private readonly llmClient: LLMClient;
  private readonly registry: ModelRegistry;
  private readonly reporter: Reporter;
  private readonly routeFn: PyreezMcpServerConfig["routeFn"];

  constructor(config: PyreezMcpServerConfig) {
    if (!config.mcpServer) {
      throw new Error("mcpServer is required");
    }
    if (!config.llmClient) {
      throw new Error("llmClient is required");
    }
    if (!config.registry) {
      throw new Error("registry is required");
    }
    if (!config.reporter) {
      throw new Error("reporter is required");
    }
    if (!config.routeFn) {
      throw new Error("routeFn is required");
    }

    this.mcpServer = config.mcpServer;
    this.llmClient = config.llmClient;
    this.registry = config.registry;
    this.reporter = config.reporter;
    this.routeFn = config.routeFn;

    this.registerTools();
  }

  private registerTools(): void {
    this.mcpServer.registerTool(
      "pyreez_route",
      {
        title: "Pyreez Route",
        description:
          "Route a task through CLASSIFY → PROFILE → SELECT pipeline to find the optimal model",
        inputSchema: z.object({
          task: z.string().describe("Task description to route"),
          budget: z
            .number()
            .optional()
            .describe("Max cost per request in USD (default: 1.0)"),
        }),
      },
      async (args) => this.handleRoute(args),
    );

    this.mcpServer.registerTool(
      "pyreez_ask",
      {
        title: "Pyreez Ask",
        description: "Send a chat completion request to a specific model",
        inputSchema: z.object({
          model: z.string().describe("Model ID (e.g., openai/gpt-4.1)"),
          messages: z
            .array(
              z.object({
                role: z.string().describe("Message role"),
                content: z.string().describe("Message content"),
              }),
            )
            .describe("Chat messages"),
          temperature: z.number().optional().describe("Sampling temperature"),
          max_tokens: z
            .number()
            .optional()
            .describe("Maximum tokens to generate"),
        }),
      },
      async (args) => this.handleAsk(args),
    );

    this.mcpServer.registerTool(
      "pyreez_ask_many",
      {
        title: "Pyreez Ask Many",
        description:
          "Send the same chat request to multiple models in parallel",
        inputSchema: z.object({
          models: z
            .array(z.string())
            .describe("Array of model IDs to query"),
          messages: z
            .array(
              z.object({
                role: z.string().describe("Message role"),
                content: z.string().describe("Message content"),
              }),
            )
            .describe("Chat messages"),
          temperature: z.number().optional().describe("Sampling temperature"),
          max_tokens: z
            .number()
            .optional()
            .describe("Maximum tokens to generate"),
        }),
      },
      async (args) => this.handleAskMany(args),
    );

    this.mcpServer.registerTool(
      "pyreez_scores",
      {
        title: "Pyreez Scores",
        description:
          "Query model capability scores from the registry",
        inputSchema: z.object({
          model: z
            .string()
            .optional()
            .describe("Filter by model ID"),
          dimension: z
            .string()
            .optional()
            .describe("Filter by capability dimension (e.g., REASONING)"),
        }),
      },
      async (args) => this.handleScores(args),
    );

    this.mcpServer.registerTool(
      "pyreez_report",
      {
        title: "Pyreez Report",
        description: "Record an LLM call result for quality tracking",
        inputSchema: z.object({
          model: z.string().describe("Model ID used"),
          task_type: z.string().describe("Task type from classification"),
          quality: z.number().describe("Quality score (0-10)"),
          latency_ms: z.number().describe("Latency in milliseconds"),
          tokens: z
            .object({
              input: z.number().describe("Input token count"),
              output: z.number().describe("Output token count"),
            })
            .describe("Token usage"),
        }),
      },
      async (args) => this.handleReport(args),
    );
  }

  // --- Tool Handlers ---

  async handleRoute(args: {
    task: string;
    budget?: number;
  }): Promise<CallToolResult> {
    if (!args.task) {
      return this.errorResult("Error: task is required");
    }

    try {
      const budget: BudgetConfig = {
        perRequest: args.budget ?? DEFAULT_BUDGET.perRequest,
      };
      const result = this.routeFn(args.task, budget);

      if (!result) {
        return this.errorResult(
          "Error: classification failed — could not route task",
        );
      }

      return this.textResult(JSON.stringify(result, null, 2));
    } catch (error) {
      return this.errorResult(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async handleAsk(args: {
    model: string;
    messages: { role: string; content: string }[];
    temperature?: number;
    max_tokens?: number;
  }): Promise<CallToolResult> {
    if (!args.model) {
      return this.errorResult("Error: model is required");
    }
    if (!args.messages?.length) {
      return this.errorResult("Error: messages must not be empty");
    }

    try {
      const response = await this.llmClient.chat({
        model: args.model,
        messages: args.messages.map((m) => ({
          role: m.role as "system" | "user" | "assistant",
          content: m.content,
        })),
        temperature: args.temperature,
        max_tokens: args.max_tokens,
      });

      const content = response.choices[0]?.message?.content;
      if (content == null) {
        return this.errorResult("Error: empty response from model");
      }

      return this.textResult(content);
    } catch (error) {
      return this.errorResult(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async handleAskMany(args: {
    models: string[];
    messages: { role: string; content: string }[];
    temperature?: number;
    max_tokens?: number;
  }): Promise<CallToolResult> {
    if (!args.models?.length) {
      return this.errorResult("Error: models must not be empty");
    }
    if (!args.messages?.length) {
      return this.errorResult("Error: messages must not be empty");
    }

    const results = await Promise.allSettled(
      args.models.map(async (model) => {
        const response = await this.llmClient.chat({
          model,
          messages: args.messages.map((m) => ({
            role: m.role as "system" | "user" | "assistant",
            content: m.content,
          })),
          temperature: args.temperature,
          max_tokens: args.max_tokens,
        });
        const content = response.choices[0]?.message?.content ?? "";
        return { model, content };
      }),
    );

    const mapped = results.map((r, i) => {
      if (r.status === "fulfilled") {
        return r.value;
      }
      const error =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
      return { model: args.models[i], error };
    });

    return this.textResult(JSON.stringify(mapped, null, 2));
  }

  async handleScores(args: {
    model?: string;
    dimension?: string;
  }): Promise<CallToolResult> {
    let models: ModelInfo[];

    if (args.model) {
      const found = this.registry.getById(args.model);
      models = found ? [found] : [];
    } else {
      models = this.registry.getAll();
    }

    if (args.dimension) {
      const dim = args.dimension;
      const scored = models.map((m) => ({
        id: m.id,
        name: m.name,
        score: (m.capabilities as Record<string, number>)[dim] ?? 0,
        confidence: (m.confidence as Record<string, number>)[dim] ?? 0,
      }));
      return this.textResult(JSON.stringify(scored, null, 2));
    }

    const full = models.map((m) => ({
      id: m.id,
      name: m.name,
      capabilities: m.capabilities,
      confidence: m.confidence,
      cost: m.cost,
    }));
    return this.textResult(JSON.stringify(full, null, 2));
  }

  async handleReport(args: {
    model: string;
    task_type: string;
    quality: number;
    latency_ms: number;
    tokens: { input: number; output: number };
  }): Promise<CallToolResult> {
    if (!args.model || !args.task_type || args.quality == null) {
      return this.errorResult("Error: model, task_type, and quality are required");
    }

    try {
      const record: CallRecord = {
        model: args.model,
        taskType: args.task_type,
        quality: args.quality,
        latencyMs: args.latency_ms,
        tokens: args.tokens,
      };
      await this.reporter.record(record);
      return this.textResult(JSON.stringify({ recorded: true }));
    } catch (error) {
      return this.errorResult(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // --- Lifecycle ---

  async start(transport: Transport): Promise<void> {
    await this.mcpServer.connect(transport);
  }

  async close(): Promise<void> {
    await this.mcpServer.close();
  }

  // --- Helpers ---

  private textResult(text: string): CallToolResult {
    return { content: [{ type: "text", text }] };
  }

  private errorResult(text: string): CallToolResult {
    return { content: [{ type: "text", text }], isError: true };
  }
}
