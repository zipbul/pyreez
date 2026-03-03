/**
 * PyreezMcpServer — MCP server exposing 5 infrastructure tools.
 *
 * Tools: pyreez_route, pyreez_scores, pyreez_report, pyreez_deliberate, pyreez_calibrate
 * Architecture: pyreez = Infrastructure layer, Host = Orchestrator.
 *
 * Classification is provided by the host agent (domain, task_type, complexity are required params).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { ModelRegistry } from "../model/registry";
import type { ModelInfo } from "../model/types";
import type { Reporter, CallRecord } from "../report/types";
import type { RunLogger } from "../report/run-logger";
import type { BudgetConfig } from "../axis/types";
import type { DeliberateInput, DeliberateOutput } from "../deliberation/types";
import type { DeliberationStore } from "../deliberation/store-types";
import type { CalibrationResult } from "../model/calibration";
import type { PyreezEngine } from "../axis/engine";
import type { TaskClassification } from "../axis/types";

export interface PyreezMcpServerConfig {
  mcpServer: McpServer;
  registry: ModelRegistry;
  reporter: Reporter;
  summaryFn?: () => Promise<import("../report/types").ReportSummary>;
  deliberateFn?: (input: DeliberateInput) => Promise<DeliberateOutput>;
  deliberationStore?: DeliberationStore;
  runLogger?: RunLogger;
  engine: PyreezEngine;
  calibrateFn?: () => Promise<CalibrationResult>;
}

const DEFAULT_BUDGET: BudgetConfig = { perRequest: 1.0 };

/** Max characters for error messages returned to MCP clients. */
const MAX_ERROR_LENGTH = 500;

/**
 * Sanitize error messages before returning to MCP clients.
 * Strips file paths and truncates to prevent leaking internals.
 */
function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Strip absolute file paths (Unix/Windows)
  const cleaned = raw.replace(/(?:\/[\w.-]+){3,}/g, "[path]");
  if (cleaned.length <= MAX_ERROR_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_ERROR_LENGTH) + "…";
}

export class PyreezMcpServer {
  private readonly mcpServer: McpServer;
  private readonly registry: ModelRegistry;
  private readonly reporter: Reporter;
  private readonly summaryFn?: PyreezMcpServerConfig["summaryFn"];
  private readonly deliberateFn?: PyreezMcpServerConfig["deliberateFn"];
  private readonly deliberationStore?: DeliberationStore;
  private readonly runLogger?: RunLogger;
  private readonly engine: PyreezEngine;
  private readonly calibrateFn?: () => Promise<CalibrationResult>;

  constructor(config: PyreezMcpServerConfig) {
    if (!config.mcpServer) {
      throw new Error("mcpServer is required");
    }
    if (!config.registry) {
      throw new Error("registry is required");
    }
    if (!config.reporter) {
      throw new Error("reporter is required");
    }
    if (!config.engine) {
      throw new Error("engine is required");
    }

    this.mcpServer = config.mcpServer;
    this.registry = config.registry;
    this.reporter = config.reporter;
    this.summaryFn = config.summaryFn;
    this.deliberateFn = config.deliberateFn;
    this.deliberationStore = config.deliberationStore;
    this.runLogger = config.runLogger;
    this.engine = config.engine;
    this.calibrateFn = config.calibrateFn;

    this.registerTools();
  }

  private registerTools(): void {
    this.mcpServer.registerTool(
      "pyreez_route",
      {
        title: "Pyreez Route",
        description:
          "Route a task through PROFILE → SCORE → SELECT pipeline to find the optimal model. Host agent must provide classification.",
        inputSchema: z.object({
          task: z.string().max(100_000).describe("Task description to route"),
          budget: z
            .number()
            .optional()
            .describe("Max cost per request in USD (default: 1.0)"),
          domain: z
            .enum([
              "IDEATION", "PLANNING", "REQUIREMENTS", "ARCHITECTURE",
              "CODING", "TESTING", "REVIEW", "DOCUMENTATION",
              "DEBUGGING", "OPERATIONS", "RESEARCH", "COMMUNICATION",
            ])
            .describe(
              "Task domain. IDEATION=brainstorm/idea, PLANNING=goal/scope/priority, REQUIREMENTS=spec/acceptance, ARCHITECTURE=system design/data model, CODING=implement/refactor/optimize, TESTING=test write/strategy, REVIEW=code review/comparison/security, DOCUMENTATION=api doc/tutorial/diagram, DEBUGGING=error diagnosis/fix, OPERATIONS=deploy/ci-cd/setup, RESEARCH=tech research/benchmark, COMMUNICATION=explain/summarize/translate",
            ),
          task_type: z
            .enum([
              "BRAINSTORM", "ANALOGY", "CONSTRAINT_DISCOVERY", "OPTION_GENERATION", "FEASIBILITY_QUICK",
              "GOAL_DEFINITION", "SCOPE_DEFINITION", "PRIORITIZATION", "MILESTONE_PLANNING", "RISK_ASSESSMENT", "RESOURCE_ESTIMATION", "TRADEOFF_ANALYSIS",
              "REQUIREMENT_EXTRACTION", "REQUIREMENT_STRUCTURING", "AMBIGUITY_DETECTION", "COMPLETENESS_CHECK", "CONFLICT_DETECTION", "ACCEPTANCE_CRITERIA",
              "SYSTEM_DESIGN", "MODULE_DESIGN", "INTERFACE_DESIGN", "DATA_MODELING", "PATTERN_SELECTION", "DEPENDENCY_ANALYSIS", "MIGRATION_STRATEGY", "PERFORMANCE_DESIGN",
              "CODE_PLAN", "SCAFFOLD", "IMPLEMENT_FEATURE", "IMPLEMENT_ALGORITHM", "REFACTOR", "OPTIMIZE", "TYPE_DEFINITION", "ERROR_HANDLING", "INTEGRATION", "CONFIGURATION",
              "TEST_STRATEGY", "TEST_CASE_DESIGN", "UNIT_TEST_WRITE", "INTEGRATION_TEST_WRITE", "EDGE_CASE_DISCOVERY", "TEST_DATA_GENERATION", "COVERAGE_ANALYSIS",
              "CODE_REVIEW", "DESIGN_REVIEW", "SECURITY_REVIEW", "PERFORMANCE_REVIEW", "CRITIQUE", "COMPARISON", "STANDARDS_COMPLIANCE",
              "API_DOC", "TUTORIAL", "COMMENT_WRITE", "CHANGELOG", "DECISION_RECORD", "DIAGRAM",
              "ERROR_DIAGNOSIS", "LOG_ANALYSIS", "REPRODUCTION", "ROOT_CAUSE", "FIX_PROPOSAL", "FIX_IMPLEMENT", "REGRESSION_CHECK",
              "DEPLOY_PLAN", "CI_CD_CONFIG", "ENVIRONMENT_SETUP", "MONITORING_SETUP", "INCIDENT_RESPONSE",
              "TECH_RESEARCH", "BENCHMARK", "COMPATIBILITY_CHECK", "BEST_PRACTICE", "TREND_ANALYSIS",
              "SUMMARIZE", "EXPLAIN", "REPORT", "TRANSLATE", "QUESTION_ANSWER",
            ])
            .describe(
              "Specific task type within the domain.",
            ),
          complexity: z
            .enum(["simple", "moderate", "complex"])
            .describe(
              "Task complexity. simple=single focused task, moderate=multi-step or requires domain knowledge, complex=cross-cutting/architectural/multi-system",
            ),
          quality_weight: z
            .number()
            .optional()
            .describe("Override quality weight for this request (default: from config)"),
          cost_weight: z
            .number()
            .optional()
            .describe("Override cost weight for this request (default: from config)"),
        }),
      },
      async (args) => this.handleRoute(args),
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
            .max(200)
            .optional()
            .describe("Filter by model ID"),
          dimension: z
            .string()
            .max(100)
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
          model: z.string().max(200).optional().describe("Model ID used"),
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
            .max(200)
            .optional()
            .describe("Team identifier for team-level evaluation"),
          leader_id: z
            .string()
            .max(200)
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
          task: z.string().max(100_000).describe("Task to deliberate on"),
          domain: z
            .enum([
              "IDEATION", "PLANNING", "REQUIREMENTS", "ARCHITECTURE",
              "CODING", "TESTING", "REVIEW", "DOCUMENTATION",
              "DEBUGGING", "OPERATIONS", "RESEARCH", "COMMUNICATION",
            ])
            .optional()
            .describe("Task domain (required when auto_route=true)"),
          task_type: z
            .enum([
              "BRAINSTORM", "ANALOGY", "CONSTRAINT_DISCOVERY", "OPTION_GENERATION", "FEASIBILITY_QUICK",
              "GOAL_DEFINITION", "SCOPE_DEFINITION", "PRIORITIZATION", "MILESTONE_PLANNING", "RISK_ASSESSMENT", "RESOURCE_ESTIMATION", "TRADEOFF_ANALYSIS",
              "REQUIREMENT_EXTRACTION", "REQUIREMENT_STRUCTURING", "AMBIGUITY_DETECTION", "COMPLETENESS_CHECK", "CONFLICT_DETECTION", "ACCEPTANCE_CRITERIA",
              "SYSTEM_DESIGN", "MODULE_DESIGN", "INTERFACE_DESIGN", "DATA_MODELING", "PATTERN_SELECTION", "DEPENDENCY_ANALYSIS", "MIGRATION_STRATEGY", "PERFORMANCE_DESIGN",
              "CODE_PLAN", "SCAFFOLD", "IMPLEMENT_FEATURE", "IMPLEMENT_ALGORITHM", "REFACTOR", "OPTIMIZE", "TYPE_DEFINITION", "ERROR_HANDLING", "INTEGRATION", "CONFIGURATION",
              "TEST_STRATEGY", "TEST_CASE_DESIGN", "UNIT_TEST_WRITE", "INTEGRATION_TEST_WRITE", "EDGE_CASE_DISCOVERY", "TEST_DATA_GENERATION", "COVERAGE_ANALYSIS",
              "CODE_REVIEW", "DESIGN_REVIEW", "SECURITY_REVIEW", "PERFORMANCE_REVIEW", "CRITIQUE", "COMPARISON", "STANDARDS_COMPLIANCE",
              "API_DOC", "TUTORIAL", "COMMENT_WRITE", "CHANGELOG", "DECISION_RECORD", "DIAGRAM",
              "ERROR_DIAGNOSIS", "LOG_ANALYSIS", "REPRODUCTION", "ROOT_CAUSE", "FIX_PROPOSAL", "FIX_IMPLEMENT", "REGRESSION_CHECK",
              "DEPLOY_PLAN", "CI_CD_CONFIG", "ENVIRONMENT_SETUP", "MONITORING_SETUP", "INCIDENT_RESPONSE",
              "TECH_RESEARCH", "BENCHMARK", "COMPATIBILITY_CHECK", "BEST_PRACTICE", "TREND_ANALYSIS",
              "SUMMARIZE", "EXPLAIN", "REPORT", "TRANSLATE", "QUESTION_ANSWER",
            ])
            .optional()
            .describe("Specific task type within the domain (required when auto_route=true)."),
          complexity: z
            .enum(["simple", "moderate", "complex"])
            .optional()
            .describe("Task complexity (required when auto_route=true)"),
          budget: z
            .number()
            .optional()
            .describe("Max cost per request in USD (default: 1.0). Only used with auto_route."),
          auto_route: z
            .boolean()
            .optional()
            .describe("When true, use the pipeline (auto-selects models). Requires domain, task_type, complexity."),
          worker_instructions: z
            .string()
            .max(10_000)
            .optional()
            .describe("Optional instructions for the workers"),
          leader_instructions: z
            .string()
            .max(10_000)
            .optional()
            .describe("Optional instructions for the leader"),
          max_rounds: z
            .number()
            .optional()
            .describe("Maximum deliberation rounds (default: 1)"),
          consensus: z
            .enum(["leader_decides"])
            .optional()
            .describe("Consensus mode (default: fixed rounds)"),
          quality_weight: z
            .number()
            .optional()
            .describe("Override quality weight for model selection (default: from config)"),
          cost_weight: z
            .number()
            .optional()
            .describe("Override cost weight for model selection (default: from config)"),
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
    domain: string;
    task_type: string;
    complexity: string;
    quality_weight?: number;
    cost_weight?: number;
  }): Promise<CallToolResult> {
    return this.logRun("route", async () => {
    if (!args.task) {
      return this.errorResult("Error: task is required");
    }

    try {
      const budget: BudgetConfig = {
        perRequest: args.budget ?? DEFAULT_BUDGET.perRequest,
      };
      const classification: TaskClassification = {
        domain: args.domain,
        taskType: args.task_type,
        complexity: args.complexity as TaskClassification["complexity"],
        qualityWeight: args.quality_weight,
        costWeight: args.cost_weight,
      };
      const result = await this.engine.traceOnly(args.task, budget, classification);

      return this.textResult(JSON.stringify({
        classification,
        requirement: result.requirement,
        selection: {
          models: result.plan.models,
          strategy: result.plan.strategy,
          estimatedCost: result.plan.estimatedCost,
          reason: result.plan.reason,
        },
      }, null, 2));
    } catch (error) {
      return this.errorResult(
        `Error: ${sanitizeError(error)}`,
      );
    }
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
          const bt = raw as { mu: number; sigma: number };
          score = bt.mu;
          conf = Math.round(Math.max(0, 1 - bt.sigma / 350) * 100) / 100;
        } else {
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
          model: args.query_model,
          consensusReached: args.query_consensus,
          limit: args.query_limit,
        });
        return this.textResult(JSON.stringify(results, null, 2));
      } catch (error) {
        return this.errorResult(
          `Error: ${sanitizeError(error)}`,
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
          `Error: ${sanitizeError(error)}`,
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
        `Error: ${sanitizeError(error)}`,
      );
    }
    });
  }

  async handleDeliberate(args: {
    task: string;
    domain?: string;
    task_type?: string;
    complexity?: string;
    budget?: number;
    auto_route?: boolean;
    worker_instructions?: string;
    leader_instructions?: string;
    max_rounds?: number;
    consensus?: string;
    quality_weight?: number;
    cost_weight?: number;
  }): Promise<CallToolResult> {
    return this.logRun("deliberate", async () => {
    if (!args.task) {
      return this.errorResult("Error: task is required");
    }

    // auto_route: use the 3-stage pipeline
    if (args.auto_route) {
      if (!args.domain || !args.task_type || !args.complexity) {
        return this.errorResult(
          "Error: domain, task_type, and complexity are required when auto_route=true",
        );
      }
      try {
        const budget = { perRequest: args.budget ?? 1.0 };
        const classification: TaskClassification = {
          domain: args.domain,
          taskType: args.task_type,
          complexity: args.complexity as TaskClassification["complexity"],
          qualityWeight: args.quality_weight,
          costWeight: args.cost_weight,
        };
        const result = await this.engine.run(args.task, budget, classification);

        // Auto-save deliberation result to store (best-effort)
        if (this.deliberationStore) {
          try {
            await this.deliberationStore.save({
              id: crypto.randomUUID(),
              task: args.task,
              timestamp: Date.now(),
              consensusReached: result.consensusReached,
              roundsExecuted: result.roundsExecuted,
              result: result.result,
              modelsUsed: result.modelsUsed,
              totalLLMCalls: result.totalLLMCalls,
            });
          } catch {
            // best-effort save
          }
        }

        return this.textResult(JSON.stringify(result, null, 2));
      } catch (error) {
        return this.errorResult(
          `Error: ${sanitizeError(error)}`,
        );
      }
    }

    // Manual deliberation with deliberateFn
    if (!this.deliberateFn) {
      return this.errorResult("Error: deliberation not available");
    }

    try {
      const input: DeliberateInput = {
        task: args.task,
        workerInstructions: args.worker_instructions,
        leaderInstructions: args.leader_instructions,
        maxRounds: args.max_rounds,
        consensus: args.consensus === "leader_decides" ? "leader_decides" : undefined,
        qualityWeight: args.quality_weight,
        costWeight: args.cost_weight,
      };
      const result = await this.deliberateFn(input);
      return this.textResult(JSON.stringify(result, null, 2));
    } catch (error) {
      return this.errorResult(
        `Error: ${sanitizeError(error)}`,
      );
    }
    });
  }

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
          `Error: ${sanitizeError(error)}`,
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
