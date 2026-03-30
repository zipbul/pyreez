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
 * Resolve task nature from taskType.
 *
 * If taskType is in ARTIFACT_TASKS → "artifact", otherwise → "critique".
 */
export function resolveTaskNature(
  taskType?: string,
): TaskNature {
  if (taskType) {
    return ARTIFACT_TASKS.has(taskType) ? "artifact" : "critique";
  }
  return "critique";
}
