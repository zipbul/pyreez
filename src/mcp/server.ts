/**
 * PyreezMcpServer — MCP server exposing 6 infrastructure tools.
 *
 * Tools: pyreez_route, pyreez_scores, pyreez_report, pyreez_deliberate, pyreez_calibrate, pyreez_feedback
 * Architecture: pyreez = Infrastructure layer, Host = Orchestrator.
 *
 * Classification: host provides domain (required), task_type and complexity are auto-inferred if omitted.
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
import type { FileFeedbackStore } from "../report/feedback-store";

/** Domain → default task_type mapping. Used when host omits task_type. */
const DOMAIN_DEFAULTS: Record<string, string> = {
  CODING: "IMPLEMENT_FEATURE",
  DEBUGGING: "FIX_IMPLEMENT",
  TESTING: "UNIT_TEST_WRITE",
  REVIEW: "CODE_REVIEW",
  DOCUMENTATION: "API_DOC",
  ARCHITECTURE: "SYSTEM_DESIGN",
  PLANNING: "SCOPE_DEFINITION",
  REQUIREMENTS: "REQUIREMENT_EXTRACTION",
  IDEATION: "BRAINSTORM",
  OPERATIONS: "ENVIRONMENT_SETUP",
  RESEARCH: "TECH_RESEARCH",
  COMMUNICATION: "QUESTION_ANSWER",
};

/** Infer complexity from task description length when host omits it. */
function inferComplexity(task: string): "simple" | "moderate" | "complex" {
  if (task.length < 200) return "simple";
  if (task.length < 1000) return "moderate";
  return "complex";
}

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
  feedbackStore?: FileFeedbackStore;
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
  private readonly feedbackStore?: FileFeedbackStore;

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
    this.feedbackStore = config.feedbackStore;

    this.registerTools();
  }

  private registerTools(): void {
    this.mcpServer.registerTool(
      "pyreez_route",
      {
        title: "Pyreez Route",
        description:
          "Route a task through PROFILE → SCORE → SELECT pipeline to find the optimal model. Domain required, task_type and complexity auto-inferred if omitted.",
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
              "Task domain. Pick the closest: CODING=write/modify code, DEBUGGING=fix errors/bugs, TESTING=write/run tests, REVIEW=review/compare code, ARCHITECTURE=system design, DOCUMENTATION=docs/comments, PLANNING=scope/prioritize, REQUIREMENTS=specs/acceptance, IDEATION=brainstorm, OPERATIONS=deploy/CI/infra, RESEARCH=investigate/benchmark, COMMUNICATION=explain/summarize/translate",
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
            .optional()
            .describe(
              "Optional. Specific task type — omit if unsure, Pyreez will use a sensible default. Common: IMPLEMENT_FEATURE, FIX_IMPLEMENT, REFACTOR, UNIT_TEST_WRITE, CODE_REVIEW, EXPLAIN, SUMMARIZE, SYSTEM_DESIGN, ERROR_DIAGNOSIS",
            ),
          complexity: z
            .enum(["simple", "moderate", "complex"])
            .optional()
            .describe(
              "Optional. simple=single focused task, moderate=multi-step or domain knowledge, complex=cross-cutting/architectural. Defaults to moderate.",
            ),
          context: z
            .object({
              language: z.string().optional()
                .describe("Programming language if applicable (e.g. typescript, python)"),
              framework: z.string().optional()
                .describe("Framework if applicable (e.g. react, express, django)"),
            })
            .optional()
            .describe("Optional coding context the host already knows"),
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
          leader_contributes: z
            .boolean()
            .optional()
            .describe("When true (default), the leader also responds independently in the diverge phase before synthesizing. Ensures the strongest model's unanchored opinion is captured."),
          protocol: z
            .enum(["diverge-synth", "debate"])
            .optional()
            .describe("Deliberation protocol. 'debate' enables multi-round debate where workers see each other's responses."),
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

    this.mcpServer.registerTool(
      "pyreez_feedback",
      {
        title: "Pyreez Feedback",
        description:
          "Record feedback for a routing/deliberation session. Supports boolean, float, comment, and demonstration feedback types.",
        inputSchema: z.object({
          session_id: z
            .string()
            .optional()
            .describe("Session ID from pyreez_route or pyreez_deliberate response"),
          model: z
            .string()
            .max(200)
            .optional()
            .describe("Model ID to provide feedback for"),
          task_type: z
            .string()
            .optional()
            .describe("Task type for this feedback"),
          type: z
            .enum(["boolean", "float", "comment", "demonstration"])
            .describe("Feedback type: boolean (thumbs up/down), float (0.0-1.0 rating), comment (text), demonstration (corrected output)"),
          value: z
            .union([z.boolean(), z.number(), z.string()])
            .describe("Feedback value: boolean for thumbs, number for rating, string for comment/demonstration"),
        }),
      },
      async (args) => this.handleFeedback(args),
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
    task_type?: string;
    complexity?: string;
    context?: { language?: string; framework?: string };
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
      const taskType = args.task_type ?? DOMAIN_DEFAULTS[args.domain] ?? "QUESTION_ANSWER";
      const complexity = (args.complexity ?? inferComplexity(args.task)) as TaskClassification["complexity"];
      const method = args.task_type ? "host" : "default";

      // R-2: Derive criticality from complexity when not explicitly set
      const criticality = complexity === "complex" ? "high"
        : complexity === "simple" ? "low"
        : "medium";
      const classification: TaskClassification = {
        domain: args.domain,
        taskType,
        complexity,
        criticality,
        language: args.context?.language,
        qualityWeight: args.quality_weight,
        costWeight: args.cost_weight,
      };
      const result = await this.engine.traceOnly(args.task, budget, classification);

      return this.textResult(JSON.stringify({
        classification: { ...classification, method },
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
      // S-2: Warn when all models score 0 for the dimension (likely invalid dimension name)
      const allZero = scored.every((s) => s.score === 0 && s.confidence === 0);
      if (args.top != null) {
        scored = scored
          .sort((a, b) => b.score - a.score)
          .slice(0, Math.max(0, args.top));
      }
      if (allZero && models.length > 0) {
        return this.textResult(JSON.stringify({
          warning: `Dimension "${dim}" not found in any model. Valid dimensions include: REASONING, CODE_GENERATION, DEBUGGING, ANALYSIS, CREATIVITY, SYSTEM_THINKING, JUDGMENT, INSTRUCTION_FOLLOWING, etc.`,
          models: scored,
        }, null, 2));
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
      // P-1: Clamp quality to [0, 10] range
      const clampedQuality = Math.max(0, Math.min(10, args.quality));
      const record: CallRecord = {
        model: args.model,
        taskType: args.task_type,
        quality: clampedQuality,
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
    leader_contributes?: boolean;
    protocol?: string;
    quality_weight?: number;
    cost_weight?: number;
  }): Promise<CallToolResult> {
    return this.logRun("deliberate", async () => {
    if (!args.task) {
      return this.errorResult("Error: task is required");
    }

    // auto_route: use the 3-stage pipeline
    if (args.auto_route) {
      if (!args.domain) {
        return this.errorResult(
          "Error: domain is required when auto_route=true",
        );
      }
      try {
        const budget = { perRequest: args.budget ?? 1.0 };
        const taskType = args.task_type ?? DOMAIN_DEFAULTS[args.domain] ?? "QUESTION_ANSWER";
        const complexity = (args.complexity ?? inferComplexity(args.task)) as TaskClassification["complexity"];
        const criticality = complexity === "complex" ? "high"
          : complexity === "simple" ? "low"
          : "medium";
        const classification: TaskClassification = {
          domain: args.domain,
          taskType,
          complexity,
          criticality,
          qualityWeight: args.quality_weight,
          costWeight: args.cost_weight,
        };
        // D-2: Use runWithTrace to include routing info in response
        const traceResult = await this.engine.runWithTrace(args.task, budget, classification);
        const result = traceResult.result;

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

        // Include routing trace so caller sees which models were selected and why
        const response = {
          ...result,
          routing: {
            models: traceResult.plan.models,
            strategy: traceResult.plan.strategy,
            reason: traceResult.plan.reason,
          },
        };
        return this.textResult(JSON.stringify(response, null, 2));
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
      const validProtocol = args.protocol === "debate" ? "debate" : args.protocol === "diverge-synth" ? "diverge-synth" : undefined;
      const input: DeliberateInput = {
        task: args.task,
        workerInstructions: args.worker_instructions,
        leaderInstructions: args.leader_instructions,
        maxRounds: args.max_rounds,
        consensus: args.consensus === "leader_decides" ? "leader_decides" : undefined,
        leaderContributes: args.leader_contributes,
        protocol: validProtocol,
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
        // Summarize stale/converged arrays to reduce response size (C-1)
        const summary = {
          comparisonsProcessed: result.comparisonsProcessed,
          anomalies: result.anomalies,
          convergedCount: result.converged.length,
          convergedSample: result.converged.slice(0, 5),
          staleCount: result.stale.length,
          staleSample: result.stale.slice(0, 5),
        };
        return this.textResult(JSON.stringify(summary, null, 2));
      } catch (error) {
        return this.errorResult(
          `Error: ${sanitizeError(error)}`,
        );
      }
    });
  }

  async handleFeedback(args: {
    session_id?: string;
    model?: string;
    task_type?: string;
    type: string;
    value: boolean | number | string;
  }): Promise<CallToolResult> {
    return this.logRun("feedback", async () => {
      if (!this.feedbackStore) {
        return this.errorResult("Error: feedback store not available");
      }

      try {
        const feedbackId = crypto.randomUUID();
        const record = {
          id: feedbackId,
          timestamp: Date.now(),
          sessionId: args.session_id,
          modelId: args.model,
          taskType: args.task_type,
          type: args.type as "boolean" | "float" | "comment" | "demonstration",
          value: args.value,
        };

        await this.feedbackStore.record(record);

        // Convert boolean/float feedback to quality signal for BT calibration
        if (args.model && args.task_type && (args.type === "boolean" || args.type === "float")) {
          const quality =
            args.type === "boolean"
              ? (args.value ? 8 : 2)
              : (typeof args.value === "number" ? Math.min(10, Math.max(0, args.value * 10)) : 5);

          try {
            await this.reporter.record({
              model: args.model,
              taskType: args.task_type,
              quality,
              latencyMs: 0,
              tokens: { input: 0, output: 0 },
            });
          } catch {
            // Best-effort — don't fail the feedback recording
          }
        }

        return this.textResult(JSON.stringify({ recorded: true, feedbackId }));
      } catch (error) {
        return this.errorResult(`Error: ${sanitizeError(error)}`);
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
