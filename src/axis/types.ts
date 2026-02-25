/**
 * Axis boundary types — shared across all 5 slots.
 *
 * These types define the interfaces between slots in the 5-slot pipeline.
 * Each slot is independently replaceable as long as it honors these boundaries.
 */

// -- Slot 2 output: ClassifyOutput --

/**
 * Classification result with vocabKind discriminator.
 * vocabKind tells Profiler which lookup table to use.
 */
export interface ClassifyOutput {
  domain: string;
  taskType: string;
  /** Which vocabulary system was used. "taskType" = 62-type system, "step" = ~20 WorkflowStep system. */
  vocabKind: "taskType" | "step";
  complexity: "simple" | "moderate" | "complex";
  criticality: "low" | "medium" | "high" | "critical";
  method: "rule" | "llm" | "embedding" | "step-declare";
  language?: string;
  tokens?: { estimatedInput: number; estimatedOutput: number };
}

// -- Slot 3 output: AxisTaskRequirement --

/**
 * Task requirement profile — output of Profiler slot.
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
    strategy?: string;
  };
  /** Criticality carried through from ClassifyOutput for Selector's quality-first decision. */
  criticality?: string;
  /** Token estimates passed from Profiler for cost filtering in Selector. */
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
}

// -- Slot 4 output: EnsemblePlan --

/**
 * Model selection plan — output of Selector slot.
 */
export interface EnsemblePlan {
  models: Array<{
    modelId: string;
    role?: string;
    weight?: number;
  }>;
  strategy: string;
  estimatedCost: number;
  reason: string;
}

// -- Slot 5 output: DeliberationResult --

/**
 * Final deliberation result — output of DeliberationProtocol slot.
 */
export interface DeliberationResult {
  result: string;
  roundsExecuted: number;
  consensusReached: boolean;
  totalLLMCalls: number;
  modelsUsed: string[];
  /** Which protocol variant was used (e.g., "leader_decides", "single", "diverge-synth"). */
  protocol: string;
}

// -- Slot 1 output: ModelScore --

/**
 * Model score — output of ScoringSystem slot.
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
 * Optional hints from the orchestrator to assist classification.
 */
export interface RouteHints {
  domain_hint?: string;
  task_type_hint?: string;
  complexity_hint?: "simple" | "moderate" | "complex";
  step?: string;
}

/**
 * Chat function injected into the engine — allows any LLM backend.
 *
 * Accepts either a plain string (user prompt) or a ChatMessage[] array
 * (multi-turn conversation). Implementations must handle both forms:
 * - string → wrap as [{ role: "user", content: input }]
 * - ChatMessage[] → pass directly to the LLM API
 */
export type ChatFn = (
  modelId: string,
  input: string | import("../llm/types").ChatMessage[],
) => Promise<string>;

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

// -- AxisConfig types --

/**
 * Full axis pipeline configuration.
 * Used by createEngine() factory to compose the correct slot implementations.
 */
export interface AxisConfig {
  scoring: "bt-21" | "bt-step" | "elo" | "llm-judge" | "benchmark";
  classifier: "keyword" | "step-declare" | "llm" | "embedding";
  profiler: "domain-override" | "step-profile" | "moe-gating";
  selector: "2track-ce" | "4strategy" | "cascade" | "preference" | "mab";
  deliberation: "role-based" | "diverge-synth" | "adp" | "free-debate" | "voting" | "single-best";
  consensus?: "leader_decides" | "all_approve" | "majority";
  learning?: {
    tier0: boolean;
    tier1: boolean;
    tier2: boolean;
    tier3: boolean;
  };
  modelIds?: string[];
}
