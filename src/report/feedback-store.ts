/**
 * FileFeedbackStore — JSONL-based feedback persistence.
 *
 * Stores feedback records in .pyreez/feedback/YYYY-MM-DD.jsonl.
 * Reuses FileIO abstraction for testability.
 */

import { join } from "node:path";
import type { FileIO } from "./types";
import type { FeedbackRecord } from "./feedback-types";

export class FileFeedbackStore {
  constructor(
    private readonly baseDir: string,
    private readonly io: FileIO,
  ) {}

  async record(feedback: FeedbackRecord): Promise<void> {
    await this.io.mkdir(this.baseDir);
    const date = new Date(feedback.timestamp).toISOString().slice(0, 10);
    const path = join(this.baseDir, `${date}.jsonl`);
    await this.io.appendFile(path, JSON.stringify(feedback) + "\n");
  }

  async getAll(): Promise<readonly FeedbackRecord[]> {
    try {
      const files = await this.io.glob(join(this.baseDir, "*.jsonl"));
      const records: FeedbackRecord[] = [];
      for (const file of files) {
        const content = await this.io.readFile(file);
        for (const line of content.split("\n")) {
          if (line.trim()) {
            records.push(JSON.parse(line));
          }
        }
      }
      return records;
    } catch {
      return [];
    }
  }

  async query(filter: {
    sessionId?: string;
    modelId?: string;
  }): Promise<readonly FeedbackRecord[]> {
    const all = await this.getAll();
    return all.filter((r) => {
      if (filter.sessionId && r.sessionId !== filter.sessionId) return false;
      if (filter.modelId && r.modelId !== filter.modelId) return false;
      return true;
    });
  }
}
