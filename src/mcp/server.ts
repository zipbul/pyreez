/**
 * PyreezMcpServer — MCP server exposing infrastructure tools.
 *
 * Tools: pyreez_scores, pyreez_deliberate, pyreez_acceptance, pyreez_feedback
 * Architecture: pyreez = Infrastructure layer, Host = Orchestrator + Synthesizer.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { ModelRegistry } from "../model/registry";

import type { RunLogger } from "../report/run-logger";
import type { DeliberateInput, DeliberateOutput } from "../deliberation/types";
import { resolveTaskNature } from "../deliberation/task-nature";
import { NoModelsAvailableError } from "../deliberation/team-composer";
import { TeamDegradedError } from "../deliberation/engine";
import { buildAcceptanceMessages } from "../deliberation/prompts";
import type { GenerationParams } from "../deliberation/types";
import { BINARY_DIMENSIONS, getDomainWeights } from "../axis/types";

export interface PyreezMcpServerConfig {
  mcpServer: McpServer;
  registry: ModelRegistry;
  deliberateFn?: (input: DeliberateInput) => Promise<DeliberateOutput>;
  runLogger?: RunLogger;
  /** Chat function for acceptance rounds. When omitted, pyreez_acceptance is unavailable. */
  chatFn?: (model: string, messages: import("../llm/types").ChatMessage[], params?: GenerationParams) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;
  /** SkillCell store for binary dimension feedback and scores. */
  skillCellStore?: import("../model/skillcell-store").SkillCellStore;
  /** Filtered registry (only models with configured providers). */
  filteredRegistry?: {
    getAll(): import("../model/types").ModelInfo[];
    getAvailable(): import("../model/types").ModelInfo[];
    getById(id: string): import("../model/types").ModelInfo | undefined;
  };
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
  private readonly filteredRegistry?: PyreezMcpServerConfig["filteredRegistry"];

  // -- Model anonymization --
  private anonToReal = new Map<string, string>();
  private realToAnon = new Map<string, string>();
  private providerRealToAnon = new Map<string, string>();
  private nextAnonIndex = 0;
  private nextProviderIndex = 0;

  /** Get or create anonymous ID for a model. */
  private anonymizeModel(realId: string): string {
    let anon = this.realToAnon.get(realId);
    if (!anon) {
      const i = this.nextAnonIndex++;
      // A-Z, then AA, AB, ...
      anon = i < 26
        ? String.fromCharCode(65 + i)
        : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
      this.anonToReal.set(anon, realId);
      this.realToAnon.set(realId, anon);
    }
    return anon;
  }

  /** Resolve anonymous ID to real model ID. Returns undefined if not found. */
  private resolveModel(anonId: string): string | undefined {
    return this.anonToReal.get(anonId);
  }

  /** Get or create anonymous provider label. */
  private anonymizeProvider(realProvider: string): string {
    let anon = this.providerRealToAnon.get(realProvider);
    if (!anon) {
      anon = `P${++this.nextProviderIndex}`;
      this.providerRealToAnon.set(realProvider, anon);
    }
    return anon;
  }

  /** Replace all known real model IDs and provider names in text with anonymous equivalents. */
  private anonymizeText(text: string): string {
    let result = text;
    for (const [real, anon] of this.realToAnon) {
      result = result.replaceAll(real, anon);
    }
    for (const [real, anon] of this.providerRealToAnon) {
      result = result.replaceAll(real, anon);
    }
    return result;
  }

  /** Reset all anonymization state (called on new scores request). */
  private resetAnonymization(): void {
    this.anonToReal.clear();
    this.realToAnon.clear();
    this.providerRealToAnon.clear();
    this.nextAnonIndex = 0;
    this.nextProviderIndex = 0;
  }

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
    this.filteredRegistry = config.filteredRegistry;

    this.registerTools();
  }

  private registerTools(): void {
    this.mcpServer.registerTool(
      "pyreez_scores",
      {
        title: "Pyreez Scores",
        description:
          "Get model scores for a domain. Returns scored models (with SkillCell data) and unscored models (no data yet). Use this to choose models before calling pyreez_deliberate.",
        inputSchema: z.object({
          domain: z
            .enum([
              "IDEATION", "PLANNING", "REQUIREMENTS", "ARCHITECTURE",
              "CODING", "TESTING", "REVIEW", "DOCUMENTATION",
              "DEBUGGING", "OPERATIONS", "RESEARCH", "COMMUNICATION",
            ])
            .describe("Task domain"),
          task_type: z
            .string()
            .optional()
            .describe("Specific task type within the domain"),
          min_score: z
            .number()
            .optional()
            .describe("Minimum score filter. If no models above threshold, includes closest below."),
        }),
      },
      async (args) => this.handleScores(args),
    );

    this.mcpServer.registerTool(
      "pyreez_deliberate",
      {
        title: "Pyreez Deliberate",
        description:
          "Run multi-model deliberation on a task. Workers respond independently; host synthesizes. Submit task and instructions in English.",
        inputSchema: z.object({
          task: z.string().max(100_000).describe("Task to deliberate on"),
          models: z
            .array(z.string())
            .min(1)
            .describe("Model IDs to use as workers (priority order). Use pyreez_scores to choose."),
          count: z
            .number()
            .optional()
            .describe("Number of workers (default: models.length, max: 7). If count > models.length, models are duplicated round-robin."),
          domain: z
            .enum([
              "IDEATION", "PLANNING", "REQUIREMENTS", "ARCHITECTURE",
              "CODING", "TESTING", "REVIEW", "DOCUMENTATION",
              "DEBUGGING", "OPERATIONS", "RESEARCH", "COMMUNICATION",
            ])
            .optional()
            .describe("Task domain for evaluation"),
          task_type: z
            .string()
            .optional()
            .describe("Specific task type within the domain"),
          worker_instructions: z
            .string()
            .max(10_000)
            .optional()
            .describe("Optional instructions for the workers"),
          max_rounds: z
            .number()
            .optional()
            .describe("Maximum deliberation rounds (default: 1)"),
          protocol: z
            .enum(["diverge-synth", "debate"])
            .optional()
            .describe("Deliberation protocol. 'debate' enables multi-round debate where workers see each other's responses."),
          technique: z
            .union([
              z.enum(["challenge", "defend", "accept", "probe", "propose", "extend", "transform"]),
              z.array(z.enum(["challenge", "defend", "accept", "probe", "propose", "extend", "transform"])),
            ])
            .optional()
            .describe("Interaction technique. Single value for all rounds, or array for per-round. Emphasis, not constraint."),
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

  async handleScores(args: {
    domain: string;
    task_type?: string;
    min_score?: number;
  }): Promise<CallToolResult> {
    return this.logRun("scores", async () => {
      const reg = this.filteredRegistry;
      if (!reg) {
        return this.errorResult("Error: registry not available");
      }

      // New scores request = new deliberation session
      this.resetAnonymization();

      const available = reg.getAvailable();
      const weights = getDomainWeights(args.domain);
      const taskType = args.task_type;

      type ScoredModel = {
        id: string;
        provider: string;
        cost: { inputPer1M: number; outputPer1M: number };
        score: number;
        observations: number;
        dimensions: Record<string, number>;
      };

      type UnscoredModel = {
        id: string;
        provider: string;
        cost: { inputPer1M: number; outputPer1M: number };
      };

      const scored: ScoredModel[] = [];
      const unscored: UnscoredModel[] = [];

      for (const model of available) {
        const cell = this.skillCellStore && taskType
          ? this.skillCellStore.get(model.id, args.domain, taskType)
          : undefined;

        // Also check domain-level cells (any taskType) if no specific cell
        const domainCells = !cell && this.skillCellStore
          ? this.skillCellStore.getForDomain(model.id, args.domain)
          : [];

        if (cell) {
          // Exact cell: use directly
          let score = 0;
          const dimensions: Record<string, number> = {};
          for (const dim of BINARY_DIMENSIONS) {
            const params = cell.dimensions[dim];
            const mean = params ? params.alpha / (params.alpha + params.beta) : 0.5;
            const w = weights[dim] ?? 0.20;
            score += w * mean;
            dimensions[dim] = Number(mean.toFixed(2));
          }
          scored.push({
            id: model.id,
            provider: model.provider,
            cost: model.cost,
            score: Number(score.toFixed(2)),
            observations: cell.total,
            dimensions,
          });
        } else if (domainCells.length > 0) {
          // Aggregate across all domain cells: pool alpha/beta
          let score = 0;
          let totalObs = 0;
          const dimensions: Record<string, number> = {};
          for (const dim of BINARY_DIMENSIONS) {
            let alpha = 1, beta = 1;
            for (const dc of domainCells) {
              const p = dc.dimensions[dim];
              if (p) { alpha += p.alpha - 1; beta += p.beta - 1; }
            }
            const mean = alpha / (alpha + beta);
            const w = weights[dim] ?? 0.20;
            score += w * mean;
            dimensions[dim] = Number(mean.toFixed(2));
          }
          for (const dc of domainCells) totalObs += dc.total;
          scored.push({
            id: model.id,
            provider: model.provider,
            cost: model.cost,
            score: Number(score.toFixed(2)),
            observations: totalObs,
            dimensions,
          });
        } else {
          unscored.push({
            id: model.id,
            provider: model.provider,
            cost: model.cost,
          });
        }
      }

      // Sort scored by score descending
      scored.sort((a, b) => b.score - a.score);

      // Sort unscored by cost descending (cheapest last)
      unscored.sort((a, b) => b.cost.outputPer1M - a.cost.outputPer1M);

      // Apply min_score filter: keep only models above threshold.
      // If none above, include the single closest model below.
      let filteredScored = scored;
      let note: string | undefined;
      if (args.min_score !== undefined && scored.length > 0) {
        const above = scored.filter((m) => m.score >= args.min_score!);
        if (above.length > 0) {
          filteredScored = above;
        } else {
          // scored is already sorted descending — first element is closest to threshold
          filteredScored = [scored[0]!];
          note = `no models above ${args.min_score}, showing closest`;
        }
      }

      // trial_recommended: unscored, cost descending, max 3
      const trialRecommended = unscored.slice(0, 3).map((m) => m.id);

      // Anonymize all model IDs and providers
      const anonScored = filteredScored.map((m) => ({
        ...m,
        id: this.anonymizeModel(m.id),
        provider: this.anonymizeProvider(m.provider),
      }));
      const anonUnscored = unscored.map((m) => ({
        ...m,
        id: this.anonymizeModel(m.id),
        provider: this.anonymizeProvider(m.provider),
      }));
      const anonTrial = trialRecommended.map((id) => this.anonymizeModel(id));

      return this.textResult(JSON.stringify({
        scored: anonScored,
        unscored: anonUnscored,
        trial_recommended: anonTrial,
        ...(note ? { note } : {}),
      }, null, 2));
    });
  }

  async handleDeliberate(args: {
    task: string;
    models: string[];
    count?: number;
    domain?: string;
    task_type?: string;
    worker_instructions?: string;
    max_rounds?: number;
    protocol?: string;
    technique?: string | string[];
  }): Promise<CallToolResult> {
    return this.logRun("deliberate", async () => {
    if (!args.task) {
      return this.errorResult("Error: task is required");
    }
    if (!args.models?.length) {
      return this.errorResult("Error: models is required (min 1). Use pyreez_scores to choose models.");
    }

    if (!this.deliberateFn) {
      return this.errorResult("Error: deliberation not available");
    }

    try {
      // Resolve anonymous model IDs to real ones
      const resolvedModels = args.models.map((id) => this.resolveModel(id) ?? id);

      const userProtocol = args.protocol === "debate" ? "debate" as const : args.protocol === "diverge-synth" ? "diverge-synth" as const : undefined;
      const taskNature = args.domain ? resolveTaskNature(args.domain, args.task_type) : undefined;

      const input: DeliberateInput = {
        task: args.task,
        models: resolvedModels,
        count: args.count,
        workerInstructions: args.worker_instructions,
        maxRounds: args.max_rounds,
        protocol: userProtocol,
        ...(taskNature ? { taskNature } : {}),
        ...(args.domain ? { domain: args.domain } : {}),
        ...(args.task_type ? { taskType: args.task_type } : {}),
        ...(args.technique ? { technique: args.technique as DeliberateInput["technique"] } : {}),
      };

      const result = await this.deliberateFn(input);

      // Anonymize all model IDs in output
      const anonResult = {
        ...result,
        modelsUsed: result.modelsUsed.map((id) => this.anonymizeModel(id)),
        ...(result.rounds ? {
          rounds: result.rounds.map((r) => ({
            ...r,
            ...(r.responses ? {
              responses: r.responses.map((resp) => ({
                ...resp,
                model: this.anonymizeModel(resp.model),
              })),
            } : {}),
            ...(r.failedWorkers ? {
              failedWorkers: r.failedWorkers.map((fw) => ({
                ...fw,
                model: this.anonymizeModel(fw.model),
              })),
            } : {}),
          })),
        } : {}),
        ...(result.modelSwaps ? {
          modelSwaps: result.modelSwaps.map((s) => ({
            original: this.anonymizeModel(s.original),
            swapped: !!s.replacement,
            round: s.round,
            error: s.error,
            ...(s.errorCode ? { errorCode: s.errorCode } : {}),
            ...(s.retryable !== undefined ? { retryable: s.retryable } : {}),
          })),
        } : {}),
        ...(result.degradation ? {
          degradation: {
            ...result.degradation,
            lostSlots: result.degradation.lostSlots.map((ls) => ({
              ...ls,
              model: this.anonymizeModel(ls.model),
            })),
          },
        } : {}),
        next_required_action: { tool: "pyreez_acceptance", reason: "After synthesizing, verify synthesis represents worker positions before presenting to user" },
        synthesis_checklist: {
          comprehend: "Fill unique_contribution, most_unexpected_claim, loss_if_removed for each worker",
          evaluate: "Label every factual claim with [x] fact / [ ] unverified. Amplify creative proposals.",
          reflect: "Fill Uncertainty, Dismissed, Counterargument — each with a concrete change to the synthesis",
        },
      };
      return this.textResult(JSON.stringify(anonResult, null, 2));
    } catch (error) {
      if (error instanceof NoModelsAvailableError) {
        return this.errorResult(JSON.stringify({
          error: this.anonymizeText(error.message),
          code: error.code,
          remediation: error.remediation?.map((r: string) => this.anonymizeText(r)),
        }));
      }
      if (error instanceof TeamDegradedError) {
        return this.errorResult(JSON.stringify({
          error: this.anonymizeText(error.message),
          lostSlots: error.lostSlots.map((ls) => ({
            ...ls,
            model: this.anonymizeModel(ls.model),
          })),
          ...(error.modelSwaps ? {
            modelSwaps: error.modelSwaps.map((s) => ({
              original: this.anonymizeModel(s.original),
              swapped: !!s.replacement,
              round: s.round,
              error: s.error,
              ...(s.errorCode ? { errorCode: s.errorCode } : {}),
              ...(s.retryable !== undefined ? { retryable: s.retryable } : {}),
            })),
          } : {}),
          tokensConsumed: error.tokensConsumed,
        }));
      }
      return this.errorResult(
        `Error: ${this.anonymizeText(sanitizeError(error))}`,
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
        // Resolve anonymous model ID to real one for API routing
        const realModel = this.resolveModel(w.model) ?? w.model;
        const messages = buildAcceptanceMessages(args.synthesis, w.original_position, args.task);
        const result = await this.chatFn!(realModel, messages, { temperature: 0 });
        totalInput += result.inputTokens;
        totalOutput += result.outputTokens;

        // Parse XML response
        const verdict = result.content.match(/<verdict>([\s\S]*?)<\/verdict>/)?.[1]?.trim()?.toLowerCase() ?? "accept";
        const misrepresented = result.content.match(/<misrepresented>([\s\S]*?)<\/misrepresented>/)?.[1]?.trim();
        const unresolved = result.content.match(/<unresolved>([\s\S]*?)<\/unresolved>/)?.[1]?.trim();

        const parsedVerdict = verdict === "reject" ? "reject" as const
          : verdict === "partial" ? "partial" as const
          : "accept" as const;

        return {
          model: this.anonymizeModel(realModel),
          verdict: parsedVerdict,
          ...(misrepresented && misrepresented !== "None." ? { misrepresented } : {}),
          ...(unresolved && unresolved !== "None." ? { unresolved } : {}),
        };
      });

      const results = await Promise.allSettled(workerPromises);
      const workers = results
        .filter((r): r is PromiseFulfilledResult<{ model: string; verdict: "accept" | "partial" | "reject"; misrepresented?: string; unresolved?: string }> => r.status === "fulfilled")
        .map((r) => r.value);

      const failed = results.filter((r) => r.status === "rejected");
      if (workers.length === 0 && failed.length > 0) {
        return this.errorResult(JSON.stringify({
          error: `All ${failed.length} acceptance check(s) failed`,
          failedModels: args.workers.map((w) => this.anonymizeModel(this.resolveModel(w.model) ?? w.model)),
        }));
      }

      const hasPartial = workers.some((w) => w.verdict === "partial");
      const hasReject = workers.some((w) => w.verdict === "reject");

      return this.textResult(JSON.stringify({
        workers,
        totalTokens: { input: totalInput, output: totalOutput },
        ...(hasReject ? {
          action_required: "reject — revise synthesis to address misrepresented/unresolved issues, then re-run pyreez_acceptance",
        } : hasPartial ? {
          action_required: "partial — review misrepresented/unresolved fields. Revise synthesis for flagged sections, then re-run pyreez_acceptance",
        } : {}),
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
      const anonModels = new Set<string>();
      for (const ev of args.evaluations) {
        // Resolve anonymous model ID to real one for SkillCell update
        const realModelId = this.resolveModel(ev.model_id) ?? ev.model_id;
        this.skillCellStore.update({
          deliberation_id: crypto.randomUUID(),
          model_id: realModelId,
          domain: ev.domain,
          task_type: ev.task_type,
          evaluator_id: "host",
          dimensions: ev.dimensions,
          failures: ev.failures,
          timestamp: Date.now(),
        });
        anonModels.add(this.anonymizeModel(realModelId));
        updated++;
      }
      await this.skillCellStore.save();

      return this.textResult(JSON.stringify({
        updated,
        models: [...anonModels],
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
