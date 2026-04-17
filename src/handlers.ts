/**
 * Shared handler logic for pyreez tools.
 *
 * Tools: deliberate, acceptance
 */

import type { RunLogger } from "./report/run-logger";
import type { DeliberateInput, DeliberateOutput } from "./deliberation/types";
import { NoModelsAvailableError } from "./deliberation/team-composer";
import { TeamDegradedError } from "./deliberation/engine";
import { buildAcceptanceMessages } from "./deliberation/prompts";
import type { GenerationParams } from "./deliberation/types";
import type { ModelInfo } from "./model/types";

// -- Shared Config --

export interface HandlersConfig {
  filteredRegistry?: {
    getAll(): ModelInfo[];
    getAvailable(): ModelInfo[];
    getById(id: string): ModelInfo | undefined;
  };
  deliberateFn?: (input: DeliberateInput) => Promise<DeliberateOutput>;
  runLogger?: RunLogger;
  chatFn?: (model: string, messages: import("./llm/types").ChatMessage[], params?: GenerationParams) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;
}

/** Max characters for error messages. */
const MAX_ERROR_LENGTH = 500;

function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = raw.replace(/(?:\/[\w.-]+){3,}/g, "[path]");
  if (cleaned.length <= MAX_ERROR_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_ERROR_LENGTH) + "…";
}

// -- Run Logging --

export type HandlerResult =
  | { data: unknown; error?: never }
  | { error: string; data?: never };

async function logRun(
  config: HandlersConfig,
  toolName: string,
  fn: () => Promise<HandlerResult>,
): Promise<HandlerResult> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = Math.round(performance.now() - start);
    config.runLogger?.log({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      tool: toolName,
      durationMs: duration,
      success: !result.error,
      ...(result.error ? { error: result.error } : {}),
    }).catch(() => {});
    return result;
  } catch (error) {
    const duration = Math.round(performance.now() - start);
    const errMsg = sanitizeError(error);
    config.runLogger?.log({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      tool: toolName,
      durationMs: duration,
      success: false,
      error: errMsg,
    }).catch(() => {});
    return { error: `Error: ${errMsg}` };
  }
}

// -- Deliberate --

export async function handleDeliberate(
  config: HandlersConfig,
  args: {
    task: string;
    models: string[];
    count?: number;
    worker_instructions?: string;
    max_rounds?: number;
    protocol?: string;
    onRound?: DeliberateInput["onRound"];
    // Protocol-specific fields
    questions?: string[];
    criteria?: string;
    subject?: string;
    aggregation?: string;
    file_access?: boolean;
  },
): Promise<HandlerResult> {
  return logRun(config, "deliberate", async () => {
    if (!args.task) {
      return { error: "Error: task is required" };
    }
    if (!args.models?.length) {
      return { error: "Error: models is required (min 1)" };
    }
    if (!config.deliberateFn) {
      return { error: "Error: deliberation not available" };
    }

    try {
      const VALID_PROTOCOLS = new Set(["shared_convergence", "adversarial_debate", "host_interrogation", "sequential_refinement", "evaluation_scoring", "red_team"]);
      const protocol = (args.protocol && VALID_PROTOCOLS.has(args.protocol)
        ? args.protocol
        : "shared_convergence") as DeliberateInput["protocol"];

      // Protocol-specific required field validation
      if (protocol === "host_interrogation" && !args.questions?.length) {
        return { error: "Error: --questions is required for host_interrogation protocol" };
      }
      if (protocol === "evaluation_scoring" && !args.criteria) {
        return { error: "Error: --criteria is required for evaluation_scoring protocol" };
      }

      const input: DeliberateInput = {
        task: args.task,
        models: args.models,
        count: args.count,
        workerInstructions: args.worker_instructions,
        maxRounds: args.max_rounds,
        protocol,
        ...(args.questions ? { questions: args.questions } : {}),
        ...(args.criteria ? { criteria: args.criteria } : {}),
        ...(args.subject ? { subject: args.subject } : {}),
        ...(args.aggregation ? { aggregation: args.aggregation as DeliberateInput["aggregation"] } : {}),
        ...(args.onRound ? { onRound: args.onRound } : {}),
        ...(args.file_access ? { fileAccess: true } : {}),
      };

      const result = await config.deliberateFn(input);

      return {
        data: {
          ...result,
          next_required_action: { tool: "acceptance", reason: "After synthesizing, verify synthesis represents worker positions before presenting to user" },
          synthesis_checklist: {
            comprehend: "Fill unique_contribution, most_unexpected_claim, loss_if_removed for each worker",
            evaluate: "Label every factual claim with [x] fact / [ ] unverified. Amplify creative proposals.",
            reflect: "Fill Uncertainty, Dismissed, Counterargument — each with a concrete change to the synthesis",
          },
        },
      };
    } catch (error) {
      if (error instanceof NoModelsAvailableError) {
        return {
          error: JSON.stringify({
            error: error.message,
            code: error.code,
            remediation: error.remediation,
          }),
        };
      }
      if (error instanceof TeamDegradedError) {
        return {
          error: JSON.stringify({
            error: error.message,
            lostSlots: error.lostSlots,
            ...(error.modelSwaps ? { modelSwaps: error.modelSwaps } : {}),
            tokensConsumed: error.tokensConsumed,
          }),
        };
      }
      return {
        error: `Error: ${sanitizeError(error)}`,
      };
    }
  });
}

// -- Acceptance --

export async function handleAcceptance(
  config: HandlersConfig,
  args: {
    task: string;
    synthesis: string;
    workers: { model: string; original_position: string; alignment?: "on-task" | "meta-critique" }[];
  },
): Promise<HandlerResult> {
  return logRun(config, "acceptance", async () => {
    if (!args.task) {
      return { error: "Error: task is required" };
    }
    if (!args.synthesis) {
      return { error: "Error: synthesis is required" };
    }
    if (!args.workers?.length) {
      return { error: "Error: at least one worker is required" };
    }
    if (!config.chatFn) {
      return { error: "Error: acceptance not available (no chatFn configured)" };
    }

    try {
      let totalInput = 0;
      let totalOutput = 0;

      // Split workers by alignment. Meta-critique workers are preserved
      // separately and excluded from action_required, since they reject the
      // task framing itself and cannot be reconciled with an on-task synthesis.
      const onTaskWorkers = args.workers.filter((w) => w.alignment !== "meta-critique");
      const metaCritiqueWorkers = args.workers.filter((w) => w.alignment === "meta-critique");

      const judgeWorker = async (w: typeof args.workers[number]) => {
        const messages = buildAcceptanceMessages(args.synthesis, w.original_position, args.task);
        const result = await config.chatFn!(w.model, messages, { temperature: 0 });
        totalInput += result.inputTokens;
        totalOutput += result.outputTokens;

        const verdictRaw = result.content.match(/<verdict>([\s\S]*?)<\/verdict>/)?.[1]?.trim()?.toLowerCase();
        const verdict = verdictRaw ?? "reject"; // default to reject if format not followed — fail-safe
        const misrepresented = result.content.match(/<misrepresented>([\s\S]*?)<\/misrepresented>/)?.[1]?.trim();
        const unresolved = result.content.match(/<unresolved>([\s\S]*?)<\/unresolved>/)?.[1]?.trim();

        const parsedVerdict = verdict === "reject" ? "reject" as const
          : verdict === "partial" ? "partial" as const
          : "accept" as const;

        return {
          model: w.model,
          verdict: parsedVerdict,
          ...(misrepresented && misrepresented !== "None." ? { misrepresented } : {}),
          ...(unresolved && unresolved !== "None." ? { unresolved } : {}),
        };
      };

      const onTaskResults = await Promise.allSettled(onTaskWorkers.map(judgeWorker));
      const workers = onTaskResults
        .filter((r): r is PromiseFulfilledResult<{ model: string; verdict: "accept" | "partial" | "reject"; misrepresented?: string; unresolved?: string }> => r.status === "fulfilled")
        .map((r) => r.value);

      const failed = onTaskResults.filter((r) => r.status === "rejected");
      if (workers.length === 0 && failed.length > 0) {
        return {
          error: JSON.stringify({
            error: `All ${failed.length} acceptance check(s) failed`,
            failedModels: onTaskWorkers.map((w) => w.model),
          }),
        };
      }

      const hasPartial = workers.some((w) => w.verdict === "partial");
      const hasReject = workers.some((w) => w.verdict === "reject");

      return {
        data: {
          workers,
          totalTokens: { input: totalInput, output: totalOutput },
          ...(metaCritiqueWorkers.length > 0 ? {
            metaCritiques: metaCritiqueWorkers.map((w) => ({
              model: w.model,
              original_position: w.original_position,
              note: "Excluded from acceptance: this worker rejected the task framing rather than answering it. Preserved for host review; not blocking action_required.",
            })),
          } : {}),
          ...(hasReject ? {
            action_required: "reject — revise synthesis to address misrepresented/unresolved issues, then re-run acceptance",
          } : hasPartial ? {
            action_required: "partial — review misrepresented/unresolved fields. Revise synthesis for flagged sections, then re-run acceptance",
          } : {}),
        },
      };
    } catch (error) {
      return { error: `Error: ${sanitizeError(error)}` };
    }
  });
}
