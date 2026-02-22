/**
 * InMemoryReporter — in-memory implementation of Reporter interface.
 * Records LLM call results for quality/cost tracking.
 * Phase B: in-memory storage. Phase C: persistent storage.
 */

import type { CallRecord, Reporter } from "./types";

export class InMemoryReporter implements Reporter {
  private readonly records: CallRecord[] = [];

  async record(call: CallRecord): Promise<void> {
    if (!call.model) {
      throw new Error("model is required");
    }
    if (!call.taskType) {
      throw new Error("taskType is required");
    }
    if (call.quality == null) {
      throw new Error("quality is required");
    }

    this.records.push({ ...call });
  }

  /** Return all recorded calls (defensive copy). */
  getAll(): readonly CallRecord[] {
    return [...this.records];
  }

  /** Filter records by model ID. */
  getByModel(model: string): readonly CallRecord[] {
    return this.records.filter((r) => r.model === model);
  }

  /** Filter records by task type. */
  getByTaskType(taskType: string): readonly CallRecord[] {
    return this.records.filter((r) => r.taskType === taskType);
  }

  /** Clear all records. */
  clear(): void {
    this.records.length = 0;
  }
}
