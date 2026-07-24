/**
 * Model registry types.
 */

import type { ProviderName } from "../llm/types";

// -- Model Cost --

// -- Model Info --

/**
 * Full model registry entry.
 */
export interface ModelInfo {
  /** Unique model identifier (e.g., "openai/gpt-5.4"). */
  id: string;
  /** Provider that serves this model. */
  provider: ProviderName;
}
