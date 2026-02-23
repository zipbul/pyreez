/**
 * Team Composer — Diversity Engine for deliberation team assembly.
 *
 * Composes a heterogeneous team (producer, reviewers, leader) with
 * diversity guarantee (≥3 different providers when possible).
 *
 * @module Diversity Engine
 */

import type { ModelInfo, CapabilityDimension } from "../model/types";
import { SIGMA_BASE } from "../model/types";
import type { TeamComposition, TeamMember } from "./types";

// -- Public types --

export interface ComposeTeamOptions {
  readonly task: string;
  readonly perspectives: readonly string[];
  readonly overrides?: {
    readonly producer?: string;
    readonly reviewers?: readonly string[];
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

const PRODUCER_DIMS: WeightedDimension[] = [
  { dimension: "CODE_GENERATION", weight: 0.35 },
  { dimension: "CREATIVITY", weight: 0.25 },
  { dimension: "REASONING", weight: 0.2 },
  { dimension: "INSTRUCTION_FOLLOWING", weight: 0.2 },
];

const LEADER_DIMS: WeightedDimension[] = [
  { dimension: "JUDGMENT", weight: 0.4 },
  { dimension: "ANALYSIS", weight: 0.3 },
  { dimension: "REASONING", weight: 0.2 },
  { dimension: "SELF_CONSISTENCY", weight: 0.1 },
];

// -- Perspective → dimension keyword mappings --

interface PerspectiveMapping {
  pattern: RegExp;
  dimensions: WeightedDimension[];
}

const PERSPECTIVE_MAPPINGS: PerspectiveMapping[] = [
  {
    pattern: /보안|security|취약|vuln/i,
    dimensions: [
      { dimension: "HALLUCINATION_RESISTANCE", weight: 0.4 },
      { dimension: "DEBUGGING", weight: 0.3 },
      { dimension: "ANALYSIS", weight: 0.3 },
    ],
  },
  {
    pattern: /성능|performance|최적화|optim|속도|latency/i,
    dimensions: [
      { dimension: "SPEED", weight: 0.3 },
      { dimension: "SYSTEM_THINKING", weight: 0.3 },
      { dimension: "ANALYSIS", weight: 0.2 },
      { dimension: "REASONING", weight: 0.2 },
    ],
  },
  {
    pattern: /품질|quality|코드|code|가독|readab|clean/i,
    dimensions: [
      { dimension: "CODE_UNDERSTANDING", weight: 0.4 },
      { dimension: "SELF_CONSISTENCY", weight: 0.3 },
      { dimension: "ANALYSIS", weight: 0.3 },
    ],
  },
  {
    pattern: /창의|creat|design|설계|아키텍처|architect/i,
    dimensions: [
      { dimension: "CREATIVITY", weight: 0.4 },
      { dimension: "SYSTEM_THINKING", weight: 0.3 },
      { dimension: "REASONING", weight: 0.3 },
    ],
  },
  {
    pattern: /수학|math|논리|logic/i,
    dimensions: [
      { dimension: "MATH_REASONING", weight: 0.4 },
      { dimension: "REASONING", weight: 0.35 },
      { dimension: "ANALYSIS", weight: 0.25 },
    ],
  },
];

const DEFAULT_REVIEWER_DIMS: WeightedDimension[] = [
  { dimension: "ANALYSIS", weight: 0.4 },
  { dimension: "JUDGMENT", weight: 0.35 },
  { dimension: "REASONING", weight: 0.25 },
];

// -- Minimum diversity threshold --

const MIN_PROVIDERS = 3;

// -- Helper functions --

/**
 * Extract provider prefix from model ID.
 * "openai/gpt-4.1" → "openai", "gpt-4.1" → "gpt-4.1"
 */
export function extractProvider(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex === -1) {
    return modelId;
  }
  return modelId.slice(0, slashIndex);
}

/**
 * Map a perspective string to capability dimensions with weights.
 * First matching keyword pattern wins.
 */
export function perspectiveToDimensions(
  perspective: string,
): WeightedDimension[] {
  for (const mapping of PERSPECTIVE_MAPPINGS) {
    if (mapping.pattern.test(perspective)) {
      return mapping.dimensions;
    }
  }
  return DEFAULT_REVIEWER_DIMS;
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
 * Compose a deliberation team with diversity guarantee.
 *
 * Algorithm:
 * 1. Validate inputs (task non-empty, perspectives ≥ 2)
 * 2. Apply overrides (validate model IDs exist)
 * 3. Auto-select remaining roles based on capability dimensions
 * 4. Ensure diversity (≥3 distinct providers when possible)
 * 5. Return TeamComposition
 *
 * @throws Error if task is empty/whitespace
 * @throws Error if perspectives < 2
 * @throws Error if override model ID not found in registry
 * @throws Error if no models available and no overrides
 */
export function composeTeam(
  options: ComposeTeamOptions,
  deps: ComposeTeamDeps,
): TeamComposition {
  // -- Validate --

  if (!options.task || options.task.trim().length === 0) {
    throw new Error("Task description must be a non-empty string");
  }
  if (options.perspectives.length < 2) {
    throw new Error("At least 2 perspectives are required");
  }

  const models = deps.getModels();
  if (models.length === 0 && !options.overrides) {
    throw new Error("No models available to compose a team");
  }

  // -- Helper to resolve override ID --

  const resolveModel = (id: string): ModelInfo => {
    const found = deps.getById
      ? deps.getById(id)
      : models.find((m) => m.id === id);
    if (!found) {
      throw new Error(`Model "${id}" not found in registry`);
    }
    return found;
  };

  // -- Track used model IDs (for exclusion during auto-select) --

  const usedIds = new Set<string>();

  // -- Producer --

  let producer: TeamMember;
  if (options.overrides?.producer) {
    const model = resolveModel(options.overrides.producer);
    producer = { model: model.id, role: "producer" };
  } else {
    if (models.length === 0) {
      throw new Error("No models available to auto-select producer");
    }
    const best = selectTopModel(models, PRODUCER_DIMS);
    producer = { model: best!.id, role: "producer" };
  }
  usedIds.add(producer.model);

  // -- Reviewers --

  const reviewers: TeamMember[] = [];
  if (
    options.overrides?.reviewers &&
    options.overrides.reviewers.length > 0
  ) {
    for (let i = 0; i < options.overrides.reviewers.length; i++) {
      const model = resolveModel(options.overrides.reviewers[i]!);
      reviewers.push({
        model: model.id,
        role: "reviewer",
        perspective: options.perspectives[i] ?? `perspective-${i}`,
      });
      usedIds.add(model.id);
    }
  } else {
    for (const perspective of options.perspectives) {
      const dims = perspectiveToDimensions(perspective);
      // Prefer different model from already assigned — soft preference (no exclusion)
      const best = selectTopModel(models, dims);
      if (best) {
        reviewers.push({
          model: best.id,
          role: "reviewer",
          perspective,
        });
        usedIds.add(best.id);
      }
    }
  }

  // -- Leader --

  let leader: TeamMember;
  if (options.overrides?.leader) {
    const model = resolveModel(options.overrides.leader);
    leader = { model: model.id, role: "leader" };
  } else {
    if (models.length === 0) {
      throw new Error("No models available to auto-select leader");
    }
    const best = selectTopModel(models, LEADER_DIMS);
    leader = { model: best!.id, role: "leader" };
  }
  usedIds.add(leader.model);

  // -- Diversity enforcement --

  const team: TeamComposition = {
    producer,
    reviewers,
    leader,
  };

  // Only enforce diversity on non-overridden members
  if (hasAllOverrides(options)) {
    return team;
  }

  return enforceDiversity(team, models);
}

// -- Diversity helpers --

function hasAllOverrides(options: ComposeTeamOptions): boolean {
  const o = options.overrides;
  if (!o) return false;
  return !!(
    o.producer &&
    o.reviewers &&
    o.reviewers.length > 0 &&
    o.leader
  );
}

function enforceDiversity(
  team: TeamComposition,
  models: readonly ModelInfo[],
): TeamComposition {
  const allMembers = [
    team.producer,
    ...team.reviewers,
    team.leader,
  ];
  const providers = new Set(allMembers.map((m) => extractProvider(m.model)));

  if (providers.size >= MIN_PROVIDERS) {
    return team;
  }

  // Available providers in registry
  const availableProviders = new Set(models.map((m) => extractProvider(m.id)));
  if (availableProviders.size < MIN_PROVIDERS) {
    // Not enough providers in registry — best effort, return as-is
    return team;
  }

  // Find providers already used
  const usedProviders = new Set(providers);

  // Find providers NOT yet used
  const unusedProviders = new Set<string>();
  for (const p of availableProviders) {
    if (!usedProviders.has(p)) {
      unusedProviders.add(p);
    }
  }

  // Try to swap reviewers first (most flexible role)
  const newReviewers = [...team.reviewers];
  let currentProviders = new Set(usedProviders);

  for (let i = 0; i < newReviewers.length && currentProviders.size < MIN_PROVIDERS; i++) {
    const reviewer = newReviewers[i]!;
    const reviewerProvider = extractProvider(reviewer.model);

    // Count how many team members share this provider
    const sameProviderCount = [team.producer, ...newReviewers, team.leader].filter(
      (m) => extractProvider(m.model) === reviewerProvider,
    ).length;

    // Only swap if this provider has duplicates
    if (sameProviderCount <= 1) continue;

    // Find a model from an unused provider that's good for this perspective
    for (const unusedProvider of unusedProviders) {
      const candidateModels = models.filter(
        (m) => extractProvider(m.id) === unusedProvider,
      );
      if (candidateModels.length === 0) continue;

      const dims = reviewer.perspective
        ? perspectiveToDimensions(reviewer.perspective)
        : DEFAULT_REVIEWER_DIMS;
      const best = selectTopModel(candidateModels, dims);

      if (best) {
        newReviewers[i] = {
          model: best.id,
          role: "reviewer",
          perspective: reviewer.perspective,
        };
        currentProviders.add(unusedProvider);
        unusedProviders.delete(unusedProvider);
        break;
      }
    }
  }

  return {
    producer: team.producer,
    reviewers: newReviewers,
    leader: team.leader,
  };
}
