/**
 * Model registry types — 21-dimension capability model.
 */

// -- Capability Dimensions (21) --

/**
 * Cognitive capabilities (C1-C6).
 */
export type CognitiveDimension =
  | "REASONING"
  | "MATH_REASONING"
  | "MULTI_STEP_DEPTH"
  | "CREATIVITY"
  | "ANALYSIS"
  | "JUDGMENT";

/**
 * Technical capabilities (T1-T5).
 */
export type TechnicalDimension =
  | "CODE_GENERATION"
  | "CODE_UNDERSTANDING"
  | "DEBUGGING"
  | "SYSTEM_THINKING"
  | "TOOL_USE";

/**
 * Trustworthiness capabilities (R1-R4).
 */
export type TrustworthinessDimension =
  | "HALLUCINATION_RESISTANCE"
  | "CONFIDENCE_CALIBRATION"
  | "SELF_CONSISTENCY"
  | "AMBIGUITY_HANDLING";

/**
 * Language capabilities (L1-L4).
 */
export type LanguageDimension =
  | "INSTRUCTION_FOLLOWING"
  | "STRUCTURED_OUTPUT"
  | "LONG_CONTEXT"
  | "MULTILINGUAL";

/**
 * Operational capabilities (O1-O2).
 */
export type OperationalDimension = "SPEED" | "COST_EFFICIENCY";

/**
 * All 21 capability dimensions.
 */
export type CapabilityDimension =
  | CognitiveDimension
  | TechnicalDimension
  | TrustworthinessDimension
  | LanguageDimension
  | OperationalDimension;

/**
 * All dimension IDs for iteration.
 */
export const ALL_DIMENSIONS: readonly CapabilityDimension[] = [
  // Cognitive (6)
  "REASONING",
  "MATH_REASONING",
  "MULTI_STEP_DEPTH",
  "CREATIVITY",
  "ANALYSIS",
  "JUDGMENT",
  // Technical (5)
  "CODE_GENERATION",
  "CODE_UNDERSTANDING",
  "DEBUGGING",
  "SYSTEM_THINKING",
  "TOOL_USE",
  // Trustworthiness (4)
  "HALLUCINATION_RESISTANCE",
  "CONFIDENCE_CALIBRATION",
  "SELF_CONSISTENCY",
  "AMBIGUITY_HANDLING",
  // Language (4)
  "INSTRUCTION_FOLLOWING",
  "STRUCTURED_OUTPUT",
  "LONG_CONTEXT",
  "MULTILINGUAL",
  // Operational (2)
  "SPEED",
  "COST_EFFICIENCY",
] as const;

// -- Model Capabilities --

/**
 * Capability scores for a model (0-10 scale per dimension).
 */
export type ModelCapabilities = Record<CapabilityDimension, number>;

/**
 * Confidence per dimension (0.0 - 1.0).
 * confidence = min(1.0, testCount / 10).
 */
export type ModelConfidence = Record<CapabilityDimension, number>;

// -- Model Cost --

/**
 * Model pricing (USD per 1M tokens).
 */
export interface ModelCost {
  inputPer1M: number;
  outputPer1M: number;
}

// -- Model Info --

/**
 * Full model registry entry.
 */
export interface ModelInfo {
  /** Unique model identifier (e.g., "openai/gpt-4.1"). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Context window size in tokens. */
  contextWindow: number;
  /** Capability scores (0-10). */
  capabilities: ModelCapabilities;
  /** Confidence per dimension (0.0-1.0). */
  confidence: ModelConfidence;
  /** Pricing info. */
  cost: ModelCost;
  /** Whether the model supports tool/function calling. */
  supportsToolCalling: boolean;
}
