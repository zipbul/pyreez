/**
 * FileRunLogger — JSONL-based run archive for MCP tool invocations.
 *
 * Records each tool call (tool name, duration, success/error) to
 * `.pyreez/runs/{date}.jsonl` for debugging and monitoring.
 *
 * Pattern follows FileReporter/FileDeliberationStore:
 * - FileIO DI for testability
 * - JSONL format (one JSON object per line)
 * - Date-based file partitioning
 *
 * @module Run Logger
 */

import type { FileIO } from "./types";

// -- Public Types --

/**
 * A single MCP tool invocation record.
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
 * Query filters for searching run records.
 */
export interface RunLogQuery {
  readonly tool?: string;
  readonly success?: boolean;
  readonly limit?: number;
}

/**
 * Interface for run logging — record and query tool invocations.
 */
export interface RunLogger {
  log(record: RunRecord): Promise<void>;
  query(filter?: RunLogQuery): Promise<readonly RunRecord[]>;
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

  async query(filter?: RunLogQuery): Promise<readonly RunRecord[]> {
    const files = await this.io.glob(`${this.baseDir}/*.jsonl`);
    if (files.length === 0) {
      return [];
    }

    const allRecords: RunRecord[] = [];
    for (const file of files) {
      const content = await this.io.readFile(file);
      const lines = content.split("\n").filter((l) => l.trim() !== "");
      for (const line of lines) {
        try {
          allRecords.push(JSON.parse(line) as RunRecord);
        } catch {
          // skip malformed JSON lines
        }
      }
    }

    let results = allRecords;

    if (filter?.tool != null) {
      results = results.filter((r) => r.tool === filter.tool);
    }
    if (filter?.success != null) {
      results = results.filter((r) => r.success === filter.success);
    }
    if (filter?.limit != null) {
      results = results.slice(0, Math.max(0, filter.limit));
    }

    return results;
  }

  private getDatePath(timestamp?: number): string {
    const date = new Date(timestamp ?? Date.now());
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${this.baseDir}/${yyyy}-${mm}-${dd}.jsonl`;
  }
}
