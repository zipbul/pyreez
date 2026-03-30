/**
 * Shared handler logic for pyreez tools.
 * Extracted from MCP server for reuse in CLI.
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

// -- Result types --

export interface HandlerResult {
  data?: unknown;
  error?: string;
}

// -- Anonymization State --

export interface AnonymizationState {
  anonToReal: Record<string, string>;
  realToAnon: Record<string, string>;
  providerRealToAnon: Record<string, string>;
  nextAnonIndex: number;
  nextProviderIndex: number;
}

export function emptyAnonymizationState(): AnonymizationState {
  return {
    anonToReal: {},
    realToAnon: {},
    providerRealToAnon: {},
    nextAnonIndex: 0,
    nextProviderIndex: 0,
  };
}

export class Anonymizer {
  private anonToReal: Map<string, string>;
  private realToAnon: Map<string, string>;
  private providerRealToAnon: Map<string, string>;
  private nextAnonIndex: number;
  private nextProviderIndex: number;

  constructor(state?: AnonymizationState) {
    if (state) {
      this.anonToReal = new Map(Object.entries(state.anonToReal));
      this.realToAnon = new Map(Object.entries(state.realToAnon));
      this.providerRealToAnon = new Map(Object.entries(state.providerRealToAnon));
      this.nextAnonIndex = state.nextAnonIndex;
      this.nextProviderIndex = state.nextProviderIndex;
    } else {
      this.anonToReal = new Map();
      this.realToAnon = new Map();
      this.providerRealToAnon = new Map();
      this.nextAnonIndex = 0;
      this.nextProviderIndex = 0;
    }
  }

  anonymizeModel(realId: string): string {
    let anon = this.realToAnon.get(realId);
    if (!anon) {
      const i = this.nextAnonIndex++;
      anon = i < 26
        ? String.fromCharCode(65 + i)
        : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
      this.anonToReal.set(anon, realId);
      this.realToAnon.set(realId, anon);
    }
    return anon;
  }

  resolveModel(anonId: string): string | undefined {
    return this.anonToReal.get(anonId);
  }

  anonymizeProvider(realProvider: string): string {
    let anon = this.providerRealToAnon.get(realProvider);
    if (!anon) {
      anon = `P${++this.nextProviderIndex}`;
      this.providerRealToAnon.set(realProvider, anon);
    }
    return anon;
  }

  anonymizeText(text: string): string {
    let result = text;
    for (const [real, anon] of this.realToAnon) {
      result = result.replaceAll(real, anon);
    }
    for (const [real, anon] of this.providerRealToAnon) {
      result = result.replaceAll(real, anon);
    }
    return result;
  }

  reset(): void {
    this.anonToReal.clear();
    this.realToAnon.clear();
    this.providerRealToAnon.clear();
    this.nextAnonIndex = 0;
    this.nextProviderIndex = 0;
  }

  serialize(): AnonymizationState {
    return {
      anonToReal: Object.fromEntries(this.anonToReal),
      realToAnon: Object.fromEntries(this.realToAnon),
      providerRealToAnon: Object.fromEntries(this.providerRealToAnon),
      nextAnonIndex: this.nextAnonIndex,
      nextProviderIndex: this.nextProviderIndex,
    };
  }
}

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
  anonymizer: Anonymizer;
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

async function logRun(
  config: HandlersConfig,
  tool: string,
  handler: () => Promise<HandlerResult>,
): Promise<HandlerResult> {
  if (!config.runLogger) return handler();

  const start = Date.now();
  const id = crypto.randomUUID();
  try {
    const result = await handler();
    try {
      await config.runLogger.log({
        id,
        timestamp: start,
        tool,
        durationMs: Date.now() - start,
        success: !result.error,
        error: result.error,
      });
    } catch {
      // logging failure must not break the tool
    }
    return result;
  } catch (error) {
    try {
      await config.runLogger.log({
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

// -- Handlers --

export async function handleDeliberate(
  config: HandlersConfig,
  args: {
    task: string;
    models: string[];
    count?: number;
    worker_instructions?: string;
    max_rounds?: number;
    protocol?: string;
    technique?: string | string[];
    onRound?: DeliberateInput["onRound"];
  },
): Promise<HandlerResult> {
  return logRun(config, "deliberate", async () => {
    if (!args.task) {
      return { error: "Error: task is required" };
    }
    if (!args.models?.length) {
      return { error: "Error: models is required (min 1). Use scores to choose models." };
    }
    if (!config.deliberateFn) {
      return { error: "Error: deliberation not available" };
    }

    try {
      const anon = config.anonymizer;
      const resolvedModels = args.models.map((id) => anon.resolveModel(id) ?? id);

      const userProtocol = args.protocol === "debate" ? "debate" as const : args.protocol === "diverge-synth" ? "diverge-synth" as const : undefined;

      const input: DeliberateInput = {
        task: args.task,
        models: resolvedModels,
        count: args.count,
        workerInstructions: args.worker_instructions,
        maxRounds: args.max_rounds,
        protocol: userProtocol,
        ...(args.technique ? { technique: args.technique as DeliberateInput["technique"] } : {}),
        ...(args.onRound ? { onRound: args.onRound } : {}),
      };

      const result = await config.deliberateFn(input);

      const anonResult = {
        ...result,
        modelsUsed: result.modelsUsed.map((id) => anon.anonymizeModel(id)),
        ...(result.rounds ? {
          rounds: result.rounds.map((r) => ({
            ...r,
            ...(r.responses ? {
              responses: r.responses.map((resp) => ({
                ...resp,
                model: anon.anonymizeModel(resp.model),
              })),
            } : {}),
            ...(r.failedWorkers ? {
              failedWorkers: r.failedWorkers.map((fw) => ({
                ...fw,
                model: anon.anonymizeModel(fw.model),
              })),
            } : {}),
          })),
        } : {}),
        ...(result.modelSwaps ? {
          modelSwaps: result.modelSwaps.map((s) => ({
            original: anon.anonymizeModel(s.original),
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
              model: anon.anonymizeModel(ls.model),
            })),
          },
        } : {}),
        next_required_action: { tool: "acceptance", reason: "After synthesizing, verify synthesis represents worker positions before presenting to user" },
        synthesis_checklist: {
          comprehend: "Fill unique_contribution, most_unexpected_claim, loss_if_removed for each worker",
          evaluate: "Label every factual claim with [x] fact / [ ] unverified. Amplify creative proposals.",
          reflect: "Fill Uncertainty, Dismissed, Counterargument — each with a concrete change to the synthesis",
        },
      };
      return { data: anonResult };
    } catch (error) {
      const anon = config.anonymizer;
      if (error instanceof NoModelsAvailableError) {
        return {
          error: JSON.stringify({
            error: anon.anonymizeText(error.message),
            code: error.code,
            remediation: error.remediation?.map((r: string) => anon.anonymizeText(r)),
          }),
        };
      }
      if (error instanceof TeamDegradedError) {
        return {
          error: JSON.stringify({
            error: anon.anonymizeText(error.message),
            lostSlots: error.lostSlots.map((ls) => ({
              ...ls,
              model: anon.anonymizeModel(ls.model),
            })),
            ...(error.modelSwaps ? {
              modelSwaps: error.modelSwaps.map((s) => ({
                original: anon.anonymizeModel(s.original),
                swapped: !!s.replacement,
                round: s.round,
                error: s.error,
                ...(s.errorCode ? { errorCode: s.errorCode } : {}),
                ...(s.retryable !== undefined ? { retryable: s.retryable } : {}),
              })),
            } : {}),
            tokensConsumed: error.tokensConsumed,
          }),
        };
      }
      return {
        error: `Error: ${anon.anonymizeText(sanitizeError(error))}`,
      };
    }
  });
}

export async function handleAcceptance(
  config: HandlersConfig,
  args: {
    task: string;
    synthesis: string;
    workers: { model: string; original_position: string }[];
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
      const anon = config.anonymizer;
      let totalInput = 0;
      let totalOutput = 0;

      const workerPromises = args.workers.map(async (w) => {
        const realModel = anon.resolveModel(w.model) ?? w.model;
        const messages = buildAcceptanceMessages(args.synthesis, w.original_position, args.task);
        const result = await config.chatFn!(realModel, messages, { temperature: 0 });
        totalInput += result.inputTokens;
        totalOutput += result.outputTokens;

        const verdict = result.content.match(/<verdict>([\s\S]*?)<\/verdict>/)?.[1]?.trim()?.toLowerCase() ?? "accept";
        const misrepresented = result.content.match(/<misrepresented>([\s\S]*?)<\/misrepresented>/)?.[1]?.trim();
        const unresolved = result.content.match(/<unresolved>([\s\S]*?)<\/unresolved>/)?.[1]?.trim();

        const parsedVerdict = verdict === "reject" ? "reject" as const
          : verdict === "partial" ? "partial" as const
          : "accept" as const;

        return {
          model: anon.anonymizeModel(realModel),
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
        return {
          error: JSON.stringify({
            error: `All ${failed.length} acceptance check(s) failed`,
            failedModels: args.workers.map((w) => anon.anonymizeModel(anon.resolveModel(w.model) ?? w.model)),
          }),
        };
      }

      const hasPartial = workers.some((w) => w.verdict === "partial");
      const hasReject = workers.some((w) => w.verdict === "reject");

      return {
        data: {
          workers,
          totalTokens: { input: totalInput, output: totalOutput },
          ...(hasReject ? {
            action_required: "reject — revise synthesis to address misrepresented/unresolved issues, then re-run acceptance",
          } : hasPartial ? {
            action_required: "partial — review misrepresented/unresolved fields. Revise synthesis for flagged sections, then re-run acceptance",
          } : {}),
          next_required_action: { tool: "feedback", reason: "Submit per-model evaluations to update SkillCell scores. Without feedback, team selection degrades." },
        },
      };
    } catch (error) {
      return { error: `Error: ${sanitizeError(error)}` };
    }
  });
}

