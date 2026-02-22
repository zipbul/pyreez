/**
 * Deliberation Engine — core execution loop.
 *
 * Exported functions:
 *   parseProduction, parseReview, parseSynthesis — LLM JSON response parsers
 *   executeRound — single round execution (producer → reviewers → leader)
 *   deliberate — multi-round loop with consensus check
 *
 * DI: all LLM calls and prompt building injected via EngineDeps.
 * @see PLAN.md Section 2 (Deliberation 프로세스)
 */

import type { ChatMessage } from "../llm/types";
import type {
  ConsensusMode,
  DeliberateInput,
  DeliberateOutput,
  Production,
  Review,
  Round,
  SharedContext,
  Synthesis,
  TeamComposition,
} from "./types";
import {
  createSharedContext,
  addRound,
  totalLLMCalls,
  modelsUsed,
} from "./shared-context";

// -- Public Interfaces --

/**
 * Dependency injection for the engine.
 * All LLM I/O and prompt construction is injected.
 */
export interface EngineDeps {
  readonly chat: (
    model: string,
    messages: ChatMessage[],
  ) => Promise<string>;
  readonly buildProducerMessages: (
    ctx: SharedContext,
    instructions?: string,
  ) => ChatMessage[];
  readonly buildReviewerMessages: (
    ctx: SharedContext,
    perspective: string,
  ) => ChatMessage[];
  readonly buildLeaderMessages: (
    ctx: SharedContext,
    instructions?: string,
  ) => ChatMessage[];
}

/**
 * Engine configuration.
 */
export interface EngineConfig {
  readonly maxRounds: number;
  readonly consensus: ConsensusMode;
}

const DEFAULT_CONFIG: EngineConfig = {
  maxRounds: 3,
  consensus: "leader_decides",
};

// -- Internal Helpers --

/**
 * Strip markdown JSON code-block wrappers (```json ... ```).
 */
function stripJsonWrapping(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```json") && trimmed.endsWith("```")) {
    return trimmed.slice(7, -3).trim();
  }
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    return trimmed.slice(3, -3).trim();
  }
  return text;
}

/**
 * Evaluate consensus based on the round's reviews and synthesis.
 */
function checkConsensus(round: Round, mode: ConsensusMode): boolean {
  if (!round.synthesis) return false;
  const { decision } = round.synthesis;

  switch (mode) {
    case "leader_decides":
      return decision === "approve";

    case "all_approve":
      return (
        decision === "approve" && round.reviews.every((r) => r.approval)
      );

    case "majority": {
      const approved = round.reviews.filter((r) => r.approval).length;
      return decision === "approve" && approved > round.reviews.length / 2;
    }
  }
}

// -- Parsers --

/**
 * Parse producer LLM response into Production.
 * Falls back to raw text as content on JSON parse failure.
 */
export function parseProduction(model: string, response: string): Production {
  const cleaned = stripJsonWrapping(response);
  try {
    const parsed = JSON.parse(cleaned);
    return {
      model,
      content: parsed.content ?? "",
      ...(parsed.revisionNotes != null
        ? { revisionNotes: parsed.revisionNotes }
        : {}),
    };
  } catch {
    return { model, content: response };
  }
}

/**
 * Parse reviewer LLM response into Review.
 * Falls back to { approval: false, reasoning: raw text } on failure.
 */
export function parseReview(
  model: string,
  perspective: string,
  response: string,
): Review {
  const cleaned = stripJsonWrapping(response);
  try {
    const parsed = JSON.parse(cleaned);
    return {
      model,
      perspective,
      issues: parsed.issues ?? [],
      approval: parsed.approval ?? false,
      reasoning: parsed.reasoning ?? "",
    };
  } catch {
    return {
      model,
      perspective,
      issues: [],
      approval: false,
      reasoning: response,
    };
  }
}

/**
 * Parse leader LLM response into Synthesis.
 * Falls back to { decision: "continue" } on failure or missing field.
 */
export function parseSynthesis(model: string, response: string): Synthesis {
  const cleaned = stripJsonWrapping(response);
  const VALID_DECISIONS = ["continue", "approve", "escalate"];
  try {
    const parsed = JSON.parse(cleaned);
    const decision = VALID_DECISIONS.includes(parsed.decision)
      ? parsed.decision
      : "continue";
    return {
      model,
      consensusStatus: parsed.consensusStatus ?? "progressing",
      keyAgreements: parsed.keyAgreements ?? [],
      keyDisagreements: parsed.keyDisagreements ?? [],
      actionItems: parsed.actionItems ?? [],
      decision,
    };
  } catch {
    return {
      model,
      consensusStatus: "progressing",
      keyAgreements: [],
      keyDisagreements: [],
      actionItems: [],
      decision: "continue",
    };
  }
}

// -- Round Execution --

/**
 * Execute a single deliberation round:
 *   1. Producer generates content
 *   2. Reviewers evaluate in parallel (Promise.allSettled)
 *   3. Leader synthesises consensus
 *
 * Producer/Leader errors propagate. Reviewer errors produce fallback reviews.
 */
export async function executeRound(
  ctx: SharedContext,
  roundNumber: number,
  deps: EngineDeps,
  config: EngineConfig,
  input: DeliberateInput,
): Promise<Round> {
  // 1. Producer
  const producerMessages = deps.buildProducerMessages(
    ctx,
    input.producerInstructions,
  );
  const producerResponse = await deps.chat(
    ctx.team.producer.model,
    producerMessages,
  );
  const production = parseProduction(ctx.team.producer.model, producerResponse);

  // 2. Reviewers — parallel, partial failure tolerated
  // Build a temporary ctx that includes the current production so reviewers can see it
  const ctxForReviewers: SharedContext = {
    ...ctx,
    rounds: [
      ...ctx.rounds,
      { number: roundNumber, production, reviews: [] },
    ],
  };
  const reviewerPromises = ctx.team.reviewers.map(async (reviewer) => {
    const perspective = reviewer.perspective ?? "general";
    const messages = deps.buildReviewerMessages(ctxForReviewers, perspective);
    const response = await deps.chat(reviewer.model, messages);
    return parseReview(reviewer.model, perspective, response);
  });

  const settled = await Promise.allSettled(reviewerPromises);
  const reviews: Review[] = settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    const reviewer = ctx.team.reviewers[i]!;
    const perspective = reviewer.perspective ?? "general";
    return {
      model: reviewer.model,
      perspective,
      issues: [],
      approval: false,
      reasoning: `Review error: ${result.reason?.message ?? "unknown error"}`,
    };
  });

  // 3. Leader — sees current round's production + reviews
  const partialRound: Round = { number: roundNumber, production, reviews };
  const ctxForLeader = addRound(ctx, partialRound);
  const leaderMessages = deps.buildLeaderMessages(
    ctxForLeader,
    input.leaderInstructions,
  );
  const leaderResponse = await deps.chat(
    ctx.team.leader.model,
    leaderMessages,
  );
  const synthesis = parseSynthesis(ctx.team.leader.model, leaderResponse);

  return { number: roundNumber, production, reviews, synthesis };
}

// -- Main Entry Point --

/**
 * Run the full multi-round deliberation loop.
 *
 * @param team - Pre-composed team.
 * @param input - Task, perspectives, optional instructions.
 * @param deps - Injected LLM chat + prompt builders.
 * @param config - Optional engine config (defaults: maxRounds=3, leader_decides).
 */
export async function deliberate(
  team: TeamComposition,
  input: DeliberateInput,
  deps: EngineDeps,
  config?: EngineConfig,
): Promise<DeliberateOutput> {
  const cfg = config ?? DEFAULT_CONFIG;
  let ctx = createSharedContext(input.task, team);
  let consensusReached = false;

  for (let i = 1; i <= cfg.maxRounds; i++) {
    const round = await executeRound(ctx, i, deps, cfg, input);
    ctx = addRound(ctx, round);

    // Escalate — immediate stop, no consensus
    if (round.synthesis?.decision === "escalate") {
      break;
    }

    // Consensus check
    if (checkConsensus(round, cfg.consensus)) {
      consensusReached = true;
      break;
    }
  }

  // -- Assemble output --
  const lastRound =
    ctx.rounds.length > 0
      ? ctx.rounds[ctx.rounds.length - 1]
      : undefined;

  const result = lastRound?.production?.content ?? "";

  const finalApprovals = lastRound
    ? lastRound.reviews.map((r) => ({
        model: r.model,
        approved: r.approval,
        remainingIssues: r.issues.map((issue) => issue.description),
      }))
    : [];

  return {
    result,
    roundsExecuted: ctx.rounds.length,
    consensusReached,
    finalApprovals,
    deliberationLog: ctx,
    totalTokens: 0,
    totalLLMCalls: totalLLMCalls(ctx),
    modelsUsed: modelsUsed(ctx),
  };
}
