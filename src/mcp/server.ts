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
import type { DeliberateInput, DeliberateOutput } from "../deliberation/types";
import type { DeliberationStore } from "../deliberation/store-types";

export interface PyreezMcpServerConfig {
  mcpServer: McpServer;
  llmClient: LLMClient;
  registry: ModelRegistry;
  reporter: Reporter;
  routeFn: (prompt: string, budget?: BudgetConfig) => RouteResult | null;
  summaryFn?: () => Promise<import("../report/types").ReportSummary>;
  deliberateFn?: (input: DeliberateInput) => Promise<DeliberateOutput>;
  deliberationStore?: DeliberationStore;
}

const DEFAULT_BUDGET: BudgetConfig = { perRequest: 1.0 };

export class PyreezMcpServer {
  private readonly mcpServer: McpServer;
  private readonly llmClient: LLMClient;
  private readonly registry: ModelRegistry;
  private readonly reporter: Reporter;
  private readonly routeFn: PyreezMcpServerConfig["routeFn"];
  private readonly summaryFn?: PyreezMcpServerConfig["summaryFn"];
  private readonly deliberateFn?: PyreezMcpServerConfig["deliberateFn"];
  private readonly deliberationStore?: DeliberationStore;

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
    this.summaryFn = config.summaryFn;
    this.deliberateFn = config.deliberateFn;
    this.deliberationStore = config.deliberationStore;

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
        description:
          'Record an LLM call result for quality tracking, or retrieve summary (action="summary")',
        inputSchema: z.object({
          action: z
            .enum(["record", "summary", "query_deliberation"])
            .optional()
            .describe('Action: "record" (default), "summary", or "query_deliberation"'),
          query_task: z
            .string()
            .optional()
            .describe("Filter deliberations by task (partial match)"),
          query_perspective: z
            .string()
            .optional()
            .describe("Filter deliberations by perspective"),
          query_model: z
            .string()
            .optional()
            .describe("Filter deliberations by model"),
          query_consensus: z
            .boolean()
            .optional()
            .describe("Filter deliberations by consensus reached"),
          query_limit: z
            .number()
            .optional()
            .describe("Limit number of deliberation results"),
          model: z.string().optional().describe("Model ID used"),
          task_type: z
            .string()
            .optional()
            .describe("Task type from classification"),
          quality: z
            .number()
            .optional()
            .describe("Quality score (0-10)"),
          latency_ms: z
            .number()
            .optional()
            .describe("Latency in milliseconds"),
          tokens: z
            .object({
              input: z.number().describe("Input token count"),
              output: z.number().describe("Output token count"),
            })
            .optional()
            .describe("Token usage"),
          context: z
            .object({
              window_size: z.number().describe("Model context window size"),
              utilization: z
                .number()
                .describe("Input tokens / window size (0.0-1.0)"),
              estimated_waste: z
                .number()
                .optional()
                .describe("Estimated unnecessary token ratio"),
            })
            .optional()
            .describe("Context utilization metrics"),
          team_id: z
            .string()
            .optional()
            .describe("Team identifier for team-level evaluation"),
          leader_id: z
            .string()
            .optional()
            .describe("Team Leader model ID"),
        }),
      },
      async (args) => this.handleReport(args),
    );

    this.mcpServer.registerTool(
      "pyreez_deliberate",
      {
        title: "Pyreez Deliberate",
        description:
          "Run multi-model consensus-based deliberation on a task",
        inputSchema: z.object({
          task: z.string().describe("Task to deliberate on"),
          perspectives: z
            .array(z.string())
            .describe("Review perspectives (e.g., ['코드 품질', '보안', '성능'])"),
          producer_instructions: z
            .string()
            .optional()
            .describe("Optional instructions for the producer"),
          leader_instructions: z
            .string()
            .optional()
            .describe("Optional instructions for the leader"),
          max_rounds: z
            .number()
            .optional()
            .describe("Maximum deliberation rounds (default: 3)"),
          consensus: z
            .enum(["leader_decides", "all_approve", "majority"])
            .optional()
            .describe("Consensus mode (default: leader_decides)"),
        }),
      },
      async (args) => this.handleDeliberate(args),
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
    action?: string;
    model?: string;
    task_type?: string;
    quality?: number;
    latency_ms?: number;
    tokens?: { input: number; output: number };
    context?: {
      window_size: number;
      utilization: number;
      estimated_waste?: number;
    };
    team_id?: string;
    leader_id?: string;
    query_task?: string;
    query_perspective?: string;
    query_model?: string;
    query_consensus?: boolean;
    query_limit?: number;
  }): Promise<CallToolResult> {
    const action = args.action ?? "record";

    if (action === "query_deliberation") {
      if (!this.deliberationStore) {
        return this.errorResult("Error: deliberation store not available");
      }
      try {
        const results = await this.deliberationStore.query({
          task: args.query_task,
          perspective: args.query_perspective,
          model: args.query_model,
          consensusReached: args.query_consensus,
          limit: args.query_limit,
        });
        return this.textResult(JSON.stringify(results, null, 2));
      } catch (error) {
        return this.errorResult(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (action === "summary") {
      if (!this.summaryFn) {
        return this.errorResult("Error: summary not available");
      }
      try {
        const summary = await this.summaryFn();
        return this.textResult(JSON.stringify(summary, null, 2));
      } catch (error) {
        return this.errorResult(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (!args.model || !args.task_type || args.quality == null) {
      return this.errorResult(
        "Error: model, task_type, and quality are required",
      );
    }

    try {
      const record: CallRecord = {
        model: args.model,
        taskType: args.task_type,
        quality: args.quality,
        latencyMs: args.latency_ms ?? 0,
        tokens: args.tokens ?? { input: 0, output: 0 },
        context: args.context
          ? {
              windowSize: args.context.window_size,
              utilization: args.context.utilization,
              estimatedWaste: args.context.estimated_waste,
            }
          : undefined,
        teamId: args.team_id,
        leaderId: args.leader_id,
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

  async handleDeliberate(args: {
    task: string;
    perspectives: string[];
    producer_instructions?: string;
    leader_instructions?: string;
    max_rounds?: number;
    consensus?: string;
  }): Promise<CallToolResult> {
    if (!args.task) {
      return this.errorResult("Error: task is required");
    }
    if (!args.perspectives?.length) {
      return this.errorResult("Error: perspectives must not be empty");
    }
    if (!this.deliberateFn) {
      return this.errorResult("Error: deliberation not available");
    }

    try {
      const input: DeliberateInput = {
        task: args.task,
        perspectives: args.perspectives,
        producerInstructions: args.producer_instructions,
        leaderInstructions: args.leader_instructions,
        maxRounds: args.max_rounds,
        consensus: args.consensus as DeliberateInput["consensus"],
      };
      const result = await this.deliberateFn(input);
      return this.textResult(JSON.stringify(result, null, 2));
    } catch (error) {
      return this.errorResult(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // --- Lifecycle (server) ---

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
