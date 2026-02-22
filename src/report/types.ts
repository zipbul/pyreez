/**
 * Report module types — call recording for quality tracking.
 */

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
}

/**
 * Reporter interface — records LLM call results.
 */
export interface Reporter {
  record(call: CallRecord): Promise<void>;
}
