/**
 * Deliberation types — multi-model deliberation.
 *
 * Workers respond independently (diverge), Host synthesizes.
 * Host provides all role prompts; pyreez provides infrastructure only.
 *
 * @module Deliberation Types
 */

import type { TaskNature } from "./task-nature";

// -- Interaction Technique --

/**
 * Interaction techniques for multi-round deliberation.
 * Emphasis, not constraint — workers may include other observations.
 */
export type InteractionTechnique =
  | "challenge" | "defend" | "accept" | "probe"
  | "propose" | "extend" | "transform";

// -- Generation Parameters --

/**
 * Optional LLM generation parameters passed through to providers.
 * Controls temperature, response length, and sampling.
 */
export interface GenerationParams {
  readonly temperature?: number;
  readonly max_tokens?: number;
  readonly top_p?: number;
}

// -- Team Composition --

/**
 * Role within a deliberation team. All members are workers.
 */
export type TeamRole = "worker";

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
  readonly domain?: string;
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

// -- Deliberate Tool I/O --

/**
 * Input for the deliberation engine.
 * Host provides task + optional instructions for workers.
 */
export interface DeliberateInput {
  readonly task: string;
  readonly workerInstructions?: string;
  readonly maxRounds?: number;
  /** Deliberation protocol. Default: "diverge-synth". */
  readonly protocol?: "diverge-synth" | "debate";
  /** Model IDs to use as workers. Required (min 1). */
  readonly models: readonly string[];
  /** Number of workers. Default = models.length. Upper bound 7, lower bound 1. */
  readonly count?: number;
  /** Task nature for prompt selection. Artifact = deliverable output, Critique = analysis. */
  readonly taskNature?: TaskNature;
  /** Domain for SkillCell evaluator. */
  readonly domain?: string;
  /** Task type for SkillCell evaluator. */
  readonly taskType?: string;
  /**
   * Interaction technique. Emphasis, not constraint.
   * Single value: all rounds. Array: per-round (last repeats on exhaustion).
   * Empty array or undefined: no technique (existing behavior).
   */
  readonly technique?: InteractionTechnique | readonly InteractionTechnique[];
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
  /** Per-round details for diagnostics. */
  readonly rounds?: readonly {
    number: number;
    responses?: readonly { model: string; content: string; confidence?: "high" | "medium" | "low" }[];
    failedWorkers?: readonly FailedWorker[];
  }[];
  /** Warnings about deliberation quality (e.g., low provider diversity). */
  readonly warnings?: readonly string[];
  /** Model swaps that occurred during deliberation (worker failure → fallback). */
  readonly modelSwaps?: readonly ModelSwap[];
  /** Team degradation info — present when team shrank below requested size. */
  readonly degradation?: Degradation;
}
