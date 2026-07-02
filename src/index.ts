/**
 * Pyreez entry point.
 * Re-exports shared utilities and delegates to CLI.
 */

import type { RegistryLike } from "./model/discovered-registry";
import type { LLMProvider } from "./llm/types";

/**
 * Filter registry models to only those from configured providers.
 * Accepts any registry-shaped source (curated ModelRegistry or the discovery-backed adapter).
 * Exported for use by CLI and tests.
 */
export function filterModelsByProviders(
  registry: RegistryLike,
  providers: readonly LLMProvider[],
): { modelIds: string[]; warnings: string[] } {
  const configuredProviders = new Set(providers.map((p) => p.name));
  const availableModels = registry.getAvailable().filter((m) => configuredProviders.has(m.provider));
  const warnings: string[] = [];
  if (availableModels.length === 0) {
    warnings.push(
      `No models match configured providers (${[...configuredProviders].join(", ")}). ` +
      "Check .pyreez/models.jsonc provider names.",
    );
  }
  return { modelIds: availableModels.map((m) => m.id), warnings };
}
