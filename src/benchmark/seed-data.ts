/**
 * 60 seed benchmark cases (12 domains × 5 cases each).
 *
 * Ground truth qualities are synthetic approximations based on
 * known model strengths. Used for benchmark framework validation.
 */

import type { BenchmarkCase } from "./types";

const MODELS = [
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-4.1",
  "google/gemini-2.5-pro",
  "deepseek/deepseek-chat",
  "anthropic/claude-haiku-4.5",
] as const;

type Q = Record<string, number>;

function q(sonnet: number, gpt: number, gemini: number, deepseek: number, haiku: number): Q {
  return {
    [MODELS[0]]: sonnet,
    [MODELS[1]]: gpt,
    [MODELS[2]]: gemini,
    [MODELS[3]]: deepseek,
    [MODELS[4]]: haiku,
  };
}

export const SEED_CASES: BenchmarkCase[] = [
  // CODING (5)
  { id: "coding-1", domain: "CODING", taskType: "IMPLEMENT_FEATURE", complexity: "simple", modelQualities: q(8, 8, 7, 7, 6) },
  { id: "coding-2", domain: "CODING", taskType: "IMPLEMENT_ALGORITHM", complexity: "complex", modelQualities: q(9, 8, 8, 8, 5) },
  { id: "coding-3", domain: "CODING", taskType: "REFACTOR", complexity: "moderate", modelQualities: q(8, 8, 7, 7, 6) },
  { id: "coding-4", domain: "CODING", taskType: "OPTIMIZE", complexity: "complex", modelQualities: q(8, 8, 7, 8, 5) },
  { id: "coding-5", domain: "CODING", taskType: "SCAFFOLD", complexity: "simple", modelQualities: q(7, 7, 7, 6, 7) },

  // DEBUGGING (5)
  { id: "debug-1", domain: "DEBUGGING", taskType: "ERROR_DIAGNOSIS", complexity: "simple", modelQualities: q(8, 8, 7, 7, 6) },
  { id: "debug-2", domain: "DEBUGGING", taskType: "FIX_IMPLEMENT", complexity: "moderate", modelQualities: q(9, 8, 7, 7, 6) },
  { id: "debug-3", domain: "DEBUGGING", taskType: "ROOT_CAUSE", complexity: "complex", modelQualities: q(9, 8, 8, 7, 5) },
  { id: "debug-4", domain: "DEBUGGING", taskType: "LOG_ANALYSIS", complexity: "moderate", modelQualities: q(7, 7, 8, 7, 6) },
  { id: "debug-5", domain: "DEBUGGING", taskType: "REGRESSION_CHECK", complexity: "simple", modelQualities: q(7, 7, 7, 6, 6) },

  // TESTING (5)
  { id: "test-1", domain: "TESTING", taskType: "UNIT_TEST_WRITE", complexity: "simple", modelQualities: q(8, 8, 7, 7, 7) },
  { id: "test-2", domain: "TESTING", taskType: "INTEGRATION_TEST_WRITE", complexity: "moderate", modelQualities: q(8, 7, 7, 6, 5) },
  { id: "test-3", domain: "TESTING", taskType: "EDGE_CASE_DISCOVERY", complexity: "moderate", modelQualities: q(9, 8, 8, 7, 6) },
  { id: "test-4", domain: "TESTING", taskType: "TEST_STRATEGY", complexity: "complex", modelQualities: q(9, 8, 8, 6, 5) },
  { id: "test-5", domain: "TESTING", taskType: "TEST_DATA_GENERATION", complexity: "simple", modelQualities: q(7, 7, 7, 7, 7) },

  // REVIEW (5)
  { id: "review-1", domain: "REVIEW", taskType: "CODE_REVIEW", complexity: "moderate", modelQualities: q(9, 8, 8, 7, 6) },
  { id: "review-2", domain: "REVIEW", taskType: "SECURITY_REVIEW", complexity: "complex", modelQualities: q(9, 8, 8, 6, 5) },
  { id: "review-3", domain: "REVIEW", taskType: "PERFORMANCE_REVIEW", complexity: "moderate", modelQualities: q(8, 8, 7, 8, 5) },
  { id: "review-4", domain: "REVIEW", taskType: "DESIGN_REVIEW", complexity: "complex", modelQualities: q(9, 8, 8, 7, 5) },
  { id: "review-5", domain: "REVIEW", taskType: "COMPARISON", complexity: "simple", modelQualities: q(8, 7, 8, 7, 7) },

  // ARCHITECTURE (5)
  { id: "arch-1", domain: "ARCHITECTURE", taskType: "SYSTEM_DESIGN", complexity: "complex", modelQualities: q(9, 8, 8, 6, 4) },
  { id: "arch-2", domain: "ARCHITECTURE", taskType: "DATA_MODELING", complexity: "moderate", modelQualities: q(8, 8, 8, 7, 5) },
  { id: "arch-3", domain: "ARCHITECTURE", taskType: "PATTERN_SELECTION", complexity: "moderate", modelQualities: q(9, 8, 7, 7, 5) },
  { id: "arch-4", domain: "ARCHITECTURE", taskType: "DEPENDENCY_ANALYSIS", complexity: "simple", modelQualities: q(8, 7, 7, 7, 6) },
  { id: "arch-5", domain: "ARCHITECTURE", taskType: "MIGRATION_STRATEGY", complexity: "complex", modelQualities: q(9, 8, 8, 6, 4) },

  // DOCUMENTATION (5)
  { id: "doc-1", domain: "DOCUMENTATION", taskType: "API_DOC", complexity: "simple", modelQualities: q(8, 7, 8, 7, 7) },
  { id: "doc-2", domain: "DOCUMENTATION", taskType: "TUTORIAL", complexity: "moderate", modelQualities: q(9, 8, 8, 7, 6) },
  { id: "doc-3", domain: "DOCUMENTATION", taskType: "COMMENT_WRITE", complexity: "simple", modelQualities: q(7, 7, 7, 6, 7) },
  { id: "doc-4", domain: "DOCUMENTATION", taskType: "CHANGELOG", complexity: "simple", modelQualities: q(7, 7, 7, 7, 7) },
  { id: "doc-5", domain: "DOCUMENTATION", taskType: "DECISION_RECORD", complexity: "moderate", modelQualities: q(9, 8, 8, 6, 5) },

  // PLANNING (5)
  { id: "plan-1", domain: "PLANNING", taskType: "SCOPE_DEFINITION", complexity: "moderate", modelQualities: q(9, 8, 8, 6, 5) },
  { id: "plan-2", domain: "PLANNING", taskType: "MILESTONE_PLANNING", complexity: "complex", modelQualities: q(9, 8, 8, 6, 4) },
  { id: "plan-3", domain: "PLANNING", taskType: "PRIORITIZATION", complexity: "moderate", modelQualities: q(8, 8, 8, 6, 5) },
  { id: "plan-4", domain: "PLANNING", taskType: "RISK_ASSESSMENT", complexity: "complex", modelQualities: q(9, 8, 8, 7, 5) },
  { id: "plan-5", domain: "PLANNING", taskType: "RESOURCE_ESTIMATION", complexity: "simple", modelQualities: q(7, 7, 7, 6, 6) },

  // REQUIREMENTS (5)
  { id: "req-1", domain: "REQUIREMENTS", taskType: "REQUIREMENT_EXTRACTION", complexity: "moderate", modelQualities: q(9, 8, 8, 6, 5) },
  { id: "req-2", domain: "REQUIREMENTS", taskType: "ACCEPTANCE_CRITERIA", complexity: "moderate", modelQualities: q(8, 8, 8, 7, 6) },
  { id: "req-3", domain: "REQUIREMENTS", taskType: "AMBIGUITY_DETECTION", complexity: "complex", modelQualities: q(9, 8, 8, 6, 4) },
  { id: "req-4", domain: "REQUIREMENTS", taskType: "COMPLETENESS_CHECK", complexity: "moderate", modelQualities: q(8, 8, 8, 7, 5) },
  { id: "req-5", domain: "REQUIREMENTS", taskType: "CONFLICT_DETECTION", complexity: "complex", modelQualities: q(9, 8, 7, 6, 4) },

  // IDEATION (5)
  { id: "idea-1", domain: "IDEATION", taskType: "BRAINSTORM", complexity: "simple", modelQualities: q(8, 7, 8, 7, 7) },
  { id: "idea-2", domain: "IDEATION", taskType: "ANALOGY", complexity: "moderate", modelQualities: q(9, 7, 8, 7, 6) },
  { id: "idea-3", domain: "IDEATION", taskType: "OPTION_GENERATION", complexity: "moderate", modelQualities: q(8, 8, 8, 7, 6) },
  { id: "idea-4", domain: "IDEATION", taskType: "CONSTRAINT_DISCOVERY", complexity: "complex", modelQualities: q(9, 8, 8, 7, 5) },
  { id: "idea-5", domain: "IDEATION", taskType: "FEASIBILITY_QUICK", complexity: "simple", modelQualities: q(7, 7, 7, 7, 7) },

  // OPERATIONS (5)
  { id: "ops-1", domain: "OPERATIONS", taskType: "ENVIRONMENT_SETUP", complexity: "simple", modelQualities: q(7, 7, 7, 7, 7) },
  { id: "ops-2", domain: "OPERATIONS", taskType: "CI_CD_CONFIG", complexity: "moderate", modelQualities: q(8, 8, 7, 7, 6) },
  { id: "ops-3", domain: "OPERATIONS", taskType: "DEPLOY_PLAN", complexity: "complex", modelQualities: q(8, 8, 8, 6, 5) },
  { id: "ops-4", domain: "OPERATIONS", taskType: "MONITORING_SETUP", complexity: "moderate", modelQualities: q(7, 8, 7, 7, 6) },
  { id: "ops-5", domain: "OPERATIONS", taskType: "INCIDENT_RESPONSE", complexity: "complex", modelQualities: q(8, 8, 8, 6, 5) },

  // RESEARCH (5)
  { id: "res-1", domain: "RESEARCH", taskType: "TECH_RESEARCH", complexity: "moderate", modelQualities: q(8, 8, 9, 7, 6) },
  { id: "res-2", domain: "RESEARCH", taskType: "BENCHMARK", complexity: "complex", modelQualities: q(8, 8, 8, 7, 5) },
  { id: "res-3", domain: "RESEARCH", taskType: "COMPATIBILITY_CHECK", complexity: "simple", modelQualities: q(7, 7, 7, 7, 7) },
  { id: "res-4", domain: "RESEARCH", taskType: "BEST_PRACTICE", complexity: "moderate", modelQualities: q(9, 8, 8, 7, 6) },
  { id: "res-5", domain: "RESEARCH", taskType: "TREND_ANALYSIS", complexity: "moderate", modelQualities: q(8, 7, 9, 7, 5) },

  // COMMUNICATION (5)
  { id: "comm-1", domain: "COMMUNICATION", taskType: "EXPLAIN", complexity: "simple", modelQualities: q(9, 8, 8, 7, 7) },
  { id: "comm-2", domain: "COMMUNICATION", taskType: "SUMMARIZE", complexity: "simple", modelQualities: q(8, 8, 8, 7, 7) },
  { id: "comm-3", domain: "COMMUNICATION", taskType: "TRANSLATE", complexity: "moderate", modelQualities: q(8, 7, 9, 7, 6) },
  { id: "comm-4", domain: "COMMUNICATION", taskType: "REPORT", complexity: "moderate", modelQualities: q(9, 8, 8, 6, 6) },
  { id: "comm-5", domain: "COMMUNICATION", taskType: "QUESTION_ANSWER", complexity: "simple", modelQualities: q(8, 8, 8, 7, 7) },
];
