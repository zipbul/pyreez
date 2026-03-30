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

/** Per-model, per-task_type skill profile. */
export interface SkillCell {
  readonly model_id: string;
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

// -- Dimension Weights (uniform) --

/** Uniform weights for all dimensions. */
export const DIMENSION_WEIGHTS: Readonly<Record<string, number>> = {
  factually_correct: 0.20, addresses_task: 0.20, provides_evidence: 0.20,
  novel_perspective: 0.20, internally_consistent: 0.20,
};

// -- Failure Flag Severity --

/** Severity level for a failure flag. */
export type FailureSeverity = "critical" | "warning";

/**
 * Global failure severity. All failures are critical by default.
 * hallucination/off_topic/degenerate = critical (all dimensions false).
 * refusal = warning (factually_correct false only).
 */
const FAILURE_SEVERITY: Readonly<Record<string, FailureSeverity>> = {
  hallucination: "critical",
  refusal: "warning",
  off_topic: "critical",
  degenerate: "critical",
};

/** Get the severity of a failure flag. */
export function getFailureSeverity(flag: string): FailureSeverity {
  return FAILURE_SEVERITY[flag] ?? "critical";
}

/**
 * Apply failure severity to dimensions.
 * - critical: override ALL dimensions to false
 * - warning: override factually_correct to false
 * Returns a new dimensions object (does not mutate input).
 */
export function applyFailureSeverity(
  dimensions: BinaryDimensions,
  failures: FailureFlags,
): BinaryDimensions {
  for (const flag of FAILURE_FLAGS) {
    if (!failures[flag]) continue;
    const severity = getFailureSeverity(flag);
    if (severity === "critical") {
      return {
        factually_correct: false,
        addresses_task: false,
        provides_evidence: false,
        novel_perspective: false,
        internally_consistent: false,
      };
    }
  }

  // Check for warning-level failures
  for (const flag of FAILURE_FLAGS) {
    if (!failures[flag]) continue;
    if (getFailureSeverity(flag) === "warning") {
      return { ...dimensions, factually_correct: false };
    }
  }

  return dimensions;
}
