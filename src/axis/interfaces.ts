/**
 * Axis slot interfaces — 3-stage pipeline.
 *
 * Stage 1: Understand — Profiler maps TaskClassification → AxisTaskRequirement
 * Stage 2: Select — Selector
 * Stage 3: Execute — DeliberationProtocol
 */

import type {
  TaskClassification,
  AxisTaskRequirement,
  EnsemblePlan,
  DeliberationResult,
  ModelScore,
  BudgetConfig,
  ChatFn,
} from "./types";
import type { TaskNature } from "../deliberation/task-nature";

// -- Profiler --

/**
 * Profiler — maps TaskClassification to capability requirements.
 */
export interface Profiler {
  profile(input: TaskClassification): Promise<AxisTaskRequirement>;
}

// -- Selector --

/**
 * Selector — picks the best model(s) from scored candidates.
 */
export interface Selector {
  select(
    req: AxisTaskRequirement,
    scores: ModelScore[],
    budget: BudgetConfig,
  ): Promise<EnsemblePlan>;
}

// -- Deliberation --

/**
 * Deliberation protocol — coordinates multiple models to produce a final result.
 * scores parameter: role-based protocol uses it for role assignment.
 */
export interface DeliberationOverrides {
  readonly protocol?: "diverge-synth" | "debate";
  readonly maxRounds?: number;
  readonly workerInstructions?: string;
  readonly taskNature?: TaskNature;
}

export interface DeliberationProtocol {
  deliberate(
    task: string,
    plan: EnsemblePlan,
    scores: ModelScore[],
    chat: ChatFn,
    overrides?: DeliberationOverrides,
  ): Promise<DeliberationResult>;
}

