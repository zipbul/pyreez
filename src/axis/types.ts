/**
 * Axis boundary types — shared across the 3-stage pipeline.
 *
 * Stage 1: Understand — host provides TaskClassification, engine does profile lookup
 * Stage 2: Select — BT scoring + 2-Track CE selector
 * Stage 3: Execute — Role-Based deliberation or single-model call
 */

// -- Stage 1 input: TaskClassification (provided by host agent) --

/**
 * Task classification provided by the host agent via MCP tool parameters.
 * Replaces server-side keyword/LLM classification.
 */
export interface TaskClassification {
  domain: string;
  taskType: string;
  complexity: "simple" | "moderate" | "complex";
  criticality?: "low" | "medium" | "high" | "critical";
  language?: string;
  /** Per-request quality weight override from host. */
  qualityWeight?: number;
  /** Per-request cost weight override from host. */
  costWeight?: number;
}

// -- Stage 1 output: AxisTaskRequirement --

/**
 * Task requirement profile — output of profile lookup.
 * Named AxisTaskRequirement to avoid collision with src/profile/types.ts TaskRequirement.
 */
export interface AxisTaskRequirement {
  /** Capability dimension → importance weight (0~1). Sum should ~= 1.0. */
  capabilities: Record<string, number>;
  constraints: {
    minContextWindow?: number;
    requiresToolCalling?: boolean;
    requiresKorean?: boolean;
    structuredOutput?: boolean;
  };
  budget: {
    maxPerRequest?: number;
    /** Per-request quality weight override (from MCP host). */
    qualityWeight?: number;
    /** Per-request cost weight override (from MCP host). */
    costWeight?: number;
  };
  /** Domain carried through from TaskClassification for Selector's domain-specific scoring. */
  domain?: string;
  /** Task type carried through from TaskClassification for Selector's task-specific scoring. */
  taskType?: string;
  /** Criticality carried through from TaskClassification for Selector's quality-first decision. */
  criticality?: string;
  /** Token estimates passed from Profiler for cost filtering in Selector. */
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
}

// -- Stage 2 output: EnsemblePlan --

/**
 * Model selection plan — output of Selector.
 */
export interface EnsemblePlan {
  models: Array<{
    modelId: string;
    role?: string;
    weight?: number;
  }>;
  strategy: string;
  estimatedCost: number;
  /** Total effective cost across all rounds, accounting for provider prompt caching. */
  effectiveCost?: number;
  reason: string;
}

// -- Stage 3 output: DeliberationResult --

/**
 * Final deliberation result — output of DeliberationProtocol.
 */
export interface DeliberationResult {
  roundsExecuted: number;
  totalLLMCalls: number;
  modelsUsed: string[];
  /** Which protocol variant was used (e.g., "diverge-synth", "debate"). */
  protocol: string;
  /** Unique session ID for feedback linkage (Not Diamond session reference). */
  sessionId?: string;
  /** Token usage for cost tracking. */
  totalTokens?: { input: number; output: number };
  /** Per-round worker responses for audit trail. */
  rounds?: readonly { number: number; responses?: readonly { model: string; content: string }[]; failedWorkers?: readonly { model: string; error: string }[] }[];
  /** Model swaps that occurred during deliberation (worker failure → fallback). */
  modelSwaps?: readonly import("../deliberation/types").ModelSwap[];
}

// -- Scoring output: ModelScore --

/**
 * Model score — output of ScoringSystem.
 * Contains per-dimension BT ratings plus an overall composite score.
 */
export interface ModelScore {
  modelId: string;
  dimensions: Record<string, { mu: number; sigma: number }>;
  /** Composite score (sum of weighted mu across key dimensions). */
  overall: number;
}

// -- Shared utility types --

/**
 * Budget configuration for a single request.
 */
export interface BudgetConfig {
  perRequest: number;
}

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
 *
 * Accepts either a plain string (user prompt) or a ChatMessage[] array
 * (multi-turn conversation). Implementations must handle both forms:
 * - string → wrap as [{ role: "user", content: input }]
 * - ChatMessage[] → pass directly to the LLM API
 *
 * Optional GenerationParams (temperature, max_tokens, top_p) are forwarded
 * to the LLM provider when provided.
 *
 * Returns ChatResult with content + token usage for cost tracking.
 */
export type ChatFn = (
  modelId: string,
  input: string | import("../llm/types").ChatMessage[],
  params?: import("../deliberation/types").GenerationParams,
) => Promise<ChatResult>;

/**
 * Pairwise comparison result for BT rating update.
 */
export interface PairwiseResult {
  modelAId: string;
  modelBId: string;
  /** "A>>B" | "A>B" | "A=B" | "B>A" | "B>>A" */
  outcome: string;
  dimension: string;
  taskType?: string;
}

// -- SkillCell types (feedback redesign) --

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

// -- Trace types (for benchmark / dry-run) --

/** Stage 1-2 intermediate results (no LLM calls). */
export interface SlotTrace {
  scores: ModelScore[];
  classified: TaskClassification;
  requirement: AxisTaskRequirement;
  plan: EnsemblePlan;
}

/** Full pipeline trace including Stage 3 deliberation result. */
export interface RunTrace extends SlotTrace {
  result: DeliberationResult;
}
