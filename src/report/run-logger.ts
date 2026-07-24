/**
 * FileRunLogger — JSONL-based run archive for CLI tool invocations.
 *
 * Records each tool call (tool name, duration, success/error) to
 * `.pyreez/runs/{date}.jsonl` for debugging and monitoring.
 *
 * - FileIO DI for testability
 * - JSONL format (one JSON object per line)
 * - Date-based file partitioning
 *
 * @module Run Logger
 */

import type { FileIO } from "./types";

// -- Public Types --

/**
 * A single tool invocation record.
 */
export interface RunRecord {
  readonly id: string;
  readonly timestamp: number;
  readonly tool: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Interface for run logging — record tool invocations.
 */
export interface RunLogger {
  log(record: RunRecord): Promise<void>;
}

// -- Implementation --

export class FileRunLogger implements RunLogger {
  constructor(
    private readonly baseDir: string,
    private readonly io: FileIO,
  ) {
    if (!baseDir) {
      throw new Error("baseDir is required");
    }
    if (!io) {
      throw new Error("io is required");
    }
  }

  async log(record: RunRecord): Promise<void> {
    if (!record.id) {
      throw new Error("record.id is required");
    }
    if (!record.tool) {
      throw new Error("record.tool is required");
    }

    await this.io.mkdir(this.baseDir);
    const path = this.getDatePath(record.timestamp);
    await this.io.appendFile(path, JSON.stringify(record) + "\n");
  }

  private getDatePath(timestamp?: number): string {
    const date = new Date(timestamp ?? Date.now());
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${this.baseDir}/${yyyy}-${mm}-${dd}.jsonl`;
  }
}
