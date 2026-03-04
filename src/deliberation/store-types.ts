/**
 * Deliberation Store types — record persistence and query.
 *
 * @module Deliberation Store Types
 */

import type { Round, TokenUsage } from "./types";

/**
 * A persisted record of a completed deliberation session.
 */
export interface DeliberationRecord {
  readonly id: string;
  readonly task: string;
  readonly timestamp: number;
  readonly consensusReached: boolean;
  readonly roundsExecuted: number;
  readonly result: string;
  readonly modelsUsed: readonly string[];
  readonly totalLLMCalls: number;
  readonly totalTokens?: TokenUsage;
  readonly workerInstructions?: string;
  readonly leaderInstructions?: string;
  readonly consensus?: string;
  readonly protocol?: "diverge-synth" | "debate";
  /** Full round-by-round log (worker responses + synthesis). */
  readonly rounds?: readonly Round[];
  /** Lightweight round summaries (number + synthesis text only). */
  readonly roundsSummary?: readonly { number: number; synthesis?: string }[];
}

/**
 * Query filters for searching deliberation records.
 */
export interface DeliberationQuery {
  readonly task?: string;
  readonly model?: string;
  readonly consensusReached?: boolean;
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
