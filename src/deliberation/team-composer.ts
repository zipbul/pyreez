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
import { BINARY_DIMENSIONS } from "../axis/types";
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
 * Uses BT uncertainty penalty: score = mu * (1 / (1 + sigma / SIGMA_BASE)) * weight
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

// -- Thompson Sampling Selection --

/** Minimum observations before exclusion recommendation is considered. */
const MIN_OBS_FOR_EXCLUSION = 10;
/** Wilson score lower bound threshold for exclusion. */
const EXCLUSION_THRESHOLD = 0.3;
/** Minimum observations before a model is considered "known" (not cold-start). */
const MIN_OBS = 5;

/**
 * Wilson score interval lower bound.
 * Robust for small sample sizes, bounded [0, 1].
 */
export function wilsonLower(passRate: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const denominator = 1 + (z * z) / n;
  const center = passRate + (z * z) / (2 * n);
  const spread = z * Math.sqrt((passRate * (1 - passRate) + (z * z) / (4 * n)) / n);
  return Math.max(0, (center - spread) / denominator);
}

/**
 * Check if a model should be excluded from a domain+taskType based on Wilson score.
 */
export function shouldExclude(cell: SkillCell | null | undefined): boolean {
  if (!cell || cell.total < MIN_OBS_FOR_EXCLUSION) return false;

  const fc = cell.dimensions.factually_correct;
  if (!fc) return false;

  const n = fc.alpha + fc.beta - 2; // subtract 2 for initial priors
  if (n < MIN_OBS_FOR_EXCLUSION) return false;

  const passRate = fc.alpha / (fc.alpha + fc.beta);
  return wilsonLower(passRate, n) < EXCLUSION_THRESHOLD;
}

/**
 * Get cold-start prior for Thompson Sampling.
 * Tier 1: same family + same domain → use family data with inflated variance.
 * Tier 2: same family + any domain → weaker transfer.
 * Tier 3: no data → uniform (alpha=1, beta=1).
 */
function getColdStartAlphaBeta(
  model: ModelInfo,
  domain: string,
  taskType: string,
  store: SkillCellStore,
): { alpha: number; beta: number } {
  const family = model.family ?? model.provider;

  // Tier 1: same family, same domain+taskType
  const familyCells = store.getAllForFamily(family, domain, taskType);
  if (familyCells.length > 0) {
    const totalObs = familyCells.reduce((sum, c) => sum + c.total, 0);
    if (totalObs >= 10) {
      // Use family average with inflated variance (wide prior)
      let passSum = 0, totalDims = 0;
      for (const cell of familyCells) {
        for (const dim of BINARY_DIMENSIONS) {
          const p = cell.dimensions[dim];
          if (p) { passSum += p.alpha - 1; totalDims += (p.alpha - 1) + (p.beta - 1); }
        }
      }
      const familyRate = totalDims > 0 ? passSum / totalDims : 0.5;
      // Inflated variance: use small alpha+beta to keep distribution wide
      return { alpha: 1 + familyRate * 3, beta: 1 + (1 - familyRate) * 3 };
    }
  }

  // Tier 2: same family, any domain — deferred to future implementation.
  // Would require reverse family→modelIds lookup + cross-domain aggregation.

  // Tier 3: uniform prior
  return { alpha: 1, beta: 1 };
}

/**
 * Select models via Thompson Sampling over SkillCell Beta posteriors.
 * Domain-specific selection with provider diversity and cold-start exploration.
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

  // Separate cold-start models for mandatory exploration
  const coldModels: ModelInfo[] = [];
  const warmModels: ModelInfo[] = [];

  for (const model of pool) {
    const cell = store.get(model.id, domain, taskType);
    if (shouldExclude(cell)) continue; // Wilson exclusion

    if (!cell || cell.total < MIN_OBS) {
      coldModels.push(model);
    } else {
      warmModels.push(model);
    }
  }

  // Sample scores for warm models
  const samples: { model: ModelInfo; score: number }[] = [];
  for (const model of warmModels) {
    const cell = store.get(model.id, domain, taskType)!;
    let dimSum = 0;
    for (const dim of BINARY_DIMENSIONS) {
      const params = cell.dimensions[dim] ?? { alpha: 1, beta: 1 };
      dimSum += betaSample(params.alpha, params.beta);
    }
    samples.push({ model, score: dimSum / BINARY_DIMENSIONS.length });
  }

  // Sample scores for cold models (using priors)
  for (const model of coldModels) {
    const prior = getColdStartAlphaBeta(model, domain, taskType, store);
    let dimSum = 0;
    for (const _dim of BINARY_DIMENSIONS) {
      dimSum += betaSample(prior.alpha, prior.beta);
    }
    samples.push({ model, score: dimSum / BINARY_DIMENSIONS.length });
  }

  // Sort by sampled score (NOT by mean)
  samples.sort((a, b) => b.score - a.score);

  // Enforce provider diversity: max ceil(count/2) from same provider
  const maxPerProvider = Math.ceil(count / 2);
  const providerCounts = new Map<string, number>();
  const selected: ModelInfo[] = [];

  // Reserve 1 slot for cold-start if available and count >= 3
  if (coldModels.length > 0 && count >= 3) {
    // Reserve 1 slot for cold-start exploration
    const coldPick = coldModels[Math.floor(Math.random() * coldModels.length)]!;
    selected.push(coldPick);
    providerCounts.set(coldPick.provider, 1);
  }

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
