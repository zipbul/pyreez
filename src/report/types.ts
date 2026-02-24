/**
 * Report module types — call recording for quality tracking.
 */

/**
 * Context utilization metrics for a single LLM call.
 */
export interface ContextMetrics {
  /** Model's context window size in tokens. */
  windowSize: number;
  /** Input tokens / window size (0.0-1.0). */
  utilization: number;
  /** Estimated ratio of unnecessary tokens (0.0-1.0). Team Leader judgment, optional. */
  estimatedWaste?: number;
}

/**
 * A single LLM call record for quality/cost tracking.
 */
export interface CallRecord {
  /** Model ID used (e.g., "openai/gpt-4.1"). */
  model: string;
  /** Task type from classification (e.g., "CODE_WRITE"). */
  taskType: string;
  /** Quality score (0-10). */
  quality: number;
  /** Latency in milliseconds. */
  latencyMs: number;
  /** Token usage. */
  tokens: { input: number; output: number };
  /** Context utilization metrics. */
  context?: ContextMetrics;
  /** Team identifier for team-level evaluation. */
  teamId?: string;
  /** Team Leader model ID. */
  leaderId?: string;
}

/**
 * Reporter interface — records LLM call results.
 */
export interface Reporter {
  record(call: CallRecord): Promise<void>;
}

/**
 * Abstraction over file system I/O for testability.
 */
export interface FileIO {
  /** Append data to a file, creating it if it doesn't exist. */
  appendFile(path: string, data: string): Promise<void>;
  /** Read entire file as string. */
  readFile(path: string): Promise<string>;
  /** Write entire file as string (overwrites). */
  writeFile(path: string, data: string): Promise<void>;
  /** Create directory recursively. */
  mkdir(path: string): Promise<void>;
  /** Return file paths matching a glob pattern. Sorted ascending. */
  glob(pattern: string): Promise<string[]>;
  /** Remove all files matching a glob pattern. */
  removeGlob(pattern: string): Promise<void>;
}

/**
 * Per-model summary statistics.
 */
export interface ModelSummary {
  count: number;
  avgQuality: number;
  avgLatencyMs: number;
  avgTokens: { input: number; output: number };
  avgContextUtilization: number | null;
}

/**
 * Aggregated report summary.
 */
export interface ReportSummary {
  totalRecords: number;
  models: Record<string, ModelSummary>;
}
