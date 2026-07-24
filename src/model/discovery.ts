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
  let parsed: { models?: { slug?: string; display_name?: string; description?: string; visibility?: string }[] };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const models = parsed.models;
  if (!Array.isArray(models)) return [];
  return models
    .filter((m): m is { slug: string; display_name?: string; description?: string; visibility?: string } => typeof m?.slug === "string")
    // drop internal/hidden entries (e.g. codex-auto-review has visibility "hide")
    .filter((m) => m.visibility !== "hide")
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
    if (m) { out.push({ id: `xai/${m[1]}`, provider: "xai" }); continue; }
    // End the list at the first non-bullet line after it starts (blank line or a footer/notes section),
    // so trailing prose is never mistaken for model ids.
    if (line.trim().length > 0) break;
  }
  return out;
}

export type ProviderStatus = "ok" | "empty" | "failed";

/**
 * A probe result that PRESERVES the failure mode. Probes must not collapse a failure into an empty list
 * (that would let a transient outage masquerade as "provider has no models" and wrongly deprecate cached
 * models). "ok" = ran + non-empty; "empty" = ran + genuinely no models; "failed" = timeout/throw/nonzero.
 */
export interface ProbeResult {
  readonly models: DiscoveredModel[];
  readonly status: ProviderStatus;
}

const PROBE_FAILED: ProbeResult = { models: [], status: "failed" };
const ok = (models: DiscoveredModel[]): ProbeResult => ({ models, status: models.length ? "ok" : "empty" });

// -- Provider probes (guarded; failure preserved as status "failed", never a silent empty) --

/** codex: `codex debug models --bundled` → JSON catalog (bundled = no network). */
export function discoverCodex(): Promise<ProbeResult> {
  return runGuarded(async () => {
    const { stdout, exitCode } = await spawnWithIdleTimeout(
      ["codex", "debug", "models", "--bundled"], {}, { idleMs: PROBE_MS },
    );
    return exitCode === 0 ? ok(parseCodexModels(stdout)) : PROBE_FAILED;
  }, PROBE_MS, PROBE_FAILED);
}

/** grok: `grok models` → text list. */
export function discoverGrok(): Promise<ProbeResult> {
  return runGuarded(async () => {
    const { stdout, exitCode } = await spawnWithIdleTimeout(
      ["grok", "models"], {}, { idleMs: PROBE_MS },
    );
    return exitCode === 0 ? ok(parseGrokModels(stdout)) : PROBE_FAILED;
  }, PROBE_MS, PROBE_FAILED);
}

/**
 * claude: agent-SDK `supportedModels()` (streaming session, no token cost). The SDK call is injected so
 * this stays testable and the SDK import lives with the provider.
 */
export function discoverClaude(
  supportedModels: () => Promise<{ value: string; displayName?: string; description?: string }[]>,
): Promise<ProbeResult> {
  return runGuarded(async () => {
    const models = (await supportedModels())
      .filter((m) => typeof m.value === "string" && m.value.length > 0)
      // keep real model values (opus/sonnet/haiku and versioned ids); drop only the "default" meta-alias
      .filter((m) => m.value !== "default")
      .map((m) => ({
        id: `anthropic/${m.value}`,
        provider: "anthropic" as const,
        ...(m.displayName ? { displayName: m.displayName } : {}),
        ...(m.description ? { description: m.description } : {}),
      }));
    return ok(models);
  }, PROBE_MS, PROBE_FAILED);
}

export interface DiscoveryResult {
  readonly models: DiscoveredModel[];
  readonly status: Partial<Record<ProviderName, ProviderStatus>>;
}

/**
 * Run the given provider probes concurrently and aggregate, preserving each probe's real status so a
 * transient failure is never mistaken for "empty".
 */
export async function discoverAll(
  probes: Partial<Record<ProviderName, () => Promise<ProbeResult>>>,
): Promise<DiscoveryResult> {
  const entries = Object.entries(probes) as [ProviderName, () => Promise<ProbeResult>][];
  const results = await Promise.all(entries.map(async ([provider, probe]) => {
    try {
      const r = await probe();
      return { provider, ...r };
    } catch {
      return { provider, ...PROBE_FAILED };
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
