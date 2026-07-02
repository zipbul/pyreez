/**
 * Live model discovery — ask each provider (via its OFFICIAL method) what models the account actually
 * has, so pyreez never routes to a configured-but-nonexistent model. Nothing is stored: the list is
 * produced at call time. Discovery runs OFF the deliberation hot path.
 *
 * Official methods (verified):
 * - codex: `codex debug models --bundled` → JSON {models:[{slug, display_name, description}]}
 * - grok:  `grok models` → text ("* id (default)" / "- id" under "Available models:")
 * - claude: agent-SDK `supportedModels()` (streaming session; returns models with no token cost)
 * - gemini: CLI list (unavailable when auth is broken → contributes nothing)
 *
 * Every probe is GUARDED (timeout + catch → []) so one provider's failure never breaks selection.
 */

import type { ProviderName } from "../llm/types";
import { spawnWithIdleTimeout } from "../llm/providers/spawn-with-idle";

/** Per-provider probe budget (ms). Discovery is off the hot path, so this is generous. */
const PROBE_MS = 20_000;

export interface DiscoveredModel {
  /** Canonical pyreez id: `provider/slug`. */
  readonly id: string;
  readonly provider: ProviderName;
  readonly displayName?: string;
  readonly description?: string;
}

/** Run an async probe with a timeout; any throw or timeout yields `fallback` (never rejects). */
export async function runGuarded<T>(fn: () => Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });
  try {
    return await Promise.race([fn().catch(() => fallback), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Parse `codex debug models` JSON into discovered models (provider = openai). */
export function parseCodexModels(jsonText: string): DiscoveredModel[] {
  let parsed: { models?: { slug?: string; display_name?: string; description?: string }[] };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const models = parsed.models;
  if (!Array.isArray(models)) return [];
  return models
    .filter((m): m is { slug: string; display_name?: string; description?: string } => typeof m?.slug === "string")
    .map((m) => ({
      id: `openai/${m.slug}`,
      provider: "openai" as const,
      ...(m.display_name ? { displayName: m.display_name } : {}),
      ...(m.description ? { description: m.description } : {}),
    }));
}

/** Parse `grok models` text (lines like "* id (default)" / "- id" under "Available models:"). */
export function parseGrokModels(text: string): DiscoveredModel[] {
  const out: DiscoveredModel[] = [];
  let inList = false;
  for (const line of text.split("\n")) {
    if (/available models:/i.test(line)) { inList = true; continue; }
    if (!inList) continue;
    const m = line.match(/^\s*[-*]\s+(\S+)/);
    if (!m) continue;
    out.push({ id: `xai/${m[1]}`, provider: "xai" });
  }
  return out;
}

// -- Provider probes (guarded; each yields [] on any failure) --

/** codex: `codex debug models --bundled` → JSON catalog (bundled = no network). */
export function discoverCodex(): Promise<DiscoveredModel[]> {
  return runGuarded(async () => {
    const { stdout, exitCode } = await spawnWithIdleTimeout(
      ["codex", "debug", "models", "--bundled"], {}, { idleMs: PROBE_MS },
    );
    return exitCode === 0 ? parseCodexModels(stdout) : [];
  }, PROBE_MS, []);
}

/** grok: `grok models` → text list. */
export function discoverGrok(): Promise<DiscoveredModel[]> {
  return runGuarded(async () => {
    const { stdout, exitCode } = await spawnWithIdleTimeout(
      ["grok", "models"], {}, { idleMs: PROBE_MS },
    );
    return exitCode === 0 ? parseGrokModels(stdout) : [];
  }, PROBE_MS, []);
}

/**
 * claude: agent-SDK `supportedModels()` (streaming session, no token cost). The SDK call is injected so
 * this stays testable and the SDK import lives with the provider.
 */
export function discoverClaude(
  supportedModels: () => Promise<{ value: string; displayName?: string; description?: string }[]>,
): Promise<DiscoveredModel[]> {
  return runGuarded(async () => {
    const models = await supportedModels();
    return models
      .filter((m) => typeof m.value === "string" && m.value.length > 0)
      // skip aliases like "default"/"opus"/"sonnet" — keep only concrete versioned ids
      .filter((m) => m.value.includes("-"))
      .map((m) => ({
        id: `anthropic/${m.value}`,
        provider: "anthropic" as const,
        ...(m.displayName ? { displayName: m.displayName } : {}),
        ...(m.description ? { description: m.description } : {}),
      }));
  }, PROBE_MS, []);
}

export type ProviderStatus = "ok" | "empty" | "failed";

export interface DiscoveryResult {
  readonly models: DiscoveredModel[];
  readonly status: Partial<Record<ProviderName, ProviderStatus>>;
}

/**
 * Run the given provider probes concurrently and aggregate. `status` distinguishes a provider that
 * genuinely returned nothing (empty) from one whose probe failed (failed) — so the host can tell
 * "provider has no models" from "provider unavailable".
 */
export async function discoverAll(
  probes: Partial<Record<ProviderName, () => Promise<DiscoveredModel[]>>>,
): Promise<DiscoveryResult> {
  const entries = Object.entries(probes) as [ProviderName, () => Promise<DiscoveredModel[]>][];
  const results = await Promise.all(entries.map(async ([provider, probe]) => {
    try {
      const models = await probe();
      return { provider, models, status: (models.length ? "ok" : "empty") as ProviderStatus };
    } catch {
      return { provider, models: [] as DiscoveredModel[], status: "failed" as ProviderStatus };
    }
  }));
  const models: DiscoveredModel[] = [];
  const status: Partial<Record<ProviderName, ProviderStatus>> = {};
  for (const r of results) {
    models.push(...r.models);
    status[r.provider] = r.status;
  }
  return { models, status };
}
