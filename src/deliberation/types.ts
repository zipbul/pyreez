/**
 * Deliberation types — multi-model deliberation.
 *
 * Workers respond independently (diverge), Host synthesizes.
 * Host provides all role prompts; pyreez provides infrastructure only.
 *
 * @module Deliberation Types
 */

import type { TaskNature } from "./task-nature";

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
 * Deliberation role assigned to workers for diversity of perspective.
 * advocate: champions the best solution with evidence.
 * critic: attacks weaknesses, focuses on failure modes.
 * wildcard: explores unconventional angles and cross-domain ideas.
 */
export type DeliberationRole = "advocate" | "critic" | "wildcard";

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
  readonly role?: DeliberationRole;
  /** Positional index in the diverge phase. Used for identity in debates (role can collide with 4+ workers). */
  readonly workerIndex: number;
}

/**
 * A single deliberation round.
 */
export interface Round {
  readonly number: number;
  readonly responses: readonly WorkerResponse[];
  /** Workers that failed during this round (partial failure tracking). */
  readonly failedWorkers?: readonly { model: string; error: string }[];
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
  readonly error: string;
  readonly httpStatus?: number;
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
  /** Per-request quality weight override. */
  readonly qualityWeight?: number;
  /** Per-request cost weight override. */
  readonly costWeight?: number;
  /** Deliberation protocol. Default: "diverge-synth". */
  readonly protocol?: "diverge-synth" | "debate";
  /** Explicit model IDs to use as workers. Bypasses auto team composition. */
  readonly models?: readonly string[];
  /** Task nature for prompt selection. Artifact = deliverable output, Critique = analysis. */
  readonly taskNature?: TaskNature;
}

/**
 * Output from the deliberation engine.
 */
export interface DeliberateOutput {
  readonly roundsExecuted: number;
  readonly totalTokens: TokenUsage;
  readonly totalLLMCalls: number;
  readonly modelsUsed: readonly string[];
  /** Per-round details for diagnostics. */
  readonly rounds?: readonly {
    number: number;
    responses?: readonly { model: string; content: string; role?: string }[];
    failedWorkers?: readonly { model: string; error: string }[];
  }[];
  /** PoLL judge scores per worker model. */
  readonly pollScores?: readonly { model: string; score: number }[];
  /** Warnings about deliberation quality (e.g., low provider diversity). */
  readonly warnings?: readonly string[];
  /** Model swaps that occurred during deliberation (worker failure → fallback). */
  readonly modelSwaps?: readonly ModelSwap[];
}
