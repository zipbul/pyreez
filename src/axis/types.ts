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
  /** True when the response was cut off by max_tokens (finish_reason === "length"). */
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
