/**
 * FileReporter — file-based implementation of Reporter interface.
 * Records LLM call results as JSONL files in baseDir/{date}.jsonl.
 * I/O is injected via FileIO for testability.
 */

import type {
  CallRecord,
  FileIO,
  ModelSummary,
  Reporter,
  ReportSummary,
} from "./types";

export class FileReporter implements Reporter {
  private readonly baseDir: string;
  private readonly io: FileIO;

  constructor(baseDir: string, io: FileIO) {
    if (!baseDir) {
      throw new Error("baseDir is required");
    }
    if (!io) {
      throw new Error("io is required");
    }

    this.baseDir = baseDir;
    this.io = io;
  }

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

    const filePath = this.getDatePath();
    await this.io.mkdir(this.baseDir);
    await this.io.appendFile(filePath, JSON.stringify(call) + "\n");
  }

  /** Return all recorded calls from all JSONL files. */
  async getAll(): Promise<readonly CallRecord[]> {
    const files = await this.io.glob(`${this.baseDir}/*.jsonl`);
    if (files.length === 0) return [];

    const records: CallRecord[] = [];
    for (const file of files) {
      const content = await this.io.readFile(file);
      const lines = content.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          records.push(JSON.parse(line) as CallRecord);
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
    return records;
  }

  /** Filter records by model ID. */
  async getByModel(model: string): Promise<readonly CallRecord[]> {
    const all = await this.getAll();
    return all.filter((r) => r.model === model);
  }

  /** Filter records by task type. */
  async getByTaskType(taskType: string): Promise<readonly CallRecord[]> {
    const all = await this.getAll();
    return all.filter((r) => r.taskType === taskType);
  }

  /** Return aggregated summary statistics. */
  async summary(): Promise<ReportSummary> {
    const all = await this.getAll();
    if (all.length === 0) {
      return { totalRecords: 0, models: {} };
    }

    const groups = new Map<string, CallRecord[]>();
    for (const record of all) {
      const list = groups.get(record.model) ?? [];
      list.push(record);
      groups.set(record.model, list);
    }

    const models: Record<string, ModelSummary> = {};
    for (const [modelId, records] of groups) {
      const count = records.length;
      const avgQuality =
        records.reduce((sum, r) => sum + r.quality, 0) / count;
      const avgLatencyMs =
        records.reduce((sum, r) => sum + r.latencyMs, 0) / count;
      const avgTokensInput =
        records.reduce((sum, r) => sum + r.tokens.input, 0) / count;
      const avgTokensOutput =
        records.reduce((sum, r) => sum + r.tokens.output, 0) / count;

      const contextRecords = records.filter((r) => r.context != null);
      const avgContextUtilization =
        contextRecords.length > 0
          ? contextRecords.reduce(
              (sum, r) => sum + r.context!.utilization,
              0,
            ) / contextRecords.length
          : null;

      models[modelId] = {
        count,
        avgQuality,
        avgLatencyMs,
        avgTokens: { input: avgTokensInput, output: avgTokensOutput },
        avgContextUtilization,
      };
    }

    return { totalRecords: all.length, models };
  }

  /** Return average latency per model from summary data. */
  async getLatencyMap(): Promise<Map<string, number>> {
    const s = await this.summary();
    const map = new Map<string, number>();
    for (const [modelId, info] of Object.entries(s.models)) {
      if (info.avgLatencyMs > 0) {
        map.set(modelId, info.avgLatencyMs);
      }
    }
    return map;
  }

  /** Remove all report files. */
  async clear(): Promise<void> {
    await this.io.removeGlob(`${this.baseDir}/*.jsonl`);
  }

  /** Generate date-based file path (YYYY-MM-DD.jsonl). */
  private getDatePath(): string {
    const date = new Date().toISOString().slice(0, 10);
    return `${this.baseDir}/${date}.jsonl`;
  }
}
