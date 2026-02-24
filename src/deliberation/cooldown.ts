/**
 * Cooldown Manager — tracks failed models with TTL-based cooldown.
 *
 * Used by the deliberation engine to exclude recently-failed models
 * during team recomposition after LLM provider errors.
 *
 * Pure in-memory, no I/O.
 * @module Cooldown Manager
 */

/**
 * A cooldown entry for a model.
 */
export interface CooldownEntry {
  readonly modelId: string;
  readonly reason: string;
  readonly cooldownUntil: number;
}

/**
 * Manages per-model cooldown state with TTL expiry.
 */
export interface CooldownManager {
  /** Add a model to cooldown. */
  add(modelId: string, reason: string, ttlMs?: number): void;
  /** Check if a model is currently on cooldown. */
  isOnCooldown(modelId: string): boolean;
  /** Get all currently-cooled-down model IDs (cleans expired entries). */
  getCooledDownIds(): ReadonlySet<string>;
  /** Clear all cooldown entries. */
  clear(): void;
}

const DEFAULT_TTL_MS = 300_000; // 5 minutes

/**
 * Create a CooldownManager instance.
 *
 * @param defaultTtlMs - Default TTL in milliseconds (default: 300,000 = 5 minutes).
 */
export function createCooldownManager(
  defaultTtlMs?: number,
): CooldownManager {
  const entries = new Map<string, CooldownEntry>();
  const ttl = defaultTtlMs ?? DEFAULT_TTL_MS;

  return {
    add(modelId: string, reason: string, ttlMs?: number): void {
      entries.set(modelId, {
        modelId,
        reason,
        cooldownUntil: Date.now() + (ttlMs ?? ttl),
      });
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

    clear(): void {
      entries.clear();
    },
  };
}
