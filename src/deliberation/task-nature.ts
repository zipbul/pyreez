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
