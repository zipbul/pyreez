/**
 * Routing trace — structured log for every pyreez_route call.
 *
 * Captures classification, candidate ranking, final selection, and
 * A/B group for post-hoc analysis of routing quality.
 */

export interface RoutingTrace {
  id: string;
  sessionId: string;
  timestamp: number;
  /** Truncated task description (max 200 chars). */
  task: string;
  classification: {
    domain: string;
    taskType: string;
    complexity: string;
    method: "host" | "default";
  };
  candidateCount: number;
  topCandidates: Array<{
    modelId: string;
    composite: number;
    cost: number;
  }>;
  selected: Array<{
    modelId: string;
    role?: string;
  }>;
  strategy: string;
  reason: string;
  estimatedCost: number;
  selectorVariant: string;
  abGroup?: string;
}

/** Truncate task description for trace storage. */
export function truncateTask(task: string, maxLen = 200): string {
  if (task.length <= maxLen) return task;
  return task.slice(0, maxLen) + "…";
}
