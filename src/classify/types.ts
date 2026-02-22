/**
 * Task classification types — 12 domains, 62 task types.
 */

// -- Task Domains (12) --

export type TaskDomain =
  | "IDEATION"
  | "PLANNING"
  | "REQUIREMENTS"
  | "ARCHITECTURE"
  | "CODING"
  | "TESTING"
  | "REVIEW"
  | "DOCUMENTATION"
  | "DEBUGGING"
  | "OPERATIONS"
  | "RESEARCH"
  | "COMMUNICATION";

// -- Task Types (62) --

/** D1. IDEATION (5) */
export type IdeationTaskType =
  | "BRAINSTORM"
  | "ANALOGY"
  | "CONSTRAINT_DISCOVERY"
  | "OPTION_GENERATION"
  | "FEASIBILITY_QUICK";

/** D2. PLANNING (7) */
export type PlanningTaskType =
  | "GOAL_DEFINITION"
  | "SCOPE_DEFINITION"
  | "PRIORITIZATION"
  | "MILESTONE_PLANNING"
  | "RISK_ASSESSMENT"
  | "RESOURCE_ESTIMATION"
  | "TRADEOFF_ANALYSIS";

/** D3. REQUIREMENTS (6) */
export type RequirementsTaskType =
  | "REQUIREMENT_EXTRACTION"
  | "REQUIREMENT_STRUCTURING"
  | "AMBIGUITY_DETECTION"
  | "COMPLETENESS_CHECK"
  | "CONFLICT_DETECTION"
  | "ACCEPTANCE_CRITERIA";

/** D4. ARCHITECTURE (8) */
export type ArchitectureTaskType =
  | "SYSTEM_DESIGN"
  | "MODULE_DESIGN"
  | "INTERFACE_DESIGN"
  | "DATA_MODELING"
  | "PATTERN_SELECTION"
  | "DEPENDENCY_ANALYSIS"
  | "MIGRATION_STRATEGY"
  | "PERFORMANCE_DESIGN";

/** D5. CODING (10) */
export type CodingTaskType =
  | "CODE_PLAN"
  | "SCAFFOLD"
  | "IMPLEMENT_FEATURE"
  | "IMPLEMENT_ALGORITHM"
  | "REFACTOR"
  | "OPTIMIZE"
  | "TYPE_DEFINITION"
  | "ERROR_HANDLING"
  | "INTEGRATION"
  | "CONFIGURATION";

/** D6. TESTING (7) */
export type TestingTaskType =
  | "TEST_STRATEGY"
  | "TEST_CASE_DESIGN"
  | "UNIT_TEST_WRITE"
  | "INTEGRATION_TEST_WRITE"
  | "EDGE_CASE_DISCOVERY"
  | "TEST_DATA_GENERATION"
  | "COVERAGE_ANALYSIS";

/** D7. REVIEW (7) */
export type ReviewTaskType =
  | "CODE_REVIEW"
  | "DESIGN_REVIEW"
  | "SECURITY_REVIEW"
  | "PERFORMANCE_REVIEW"
  | "CRITIQUE"
  | "COMPARISON"
  | "STANDARDS_COMPLIANCE";

/** D8. DOCUMENTATION (6) */
export type DocumentationTaskType =
  | "API_DOC"
  | "TUTORIAL"
  | "COMMENT_WRITE"
  | "CHANGELOG"
  | "DECISION_RECORD"
  | "DIAGRAM";

/** D9. DEBUGGING (7) */
export type DebuggingTaskType =
  | "ERROR_DIAGNOSIS"
  | "LOG_ANALYSIS"
  | "REPRODUCTION"
  | "ROOT_CAUSE"
  | "FIX_PROPOSAL"
  | "FIX_IMPLEMENT"
  | "REGRESSION_CHECK";

/** D10. OPERATIONS (5) */
export type OperationsTaskType =
  | "DEPLOY_PLAN"
  | "CI_CD_CONFIG"
  | "ENVIRONMENT_SETUP"
  | "MONITORING_SETUP"
  | "INCIDENT_RESPONSE";

/** D11. RESEARCH (5) */
export type ResearchTaskType =
  | "TECH_RESEARCH"
  | "BENCHMARK"
  | "COMPATIBILITY_CHECK"
  | "BEST_PRACTICE"
  | "TREND_ANALYSIS";

/** D12. COMMUNICATION (5) */
export type CommunicationTaskType =
  | "SUMMARIZE"
  | "EXPLAIN"
  | "REPORT"
  | "TRANSLATE"
  | "QUESTION_ANSWER";

/**
 * All 62 task types.
 */
export type TaskType =
  | IdeationTaskType
  | PlanningTaskType
  | RequirementsTaskType
  | ArchitectureTaskType
  | CodingTaskType
  | TestingTaskType
  | ReviewTaskType
  | DocumentationTaskType
  | DebuggingTaskType
  | OperationsTaskType
  | ResearchTaskType
  | CommunicationTaskType;

// -- Complexity & Criticality --

export type Complexity = "simple" | "moderate" | "complex";
export type Criticality = "low" | "medium" | "high" | "critical";

// -- Classification Result --

export interface ClassifyResult {
  domain: TaskDomain;
  taskType: TaskType;
  complexity: Complexity;
  criticality: Criticality;
  /** "rule" if classified by keyword rules, "llm" if LLM fallback was used. */
  method: "rule" | "llm";
}

// -- Domain ↔ TaskType mapping --

export const DOMAIN_TASK_TYPES: Record<TaskDomain, readonly TaskType[]> = {
  IDEATION: [
    "BRAINSTORM",
    "ANALOGY",
    "CONSTRAINT_DISCOVERY",
    "OPTION_GENERATION",
    "FEASIBILITY_QUICK",
  ],
  PLANNING: [
    "GOAL_DEFINITION",
    "SCOPE_DEFINITION",
    "PRIORITIZATION",
    "MILESTONE_PLANNING",
    "RISK_ASSESSMENT",
    "RESOURCE_ESTIMATION",
    "TRADEOFF_ANALYSIS",
  ],
  REQUIREMENTS: [
    "REQUIREMENT_EXTRACTION",
    "REQUIREMENT_STRUCTURING",
    "AMBIGUITY_DETECTION",
    "COMPLETENESS_CHECK",
    "CONFLICT_DETECTION",
    "ACCEPTANCE_CRITERIA",
  ],
  ARCHITECTURE: [
    "SYSTEM_DESIGN",
    "MODULE_DESIGN",
    "INTERFACE_DESIGN",
    "DATA_MODELING",
    "PATTERN_SELECTION",
    "DEPENDENCY_ANALYSIS",
    "MIGRATION_STRATEGY",
    "PERFORMANCE_DESIGN",
  ],
  CODING: [
    "CODE_PLAN",
    "SCAFFOLD",
    "IMPLEMENT_FEATURE",
    "IMPLEMENT_ALGORITHM",
    "REFACTOR",
    "OPTIMIZE",
    "TYPE_DEFINITION",
    "ERROR_HANDLING",
    "INTEGRATION",
    "CONFIGURATION",
  ],
  TESTING: [
    "TEST_STRATEGY",
    "TEST_CASE_DESIGN",
    "UNIT_TEST_WRITE",
    "INTEGRATION_TEST_WRITE",
    "EDGE_CASE_DISCOVERY",
    "TEST_DATA_GENERATION",
    "COVERAGE_ANALYSIS",
  ],
  REVIEW: [
    "CODE_REVIEW",
    "DESIGN_REVIEW",
    "SECURITY_REVIEW",
    "PERFORMANCE_REVIEW",
    "CRITIQUE",
    "COMPARISON",
    "STANDARDS_COMPLIANCE",
  ],
  DOCUMENTATION: [
    "API_DOC",
    "TUTORIAL",
    "COMMENT_WRITE",
    "CHANGELOG",
    "DECISION_RECORD",
    "DIAGRAM",
  ],
  DEBUGGING: [
    "ERROR_DIAGNOSIS",
    "LOG_ANALYSIS",
    "REPRODUCTION",
    "ROOT_CAUSE",
    "FIX_PROPOSAL",
    "FIX_IMPLEMENT",
    "REGRESSION_CHECK",
  ],
  OPERATIONS: [
    "DEPLOY_PLAN",
    "CI_CD_CONFIG",
    "ENVIRONMENT_SETUP",
    "MONITORING_SETUP",
    "INCIDENT_RESPONSE",
  ],
  RESEARCH: [
    "TECH_RESEARCH",
    "BENCHMARK",
    "COMPATIBILITY_CHECK",
    "BEST_PRACTICE",
    "TREND_ANALYSIS",
  ],
  COMMUNICATION: [
    "SUMMARIZE",
    "EXPLAIN",
    "REPORT",
    "TRANSLATE",
    "QUESTION_ANSWER",
  ],
} as const;
