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
import type { SkillCell } from "../axis/types";
import { BINARY_DIMENSIONS, getDomainWeights } from "../axis/types";
import type { SkillCellStore } from "../model/skillcell-store";
import { betaSample } from "../math/beta";

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
      "Verify models have 'available: true' in scores/models.json",
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

// -- Capability-Based Role Ordering --

/**
 * Dimension weights for each deliberation role.
 * advocate (index 0): values REASONING (strong arguments, evidence chains).
 * critic (index 1): values ANALYSIS (finding flaws, decomposing assumptions).
 * wildcard (index 2): values CREATIVITY (unconventional angles).
 */
const ROLE_DIMS: readonly { dimension: CapabilityDimension; weight: number }[][] = [
  [{ dimension: "REASONING", weight: 0.5 }, { dimension: "CONFIDENCE_CALIBRATION", weight: 0.3 }, { dimension: "ANALYSIS", weight: 0.2 }],
  [{ dimension: "ANALYSIS", weight: 0.5 }, { dimension: "HALLUCINATION_RESISTANCE", weight: 0.3 }, { dimension: "REASONING", weight: 0.2 }],
  [{ dimension: "CREATIVITY", weight: 0.5 }, { dimension: "AMBIGUITY_HANDLING", weight: 0.3 }, { dimension: "REASONING", weight: 0.2 }],
];

/**
 * Reorder workers so that each worker's capability profile best matches
 * the deliberation role assigned to its index position.
 */
export function orderWorkersByRole(
  workers: readonly TeamMember[],
  getById: (id: string) => ModelInfo | undefined,
): TeamMember[] {
  if (workers.length <= 1) return [...workers];

  const infos = workers.map((w, i) => ({ member: w, info: getById(w.model), origIdx: i }));

  if (infos.some((x) => !x.info)) return [...workers];

  const assigned = new Set<number>();
  const result: TeamMember[] = new Array(workers.length);

  for (let slot = 0; slot < workers.length; slot++) {
    const roleDims = ROLE_DIMS[slot % ROLE_DIMS.length]!;
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < infos.length; i++) {
      if (assigned.has(i)) continue;
      const score = scoreDimensions(infos[i]!.info!, roleDims);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    assigned.add(bestIdx);
    result[slot] = infos[bestIdx]!.member;
  }

  return result;
}

// -- Thompson Sampling Selection (3-Tier Hierarchical Blend) --

/**
 * Blend schedule: maps observation count to weight on the specific tier.
 * Remainder goes to the parent tier. Piecewise-linear interpolation.
 */
const BLEND_SCHEDULE: readonly [number, number][] = [
  [0, 0.0], [1, 0.15], [3, 0.40], [5, 0.60],
  [8, 0.80], [12, 0.90], [20, 0.95], [50, 1.0],
];

/** Get blend weight for a specific tier given observation count. */
export function blendWeight(n: number): number {
  if (n <= 0) return 0;
  if (n >= BLEND_SCHEDULE[BLEND_SCHEDULE.length - 1]![0]) return 1.0;
  for (let i = 0; i < BLEND_SCHEDULE.length - 1; i++) {
    const [lo, wLo] = BLEND_SCHEDULE[i]!;
    const [hi, wHi] = BLEND_SCHEDULE[i + 1]!;
    if (n >= lo && n < hi) {
      const frac = (n - lo) / (hi - lo);
      return wLo + frac * (wHi - wLo);
    }
  }
  return 0;
}

/**
 * Aggregate Beta params across multiple cells for a dimension.
 * Returns pooled alpha/beta from all cells, or uniform prior if no data.
 */
function aggregateParams(cells: readonly SkillCell[], dim: string): { alpha: number; beta: number; total: number } {
  let alpha = 1, beta = 1, total = 0;
  for (const cell of cells) {
    const p = cell.dimensions[dim];
    if (p) {
      alpha += p.alpha - 1; // subtract prior, add observations
      beta += p.beta - 1;
      total += cell.total;
    }
  }
  return { alpha, beta, total };
}

/**
 * 3-tier hierarchical Thompson sample for a single dimension.
 *
 * Tier 1: model:domain:taskType (specific cell)
 * Tier 2: model:domain (aggregated across taskTypes)
 * Tier 3: family:domain:taskType (family-level)
 *
 * Blends tiers based on observation count at each level.
 */
function hierarchicalSample(
  model: ModelInfo,
  domain: string,
  taskType: string,
  dim: string,
  store: SkillCellStore,
): number {
  const family = model.family ?? model.provider;

  // Tier 3: family-level (broadest)
  const familyCells = store.getAllForFamily(family, domain, taskType);
  const t3 = aggregateParams(familyCells, dim);
  const s3 = betaSample(t3.alpha, t3.beta);

  // Tier 2: model:domain (all taskTypes for this model+domain)
  const domainCells = store.getForDomain(model.id, domain);
  const t2 = aggregateParams(domainCells, dim);
  const w2 = blendWeight(t2.total);
  const s2 = w2 * betaSample(t2.alpha, t2.beta) + (1 - w2) * s3;

  // Tier 1: model:domain:taskType (specific)
  const cell = store.get(model.id, domain, taskType);
  const params = cell?.dimensions[dim] ?? { alpha: 1, beta: 1 };
  const n1 = cell?.total ?? 0;
  const w1 = blendWeight(n1);
  return w1 * betaSample(params.alpha, params.beta) + (1 - w1) * s2;
}

/**
 * Select models via Thompson Sampling with 3-tier hierarchical blending.
 * Replaces Wilson score exclusion with smooth blend schedule.
 *
 * @param domain - Task domain for skill cell lookup.
 * @param taskType - Task type for skill cell lookup.
 * @param pool - Available models to choose from.
 * @param count - Number of models to select.
 * @param store - SkillCell store with accumulated feedback data.
 */
export function thompsonSelect(
  domain: string,
  taskType: string,
  pool: readonly ModelInfo[],
  count: number,
  store: SkillCellStore,
): ModelInfo[] {
  if (pool.length <= count) return [...pool];

  // Domain-specific dimension weights for Thompson Sampling
  const weights = getDomainWeights(domain);

  // Score all models using hierarchical blend (no warm/cold split needed)
  const samples: { model: ModelInfo; score: number }[] = [];
  for (const model of pool) {
    let score = 0;
    for (const dim of BINARY_DIMENSIONS) {
      score += (weights[dim] ?? 0.20) * hierarchicalSample(model, domain, taskType, dim, store);
    }
    samples.push({ model, score });
  }

  // Sort by sampled score (NOT by mean)
  samples.sort((a, b) => b.score - a.score);

  // Enforce provider diversity: max ceil(count/2) from same provider
  const maxPerProvider = Math.ceil(count / 2);
  const providerCounts = new Map<string, number>();
  const selected: ModelInfo[] = [];

  // Hierarchical blend ensures cold-start models get exploration via parent-tier variance.
  // No mandatory cold slot needed — natural Thompson exploration handles it.

  for (const { model } of samples) {
    if (selected.length >= count) break;
    if (selected.includes(model)) continue; // skip if already in cold slot

    const provCount = providerCounts.get(model.provider) ?? 0;
    if (provCount >= maxPerProvider) continue;

    selected.push(model);
    providerCounts.set(model.provider, provCount + 1);
  }

  return selected;
}
