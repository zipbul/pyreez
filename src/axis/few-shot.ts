/**
 * FewShotExtractor — extracts successful deliberation examples for few-shot prompting.
 *
 * Reads JSONL files from the deliberation store, filters for consensus-reached
 * examples matching the target task type, returns top N for prompt injection.
 */

import type { FileIO } from "../report/types";

const DEFAULT_BASE_PATH = ".pyreez/deliberations";
const DEFAULT_MAX_EXAMPLES = 3;

export interface FewShotExtractorOptions {
  io: FileIO;
  basePath?: string;
  maxExamples?: number;
}

interface DelibRecord {
  taskType?: string;
  consensusReached?: boolean;
  result?: string;
  modelsUsed?: string[];
}

export class FewShotExtractor {
  private readonly io: FileIO;
  private readonly basePath: string;
  private readonly maxExamples: number;

  constructor(opts: FewShotExtractorOptions) {
    this.io = opts.io;
    this.basePath = opts.basePath ?? DEFAULT_BASE_PATH;
    this.maxExamples = opts.maxExamples ?? DEFAULT_MAX_EXAMPLES;
  }

  /**
   * Extract successful deliberation examples matching the given task type.
   * Returns up to maxExamples result strings from consensus-reached records.
   * On any error, returns empty array.
   */
  async extract(taskType: string): Promise<string[]> {
    if (this.maxExamples <= 0) return [];

    try {
      const files = await this.io.glob(`${this.basePath}/**/*.jsonl`);
      const examples: string[] = [];

      for (const file of files) {
        const content = await this.io.readFile(file);
        const lines = content.split("\n").filter((l) => l.trim().length > 0);

        for (const line of lines) {
          try {
            const record: DelibRecord = JSON.parse(line);
            if (
              record.consensusReached === true &&
              record.taskType === taskType &&
              record.result
            ) {
              examples.push(record.result);
              if (examples.length >= this.maxExamples) {
                return examples;
              }
            }
          } catch {
            // Skip malformed JSONL lines
          }
        }
      }

      return examples;
    } catch {
      return [];
    }
  }
}
