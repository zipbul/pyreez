/**
 * Deliberation Store types — record persistence and query for stigmergic reports.
 *
 * @see PLAN.md D7 (Stigmergic Report 확장)
 */

/**
 * A persisted record of a completed deliberation session.
 */
export interface DeliberationRecord {
  readonly id: string;
  readonly task: string;
  readonly timestamp: number;
  readonly perspectives: readonly string[];
  readonly consensusReached: boolean;
  readonly roundsExecuted: number;
  readonly result: string;
  readonly modelsUsed: readonly string[];
  readonly totalLLMCalls: number;
  readonly finalApprovals?: number;
  readonly producerInstructions?: string;
  readonly leaderInstructions?: string;
  readonly consensus?: string;
}

/**
 * Query filters for searching deliberation records.
 */
export interface DeliberationQuery {
  readonly task?: string;
  readonly perspective?: string;
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
