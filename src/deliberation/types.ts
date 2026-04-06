/**
 * Deliberation types — heterogeneous multi-model deliberation.
 *
 * Workers respond independently (diverge), Host synthesizes.
 * pyreez owns the deliberation harness (anti-conformity, steelmanning,
 * formatting, sharing structure). Host owns the semantic payload
 * (task, workerInstructions, protocol selection).
 *
 * @module Deliberation Types
 */

import type { TaskNature } from "./task-nature";

// -- Protocol --

/**
 * Deliberation protocols — each defines a distinct communication structure.
 *
 * - shared_convergence: workers share positions (sparse), converge toward consensus
 * - adversarial_debate: workers share positions + must challenge, no convergence
 * - host_interrogation: workers isolated, host asks 1:1 questions
 * - sequential_refinement: workers chain A→B→C, each improves previous
 * - evaluation_scoring: workers isolated, independent scoring + aggregation
 * - red_team: asymmetric roles (generator vs attacker)
 */
export type Protocol =
  | "shared_convergence"
  | "adversarial_debate"
  | "host_interrogation"
  | "sequential_refinement"
  | "evaluation_scoring"
  | "red_team";

// -- Generation Parameters --

/**
 * Optional LLM generation parameters passed through to providers.
 * Controls temperature, response length, and sampling.
 */
export interface GenerationParams {
  readonly temperature?: number;
  readonly top_p?: number;
  readonly fileAccess?: boolean;
}

// -- Team Composition --

/**
 * Role within a deliberation team.
 * "worker" is standard. "generator"/"attacker" are used in red_team protocol.
 */
export type TeamRole = "worker" | "generator" | "attacker";

/**
 * A single team member assignment.
 */
export interface TeamMember {
  /** Model ID (e.g., "openai/gpt-5"). */
  readonly model: string;
  /** Assigned role. */
  readonly role: TeamRole;
}

/**
 * Full team composition for a deliberation session.
 */
export interface TeamComposition {
  readonly workers: readonly TeamMember[];
}

// -- Round Structure --

/**
 * A single worker's response for a round.
 */
export interface WorkerResponse {
  readonly model: string;
  readonly content: string;
  /** Positional index in the diverge phase. */
  readonly workerIndex: number;
  /** Self-reported confidence from explicit markers. undefined = no marker found. */
  readonly confidence?: "high" | "medium" | "low";
}

/**
 * A worker that failed during a round.
 */
export interface FailedWorker {
  readonly model: string;
  /** Human-readable error message (cleaned of raw JSON). */
  readonly error: string;
  /** Classified error type for programmatic handling. */
  readonly errorCode?: string;
  /** Whether this error is likely transient (rate limit, timeout). */
  readonly retryable?: boolean;
}

/**
 * A single deliberation round.
 */
export interface Round {
  readonly number: number;
  readonly responses: readonly WorkerResponse[];
  /** Workers that failed during this round (partial failure tracking). */
  readonly failedWorkers?: readonly FailedWorker[];
  /** Protocol used for this round. */
  readonly protocol?: Protocol;
}

// -- SharedContext --

/**
 * SharedContext: the central state of a deliberation session.
 * Immutable: each mutation returns a new SharedContext.
 */
export interface SharedContext {
  readonly task: string;
  readonly team: TeamComposition;
  readonly rounds: readonly Round[];
  readonly taskNature?: TaskNature;
}

// -- Token Usage --

/**
 * Accumulated token usage across a deliberation session.
 */
export interface TokenUsage {
  readonly input: number;
  readonly output: number;
}

// -- Model Swap --

/**
 * Records a worker model swap during deliberation.
 * Created when a worker fails and is replaced by a fallback model.
 * `replacement` is undefined when no fallback is available (pool exhausted or manual mode).
 */
export interface ModelSwap {
  readonly original: string;
  readonly replacement?: string;
  readonly round: number;
  /** Human-readable error message (cleaned of raw JSON). */
  readonly error: string;
  readonly httpStatus?: number;
  /** Classified error type for programmatic handling. */
  readonly errorCode?: string;
  /** Whether this error is likely transient (rate limit, timeout). */
  readonly retryable?: boolean;
}

// -- Host Interrogation --

/**
 * A single question-answer exchange in host interrogation.
 */
export interface InterrogationExchange {
  readonly question: string;
  readonly answer: string;
}

// -- Evaluation Scoring --

/**
 * Aggregation method for evaluation scoring.
 */
export type AggregationMethod = "voting" | "consensus" | "confidence_weighted";

// -- Deliberate Tool I/O --

/**
 * Input for the deliberation engine.
 * Host provides task + optional instructions for workers.
 */
export interface DeliberateInput {
  readonly task: string;
  readonly workerInstructions?: string;
  readonly maxRounds?: number;
  /** Deliberation protocol. Required. */
  readonly protocol: Protocol;
  /** Model IDs to use as workers. Required (min 1). */
  readonly models: readonly string[];
  /** Number of workers. Default = models.length. Upper bound 7, lower bound 1. */
  readonly count?: number;
  /** Task nature for prompt selection. Artifact = deliverable output, Critique = analysis. */
  readonly taskNature?: TaskNature;

  // -- Protocol-specific fields --

  /** Host interrogation: questions to ask each worker. */
  readonly questions?: readonly string[];
  /** Host interrogation: previous exchanges for session continuation. Keyed by workerIndex. */
  readonly previousExchanges?: Readonly<Record<number, readonly InterrogationExchange[]>>;

  /** Evaluation scoring: criteria for evaluation. */
  readonly criteria?: string;
  /** Evaluation scoring: subject to evaluate. */
  readonly subject?: string;
  /** Evaluation scoring: aggregation method. Default: "voting". */
  readonly aggregation?: AggregationMethod;

  /** Red team: role assignments per worker index. */
  readonly roles?: Readonly<Record<number, "generator" | "attacker">>;

  /** Sequential refinement: order of worker indices. */
  readonly workerOrder?: readonly number[];

  /** Enable read-only file access for workers during deliberation.
   * CLI providers: enables file read tools + sets cwd to project directory.
   * API providers: enables function calling with read-only file tools. */
  readonly fileAccess?: boolean;

  /**
   * Optional callback invoked after each round completes.
   * Enables streaming output in CLI mode. Not serializable — runtime only.
   */
  readonly onRound?: (round: {
    number: number;
    responses: readonly { model: string; content: string; confidence?: "high" | "medium" | "low" }[];
    failedWorkers?: readonly FailedWorker[];
    protocol: Protocol;
  }) => void;
}

/**
 * Output from the deliberation engine.
 */
/** Team degradation metadata — attached when team shrinks below requested size. */
export interface Degradation {
  readonly originalTeamSize: number;
  readonly activeTeamSize: number;
  readonly lostSlots: readonly { model: string; reason: string }[];
}

export interface DeliberateOutput {
  readonly roundsExecuted: number;
  readonly totalTokens: TokenUsage;
  readonly totalLLMCalls: number;
  readonly modelsUsed: readonly string[];
  /** Protocol used. */
  readonly protocol: Protocol;
  /** Per-round details for diagnostics. */
  readonly rounds?: readonly {
    number: number;
    protocol: Protocol;
    responses?: readonly { model: string; content: string; confidence?: "high" | "medium" | "low" }[];
    failedWorkers?: readonly FailedWorker[];
  }[];
  /** Warnings about deliberation quality (e.g., low provider diversity). */
  readonly warnings?: readonly string[];
  /** Model swaps that occurred during deliberation (worker failure → fallback). */
  readonly modelSwaps?: readonly ModelSwap[];
  /** Team degradation info — present when team shrank below requested size. */
  readonly degradation?: Degradation;
  /** Aggregation results for evaluation_scoring protocol. */
  readonly aggregation?: {
    readonly method: AggregationMethod;
    readonly results: readonly { model: string; score?: number; verdict?: string; confidence?: "high" | "medium" | "low" }[];
    /** Confidence-weighted average score (confidence_weighted method). */
    readonly weightedScore?: number;
    /** Majority verdict (voting method). */
    readonly majorityVerdict?: string;
    /** Vote count for majority verdict (voting method). */
    readonly voteCount?: number;
    /** Consensus verdict if all agree (consensus method). */
    readonly consensus?: string;
  };
}
