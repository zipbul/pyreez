/**
 * Cooldown Manager — tracks failed models with session-level permanent exclusion.
 *
 * Used by the deliberation engine to exclude failed models
 * during per-worker fallback after LLM provider errors.
 *
 * Features:
 *   - Session-level permanent exclusion (no TTL — failed models stay excluded)
 *   - Provider-level propagation (failure affects all models from same provider)
 *
 * Pure in-memory, no I/O.
 * @module Cooldown Manager
 */

/**
 * Classified error types for cooldown differentiation.
 */
export type CooldownErrorType =
  | "rate_limit"
  | "server_error"
  | "timeout"
  | "auth_error"
  | "degenerate"
  | "unknown";

/**
 * A cooldown entry for a model.
 */
export interface CooldownEntry {
  readonly modelId: string;
  readonly reason: string;
  readonly cooldownUntil: number;
  readonly failCount: number;
  readonly errorType: CooldownErrorType;
}

/**
 * Manages per-model cooldown state.
 */
export interface CooldownManager {
  /** Add a model to cooldown (session-level permanent). */
  add(modelId: string, reason: string, errorType?: CooldownErrorType, ttlMs?: number): void;
  /** Add all models from the same provider to cooldown. */
  addProvider(modelId: string, reason: string, ttlMs?: number): void;
  /** Check if a model is currently on cooldown. */
  isOnCooldown(modelId: string): boolean;
  /** Get all currently-cooled-down model IDs. */
  getCooledDownIds(): ReadonlySet<string>;
  /** Get the cooldown entry for a model (undefined if not on cooldown). */
  getEntry(modelId: string): CooldownEntry | undefined;
  /** Clear all cooldown entries. */
  clear(): void;
}

import { extractProvider } from "./provider-util";

/**
 * Create a CooldownManager instance.
 * Session-level: once added, models stay excluded until clear() is called.
 */
export function createCooldownManager(
  _defaultTtlMs?: number,
): CooldownManager {
  const cooledModels = new Set<string>();
  const cooledProviders = new Set<string>();
  const entries = new Map<string, CooldownEntry>();

  return {
    add(modelId: string, reason: string, errorType?: CooldownErrorType): void {
      cooledModels.add(modelId);
      entries.set(modelId, {
        modelId,
        reason,
        cooldownUntil: Infinity,
        failCount: (entries.get(modelId)?.failCount ?? 0) + 1,
        errorType: errorType ?? "unknown",
      });
    },

    addProvider(modelId: string, reason: string): void {
      const provider = extractProvider(modelId);
      cooledProviders.add(provider);
      this.add(modelId, reason, "rate_limit");
    },

    isOnCooldown(modelId: string): boolean {
      if (cooledModels.has(modelId)) return true;
      const provider = extractProvider(modelId);
      return cooledProviders.has(provider);
    },

    getCooledDownIds(): ReadonlySet<string> {
      return cooledModels;
    },

    getEntry(modelId: string): CooldownEntry | undefined {
      const entry = entries.get(modelId);
      if (entry) return entry;
      // Synthesize entry for provider-level cooldown
      const provider = extractProvider(modelId);
      if (cooledProviders.has(provider)) {
        return {
          modelId,
          reason: `provider cooldown (${provider})`,
          cooldownUntil: Infinity,
          failCount: 1,
          errorType: "rate_limit",
        };
      }
      return undefined;
    },

    clear(): void {
      cooledModels.clear();
      cooledProviders.clear();
      entries.clear();
    },
  };
}

/**
 * Classify an error into a CooldownErrorType by examining the cause chain.
 * Extracts HTTP status and error type from LLMClientError when available.
 */
export function classifyError(error: unknown): CooldownErrorType {
  const llmError = findLLMClientError(error);
  if (llmError) {
    return classifyByStatus(llmError.status, llmError.type);
  }
  if (error instanceof Error && error.message.includes("degenerate")) {
    return "degenerate";
  }
  return "unknown";
}

/**
 * Walk the cause chain to find an LLMClientError.
 * Exported for ModelSwap.httpStatus extraction.
 */
export function findLLMClientError(error: unknown): { status: number; type?: string } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth++) {
    if (current && typeof current === "object" && "status" in current && typeof (current as { status: unknown }).status === "number") {
      const e = current as { status: number; type?: string };
      return { status: e.status, type: e.type };
    }
    if (current && typeof current === "object" && "cause" in current) {
      current = (current as { cause: unknown }).cause;
    } else {
      break;
    }
  }
  return undefined;
}

/**
 * Map HTTP status + error type string to CooldownErrorType.
 */
function classifyByStatus(status: number, type?: string): CooldownErrorType {
  if (status === 429 || type === "rate_limit_error") return "rate_limit";
  if (status === 401 || status === 403 || type === "authentication_error") return "auth_error";
  if (status === 408 || type === "timeout_error" || type === "connection_error") return "timeout";
  if (status >= 500) return "server_error";
  return "unknown";
}

/**
 * Clean raw error message: extract human-readable text from JSON error bodies.
 */
export function normalizeErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string };
      message?: string;
    };
    return parsed.error?.message ?? parsed.message ?? raw;
  } catch {
    return raw;
  }
}

/**
 * Whether the error type is likely transient and worth retrying later.
 */
export function isRetryableError(errorType: CooldownErrorType): boolean {
  return errorType === "rate_limit" || errorType === "timeout";
}
