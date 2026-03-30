/**
 * Team Composer — builds worker team for deliberation.
 *
 * All models are workers. Host handles synthesis.
 *
 * @module Team Composer
 */

import type { ModelInfo, CapabilityDimension } from "../model/types";
import { SIGMA_BASE } from "../model/types";
import type { TeamComposition, TeamMember } from "./types";

// -- Error types --

/**
 * Thrown when no models are available for deliberation.
 * Includes structured error code and remediation hints for host agents.
 */
export class NoModelsAvailableError extends Error {
  readonly code = "NO_MODELS_AVAILABLE";
  readonly remediation: string[];

  constructor(reason: string, remediation?: string[]) {
    super(reason);
    this.name = "NoModelsAvailableError";
    this.remediation = remediation ?? [
      "Check that at least one provider API key is configured (PYREEZ_ANTHROPIC_KEY, PYREEZ_GOOGLE_API_KEY, etc.)",
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

// -- Dimension weight sets --

interface WeightedDimension {
  dimension: CapabilityDimension;
  weight: number;
}

export const SELECTION_DIMS: WeightedDimension[] = [
  { dimension: "JUDGMENT", weight: 0.4 },
  { dimension: "ANALYSIS", weight: 0.3 },
  { dimension: "REASONING", weight: 0.2 },
  { dimension: "SELF_CONSISTENCY", weight: 0.1 },
];

// -- Helper functions --

import { extractProvider } from "./provider-util";
// Re-export for downstream consumers
export { extractProvider };

/**
 * Score a model against weighted dimensions.
 * Uses uncertainty penalty: score = mu * (1 / (1 + sigma / SIGMA_BASE)) * weight
 */
export function scoreDimensions(
  model: ModelInfo,
  dims: readonly WeightedDimension[],
): number {
  let total = 0;
  for (const { dimension, weight } of dims) {
    const rating = model.capabilities[dimension];
    if (!rating) continue; // skip missing dimensions gracefully
    const uncertaintyPenalty = 1 / (1 + rating.sigma / SIGMA_BASE);
    total += rating.mu * uncertaintyPenalty * weight;
  }
  return total;
}

/**
 * Select the top-scoring model from a list, optionally excluding some.
 */
export function selectTopModel(
  models: readonly ModelInfo[],
  dims: readonly WeightedDimension[],
  exclude?: ReadonlySet<string>,
): ModelInfo | undefined {
  let best: ModelInfo | undefined;
  let bestScore = -Infinity;

  for (const model of models) {
    if (exclude?.has(model.id)) continue;
    const score = scoreDimensions(model, dims);
    if (score > bestScore) {
      bestScore = score;
      best = model;
    }
  }

  return best;
}

// -- Capability Filtering --

/**
 * Filter models by minimum capability score across SELECTION_DIMS.
 * Soft fallback: returns all models if fewer than `minCount` qualify.
 */
export function filterByCapability(
  models: readonly ModelInfo[],
  minScore: number,
  minCount: number = 2,
): ModelInfo[] {
  const qualifying = models.filter((m) => {
    const hasCapabilities = SELECTION_DIMS.every(
      ({ dimension }) => m.capabilities[dimension] != null,
    );
    if (!hasCapabilities) return true; // include uncalibrated models
    return scoreDimensions(m, SELECTION_DIMS) >= minScore;
  });
  if (qualifying.length >= minCount) return qualifying;
  return [...models];
}

// -- Provider Diversity Selection --

/**
 * Select up to `count` models with maximum provider diversity.
 *
 * Algorithm: round-robin across providers, picking the best model
 * (by JUDGMENT composite) from each provider per round.
 */
export function selectDiverseModels(
  models: readonly ModelInfo[],
  count: number,
): ModelInfo[] {
  if (models.length <= count) {
    if (models.length <= 1) return [...models];
    count = models.length;
  }

  const qualified = filterByCapability(models, 300, count);

  const byProvider = new Map<string, ModelInfo[]>();
  for (const model of qualified) {
    const provider = extractProvider(model.id);
    const group = byProvider.get(provider) ?? [];
    group.push(model);
    byProvider.set(provider, group);
  }

  for (const group of byProvider.values()) {
    group.sort((a, b) => scoreDimensions(b, SELECTION_DIMS) - scoreDimensions(a, SELECTION_DIMS));
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

/**
 * Compose a deliberation team: all models become workers.
 *
 * @param options - Task, model IDs to use.
 * @param deps - Model registry access.
 * @throws Error if task is empty or no models available.
 */
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

  const requestedModels = filterByCapability(
    options.modelIds.map(resolveModel),
    300,
  );

  const workers: TeamMember[] = requestedModels.map((m) => ({
    model: m.id,
    role: "worker" as const,
  }));

  return { workers };
}


