/**
 * Pyreez entry point.
 * Re-exports shared utilities and delegates to CLI.
 */

import { ModelRegistry } from "./model/registry";
import type { LLMProvider } from "./llm/types";

/**
 * Filter registry models to only those from configured providers.
 * Exported for use by CLI and tests.
 */
export function filterModelsByProviders(
  registry: ModelRegistry,
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
