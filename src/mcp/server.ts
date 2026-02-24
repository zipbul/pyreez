/**
 * PyreezMcpServer — MCP server exposing 6 infrastructure tools.
 *
 * Tools: pyreez_route, pyreez_ask, pyreez_ask_many, pyreez_scores, pyreez_report, pyreez_deliberate
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
import type { RunLogger } from "../report/run-logger";
import type { RouteResult } from "../router/router";
import type { BudgetConfig } from "../router/types";
import type { DeliberateInput, DeliberateOutput } from "../deliberation/types";
import type { DeliberationStore } from "../deliberation/store-types";
import { stripThinkTags } from "../deliberation/wire";
import type { CalibrationResult } from "../model/calibration";

export interface PyreezMcpServerConfig {
  mcpServer: McpServer;
  llmClient: LLMClient;
  registry: ModelRegistry;
  reporter: Reporter;
  routeFn: (prompt: string, budget?: BudgetConfig, hints?: import("../router/types").RouteHints) => RouteResult | null;
  summaryFn?: () => Promise<import("../report/types").ReportSummary>;
  deliberateFn?: (input: DeliberateInput) => Promise<DeliberateOutput>;
  deliberationStore?: DeliberationStore;
  runLogger?: RunLogger;
  calibrateFn?: () => Promise<CalibrationResult>;
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
  private readonly runLogger?: RunLogger;
  private readonly calibrateFn?: () => Promise<CalibrationResult>;

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
    this.runLogger = config.runLogger;
    this.calibrateFn = config.calibrateFn;

    this.registerTools();
  }

  private registerTools(): void {
    this.mcpServer.registerTool(
      "pyreez_route",
      {
        title: "Pyreez Route",
        description:
          "Route a task through CLASSIFY → PROFILE → SELECT pipeline to find the optimal model. Submit task in English.",
        inputSchema: z.object({
          task: z.string().describe("Task description to route"),
          budget: z
            .number()
            .optional()
            .describe("Max cost per request in USD (default: 1.0)"),
          domain_hint: z
            .string()
            .optional()
            .describe(
              "Domain hint from host agent (e.g., CODING, ARCHITECTURE, TESTING). Bypasses keyword classification.",
            ),
          complexity_hint: z
            .string()
            .optional()
            .describe(
              'Complexity hint from host agent ("simple", "moderate", "complex"). Overrides estimated complexity.',
            ),
        }),
      },
      async (args) => this.handleRoute(args),
    );

    this.mcpServer.registerTool(
      "pyreez_ask",
      {
        title: "Pyreez Ask",
        description: "Send a chat completion request to a specific model. Submit messages in English.",
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
          "Send the same chat request to multiple models in parallel. Submit messages in English.",
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
          top: z
            .number()
            .optional()
            .describe("Return top N models sorted by score DESC (requires dimension)"),
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
          "Run multi-model consensus-based deliberation on a task. Submit task and instructions in English.",
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

    this.mcpServer.registerTool(
      "pyreez_calibrate",
      {
        title: "Pyreez Calibrate",
        description:
          "Run a calibration cycle to update BT ratings from usage data and persist results",
        inputSchema: z.object({}),
      },
      async () => this.handleCalibrate(),
    );
  }

  // --- Run Logging ---

  private async logRun(
    tool: string,
    handler: () => Promise<CallToolResult>,
  ): Promise<CallToolResult> {
    if (!this.runLogger) return handler();

    const start = Date.now();
    const id = crypto.randomUUID();
    try {
      const result = await handler();
      try {
        await this.runLogger.log({
          id,
          timestamp: start,
          tool,
          durationMs: Date.now() - start,
          success: !result.isError,
          error: result.isError
            ? (result.content[0] as { text: string }).text
            : undefined,
        });
      } catch {
        // logging failure must not break the tool
      }
      return result;
    } catch (error) {
      try {
        await this.runLogger.log({
          id,
          timestamp: start,
          tool,
          durationMs: Date.now() - start,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // logging failure must not break the tool
      }
      throw error;
    }
  }

  // --- Tool Handlers ---

  async handleRoute(args: {
    task: string;
    budget?: number;
    domain_hint?: string;
    complexity_hint?: string;
  }): Promise<CallToolResult> {
    return this.logRun("route", async () => {
    if (!args.task) {
      return this.errorResult("Error: task is required");
    }

    try {
      const budget: BudgetConfig = {
        perRequest: args.budget ?? DEFAULT_BUDGET.perRequest,
      };
      const hints = {
        domain_hint: args.domain_hint as any,
        complexity_hint: args.complexity_hint as any,
      };
      const result = this.routeFn(args.task, budget, hints);

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
    });
  }

  async handleAsk(args: {
    model: string;
    messages: { role: string; content: string }[];
    temperature?: number;
    max_tokens?: number;
  }): Promise<CallToolResult> {
    return this.logRun("ask", async () => {
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

      return this.textResult(stripThinkTags(content));
    } catch (error) {
      return this.errorResult(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    });
  }

  async handleAskMany(args: {
    models: string[];
    messages: { role: string; content: string }[];
    temperature?: number;
    max_tokens?: number;
  }): Promise<CallToolResult> {
    return this.logRun("ask_many", async () => {
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
        return { model, content: stripThinkTags(content) };
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
    });
  }

  async handleScores(args: {
    model?: string;
    dimension?: string;
    top?: number;
  }): Promise<CallToolResult> {
    return this.logRun("scores", async () => {
    let models: ModelInfo[];

    if (args.model) {
      const found = this.registry.getById(args.model);
      models = found ? [found] : [];
    } else {
      models = this.registry.getAll();
    }

    if (args.dimension) {
      const dim = args.dimension;
      let scored = models.map((m) => {
        const raw = (m.capabilities as Record<string, unknown>)[dim];
        let score: number;
        let conf: number;
        if (raw != null && typeof raw === "object" && "mu" in raw) {
          // BT format: { mu, sigma, comparisons }
          const bt = raw as { mu: number; sigma: number };
          score = bt.mu;
          conf = Math.round(Math.max(0, 1 - bt.sigma / 350) * 100) / 100;
        } else {
          // Legacy format: plain number (no confidence available)
          score = typeof raw === "number" ? raw : 0;
          conf = 0;
        }
        return {
          id: m.id,
          name: m.name,
          score,
          confidence: conf,
        };
      });
      if (args.top != null) {
        scored = scored
          .sort((a, b) => b.score - a.score)
          .slice(0, Math.max(0, args.top));
      }
      return this.textResult(JSON.stringify(scored, null, 2));
    }

    const full = models.map((m) => ({
      id: m.id,
      name: m.name,
      capabilities: m.capabilities,
      cost: m.cost,
    }));
    return this.textResult(JSON.stringify(full, null, 2));
    });
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
    return this.logRun("report", async () => {
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
    });
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
    return this.logRun("deliberate", async () => {
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
    });
  }

  // --- Lifecycle (server) ---

  async handleCalibrate(): Promise<CallToolResult> {
    return this.logRun("calibrate", async () => {
      if (!this.calibrateFn) {
        return this.errorResult("Error: calibration not available");
      }
      try {
        const result = await this.calibrateFn();
        return this.textResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return this.errorResult(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

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
