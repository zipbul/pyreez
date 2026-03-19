/**
 * PyreezMcpServer — MCP server exposing infrastructure tools.
 *
 * Tools: pyreez_deliberate, pyreez_acceptance, pyreez_feedback
 * Architecture: pyreez = Infrastructure layer, Host = Orchestrator + Synthesizer.
 *
 * Classification: host provides domain (required), task_type and complexity are auto-inferred if omitted.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { ModelRegistry } from "../model/registry";

import type { RunLogger } from "../report/run-logger";
import type { DeliberateInput, DeliberateOutput } from "../deliberation/types";
import type { DeliberationStore } from "../deliberation/store-types";
import { resolveTaskNature, shouldAutoDebate } from "../deliberation/task-nature";
import { NoModelsAvailableError } from "../deliberation/team-composer";
import { buildAcceptanceMessages } from "../deliberation/prompts";
import type { GenerationParams } from "../deliberation/types";

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
  /** @deprecated Stored in wire deps. Kept for backwards compatibility with index.ts. */
  deliberationStore?: DeliberationStore;
  runLogger?: RunLogger;
  /** Chat function for acceptance rounds. When omitted, pyreez_acceptance is unavailable. */
  chatFn?: (model: string, messages: import("../llm/types").ChatMessage[], params?: GenerationParams) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;
  /** SkillCell store for binary dimension feedback. */
  skillCellStore?: import("../model/skillcell-store").SkillCellStore;
}


/** Max characters for error messages returned to MCP clients. */
const MAX_ERROR_LENGTH = 500;

/**
 * Sanitize error messages before returning to MCP clients.
 * Strips file paths and truncates to prevent leaking internals.
 */
function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = raw.replace(/(?:\/[\w.-]+){3,}/g, "[path]");
  if (cleaned.length <= MAX_ERROR_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_ERROR_LENGTH) + "…";
}

export class PyreezMcpServer {
  private readonly mcpServer: McpServer;
  private readonly deliberateFn?: PyreezMcpServerConfig["deliberateFn"];
  private readonly runLogger?: RunLogger;
  private readonly chatFn?: PyreezMcpServerConfig["chatFn"];
  private readonly skillCellStore?: import("../model/skillcell-store").SkillCellStore;

  constructor(config: PyreezMcpServerConfig) {
    if (!config.mcpServer) {
      throw new Error("mcpServer is required");
    }
    if (!config.registry) {
      throw new Error("registry is required");
    }
    this.mcpServer = config.mcpServer;
    this.deliberateFn = config.deliberateFn;
    this.runLogger = config.runLogger;
    this.chatFn = config.chatFn;
    this.skillCellStore = config.skillCellStore;

    this.registerTools();
  }

  private registerTools(): void {
    this.mcpServer.registerTool(
      "pyreez_deliberate",
      {
        title: "Pyreez Deliberate",
        description:
          "Run multi-model deliberation on a task. Workers respond independently; host synthesizes. Submit task and instructions in English.",
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
          max_rounds: z
            .number()
            .optional()
            .describe("Maximum deliberation rounds (default: 1)"),
          models: z
            .array(z.string())
            .optional()
            .describe("Explicit model IDs to use as workers. Bypasses auto team composition."),
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
      "pyreez_acceptance",
      {
        title: "Pyreez Acceptance",
        description:
          "Verify a host synthesis by having workers check if their positions were accurately represented. Call after synthesizing worker outputs.",
        inputSchema: z.object({
          task: z.string().max(100_000).describe("Original task that was deliberated"),
          synthesis: z.string().max(100_000).describe("Host's synthesis to verify"),
          workers: z
            .array(z.object({
              model: z.string().describe("Model ID of the worker"),
              original_position: z.string().max(50_000).describe("Worker's original position/response to verify against"),
            }))
            .min(1)
            .describe("Workers whose positions should be verified against the synthesis"),
        }),
      },
      async (args) => this.handleAcceptance(args),
    );

    this.mcpServer.registerTool(
      "pyreez_feedback",
      {
        title: "Pyreez Feedback",
        description:
          "Submit per-model binary evaluations to update SkillCell scores. Call after deliberation to improve future model selection.",
        inputSchema: z.object({
          evaluations: z
            .array(z.object({
              model_id: z.string().describe("Model ID being evaluated"),
              domain: z.string().describe("Task domain"),
              task_type: z.string().describe("Task type"),
              dimensions: z.object({
                factually_correct: z.boolean(),
                addresses_task: z.boolean(),
                provides_evidence: z.boolean(),
                novel_perspective: z.boolean(),
                internally_consistent: z.boolean(),
              }).describe("Binary pass/fail per dimension"),
              failures: z.object({
                hallucination: z.boolean(),
                refusal: z.boolean(),
                off_topic: z.boolean(),
                degenerate: z.boolean(),
              }).describe("Critical failure flags"),
            }))
            .min(1)
            .describe("Per-model binary evaluations for SkillCell update"),
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

  async handleDeliberate(args: {
    task: string;
    domain?: string;
    task_type?: string;
    complexity?: string;
    budget?: number;
    auto_route?: boolean;
    worker_instructions?: string;
    max_rounds?: number;
    models?: string[];
    protocol?: string;
    quality_weight?: number;
    cost_weight?: number;
  }): Promise<CallToolResult> {
    return this.logRun("deliberate", async () => {
    if (!args.task) {
      return this.errorResult("Error: task is required");
    }

    // auto_route: resolve classification, then route through deliberateFn (Thompson Sampling)
    if (args.auto_route && !args.models?.length) {
      if (!args.domain) {
        return this.errorResult(
          "Error: domain is required when auto_route=true",
        );
      }
      if (!this.deliberateFn) {
        return this.errorResult("Error: deliberation not available");
      }

      try {
        const taskType = args.task_type ?? DOMAIN_DEFAULTS[args.domain] ?? "QUESTION_ANSWER";
        const userProtocol = args.protocol === "debate" ? "debate" as const : args.protocol === "diverge-synth" ? "diverge-synth" as const : undefined;
        const taskNature = resolveTaskNature(args.domain, taskType);
        const complexity = (args.complexity ?? inferComplexity(args.task)) as string;
        const autoDebate = !userProtocol && shouldAutoDebate(args.domain, taskType, complexity);
        const effectiveProtocol = userProtocol ?? (autoDebate ? "debate" as const : undefined);

        const input: DeliberateInput = {
          task: args.task,
          workerInstructions: args.worker_instructions,
          maxRounds: args.max_rounds,
          protocol: effectiveProtocol,
          qualityWeight: args.quality_weight,
          costWeight: args.cost_weight,
          taskNature: taskNature ?? undefined,
          domain: args.domain,
          taskType,
        };

        const result = await this.deliberateFn(input);
        const response = {
          ...result,
          next_required_action: { tool: "pyreez_acceptance", reason: "After synthesizing, verify synthesis represents worker positions before presenting to user" },
          synthesis_checklist: {
            comprehend: "Fill unique_contribution, most_unexpected_claim, loss_if_removed for each worker",
            evaluate: "Label every factual claim with [x] fact / [ ] unverified. Amplify creative proposals.",
            reflect: "Fill Uncertainty, Dismissed, Counterargument — each with a concrete change to the synthesis",
          },
        };
        return this.textResult(JSON.stringify(response, null, 2));
      } catch (error) {
        if (error instanceof NoModelsAvailableError) {
          return this.errorResult(JSON.stringify({
            error: error.message,
            code: error.code,
            remediation: error.remediation,
          }));
        }
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
      const manualUserProtocol = args.protocol === "debate" ? "debate" as const : args.protocol === "diverge-synth" ? "diverge-synth" as const : undefined;
      const manualTaskNature = args.domain ? resolveTaskNature(args.domain, args.task_type) : undefined;
      const manualComplexity = (args.complexity ?? inferComplexity(args.task)) as string;
      const manualAutoDebate = !manualUserProtocol && args.domain && shouldAutoDebate(args.domain, args.task_type, manualComplexity);
      const manualEffectiveProtocol = manualUserProtocol ?? (manualAutoDebate ? "debate" as const : undefined);
      const input: DeliberateInput = {
        task: args.task,
        workerInstructions: args.worker_instructions,
        maxRounds: args.max_rounds,
        protocol: manualEffectiveProtocol,
        qualityWeight: args.quality_weight,
        costWeight: args.cost_weight,
        ...(args.models?.length ? { models: args.models } : {}),
        ...(manualTaskNature ? { taskNature: manualTaskNature } : {}),
        ...(args.domain ? { domain: args.domain } : {}),
        ...(args.task_type ? { taskType: args.task_type } : {}),
      };
      const result = await this.deliberateFn(input);
      const manualResponse = {
        ...result,
        next_required_action: { tool: "pyreez_acceptance", reason: "After synthesizing, verify synthesis represents worker positions before presenting to user" },
        synthesis_checklist: {
          comprehend: "Fill unique_contribution, most_unexpected_claim, loss_if_removed for each worker",
          evaluate: "Label every factual claim with [x] fact / [ ] unverified. Amplify creative proposals.",
          reflect: "Fill Uncertainty, Dismissed, Counterargument — each with a concrete change to the synthesis",
        },
      };
      return this.textResult(JSON.stringify(manualResponse, null, 2));
    } catch (error) {
      if (error instanceof NoModelsAvailableError) {
        return this.errorResult(JSON.stringify({
          error: error.message,
          code: error.code,
          remediation: error.remediation,
        }));
      }
      return this.errorResult(
        `Error: ${sanitizeError(error)}`,
      );
    }
    });
  }

  async handleAcceptance(args: {
    task: string;
    synthesis: string;
    workers: { model: string; original_position: string }[];
  }): Promise<CallToolResult> {
    return this.logRun("acceptance", async () => {
    if (!args.task) {
      return this.errorResult("Error: task is required");
    }
    if (!args.synthesis) {
      return this.errorResult("Error: synthesis is required");
    }
    if (!args.workers?.length) {
      return this.errorResult("Error: at least one worker is required");
    }
    if (!this.chatFn) {
      return this.errorResult("Error: acceptance not available (no chatFn configured)");
    }

    try {
      let totalInput = 0;
      let totalOutput = 0;

      const workerPromises = args.workers.map(async (w) => {
        const messages = buildAcceptanceMessages(args.synthesis, w.original_position, args.task);
        const result = await this.chatFn!(w.model, messages, { temperature: 0, max_tokens: 512 });
        totalInput += result.inputTokens;
        totalOutput += result.outputTokens;

        // Parse XML response
        const verdict = result.content.match(/<verdict>([\s\S]*?)<\/verdict>/)?.[1]?.trim() ?? "accept";
        const misrepresented = result.content.match(/<misrepresented>([\s\S]*?)<\/misrepresented>/)?.[1]?.trim();
        const unresolved = result.content.match(/<unresolved>([\s\S]*?)<\/unresolved>/)?.[1]?.trim();

        return {
          model: w.model,
          verdict: verdict === "reject" ? "reject" as const : "accept" as const,
          ...(misrepresented && misrepresented !== "None." ? { misrepresented } : {}),
          ...(unresolved && unresolved !== "None." ? { unresolved } : {}),
        };
      });

      const results = await Promise.allSettled(workerPromises);
      const workers = results
        .filter((r): r is PromiseFulfilledResult<{ model: string; verdict: "accept" | "reject"; misrepresented?: string; unresolved?: string }> => r.status === "fulfilled")
        .map((r) => r.value);

      const failed = results.filter((r) => r.status === "rejected");
      if (workers.length === 0 && failed.length > 0) {
        return this.errorResult(JSON.stringify({
          error: `All ${failed.length} acceptance check(s) failed`,
          failedModels: args.workers.map((w) => w.model),
        }));
      }

      return this.textResult(JSON.stringify({
        workers,
        totalTokens: { input: totalInput, output: totalOutput },
        next_required_action: { tool: "pyreez_feedback", reason: "Submit per-model evaluations to update SkillCell scores. Without feedback, team selection degrades." },
      }, null, 2));
    } catch (error) {
      return this.errorResult(`Error: ${sanitizeError(error)}`);
    }
    });
  }

  async handleFeedback(args: {
    evaluations?: {
      model_id: string; domain: string; task_type: string;
      dimensions: { factually_correct: boolean; addresses_task: boolean; provides_evidence: boolean; novel_perspective: boolean; internally_consistent: boolean };
      failures: { hallucination: boolean; refusal: boolean; off_topic: boolean; degenerate: boolean };
    }[];
  }): Promise<CallToolResult> {
    return this.logRun("feedback", async () => {
    if (!this.skillCellStore) {
      return this.errorResult("Error: feedback not available (no skillCellStore configured)");
    }
    if (!args.evaluations?.length) {
      return this.errorResult("Error: at least one evaluation is required");
    }

    try {
      let updated = 0;
      for (const ev of args.evaluations) {
        this.skillCellStore.update({
          deliberation_id: crypto.randomUUID(),
          model_id: ev.model_id,
          domain: ev.domain,
          task_type: ev.task_type,
          evaluator_id: "host",
          dimensions: ev.dimensions,
          failures: ev.failures,
          timestamp: Date.now(),
        });
        updated++;
      }
      await this.skillCellStore.save();

      const models = new Set<string>();
      for (const ev of args.evaluations) {
        models.add(ev.model_id);
      }

      return this.textResult(JSON.stringify({
        updated,
        models: [...models],
      }, null, 2));
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
