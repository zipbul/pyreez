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

  // Resolve all requested models
  const requestedModels = options.modelIds.map(resolveModel);

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
