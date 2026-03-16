/**
 * Report module types — file I/O abstraction and call recording.
 */

/**
 * A single LLM call record for quality/cost tracking.
 * Used by calibration module for pairwise signal extraction.
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
  /** Team identifier for team-level evaluation. */
  teamId?: string;
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
