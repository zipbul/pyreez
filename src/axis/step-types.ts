/**
 * WorkflowStep type system — ~20 step vocabulary for PLAN.md variant.
 *
 * Shared between:
 * - StepDeclareClassifier (R-A2): produces ClassifyOutput with vocabKind="step"
 * - StepProfiler (R-B2):         consumes step → capability profile
 * - StepBtScoringSystem (S1-b):  uses stepToDimensions() for BT calibration
 */

import type { CapabilityDimension } from "../model/types";

// -- WorkflowStep vocabulary (~20 steps) --

export type WorkflowStep =
  | "IDEATE"        // Brainstorm, analogy, option generation
  | "RESEARCH"      // Domain knowledge, feasibility, benchmarks
  | "PLAN"          // Goal definition, milestone, resource estimation
  | "PRIORITIZE"    // Prioritization, tradeoff, risk assessment
  | "REQUIREMENTS"  // Extract, structure, validate requirements
  | "DESIGN"        // System/module/interface design, data modeling
  | "PATTERN"       // Pattern selection, migration strategy
  | "CODE"          // Implement feature, algorithm, scaffold
  | "CONFIGURE"     // Configuration, CI/CD, environment setup
  | "REFACTOR"      // Refactor, optimize, type definition
  | "DEBUG"         // Root cause, error diagnosis, fix
  | "TEST"          // Test design, write, coverage
  | "REVIEW"        // Code review, security, performance audit
  | "DOCUMENT"      // API docs, README, comments, explanation
  | "SUMMARIZE"     // Summarize, explain, translate
  | "ANALYZE"       // Data analysis, log analysis, metrics
  | "VALIDATE"      // Acceptance criteria, completeness check
  | "DEPLOY"        // Deployment, monitoring, incident response
  | "COMMUNICATE"   // Report, presentation, email
  | "GENERAL";      // Fallback / unknown

export const ALL_STEPS: readonly WorkflowStep[] = [
  "IDEATE", "RESEARCH", "PLAN", "PRIORITIZE", "REQUIREMENTS",
  "DESIGN", "PATTERN", "CODE", "CONFIGURE", "REFACTOR",
  "DEBUG", "TEST", "REVIEW", "DOCUMENT", "SUMMARIZE",
  "ANALYZE", "VALIDATE", "DEPLOY", "COMMUNICATE", "GENERAL",
];

// -- Step → Domain mapping (for StepDeclareClassifier) --

export const STEP_DOMAIN: Record<WorkflowStep, string> = {
  IDEATE:       "IDEATION",
  RESEARCH:     "RESEARCH",
  PLAN:         "PLANNING",
  PRIORITIZE:   "PLANNING",
  REQUIREMENTS: "REQUIREMENTS",
  DESIGN:       "ARCHITECTURE",
  PATTERN:      "ARCHITECTURE",
  CODE:         "CODING",
  CONFIGURE:    "OPERATIONS",
  REFACTOR:     "CODING",
  DEBUG:        "DEBUGGING",
  TEST:         "TESTING",
  REVIEW:       "REVIEW",
  DOCUMENT:     "DOCUMENTATION",
  SUMMARIZE:    "COMMUNICATION",
  ANALYZE:      "RESEARCH",
  VALIDATE:     "REQUIREMENTS",
  DEPLOY:       "OPERATIONS",
  COMMUNICATE:  "COMMUNICATION",
  GENERAL:      "CODING",
};

// -- STEP_PROFILES: dimension weights per step --

/** Dimension weight map for a workflow step. Weights sum to 1.0. */
export type StepProfile = Record<string, number>;

export const STEP_PROFILES: Record<WorkflowStep, StepProfile> = {
  IDEATE: {
    CREATIVITY: 0.35,
    REASONING: 0.25,
    ANALYSIS: 0.20,
    AMBIGUITY_HANDLING: 0.10,
    INSTRUCTION_FOLLOWING: 0.10,
  },
  RESEARCH: {
    ANALYSIS: 0.30,
    REASONING: 0.25,
    JUDGMENT: 0.20,
    HALLUCINATION_RESISTANCE: 0.15,
    LONG_CONTEXT: 0.10,
  },
  PLAN: {
    REASONING: 0.30,
    ANALYSIS: 0.25,
    JUDGMENT: 0.20,
    MULTI_STEP_DEPTH: 0.15,
    INSTRUCTION_FOLLOWING: 0.10,
  },
  PRIORITIZE: {
    JUDGMENT: 0.35,
    ANALYSIS: 0.30,
    REASONING: 0.20,
    MULTI_STEP_DEPTH: 0.10,
    INSTRUCTION_FOLLOWING: 0.05,
  },
  REQUIREMENTS: {
    ANALYSIS: 0.30,
    REASONING: 0.25,
    AMBIGUITY_HANDLING: 0.20,
    INSTRUCTION_FOLLOWING: 0.15,
    STRUCTURED_OUTPUT: 0.10,
  },
  DESIGN: {
    SYSTEM_THINKING: 0.30,
    REASONING: 0.25,
    ANALYSIS: 0.20,
    CREATIVITY: 0.15,
    JUDGMENT: 0.10,
  },
  PATTERN: {
    SYSTEM_THINKING: 0.35,
    JUDGMENT: 0.30,
    ANALYSIS: 0.20,
    REASONING: 0.15,
  },
  CODE: {
    CODE_GENERATION: 0.35,
    REASONING: 0.25,
    CODE_UNDERSTANDING: 0.15,
    DEBUGGING: 0.15,
    INSTRUCTION_FOLLOWING: 0.10,
  },
  CONFIGURE: {
    CODE_GENERATION: 0.30,
    TOOL_USE: 0.25,
    INSTRUCTION_FOLLOWING: 0.25,
    STRUCTURED_OUTPUT: 0.20,
  },
  REFACTOR: {
    CODE_UNDERSTANDING: 0.35,
    CODE_GENERATION: 0.30,
    REASONING: 0.20,
    SYSTEM_THINKING: 0.15,
  },
  DEBUG: {
    DEBUGGING: 0.35,
    CODE_UNDERSTANDING: 0.30,
    REASONING: 0.20,
    ANALYSIS: 0.15,
  },
  TEST: {
    CODE_GENERATION: 0.25,
    REASONING: 0.25,
    ANALYSIS: 0.20,
    DEBUGGING: 0.15,
    CODE_UNDERSTANDING: 0.15,
  },
  REVIEW: {
    CODE_UNDERSTANDING: 0.30,
    ANALYSIS: 0.25,
    JUDGMENT: 0.20,
    REASONING: 0.15,
    HALLUCINATION_RESISTANCE: 0.10,
  },
  DOCUMENT: {
    INSTRUCTION_FOLLOWING: 0.30,
    CODE_UNDERSTANDING: 0.25,
    STRUCTURED_OUTPUT: 0.20,
    ANALYSIS: 0.15,
    CREATIVITY: 0.10,
  },
  SUMMARIZE: {
    ANALYSIS: 0.30,
    INSTRUCTION_FOLLOWING: 0.25,
    LONG_CONTEXT: 0.25,
    REASONING: 0.20,
  },
  ANALYZE: {
    ANALYSIS: 0.35,
    REASONING: 0.25,
    JUDGMENT: 0.20,
    MULTI_STEP_DEPTH: 0.12,
    HALLUCINATION_RESISTANCE: 0.08,
  },
  VALIDATE: {
    ANALYSIS: 0.30,
    REASONING: 0.25,
    JUDGMENT: 0.20,
    AMBIGUITY_HANDLING: 0.15,
    HALLUCINATION_RESISTANCE: 0.10,
  },
  DEPLOY: {
    TOOL_USE: 0.30,
    SYSTEM_THINKING: 0.25,
    CODE_GENERATION: 0.25,
    INSTRUCTION_FOLLOWING: 0.20,
  },
  COMMUNICATE: {
    INSTRUCTION_FOLLOWING: 0.30,
    CREATIVITY: 0.25,
    ANALYSIS: 0.20,
    LONG_CONTEXT: 0.15,
    MULTILINGUAL: 0.10,
  },
  GENERAL: {
    REASONING: 0.25,
    ANALYSIS: 0.25,
    INSTRUCTION_FOLLOWING: 0.25,
    JUDGMENT: 0.25,
  },
};

// -- stepToDimensions: primary dimensions for BT calibration --
// Used by StepBtScoringSystem to know which dimensions to update
// when a model performs well/poorly on a given step.

export function stepToDimensions(step: string): CapabilityDimension[] {
  const map: Record<WorkflowStep, CapabilityDimension[]> = {
    IDEATE:       ["CREATIVITY", "REASONING"],
    RESEARCH:     ["ANALYSIS", "REASONING", "JUDGMENT"],
    PLAN:         ["REASONING", "MULTI_STEP_DEPTH", "ANALYSIS"],
    PRIORITIZE:   ["JUDGMENT", "ANALYSIS"],
    REQUIREMENTS: ["ANALYSIS", "AMBIGUITY_HANDLING"],
    DESIGN:       ["SYSTEM_THINKING", "REASONING", "ANALYSIS"],
    PATTERN:      ["SYSTEM_THINKING", "JUDGMENT"],
    CODE:         ["CODE_GENERATION", "REASONING"],
    CONFIGURE:    ["CODE_GENERATION", "TOOL_USE"],
    REFACTOR:     ["CODE_UNDERSTANDING", "CODE_GENERATION"],
    DEBUG:        ["DEBUGGING", "CODE_UNDERSTANDING"],
    TEST:         ["CODE_GENERATION", "REASONING", "DEBUGGING"],
    REVIEW:       ["CODE_UNDERSTANDING", "ANALYSIS", "JUDGMENT"],
    DOCUMENT:     ["INSTRUCTION_FOLLOWING", "CODE_UNDERSTANDING"],
    SUMMARIZE:    ["ANALYSIS", "INSTRUCTION_FOLLOWING"],
    ANALYZE:      ["ANALYSIS", "REASONING", "JUDGMENT"],
    VALIDATE:     ["ANALYSIS", "JUDGMENT"],
    DEPLOY:       ["TOOL_USE", "SYSTEM_THINKING"],
    COMMUNICATE:  ["INSTRUCTION_FOLLOWING", "CREATIVITY"],
    GENERAL:      ["REASONING"],
  };
  return (map as Record<string, CapabilityDimension[]>)[step] ?? ["REASONING"];
}

// -- Step keyword hints for StepDeclareClassifier auto-mapping --

/** Keyword → WorkflowStep mapping for prompt-based step inference. */
export const STEP_KEYWORD_MAP: Array<[WorkflowStep, string[]]> = [
  ["CODE",          ["implement", "write", "create function", "build", "scaffold", "코드 작성", "구현"]],
  ["DEBUG",         ["debug", "fix bug", "error", "exception", "crash", "버그", "오류 수정"]],
  ["TEST",          ["test", "unit test", "coverage", "테스트"]],
  ["REVIEW",        ["review", "audit", "inspect", "리뷰", "코드 리뷰"]],
  ["REFACTOR",      ["refactor", "optimize", "clean up", "리팩토링", "개선"]],
  ["DESIGN",        ["design", "architecture", "설계", "아키텍처"]],
  ["PLAN",          ["plan", "roadmap", "schedule", "계획", "마일스톤"]],
  ["DOCUMENT",      ["document", "readme", "api doc", "문서"]],
  ["SUMMARIZE",     ["summarize", "explain", "요약", "설명"]],
  ["ANALYZE",       ["analyze", "metrics", "analysis", "분석"]],
  ["DEPLOY",        ["deploy", "release", "ci/cd", "배포"]],
  ["CONFIGURE",     ["configure", "setup", "config", "설정"]],
  ["IDEATE",        ["brainstorm", "idea", "아이디어"]],
  ["PRIORITIZE",    ["prioritize", "rank", "우선순위"]],
  ["REQUIREMENTS",  ["requirement", "spec", "user story", "요구사항"]],
  ["COMMUNICATE",   ["report", "presentation", "email", "보고서"]],
  ["VALIDATE",      ["validate", "acceptance", "검증"]],
  ["RESEARCH",      ["research", "investigate", "조사"]],
];
