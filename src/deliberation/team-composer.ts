/**
 * Team Composer — builds worker team for deliberation.
 *
 * Model scoring uses benchmark data from .pyreez/models.jsonc.
 * Fallback: cost-descending (expensive models are generally more capable).
 *
 * @module Team Composer
 */

import type { ModelInfo } from "../model/types";
import type { TeamComposition, TeamMember } from "./types";

// -- Error types --

export class NoModelsAvailableError extends Error {
  readonly code = "NO_MODELS_AVAILABLE";
  readonly remediation: string[];

  constructor(reason: string, remediation?: string[]) {
    super(reason);
    this.name = "NoModelsAvailableError";
    this.remediation = remediation ?? [
      "Check that at least one provider API key is configured",
      "Verify models have 'available: true' in .pyreez/models.jsonc",
      "If models were recently failing, they may be on cooldown — retry after a few minutes",
    ];
  }
}

// -- Public types --

export interface ComposeTeamOptions {
  readonly task: string;
  readonly modelIds: readonly string[];
}

export interface ComposeTeamDeps {
  getModels: () => ModelInfo[];
  getById?: (id: string) => ModelInfo | undefined;
}

// -- Scoring --

import { extractProvider } from "./provider-util";
export { extractProvider };

/**
 * Score a model using benchmark data.
 * Average of all available benchmark category scores.
 * Fallback: output cost as proxy (higher cost ≈ higher quality).
 */
/** Full benchmark has 7 categories. Fewer categories → less reliable score. */
const FULL_BENCHMARK_CATEGORIES = 7;

export function scoreModel(model: ModelInfo): number {
  if (model.benchmark) {
    const values = Object.values(model.benchmark);
    if (values.length > 0) {
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      // Penalize incomplete benchmarks: coverage ratio scales the score
      const coverage = values.length / FULL_BENCHMARK_CATEGORIES;
      return avg * coverage;
    }
  }
  // Fallback: cost proxy (normalize to 0-100 scale, cap at $25/1M output)
  return Math.min(model.cost.outputPer1M / 25 * 100, 100);
}

/**
 * Select up to `count` models with maximum provider diversity.
 * Picks the best-scoring model from each provider in round-robin.
 */
export function selectDiverseModels(
  models: readonly ModelInfo[],
  count: number,
): ModelInfo[] {
  if (models.length <= count) {
    if (models.length <= 1) return [...models];
    count = models.length;
  }

  const byProvider = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const provider = extractProvider(model.id);
    const group = byProvider.get(provider) ?? [];
    group.push(model);
    byProvider.set(provider, group);
  }

  for (const group of byProvider.values()) {
    group.sort((a, b) => scoreModel(b) - scoreModel(a));
  }

  const selected: ModelInfo[] = [];
  const providers = [...byProvider.keys()];
  let round = 0;

  while (selected.length < count) {
    let addedThisRound = false;
    for (const provider of providers) {
      if (selected.length >= count) break;
      const group = byProvider.get(provider)!;
      if (round < group.length) {
        selected.push(group[round]!);
        addedThisRound = true;
      }
    }
    if (!addedThisRound) break;
    round++;
  }

  return selected;
}

// -- Main function --

export function composeTeam(
  options: ComposeTeamOptions,
  deps: ComposeTeamDeps,
): TeamComposition {
  if (!options.task || options.task.trim().length === 0) {
    throw new Error("Task description must be a non-empty string");
  }
  if (options.modelIds.length === 0) {
    throw new NoModelsAvailableError(
      "No models available for deliberation. At least one model is required.",
    );
  }

  const models = deps.getModels();
  const resolveModel = (id: string): ModelInfo => {
    const found = deps.getById
      ? deps.getById(id)
      : models.find((m) => m.id === id);
    if (!found) {
      throw new Error(`Model "${id}" not found in registry`);
    }
    return found;
  };

  const requestedModels = options.modelIds.map(resolveModel);
  const workers: TeamMember[] = requestedModels.map((m) => ({
    model: m.id,
    role: "worker" as const,
  }));

  return { workers };
}
