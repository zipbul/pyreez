/**
 * Cooldown Manager — tracks failed models with TTL-based cooldown.
 *
 * Used by the deliberation engine to exclude recently-failed models
 * during team recomposition after LLM provider errors.
 *
 * Features:
 *   - Error-type-aware TTL (rate_limit, server_error, timeout, auth_error, degenerate)
 *   - Escalating cooldown via failCount (TTL × 2^(failCount-1), capped)
 *   - Provider-level propagation for rate limits (429 affects all models from same provider)
 *
 * Pure in-memory, no I/O.
 * @module Cooldown Manager
 */

/**
 * Classified error types for cooldown TTL differentiation.
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
 * Manages per-model cooldown state with TTL expiry.
 */
export interface CooldownManager {
  /** Add a model to cooldown with error-type-aware TTL and escalation. */
  add(modelId: string, reason: string, errorType?: CooldownErrorType, ttlMs?: number): void;
  /** Add all models from the same provider to cooldown (for rate limits). */
  addProvider(modelId: string, reason: string, ttlMs?: number): void;
  /** Check if a model is currently on cooldown. */
  isOnCooldown(modelId: string): boolean;
  /** Get all currently-cooled-down model IDs (cleans expired entries). */
  getCooledDownIds(): ReadonlySet<string>;
  /** Get the cooldown entry for a model (undefined if not on cooldown or expired). */
  getEntry(modelId: string): CooldownEntry | undefined;
  /** Clear all cooldown entries. */
  clear(): void;
}

/** Default TTL per error type (milliseconds). */
const ERROR_TYPE_TTL: Record<CooldownErrorType, number> = {
  rate_limit: 30_000,     // 30 seconds
  server_error: 60_000,   // 1 minute
  timeout: 120_000,       // 2 minutes
  auth_error: 1_800_000,  // 30 minutes (finite, not permanent)
  degenerate: 300_000,    // 5 minutes
  unknown: 300_000,       // 5 minutes (legacy default)
};

/** Maximum escalation multiplier cap (prevents absurd cooldowns). */
const MAX_ESCALATION_FACTOR = 8; // 2^3 — after 4 failures, TTL stops growing

const DEFAULT_TTL_MS = 300_000; // 5 minutes (fallback)

/**
 * Extract provider prefix from a model ID (e.g., "anthropic" from "anthropic/claude-opus-4.6").
 */
function extractProvider(modelId: string): string {
  return modelId.split("/")[0] ?? modelId;
}

/**
 * Create a CooldownManager instance.
 *
 * @param defaultTtlMs - Default TTL in milliseconds (default: 300,000 = 5 minutes).
 *                       Used when no error type is provided.
 */
export function createCooldownManager(
  defaultTtlMs?: number,
): CooldownManager {
  const entries = new Map<string, CooldownEntry>();
  const fallbackTtl = defaultTtlMs ?? DEFAULT_TTL_MS;

  function computeTtl(errorType: CooldownErrorType | undefined, explicitTtlMs: number | undefined, failCount: number): number {
    const baseTtl = explicitTtlMs ?? (errorType ? ERROR_TYPE_TTL[errorType] : fallbackTtl);
    const escalation = Math.min(2 ** (failCount - 1), MAX_ESCALATION_FACTOR);
    return baseTtl * escalation;
  }

  return {
    add(modelId: string, reason: string, errorType?: CooldownErrorType, ttlMs?: number): void {
      // Read-modify-write: preserve and increment failCount
      const existing = entries.get(modelId);
      const failCount = (existing ? existing.failCount : 0) + 1;
      const effectiveType = errorType ?? "unknown";
      const effectiveTtl = computeTtl(errorType, ttlMs, failCount);

      entries.set(modelId, {
        modelId,
        reason,
        cooldownUntil: Date.now() + effectiveTtl,
        failCount,
        errorType: effectiveType,
      });
    },

    addProvider(modelId: string, reason: string, ttlMs?: number): void {
      const provider = extractProvider(modelId);
      const effectiveTtl = ttlMs ?? ERROR_TYPE_TTL.rate_limit;
      // Cool down all models from the same provider
      for (const [id] of entries) {
        if (extractProvider(id) === provider && id !== modelId) {
          const existing = entries.get(id);
          const failCount = (existing ? existing.failCount : 0) + 1;
          entries.set(id, {
            modelId: id,
            reason: `provider rate limit (from ${modelId})`,
            cooldownUntil: Date.now() + effectiveTtl,
            failCount,
            errorType: "rate_limit",
          });
        }
      }
      // Also cool down the original model
      this.add(modelId, reason, "rate_limit", ttlMs);
    },

    isOnCooldown(modelId: string): boolean {
      const entry = entries.get(modelId);
      if (!entry) return false;
      if (Date.now() >= entry.cooldownUntil) {
        entries.delete(modelId);
        return false;
      }
      return true;
    },

    getCooledDownIds(): ReadonlySet<string> {
      const now = Date.now();
      const active = new Set<string>();
      for (const [id, entry] of entries) {
        if (now < entry.cooldownUntil) {
          active.add(id);
        } else {
          entries.delete(id);
        }
      }
      return active;
    },

    getEntry(modelId: string): CooldownEntry | undefined {
      const entry = entries.get(modelId);
      if (!entry) return undefined;
      if (Date.now() >= entry.cooldownUntil) {
        entries.delete(modelId);
        return undefined;
      }
      return entry;
    },

    clear(): void {
      entries.clear();
    },
  };
}

/**
 * Classify an error into a CooldownErrorType by examining the cause chain.
 * Extracts HTTP status and error type from LLMClientError when available.
 */
export function classifyError(error: unknown): CooldownErrorType {
  // Direct LLMClientError
  const llmError = findLLMClientError(error);
  if (llmError) {
    return classifyByStatus(llmError.status, llmError.type);
  }
  // Degenerate response detection
  if (error instanceof Error && error.message.includes("degenerate")) {
    return "degenerate";
  }
  return "unknown";
}

/**
 * Walk the cause chain to find an LLMClientError.
 */
function findLLMClientError(error: unknown): { status: number; type?: string } | undefined {
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
