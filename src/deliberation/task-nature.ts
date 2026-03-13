/**
 * TaskNature resolution — determines whether a task produces an artifact or critique.
 *
 * "Artifact" = paste/execute-ready output (code, config, schema, plan).
 * "Critique" = analysis, review, research, brainstorming.
 *
 * @module Task Nature
 */

export type TaskNature = "artifact" | "critique";

/**
 * Task types that produce executable/paste-ready artifacts.
 * Everything else defaults to "critique".
 */
const ARTIFACT_TASKS = new Set([
  // Coding
  "IMPLEMENT_FEATURE",
  "IMPLEMENT_ALGORITHM",
  "SCAFFOLD",
  "TYPE_DEFINITION",
  "ERROR_HANDLING",
  "INTEGRATION",
  "CONFIGURATION",
  "OPTIMIZE",
  "REFACTOR",
  "CODE_PLAN",
  // Testing
  "UNIT_TEST_WRITE",
  "INTEGRATION_TEST_WRITE",
  "TEST_DATA_GENERATION",
  // Debugging (fix)
  "FIX_IMPLEMENT",
  "REGRESSION_CHECK",
  // Operations
  "CI_CD_CONFIG",
  "ENVIRONMENT_SETUP",
  "MONITORING_SETUP",
  // Documentation (write)
  "COMMENT_WRITE",
  "CHANGELOG",
  // Architecture (design artifacts)
  "SYSTEM_DESIGN",
  "MODULE_DESIGN",
  "INTERFACE_DESIGN",
  "DATA_MODELING",
  "PATTERN_SELECTION",
  "MIGRATION_STRATEGY",
  "PERFORMANCE_DESIGN",
]);

/**
 * Domains that default to artifact when taskType is not specified.
 */
const ARTIFACT_DOMAINS = new Set([
  "CODING",
  "TESTING",
  "OPERATIONS",
  "ARCHITECTURE",
]);

/**
 * Resolve task nature from domain and taskType.
 *
 * Priority: taskType (if in ARTIFACT_TASKS) > domain > default "critique".
 * taskType always wins — e.g. CODING/CODE_REVIEW → critique.
 */
export function resolveTaskNature(
  domain?: string,
  taskType?: string,
): TaskNature {
  if (taskType) {
    return ARTIFACT_TASKS.has(taskType) ? "artifact" : "critique";
  }
  if (domain) {
    return ARTIFACT_DOMAINS.has(domain) ? "artifact" : "critique";
  }
  return "critique";
}

// -- Debate Auto-Selection --

/**
 * Task types where debate protocol improves output quality.
 * These are complex critique/review tasks where multiple rounds of
 * argument exchange lead to more rigorous analysis.
 */
const DEBATE_TASK_TYPES = new Set([
  "CODE_REVIEW",
  "DESIGN_REVIEW",
  "SECURITY_REVIEW",
  "PERFORMANCE_REVIEW",
  "CRITIQUE",
  "COMPARISON",
]);

/**
 * Determine whether debate protocol should be auto-selected.
 *
 * Rules:
 * - Only for critique tasks (never artifact — debate suppresses creative output)
 * - Only for complex tasks with specific review/critique task types
 * - Returns false if task type is not in the debate-eligible set
 *
 * @returns true if debate should be auto-selected
 */
export function shouldAutoDebate(
  domain?: string,
  taskType?: string,
  complexity?: string,
): boolean {
  // Only debate on complex tasks
  if (complexity !== "complex") return false;
  // Must have a task type in the debate set
  if (!taskType) return false;
  // Never for artifact tasks
  const nature = resolveTaskNature(domain, taskType);
  if (nature === "artifact") return false;
  return DEBATE_TASK_TYPES.has(taskType);
}
