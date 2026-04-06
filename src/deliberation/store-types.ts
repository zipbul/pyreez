/**
 * Deliberation Store types — record persistence and query.
 *
 * @module Deliberation Store Types
 */

import type { ModelSwap, Round, TokenUsage } from "./types";

/**
 * A persisted record of a completed deliberation session.
 */
export interface DeliberationRecord {
  readonly id: string;
  readonly task: string;
  readonly timestamp: number;
  readonly roundsExecuted: number;
  readonly modelsUsed: readonly string[];
  readonly totalLLMCalls: number;
  readonly totalTokens?: TokenUsage;
  readonly workerInstructions?: string;
  readonly protocol?: "shared_convergence" | "adversarial_debate" | "host_interrogation" | "sequential_refinement" | "evaluation_scoring" | "red_team";
  /** Full round-by-round log (worker responses). */
  readonly rounds?: readonly Round[];
  /** Lightweight round summaries (number only). */
  readonly roundsSummary?: readonly { number: number }[];
  /** Model swaps that occurred during deliberation. */
  readonly modelSwaps?: readonly ModelSwap[];
}

/**
 * Query filters for searching deliberation records.
 */
export interface DeliberationQuery {
  readonly task?: string;
  readonly model?: string;
  readonly limit?: number;
}

/**
 * Interface for deliberation record persistence.
 */
export interface DeliberationStore {
  save(record: DeliberationRecord): Promise<void>;
  query(q: DeliberationQuery): Promise<readonly DeliberationRecord[]>;
  getById(id: string): Promise<DeliberationRecord | undefined>;
}
