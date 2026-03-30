/**
 * Model registry types.
 */

import type { ProviderName } from "../llm/types";

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
  /** Unique model identifier (e.g., "openai/gpt-5.4"). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Provider that serves this model. */
  provider: ProviderName;
  /** Context window size in tokens. */
  contextWindow: number;
  /** Pricing info. */
  cost: ModelCost;
  /** Whether the model supports tool/function calling. */
  supportsToolCalling: boolean;
  /** Whether the model is currently available in the API. Defaults to true if omitted. */
  available?: boolean;
  /** Model architecture family (e.g., "claude-4", "grok-4", "gpt-5"). */
  family?: string;
  /** Per-category benchmark scores (0-100). Source: benchlm.ai / artificialanalysis.ai. */
  benchmark?: Record<string, number>;
}
