/**
 * Team Composer — builds workers + leader for Diverge-Synth deliberation.
 *
 * Leader: best JUDGMENT composite score.
 * Workers: all remaining models.
 *
 * @module Team Composer
 */

import type { ModelInfo, CapabilityDimension } from "../model/types";
import { SIGMA_BASE } from "../model/types";
import type { TeamComposition, TeamMember } from "./types";

// -- Public types --

export interface ComposeTeamOptions {
  readonly task: string;
  readonly modelIds: readonly string[];
  readonly overrides?: {
    readonly leader?: string;
  };
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

export const LEADER_DIMS: WeightedDimension[] = [
  { dimension: "JUDGMENT", weight: 0.4 },
  { dimension: "ANALYSIS", weight: 0.3 },
  { dimension: "REASONING", weight: 0.2 },
  { dimension: "SELF_CONSISTENCY", weight: 0.1 },
];

// -- Helper functions --

/**
 * Extract provider prefix from model ID.
 * "openai/gpt-5" → "openai", "gpt-5" → "gpt-5"
 */
export function extractProvider(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex === -1) {
    return modelId;
  }
  return modelId.slice(0, slashIndex);
}

/**
 * Score a model against weighted dimensions.
 * Uses BT uncertainty penalty: score = mu * (1 / (1 + sigma / SIGMA_BASE)) * weight
 */
export function scoreDimensions(
  model: ModelInfo,
  dims: readonly WeightedDimension[],
): number {
  let total = 0;
  for (const { dimension, weight } of dims) {
    const rating = model.capabilities[dimension];
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
 * Filter models by minimum capability score across LEADER_DIMS.
 * Soft fallback: returns all models if fewer than `minCount` qualify.
 *
 * @param models - Models to filter.
 * @param minScore - Minimum scoreDimensions() threshold.
 * @param minCount - Minimum models required; falls back to unfiltered if not met.
 */
export function filterByCapability(
  models: readonly ModelInfo[],
  minScore: number,
  minCount: number = 2,
): ModelInfo[] {
  const qualifying = models.filter((m) => {
    // Skip models without proper capabilities (graceful degradation)
    const hasCapabilities = LEADER_DIMS.every(
      ({ dimension }) => m.capabilities[dimension] != null,
    );
    if (!hasCapabilities) return true; // include uncalibrated models
    return scoreDimensions(m, LEADER_DIMS) >= minScore;
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
 * This ensures teams span multiple LLM providers, reducing correlated
 * errors from shared training data.
 *
 * @param models - Available models to select from.
 * @param count - Maximum team size.
 * @returns Selected models with provider diversity guarantee.
 */
export function selectDiverseModels(
  models: readonly ModelInfo[],
  count: number,
): ModelInfo[] {
  if (models.length <= count) {
    // Even when all models fit, still sort by provider diversity
    // to ensure team-composer sees providers in round-robin order.
    if (models.length <= 1) return [...models];
    // Fall through to diversity selection logic
    count = models.length;
  }

  // Apply capability filter before diversity selection (soft: falls back to all if too few qualify)
  const qualified = filterByCapability(models, 300, count);

  // Group by provider, sorted by JUDGMENT composite within each group
  const byProvider = new Map<string, ModelInfo[]>();
  for (const model of qualified) {
    const provider = extractProvider(model.id);
    const group = byProvider.get(provider) ?? [];
    group.push(model);
    byProvider.set(provider, group);
  }

  // Sort each provider's models by LEADER_DIMS score descending
  for (const group of byProvider.values()) {
    group.sort((a, b) => scoreDimensions(b, LEADER_DIMS) - scoreDimensions(a, LEADER_DIMS));
  }

  // Round-robin: take best from each provider, then second-best, etc.
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
 * Compose a deliberation team: leader (best judgment) + workers (rest).
 *
 * @param options - Task, model IDs to use, optional leader override.
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
    throw new Error("At least one model is required");
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

  // Resolve all requested models, filtering by capability
  const requestedModels = filterByCapability(
    options.modelIds.map(resolveModel),
    300, // minimum LEADER_DIMS composite score
  );

  // Leader selection
  let leader: TeamMember;
  if (options.overrides?.leader) {
    const leaderModel = resolveModel(options.overrides.leader);
    leader = { model: leaderModel.id, role: "leader" };
  } else {
    // Auto-select: best JUDGMENT composite score
    const best = selectTopModel(requestedModels, LEADER_DIMS);
    leader = { model: best!.id, role: "leader" };
  }

  // Workers: everyone except leader
  const workerModels = requestedModels.filter((m) => m.id !== leader.model);
  // If only 1 model, it's both leader and the sole worker
  if (workerModels.length === 0) {
    workerModels.push(requestedModels[0]!);
  }

  const workers: TeamMember[] = workerModels.map((m) => ({
    model: m.id,
    role: "worker" as const,
  }));

  return { workers, leader };
}
