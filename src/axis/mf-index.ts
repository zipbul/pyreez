/**
 * MF Index — maps task types and model IDs to numeric indices for MfLearner.
 *
 * Provides deterministic, stable index mappings:
 * - Task types: derived from DOMAIN_TASK_TYPES (78 types, fixed order)
 * - Model IDs: alphabetically sorted for determinism
 */

import { DOMAIN_TASK_TYPES } from "../classify/types";
import type { TaskDomain } from "../classify/types";

/**
 * Build a deterministic task type → index map from DOMAIN_TASK_TYPES.
 * Iterates domains in declaration order, task types within each domain in order.
 */
export function buildTaskTypeIndex(): Map<string, number> {
  const index = new Map<string, number>();
  let i = 0;
  const domains = Object.keys(DOMAIN_TASK_TYPES) as TaskDomain[];
  for (const domain of domains) {
    for (const taskType of DOMAIN_TASK_TYPES[domain]) {
      index.set(taskType, i++);
    }
  }
  return index;
}

/**
 * Build a deterministic model ID → index map (alphabetically sorted).
 */
export function buildModelIndex(modelIds: string[]): Map<string, number> {
  const sorted = [...modelIds].sort();
  const index = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    index.set(sorted[i]!, i);
  }
  return index;
}

/** Pre-built task type index (singleton). */
export const TASK_TYPE_INDEX = buildTaskTypeIndex();

/** Total number of task types. */
export const NUM_TASK_TYPES = TASK_TYPE_INDEX.size;
