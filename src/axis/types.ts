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
  result: string;
  roundsExecuted: number;
  consensusReached: boolean | null;
  totalLLMCalls: number;
  modelsUsed: string[];
  /** Which protocol variant was used (e.g., "leader_decides", "single", "role-based"). */
  protocol: string;
  /** Unique session ID for feedback linkage (Not Diamond session reference). */
  sessionId?: string;
  /** Token usage for cost tracking. */
  totalTokens?: { input: number; output: number };
  /** Per-round worker responses and synthesis for audit trail. */
  rounds?: readonly { number: number; responses?: readonly { model: string; content: string }[]; synthesis?: string; failedWorkers?: readonly { model: string; error: string }[] }[];
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
  content: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Chat function injected into the engine — allows any LLM backend.
 *
 * Accepts either a plain string (user prompt) or a ChatMessage[] array
 * (multi-turn conversation). Implementations must handle both forms:
 * - string → wrap as [{ role: "user", content: input }]
 * - ChatMessage[] → pass directly to the LLM API
 *
 * Returns ChatResult with content + token usage for cost tracking.
 */
export type ChatFn = (
  modelId: string,
  input: string | import("../llm/types").ChatMessage[],
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
