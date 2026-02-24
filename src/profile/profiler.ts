/**
 * Task profiler — maps ClassifyResult to TaskRequirement.
 * Maps ClassifyResult → TaskRequirement using domain defaults + task overrides.
 */

import type { CapabilityDimension } from "../model/types";
import type { TaskDomain, TaskType, ClassifyResult } from "../classify/types";
import type { CapabilityRequirement, TaskRequirement } from "./types";

// -- Korean character detection regex --

const KOREAN_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;

/** Non-Latin token expansion factor — empirical multiplier for non-Latin text token estimates. */
export const NON_LATIN_TOKEN_EXPANSION = 1.5;

/** Regex matching non-Latin characters (code point > 0x7F). */
const NON_LATIN_CHAR_REGEX = /[^\x00-\x7F]/g;

/**
 * Calculate the ratio of non-Latin characters in a text (0.0 ~ 1.0).
 * Non-Latin = any character with code point > 0x7F (outside basic ASCII).
 * Used for proportional token expansion.
 */
export function nonLatinRatio(text: string): number {
  if (text.length === 0) return 0;
  const matches = text.match(NON_LATIN_CHAR_REGEX);
  return matches ? matches.length / text.length : 0;
}

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

  // Non-Latin token expansion — proportional to non-Latin character ratio
  const ratio = nonLatinRatio(prompt);
  const factor = ratio > 0 ? 1 + ratio * (NON_LATIN_TOKEN_EXPANSION - 1) : 1;
  const expandedInput = Math.ceil(tokens.input * factor);
  const expandedOutput = Math.ceil(tokens.output * factor);

  // Flags
  const requiresKorean = KOREAN_REGEX.test(prompt);
  const requiresStructuredOutput = STRUCTURED_OUTPUT_TASKS.has(taskType);
  const requiresToolCalling = TOOL_CALLING_TASKS.has(taskType);

  return {
    taskType,
    domain,
    requiredCapabilities: capabilities,
    estimatedInputTokens: expandedInput,
    estimatedOutputTokens: expandedOutput,
    requiresStructuredOutput,
    requiresKorean,
    requiresToolCalling,
    criticality: classifyResult.criticality,
  };
}
