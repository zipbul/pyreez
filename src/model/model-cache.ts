/**
 * Model availability cache — a periodically-refreshed snapshot of live discovery, so routing/selection
 * read a fast local file instead of probing every command. A vanished model is kept as `deprecated`
 * (its affinity history stays meaningful) until TTL-pruned.
 *
 * The safety rule (from review): a cached model is deprecated ONLY when its provider returned a clean
 * `ok` (ran, non-empty) list that omits it. A provider that returned `empty` or `failed` (outage,
 * timeout, auth) leaves its cached models UNTOUCHED — a transient failure must never deprecate real
 * models.
 */

import { discoverAll, type DiscoveredModel, type DiscoveryResult, type ProbeResult } from "./discovery";
import type { ProviderName } from "../llm/types";
import type { FileIO } from "../report/types";

export type ModelStatus = "available" | "deprecated";

export interface CachedModel extends DiscoveredModel {
  readonly status: ModelStatus;
  readonly lastSeen: number;
}

export interface ModelCache {
  readonly refreshedAt: number;
  readonly models: readonly CachedModel[];
}

export const EMPTY_CACHE: ModelCache = { refreshedAt: 0, models: [] };

/**
 * Merge a fresh discovery into the previous cache.
 * - provider "ok": discovered models → available (lastSeen=now); cached-of-that-provider absent from the
 *   ok list → deprecated.
 * - provider "empty" / "failed" / not probed: that provider's cached models are kept unchanged.
 */
export function mergeCache(prev: ModelCache, discovery: DiscoveryResult, now: number): ModelCache {
  const okProviders = new Set<ProviderName>();
  for (const [p, s] of Object.entries(discovery.status)) if (s === "ok") okProviders.add(p as ProviderName);

  const discoveredById = new Map(discovery.models.map((m) => [m.id, m]));
  const out = new Map<string, CachedModel>();

  // Carry forward previous entries; deprecate only those under an ok provider that are now absent.
  for (const m of prev.models) {
    if (okProviders.has(m.provider) && !discoveredById.has(m.id)) {
      out.set(m.id, { ...m, status: "deprecated" });
    } else {
      out.set(m.id, m);
    }
  }
  // Upsert everything discovered this round as available.
  for (const m of discovery.models) {
    out.set(m.id, { ...m, status: "available", lastSeen: now });
  }
  return { refreshedAt: now, models: [...out.values()] };
}

/** Drop deprecated models not seen within ttlMs (available models are always kept). */
export function pruneDeprecated(cache: ModelCache, now: number, ttlMs: number): ModelCache {
  return {
    refreshedAt: cache.refreshedAt,
    models: cache.models.filter((m) => m.status === "available" || now - m.lastSeen <= ttlMs),
  };
}

/** The routable models (status available), stripped back to DiscoveredModel. */
export function availableModels(cache: ModelCache): DiscoveredModel[] {
  return cache.models
    .filter((m) => m.status === "available")
    .map(({ status: _s, lastSeen: _l, ...m }) => m);
}

/** True when the cache is older than ttlMs (or never refreshed) → a refresh is due. */
export function isStale(cache: ModelCache, now: number, ttlMs: number): boolean {
  return now - cache.refreshedAt > ttlMs;
}

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : ".";
}

/** Load the cache; EMPTY_CACHE when missing/unreadable. */
export async function loadModelCache(fileIO: FileIO, path: string): Promise<ModelCache> {
  try {
    return JSON.parse(await fileIO.readFile(path)) as ModelCache;
  } catch {
    return EMPTY_CACHE;
  }
}

/** Write the cache atomically (temp + rename); single-writer. */
export async function writeModelCache(fileIO: FileIO, path: string, cache: ModelCache): Promise<void> {
  await fileIO.mkdir(dirOf(path));
  // Unique temp name so concurrent writers never clobber each other's temp before rename.
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  await fileIO.writeFile(tmp, JSON.stringify(cache, null, 2));
  await fileIO.rename(tmp, path);
}

export interface RefreshOptions {
  readonly now: number;
  /** Refresh when the cache is older than this. */
  readonly ttlMs: number;
  /** Deprecated entries older than this are pruned on refresh. */
  readonly pruneTtlMs: number;
  /** Force a refresh even if the cache is fresh. */
  readonly force?: boolean;
}

/**
 * Return the cache, refreshing from live probes when stale (or forced). A fresh cache is returned as-is
 * (no probing). On refresh, merge + prune + atomic-write. Single-writer: only call this where one writer
 * is guaranteed (buildConfig / an explicit `--refresh`).
 */
export async function refreshModelCache(
  fileIO: FileIO,
  path: string,
  probes: Partial<Record<ProviderName, () => Promise<ProbeResult>>>,
  opts: RefreshOptions,
): Promise<ModelCache> {
  const prev = await loadModelCache(fileIO, path);
  if (!opts.force && !isStale(prev, opts.now, opts.ttlMs)) return prev;
  const discovery = await discoverAll(probes);
  const merged = pruneDeprecated(mergeCache(prev, discovery, opts.now), opts.now, opts.pruneTtlMs);
  await writeModelCache(fileIO, path, merged);
  return merged;
}
