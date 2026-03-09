/**
 * PyreezMcpServer — MCP server exposing 3 infrastructure tools.
 *
 * Tools: pyreez_route, pyreez_scores, pyreez_deliberate
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
import type { RunLogger } from "../report/run-logger";
import type { BudgetConfig } from "../axis/types";
import type { DeliberateInput, DeliberateOutput } from "../deliberation/types";
import type { DeliberationStore } from "../deliberation/store-types";
import type { PyreezEngine } from "../axis/engine";
import type { TaskClassification } from "../axis/types";
import { resolveTaskNature } from "../deliberation/task-nature";

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
  deliberateFn?: (input: DeliberateInput) => Promise<DeliberateOutput>;
  deliberationStore?: DeliberationStore;
  runLogger?: RunLogger;
  engine: PyreezEngine;
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
  private readonly deliberateFn?: PyreezMcpServerConfig["deliberateFn"];
  private readonly deliberationStore?: DeliberationStore;
  private readonly runLogger?: RunLogger;
  private readonly engine: PyreezEngine;

  constructor(config: PyreezMcpServerConfig) {
    if (!config.mcpServer) {
      throw new Error("mcpServer is required");
    }
    if (!config.registry) {
      throw new Error("registry is required");
    }
    if (!config.engine) {
      throw new Error("engine is required");
    }

    this.mcpServer = config.mcpServer;
    this.registry = config.registry;
    this.deliberateFn = config.deliberateFn;
    this.deliberationStore = config.deliberationStore;
    this.runLogger = config.runLogger;
    this.engine = config.engine;

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
            .describe("When true, the leader also responds independently in the diverge phase before synthesizing. Ensures the strongest model's unanchored opinion is captured."),
          models: z
            .array(z.string())
            .optional()
            .describe("Explicit model IDs to use. First N-1 are workers, last is leader. Bypasses auto team composition."),
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
    models?: string[];
    protocol?: string;
    quality_weight?: number;
    cost_weight?: number;
  }): Promise<CallToolResult> {
    return this.logRun("deliberate", async () => {
    if (!args.task) {
      return this.errorResult("Error: task is required");
    }

    // Explicit models bypass auto_route — always use manual deliberateFn path
    if (args.auto_route && !args.models?.length) {
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
        // Build deliberation overrides from user params
        const validProtocol = args.protocol === "debate" ? "debate" as const : args.protocol === "diverge-synth" ? "diverge-synth" as const : undefined;
        const taskNature = resolveTaskNature(args.domain, taskType);
        const hasOverrides = validProtocol != null || args.max_rounds != null || args.consensus != null || args.leader_contributes != null || args.worker_instructions != null || args.leader_instructions != null || taskNature != null;
        const deliberationOverrides = hasOverrides ? {
          protocol: validProtocol,
          maxRounds: args.max_rounds,
          consensus: args.consensus === "leader_decides" ? "leader_decides" as const : undefined,
          leaderContributes: args.leader_contributes,
          workerInstructions: args.worker_instructions,
          leaderInstructions: args.leader_instructions,
          taskNature,
        } : undefined;

        // D-2: Use runWithTrace to include routing info in response
        const traceResult = await this.engine.runWithTrace(args.task, budget, classification, deliberationOverrides);
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
              totalTokens: result.totalTokens,
              protocol: result.protocol as "diverge-synth" | "debate" | undefined,
              consensus: deliberationOverrides?.consensus,
              workerInstructions: args.worker_instructions,
              leaderInstructions: args.leader_instructions,
              ...(result.rounds ? { roundsSummary: result.rounds } : {}),
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
      const manualTaskNature = args.domain ? resolveTaskNature(args.domain, args.task_type) : undefined;
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
        ...(args.models?.length ? { models: args.models } : {}),
        ...(manualTaskNature ? { taskNature: manualTaskNature } : {}),
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
