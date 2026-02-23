/**
 * Task profiling types — capability requirements per task type.
 */

import type { CapabilityDimension } from "../model/types";
import type { TaskDomain, TaskType, Criticality } from "../classify/types";

/**
 * Single capability requirement with weight and optional minimum.
 */
export interface CapabilityRequirement {
  dimension: CapabilityDimension;
  /** Importance weight (0.0-1.0). Sum of all weights in a profile = 1.0. */
  weight: number;
  /** Minimum mu threshold. Models below this are filtered out. */
  minimum?: number;
}

/**
 * Full task requirement profile — output of PROFILE phase.
 */
export interface TaskRequirement {
  taskType: TaskType;
  domain: TaskDomain;
  requiredCapabilities: CapabilityRequirement[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  requiresStructuredOutput: boolean;
  requiresKorean: boolean;
  requiresToolCalling: boolean;
  /** Task criticality — determines quality-first vs cost-first selection. */
  criticality?: Criticality;
}
