/**
 * Router — full pipeline: CLASSIFY → PROFILE → SELECT.
 * Entry point for the Pyreez routing system.
 */

import { classifyByRules } from "../classify/classifier";
import { profileTask } from "../profile/profiler";
import { selectModel } from "./selector";
import { ModelRegistry } from "../model/registry";
import type { ClassifyResult } from "../classify/types";
import type { ModelInfo } from "../model/types";
import type { TaskRequirement } from "../profile/types";
import type { BudgetConfig, SelectResult, FallbackSelectResult } from "./types";

/**
 * Complete route result including all pipeline phases.
 */
export interface RouteResult {
  classification: ClassifyResult;
  requirement: TaskRequirement;
  selection: SelectResult | FallbackSelectResult;
}

/**
 * Injectable dependencies for route pipeline (DI for testing).
 */
export interface RouteDeps {
  classify: (prompt: string) => ClassifyResult | null;
  profile: (result: ClassifyResult, prompt: string) => TaskRequirement;
  select: (
    models: ModelInfo[],
    req: TaskRequirement,
    budget: BudgetConfig,
  ) => SelectResult | FallbackSelectResult;
  getModels: () => ModelInfo[];
}

const DEFAULT_BUDGET: BudgetConfig = { perRequest: 1.0 };

/** Default production dependencies. */
function defaultDeps(): RouteDeps {
  return {
    classify: classifyByRules,
    profile: profileTask,
    select: selectModel,
    getModels: () => new ModelRegistry().getAll(),
  };
}

/**
 * Route a user prompt through the full pipeline.
 * Returns null if the prompt cannot be classified (LLM fallback needed).
 */
export function route(
  prompt: string,
  budget?: BudgetConfig,
  deps: RouteDeps = defaultDeps(),
): RouteResult | null {
  // Phase 1: CLASSIFY
  const classification = deps.classify(prompt);
  if (!classification) return null;

  // Phase 3: PROFILE
  const requirement = deps.profile(classification, prompt);

  // Phase 4: SELECT
  const models = deps.getModels();
  const selection = deps.select(models, requirement, budget ?? DEFAULT_BUDGET);

  return { classification, requirement, selection };
}
