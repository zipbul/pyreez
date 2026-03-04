/**
 * Deliberation types — Diverge-Synth model.
 *
 * Workers respond independently (diverge), Leader synthesizes (synth).
 * Host provides all role prompts; pyreez provides infrastructure only.
 *
 * @module Deliberation Types
 */

// -- Team Composition --

/**
 * Roles within a deliberation team.
 * Worker = independent responder, Leader = synthesizer.
 */
export type TeamRole = "worker" | "leader";

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
  readonly leader: TeamMember;
}

// -- Round Structure --

/**
 * A single worker's response for a round.
 */
export interface WorkerResponse {
  readonly model: string;
  readonly content: string;
}

/**
 * Leader's synthesis for a round.
 */
export interface Synthesis {
  readonly model: string;
  readonly content: string;
  /** Only present when consensus mode is enabled. */
  readonly decision?: "continue" | "approve";
}

/**
 * A single deliberation round.
 */
export interface Round {
  readonly number: number;
  readonly responses: readonly WorkerResponse[];
  readonly synthesis?: Synthesis;
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
}

// -- Consensus Mode --

/**
 * How consensus is determined.
 * "leader_decides": leader outputs JSON with decision field.
 * Omit for fixed-round execution (always runs maxRounds).
 */
export type ConsensusMode = "leader_decides";

// -- Token Usage --

/**
 * Accumulated token usage across a deliberation session.
 */
export interface TokenUsage {
  readonly input: number;
  readonly output: number;
}

// -- Deliberate Tool I/O --

/**
 * Input for the deliberation engine.
 * Host provides task + optional instructions for workers/leader.
 */
export interface DeliberateInput {
  readonly task: string;
  readonly workerInstructions?: string;
  readonly leaderInstructions?: string;
  readonly maxRounds?: number;
  readonly consensus?: ConsensusMode;
  /** Per-request quality weight override. */
  readonly qualityWeight?: number;
  /** Per-request cost weight override. */
  readonly costWeight?: number;
  /** Deliberation protocol. Default: "diverge-synth". */
  readonly protocol?: "diverge-synth" | "debate";
  /** Explicit model IDs to use. First N-1 are workers, last is leader. Bypasses auto team composition. */
  readonly models?: readonly string[];
  /**
   * When true, the leader also responds independently in the diverge phase
   * before synthesizing. Default: true.
   */
  readonly leaderContributes?: boolean;
}

/**
 * Output from the deliberation engine.
 */
export interface DeliberateOutput {
  readonly result: string;
  readonly roundsExecuted: number;
  readonly consensusReached: boolean;
  readonly totalTokens: TokenUsage;
  readonly totalLLMCalls: number;
  readonly modelsUsed: readonly string[];
  /** Per-round details for diagnostics. */
  readonly rounds?: readonly {
    number: number;
    responses?: readonly { model: string; content: string }[];
    synthesis?: string;
    failedWorkers?: readonly { model: string; error: string }[];
  }[];
}
