/**
 * Task profiler — maps ClassifyResult to TaskRequirement.
 * Maps ClassifyResult → TaskRequirement using domain defaults + task overrides.
 */

import type { CapabilityDimension } from "../model/types";
import type { TaskDomain, TaskType, ClassifyResult } from "../classify/types";
import type { CapabilityRequirement, TaskRequirement } from "./types";

// -- Korean character detection regex --

const KOREAN_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;

// -- Token estimates by complexity --

interface TokenEstimate {
  input: number;
  output: number;
}

const COMPLEXITY_TOKENS: Record<string, TokenEstimate> = {
  simple: { input: 500, output: 200 },
  moderate: { input: 2000, output: 1000 },
  complex: { input: 8000, output: 4000 },
};

// -- Structured output tasks --

const STRUCTURED_OUTPUT_TASKS = new Set<TaskType>([
  "REQUIREMENT_STRUCTURING",
  "REQUIREMENT_EXTRACTION",
  "ACCEPTANCE_CRITERIA",
  "API_DOC",
  "CHANGELOG",
  "DECISION_RECORD",
  "TEST_CASE_DESIGN",
  "TEST_DATA_GENERATION",
  "COVERAGE_ANALYSIS",
  "REPORT",
  "SUMMARIZE",
]);

// -- Tool calling tasks --

const TOOL_CALLING_TASKS = new Set<TaskType>([
  "CI_CD_CONFIG",
  "ENVIRONMENT_SETUP",
  "MONITORING_SETUP",
  "DEPLOY_PLAN",
  "SCAFFOLD",
]);

// -- Domain default capability profiles --
// Sum of all weights = 1.0 per domain.

type CapProfile = readonly CapabilityRequirement[];

const DOMAIN_DEFAULTS: Record<TaskDomain, CapProfile> = {
  IDEATION: [
    { dimension: "CREATIVITY", weight: 0.3 },
    { dimension: "ANALYSIS", weight: 0.25 },
    { dimension: "REASONING", weight: 0.2 },
    { dimension: "AMBIGUITY_HANDLING", weight: 0.15 },
    { dimension: "HALLUCINATION_RESISTANCE", weight: 0.1 },
  ],
  PLANNING: [
    { dimension: "JUDGMENT", weight: 0.3 },
    { dimension: "ANALYSIS", weight: 0.25 },
    { dimension: "REASONING", weight: 0.2 },
    { dimension: "SYSTEM_THINKING", weight: 0.15 },
    { dimension: "MULTI_STEP_DEPTH", weight: 0.1 },
  ],
  REQUIREMENTS: [
    { dimension: "INSTRUCTION_FOLLOWING", weight: 0.3 },
    { dimension: "ANALYSIS", weight: 0.25 },
    { dimension: "STRUCTURED_OUTPUT", weight: 0.2 },
    { dimension: "AMBIGUITY_HANDLING", weight: 0.15 },
    { dimension: "HALLUCINATION_RESISTANCE", weight: 0.1 },
  ],
  ARCHITECTURE: [
    { dimension: "SYSTEM_THINKING", weight: 0.3 },
    { dimension: "REASONING", weight: 0.25 },
    { dimension: "MULTI_STEP_DEPTH", weight: 0.2 },
    { dimension: "JUDGMENT", weight: 0.15 },
    { dimension: "ANALYSIS", weight: 0.1 },
  ],
  CODING: [
    { dimension: "CODE_GENERATION", weight: 0.3 },
    { dimension: "REASONING", weight: 0.25 },
    { dimension: "DEBUGGING", weight: 0.2 },
    { dimension: "CODE_UNDERSTANDING", weight: 0.15 },
    { dimension: "INSTRUCTION_FOLLOWING", weight: 0.1 },
  ],
  TESTING: [
    { dimension: "CODE_GENERATION", weight: 0.25 },
    { dimension: "INSTRUCTION_FOLLOWING", weight: 0.25 },
    { dimension: "REASONING", weight: 0.2 },
    { dimension: "CREATIVITY", weight: 0.15 },
    { dimension: "CODE_UNDERSTANDING", weight: 0.15 },
  ],
  REVIEW: [
    { dimension: "CODE_UNDERSTANDING", weight: 0.3 },
    { dimension: "JUDGMENT", weight: 0.25 },
    { dimension: "INSTRUCTION_FOLLOWING", weight: 0.2 },
    { dimension: "REASONING", weight: 0.15 },
    { dimension: "HALLUCINATION_RESISTANCE", weight: 0.1 },
  ],
  DOCUMENTATION: [
    { dimension: "INSTRUCTION_FOLLOWING", weight: 0.25 },
    { dimension: "STRUCTURED_OUTPUT", weight: 0.25 },
    { dimension: "ANALYSIS", weight: 0.2 },
    { dimension: "CODE_UNDERSTANDING", weight: 0.15 },
    { dimension: "MULTILINGUAL", weight: 0.15 },
  ],
  DEBUGGING: [
    { dimension: "REASONING", weight: 0.3 },
    { dimension: "CODE_UNDERSTANDING", weight: 0.25 },
    { dimension: "ANALYSIS", weight: 0.2 },
    { dimension: "DEBUGGING", weight: 0.15 },
    { dimension: "SELF_CONSISTENCY", weight: 0.1 },
  ],
  OPERATIONS: [
    { dimension: "SYSTEM_THINKING", weight: 0.25 },
    { dimension: "TOOL_USE", weight: 0.25 },
    { dimension: "INSTRUCTION_FOLLOWING", weight: 0.2 },
    { dimension: "HALLUCINATION_RESISTANCE", weight: 0.15 },
    { dimension: "AMBIGUITY_HANDLING", weight: 0.15 },
  ],
  RESEARCH: [
    { dimension: "ANALYSIS", weight: 0.3 },
    { dimension: "REASONING", weight: 0.25 },
    { dimension: "HALLUCINATION_RESISTANCE", weight: 0.2 },
    { dimension: "SELF_CONSISTENCY", weight: 0.15 },
    { dimension: "LONG_CONTEXT", weight: 0.1 },
  ],
  COMMUNICATION: [
    { dimension: "INSTRUCTION_FOLLOWING", weight: 0.25 },
    { dimension: "ANALYSIS", weight: 0.25 },
    { dimension: "STRUCTURED_OUTPUT", weight: 0.2 },
    { dimension: "MULTILINGUAL", weight: 0.15 },
    { dimension: "REASONING", weight: 0.15 },
  ],
};

// -- Task type overrides --
// Only defined for tasks that differ from their domain default.

const TASK_OVERRIDES: Partial<Record<TaskType, CapProfile>> = {
  // IDEATION overrides
  ANALOGY: [
    { dimension: "CREATIVITY", weight: 0.25 },
    { dimension: "ANALYSIS", weight: 0.25 },
    { dimension: "REASONING", weight: 0.2 },
    { dimension: "HALLUCINATION_RESISTANCE", weight: 0.15 },
    { dimension: "AMBIGUITY_HANDLING", weight: 0.15 },
  ],
  FEASIBILITY_QUICK: [
    { dimension: "REASONING", weight: 0.3 },
    { dimension: "JUDGMENT", weight: 0.25 },
    { dimension: "ANALYSIS", weight: 0.2 },
    { dimension: "HALLUCINATION_RESISTANCE", weight: 0.15 },
    { dimension: "CREATIVITY", weight: 0.1 },
  ],

  // PLANNING overrides
  PRIORITIZATION: [
    { dimension: "JUDGMENT", weight: 0.35 },
    { dimension: "ANALYSIS", weight: 0.3 },
    { dimension: "REASONING", weight: 0.25 },
    { dimension: "MULTI_STEP_DEPTH", weight: 0.1 },
  ],

  // REQUIREMENTS overrides
  AMBIGUITY_DETECTION: [
    { dimension: "INSTRUCTION_FOLLOWING", weight: 0.35 },
    { dimension: "ANALYSIS", weight: 0.3 },
    { dimension: "AMBIGUITY_HANDLING", weight: 0.2 },
    { dimension: "REASONING", weight: 0.15 },
  ],

  // ARCHITECTURE overrides
  SYSTEM_DESIGN: [
    { dimension: "SYSTEM_THINKING", weight: 0.3 },
    { dimension: "REASONING", weight: 0.25 },
    { dimension: "MULTI_STEP_DEPTH", weight: 0.2 },
    { dimension: "JUDGMENT", weight: 0.15 },
    { dimension: "ANALYSIS", weight: 0.1 },
  ],

  // CODING overrides
  IMPLEMENT_ALGORITHM: [
    { dimension: "CODE_GENERATION", weight: 0.35 },
    { dimension: "REASONING", weight: 0.3 },
    { dimension: "MATH_REASONING", weight: 0.2 },
    { dimension: "ANALYSIS", weight: 0.15 },
  ],

  // REVIEW overrides
  CODE_REVIEW: [
    { dimension: "CODE_UNDERSTANDING", weight: 0.3 },
    { dimension: "JUDGMENT", weight: 0.25 },
    { dimension: "INSTRUCTION_FOLLOWING", weight: 0.2 },
    { dimension: "REASONING", weight: 0.15 },
    { dimension: "HALLUCINATION_RESISTANCE", weight: 0.1 },
  ],
  SECURITY_REVIEW: [
    { dimension: "INSTRUCTION_FOLLOWING", weight: 0.3 },
    { dimension: "CODE_UNDERSTANDING", weight: 0.25 },
    { dimension: "REASONING", weight: 0.2 },
    { dimension: "HALLUCINATION_RESISTANCE", weight: 0.15 },
    { dimension: "AMBIGUITY_HANDLING", weight: 0.1 },
  ],

  // DEBUGGING overrides
  ROOT_CAUSE: [
    { dimension: "REASONING", weight: 0.35 },
    { dimension: "CODE_UNDERSTANDING", weight: 0.3 },
    { dimension: "ANALYSIS", weight: 0.2 },
    { dimension: "DEBUGGING", weight: 0.15 },
  ],

  // TESTING overrides
  EDGE_CASE_DISCOVERY: [
    { dimension: "CREATIVITY", weight: 0.3 },
    { dimension: "REASONING", weight: 0.25 },
    { dimension: "AMBIGUITY_HANDLING", weight: 0.25 },
    { dimension: "CODE_UNDERSTANDING", weight: 0.2 },
  ],

  // COMMUNICATION overrides
  SUMMARIZE: [
    { dimension: "ANALYSIS", weight: 0.35 },
    { dimension: "STRUCTURED_OUTPUT", weight: 0.25 },
    { dimension: "INSTRUCTION_FOLLOWING", weight: 0.25 },
    { dimension: "REASONING", weight: 0.15 },
  ],
  TRANSLATE: [
    { dimension: "MULTILINGUAL", weight: 0.4 },
    { dimension: "INSTRUCTION_FOLLOWING", weight: 0.3 },
    { dimension: "HALLUCINATION_RESISTANCE", weight: 0.2 },
    { dimension: "REASONING", weight: 0.1 },
  ],
};

// -- Public API --

/**
 * Profile a classified task into capability requirements.
 * Uses domain defaults, with overrides for specific task types.
 */
export function profileTask(
  classifyResult: ClassifyResult,
  prompt: string,
): TaskRequirement {
  const { domain, taskType, complexity } = classifyResult;

  // Capability requirements: override → domain default
  const capabilities: CapabilityRequirement[] = [
    ...(TASK_OVERRIDES[taskType] ?? DOMAIN_DEFAULTS[domain]),
  ];

  // Token estimates from complexity
  const tokens = COMPLEXITY_TOKENS[complexity] ?? COMPLEXITY_TOKENS.moderate!;

  // Flags
  const requiresKorean = KOREAN_REGEX.test(prompt);
  const requiresStructuredOutput = STRUCTURED_OUTPUT_TASKS.has(taskType);
  const requiresToolCalling = TOOL_CALLING_TASKS.has(taskType);

  return {
    taskType,
    domain,
    requiredCapabilities: capabilities,
    estimatedInputTokens: tokens.input,
    estimatedOutputTokens: tokens.output,
    requiresStructuredOutput,
    requiresKorean,
    requiresToolCalling,
    criticality: classifyResult.criticality,
  };
}
