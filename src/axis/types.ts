/**
 * Axis types — shared across deliberation infrastructure.
 */

// -- Shared utility types --

/**
 * Result of a single LLM call, including token usage.
 */
export interface ChatResult {
  readonly content: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** True when the response was cut off (finish_reason === "length"). */
  readonly truncated?: boolean;
}

/**
 * Chat function injected into the engine — allows any LLM backend.
 */
export type ChatFn = (
  modelId: string,
  input: string | import("../llm/types").ChatMessage[],
  params?: import("../deliberation/types").GenerationParams,
) => Promise<ChatResult>;

// -- SkillCell types (feedback system) --

/** Binary evaluation dimensions for a worker response. */
export interface BinaryDimensions {
  readonly factually_correct: boolean;
  readonly addresses_task: boolean;
  readonly provides_evidence: boolean;
  readonly novel_perspective: boolean;
  readonly internally_consistent: boolean;
}

/** Critical failure flags. */
export interface FailureFlags {
  readonly hallucination: boolean;
  readonly refusal: boolean;
  readonly off_topic: boolean;
  readonly degenerate: boolean;
}

/** Single evaluation record for one model's response. */
export interface FeedbackRecord {
  readonly deliberation_id: string;
  readonly model_id: string;
  readonly domain: string;
  readonly task_type: string;
  readonly evaluator_id: string;
  readonly dimensions: BinaryDimensions;
  readonly failures: FailureFlags;
  readonly timestamp: number;
}

/** Beta distribution parameters for Thompson Sampling. */
export interface BetaParams {
  alpha: number;
  beta: number;
}

/** Per-model, per-domain, per-task_type skill profile. */
export interface SkillCell {
  readonly model_id: string;
  readonly domain: string;
  readonly task_type: string;
  dimensions: Record<string, BetaParams>;
  failure_counts: Record<string, number>;
  total: number;
}

/** Dimension names for binary evaluation. */
export const BINARY_DIMENSIONS = [
  "factually_correct",
  "addresses_task",
  "provides_evidence",
  "novel_perspective",
  "internally_consistent",
] as const;

/** Failure flag names. */
export const FAILURE_FLAGS = [
  "hallucination",
  "refusal",
  "off_topic",
  "degenerate",
] as const;

// -- Domain Dimension Weights --

/** Per-domain weight vectors for Thompson Sampling. Sums to 1.0 per domain. */
export const DOMAIN_DIMENSION_WEIGHTS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  IDEATION:       { factually_correct: 0.10, addresses_task: 0.20, provides_evidence: 0.10, novel_perspective: 0.40, internally_consistent: 0.20 },
  PLANNING:       { factually_correct: 0.15, addresses_task: 0.30, provides_evidence: 0.15, novel_perspective: 0.20, internally_consistent: 0.20 },
  REQUIREMENTS:   { factually_correct: 0.25, addresses_task: 0.30, provides_evidence: 0.20, novel_perspective: 0.05, internally_consistent: 0.20 },
  ARCHITECTURE:   { factually_correct: 0.25, addresses_task: 0.25, provides_evidence: 0.25, novel_perspective: 0.05, internally_consistent: 0.20 },
  CODING:         { factually_correct: 0.15, addresses_task: 0.35, provides_evidence: 0.10, novel_perspective: 0.10, internally_consistent: 0.30 },
  TESTING:        { factually_correct: 0.25, addresses_task: 0.25, provides_evidence: 0.20, novel_perspective: 0.10, internally_consistent: 0.20 },
  REVIEW:         { factually_correct: 0.30, addresses_task: 0.20, provides_evidence: 0.25, novel_perspective: 0.05, internally_consistent: 0.20 },
  DOCUMENTATION:  { factually_correct: 0.10, addresses_task: 0.25, provides_evidence: 0.10, novel_perspective: 0.25, internally_consistent: 0.30 },
  DEBUGGING:      { factually_correct: 0.30, addresses_task: 0.25, provides_evidence: 0.25, novel_perspective: 0.05, internally_consistent: 0.15 },
  OPERATIONS:     { factually_correct: 0.20, addresses_task: 0.30, provides_evidence: 0.20, novel_perspective: 0.05, internally_consistent: 0.25 },
  RESEARCH:       { factually_correct: 0.30, addresses_task: 0.15, provides_evidence: 0.30, novel_perspective: 0.10, internally_consistent: 0.15 },
  COMMUNICATION:  { factually_correct: 0.20, addresses_task: 0.25, provides_evidence: 0.15, novel_perspective: 0.10, internally_consistent: 0.30 },
};

/** Default equal weights (fallback for unknown domains). */
const DEFAULT_WEIGHTS: Readonly<Record<string, number>> = {
  factually_correct: 0.20, addresses_task: 0.20, provides_evidence: 0.20,
  novel_perspective: 0.20, internally_consistent: 0.20,
};

/** Get dimension weights for a domain. Falls back to equal weights. */
export function getDomainWeights(domain: string): Readonly<Record<string, number>> {
  return DOMAIN_DIMENSION_WEIGHTS[domain] ?? DEFAULT_WEIGHTS;
}

// -- Failure Flag Severity --

/** Severity level for a failure flag in a given domain. */
export type FailureSeverity = "critical" | "warning" | "neutral";

/**
 * Domain×flag severity overrides. Default is "critical" for all combinations.
 * Only non-critical entries are stored (sparse representation).
 */
const SEVERITY_OVERRIDES: ReadonlyMap<string, FailureSeverity> = new Map([
  ["IDEATION:hallucination", "neutral"],
  ["PLANNING:hallucination", "warning"],
  ["DOCUMENTATION:hallucination", "warning"],
  ["COMMUNICATION:hallucination", "warning"],
  ["COMMUNICATION:refusal", "warning"],
]);

/** Get the severity of a failure flag for a domain. */
export function getFailureSeverity(domain: string, flag: string): FailureSeverity {
  return SEVERITY_OVERRIDES.get(`${domain}:${flag}`) ?? "critical";
}

/**
 * Apply failure severity to a FeedbackRecord's dimensions.
 * - critical: override ALL dimensions to false
 * - warning: override factually_correct to false
 * - neutral: no change
 * Returns a new dimensions object (does not mutate input).
 */
export function applyFailureSeverity(
  domain: string,
  dimensions: BinaryDimensions,
  failures: FailureFlags,
): BinaryDimensions {
  let worstSeverity: FailureSeverity = "neutral";

  for (const flag of FAILURE_FLAGS) {
    if (!failures[flag]) continue;
    const severity = getFailureSeverity(domain, flag);
    if (severity === "critical") {
      // Critical is the worst — short-circuit
      return {
        factually_correct: false,
        addresses_task: false,
        provides_evidence: false,
        novel_perspective: false,
        internally_consistent: false,
      };
    }
    if (severity === "warning") {
      worstSeverity = "warning";
    }
  }

  if (worstSeverity === "warning") {
    return { ...dimensions, factually_correct: false };
  }

  return dimensions;
}
