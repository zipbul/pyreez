/**
 * FileDeliberationStore — JSONL-based file store for deliberation records.
 *
 * Pattern follows FileReporter (src/report/file-reporter.ts):
 * - FileIO DI for testability
 * - JSONL format (one JSON object per line)
 * - Date-based file partitioning
 *
 * @module Deliberation File Store
 */

import type { FileIO } from "../report/types";
import type {
  DeliberationRecord,
  DeliberationQuery,
  DeliberationStore,
} from "./store-types";

export class FileDeliberationStore implements DeliberationStore {
  constructor(
    private readonly baseDir: string,
    private readonly io: FileIO,
  ) {}

  async save(record: DeliberationRecord): Promise<void> {
    if (!record.id) {
      throw new Error("record.id is required");
    }
    if (!record.task) {
      throw new Error("record.task is required");
    }

    await this.io.mkdir(this.baseDir);
    const path = this.getDatePath(record.timestamp);
    await this.io.appendFile(path, JSON.stringify(record) + "\n");
  }

  async query(q: DeliberationQuery): Promise<readonly DeliberationRecord[]> {
    const files = await this.io.glob(`${this.baseDir}/*.jsonl`);
    if (files.length === 0) {
      return [];
    }

    const allRecords: DeliberationRecord[] = [];
    for (const file of files) {
      const content = await this.io.readFile(file);
      const lines = content.split("\n").filter((l) => l.trim() !== "");
      for (const line of lines) {
        try {
          allRecords.push(JSON.parse(line) as DeliberationRecord);
        } catch {
          // skip invalid JSON lines
        }
      }
    }

    let results = allRecords;

    if (q.task != null) {
      results = results.filter((r) => r.task.includes(q.task!));
    }
    if (q.perspective != null) {
      results = results.filter((r) =>
        r.perspectives.some((p) => p === q.perspective),
      );
    }
    if (q.model != null) {
      results = results.filter((r) =>
        r.modelsUsed.some((m) => m === q.model),
      );
    }
    if (q.consensusReached != null) {
      results = results.filter(
        (r) => r.consensusReached === q.consensusReached,
      );
    }
    if (q.limit != null) {
      results = results.slice(0, q.limit);
    }

    return results;
  }

  async getById(id: string): Promise<DeliberationRecord | undefined> {
    const all = await this.query({});
    return all.find((r) => r.id === id);
  }

  private getDatePath(timestamp?: number): string {
    const date = new Date(timestamp ?? Date.now());
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${this.baseDir}/${yyyy}-${mm}-${dd}.jsonl`;
  }
}
