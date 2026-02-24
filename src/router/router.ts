/**
 * Router — full pipeline: CLASSIFY → PROFILE → SELECT.
 * Entry point for the Pyreez routing system.
 */

import { classifyByRules } from "../classify/classifier";
import { profileTask } from "../profile/profiler";
import { selectModel } from "./selector";
import { ModelRegistry } from "../model/registry";
import type { ClassifyResult, TaskDomain, Complexity } from "../classify/types";
import type { ModelInfo } from "../model/types";
import type { TaskRequirement } from "../profile/types";
import type { BudgetConfig, SelectResult, FallbackSelectResult, RouteHints } from "./types";

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
    getModels: () => new ModelRegistry().getAvailable(),
  };
}

/** Default task types per domain — used when domain_hint provides domain without specific taskType. */
const DEFAULT_DOMAIN_TASK_TYPE: Record<TaskDomain, string> = {
  IDEATION: "BRAINSTORM",
  PLANNING: "GOAL_DEFINITION",
  REQUIREMENTS: "ACCEPTANCE_CRITERIA",
  ARCHITECTURE: "SYSTEM_DESIGN",
  CODING: "IMPLEMENT_FEATURE",
  TESTING: "UNIT_TEST_WRITE",
  REVIEW: "CODE_REVIEW",
  DOCUMENTATION: "API_DOC",
  DEBUGGING: "FIX_IMPLEMENT",
  OPERATIONS: "DEPLOY_PLAN",
  RESEARCH: "TECH_RESEARCH",
  COMMUNICATION: "EXPLAIN",
};

/**
 * Route a user prompt through the full pipeline.
 * Returns null if the prompt cannot be classified (LLM fallback needed).
 *
 * When hints are provided:
 * - domain_hint bypasses keyword classification entirely.
 * - complexity_hint overrides the estimated complexity.
 */
export function route(
  prompt: string,
  budget?: BudgetConfig,
  deps: RouteDeps = defaultDeps(),
  hints?: RouteHints,
): RouteResult | null {
  // Phase 1: CLASSIFY (with hint support)
  let classification: ClassifyResult | null;

  if (hints?.domain_hint) {
    classification = {
      domain: hints.domain_hint,
      taskType: (hints.task_type_hint ?? DEFAULT_DOMAIN_TASK_TYPE[hints.domain_hint]) as any,
      complexity: hints.complexity_hint ?? "moderate",
      criticality: "medium",
      method: "hint" as any,
    };
  } else {
    classification = deps.classify(prompt);
    if (!classification) return null;

    if (hints?.complexity_hint) {
      classification = { ...classification, complexity: hints.complexity_hint };
    }
  }

  // Phase 3: PROFILE
  const requirement = deps.profile(classification, prompt);

  // Phase 4: SELECT
  const models = deps.getModels();
  const selection = deps.select(models, requirement, budget ?? DEFAULT_BUDGET);

  return { classification, requirement, selection };
}
