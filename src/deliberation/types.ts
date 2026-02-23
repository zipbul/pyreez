/**
 * Deliberation types — SharedContext, Team composition, Round structure.
 *
 * These types define the core data model for pyreez's consensus-based
 * heterogeneous model deliberation system.
 *
 * @module Deliberation Types
 */

// -- Team Composition --

/**
 * Roles within a deliberation team.
 */
export type TeamRole = "producer" | "reviewer" | "leader";

/**
 * A single team member assignment.
 */
export interface TeamMember {
  /** Model ID (e.g., "openai/gpt-4.1"). */
  readonly model: string;
  /** Assigned role. */
  readonly role: TeamRole;
  /** Assigned review perspective (reviewers only). */
  readonly perspective?: string;
}

/**
 * Full team composition for a deliberation session.
 * Diversity guarantee: at least 3 different providers/architectures.
 */
export interface TeamComposition {
  readonly producer: TeamMember;
  readonly reviewers: readonly TeamMember[];
  readonly leader: TeamMember;
}

// -- Round Structure --

/**
 * Issue severity levels.
 */
export type IssueSeverity = "critical" | "major" | "minor" | "suggestion";

/**
 * A single issue found during review.
 */
export interface Issue {
  readonly severity: IssueSeverity;
  readonly description: string;
  readonly location?: string;
  readonly suggestion?: string;
}

/**
 * Producer's output for a round.
 */
export interface Production {
  readonly model: string;
  readonly content: string;
  readonly revisionNotes?: string;
}

/**
 * Reviewer's feedback for a round.
 */
export interface Review {
  readonly model: string;
  readonly perspective: string;
  readonly issues: readonly Issue[];
  readonly approval: boolean;
  readonly reasoning: string;
}

/**
 * Leader's consensus decision.
 */
export type ConsensusDecision = "continue" | "approve" | "escalate";

/**
 * Current consensus status.
 */
export type ConsensusStatus = "reached" | "progressing" | "stalled";

/**
 * Leader's synthesis for a round.
 */
export interface Synthesis {
  readonly model: string;
  readonly consensusStatus: ConsensusStatus;
  readonly keyAgreements: readonly string[];
  readonly keyDisagreements: readonly string[];
  readonly actionItems: readonly string[];
  readonly decision: ConsensusDecision;
}

/**
 * A single deliberation round.
 */
export interface Round {
  readonly number: number;
  readonly production?: Production;
  readonly reviews: readonly Review[];
  readonly synthesis?: Synthesis;
}

// -- SharedContext --

/**
 * SharedContext: the central state of a deliberation session.
 * All participants share the full history (Blackboard System pattern, MAS).
 *
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
 */
export type ConsensusMode = "all_approve" | "majority" | "leader_decides";

// -- Deliberate Tool I/O --

/**
 * Input for pyreez_deliberate MCP tool.
 */
export interface DeliberateInput {
  readonly task: string;
  readonly perspectives: readonly string[];
  readonly producerInstructions?: string;
  readonly leaderInstructions?: string;
  readonly team?: {
    readonly producer?: string;
    readonly reviewers?: string[];
    readonly leader?: string;
  };
  readonly maxRounds?: number;
  readonly consensus?: ConsensusMode;
  readonly initialCandidates?: number;
  readonly includeHistory?: boolean;
}

/**
 * Output from pyreez_deliberate MCP tool.
 */
export interface DeliberateOutput {
  readonly result: string;
  readonly roundsExecuted: number;
  readonly consensusReached: boolean;
  readonly finalApprovals: readonly {
    readonly model: string;
    readonly approved: boolean;
    readonly remainingIssues: readonly string[];
  }[];
  readonly deliberationLog: SharedContext;
  readonly totalTokens: number;
  readonly totalLLMCalls: number;
  readonly modelsUsed: readonly string[];
}
