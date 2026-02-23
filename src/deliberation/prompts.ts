/**
 * Deliberation prompt builders.
 *
 * Exported functions:
 *   buildProducerMessages — build ChatMessage[] for the producer LLM
 *   buildReviewerMessages — build ChatMessage[] for a reviewer LLM
 *   buildLeaderMessages — build ChatMessage[] for the leader LLM
 *
 * Pure functions: SharedContext in → ChatMessage[] out.
 * @module Deliberation Prompts
 */

import type { ChatMessage } from "../llm/types";
import type { Round, SharedContext } from "./types";

// -- System Prompts --

const PRODUCER_SYSTEM = `You are a Producer in a multi-model deliberation team.
Your role is to generate high-quality content that addresses the given task.
If previous rounds exist, incorporate feedback from reviewers and the leader's action items.

Respond in JSON format:
{
  "content": "<your produced content>",
  "revisionNotes": "<optional: what you changed and why>"
}`;

function reviewerSystem(perspective: string): string {
  return `You are a Reviewer in a multi-model deliberation team.
Your review perspective is: ${perspective}
Evaluate the producer's output strictly from your assigned perspective.
Identify issues, provide reasoning, and decide whether to approve.

Respond in JSON format:
{
  "issues": [{"severity": "critical|major|minor|suggestion", "description": "<issue>", "location": "<optional>", "suggestion": "<optional>"}],
  "approval": true|false,
  "reasoning": "<your reasoning>"
}`;
}

const LEADER_SYSTEM = `You are the Leader in a multi-model deliberation team.
Your role is to synthesize all reviewer feedback, identify consensus, and decide the next step.
Evaluate whether the team has reached agreement or needs another round.

Respond in JSON format:
{
  "consensusStatus": "reached|progressing|stalled",
  "keyAgreements": ["<agreed point>"],
  "keyDisagreements": ["<disagreed point>"],
  "actionItems": ["<action for next round>"],
  "decision": "continue|approve|escalate"
}`;

// -- History Serialization --

function serializeRound(round: Round): string {
  const parts: string[] = [`### Round ${round.number}`];

  if (round.production) {
    parts.push(`**Production** (${round.production.model}):`);
    parts.push(round.production.content);
    if (round.production.revisionNotes) {
      parts.push(`_Revision notes: ${round.production.revisionNotes}_`);
    }
  }

  if (round.reviews.length > 0) {
    parts.push("**Reviews:**");
    for (const review of round.reviews) {
      parts.push(`- [${review.perspective}] (${review.model}): ${review.approval ? "✅ Approved" : "❌ Not approved"}`);
      parts.push(`  Reasoning: ${review.reasoning}`);
      if (review.issues.length > 0) {
        for (const issue of review.issues) {
          parts.push(`  - [${issue.severity}] ${issue.description}`);
        }
      }
    }
  }

  if (round.synthesis) {
    parts.push(`**Synthesis** (${round.synthesis.model}):`);
    parts.push(`Decision: ${round.synthesis.decision}`);
    parts.push(`Status: ${round.synthesis.consensusStatus}`);
    if (round.synthesis.keyAgreements.length > 0) {
      parts.push(`Agreements: ${round.synthesis.keyAgreements.join(", ")}`);
    }
    if (round.synthesis.keyDisagreements.length > 0) {
      parts.push(`Disagreements: ${round.synthesis.keyDisagreements.join(", ")}`);
    }
    if (round.synthesis.actionItems.length > 0) {
      parts.push(`Action items: ${round.synthesis.actionItems.join(", ")}`);
    }
  }

  return parts.join("\n");
}

function serializeHistory(rounds: readonly Round[]): string {
  return rounds.map(serializeRound).join("\n\n");
}

// -- Exported Builders --

/**
 * Build messages for the producer LLM.
 *
 * - system: role description + JSON output format
 * - user: task + (history if rounds > 0) + (instructions if provided)
 */
export function buildProducerMessages(
  ctx: SharedContext,
  instructions?: string,
): ChatMessage[] {
  const userParts: string[] = [`## Task\n${ctx.task}`];

  if (ctx.rounds.length > 0) {
    userParts.push(`## Previous Rounds\n${serializeHistory(ctx.rounds)}`);
  }

  if (instructions) {
    userParts.push(`## Instructions\n${instructions}`);
  }

  return [
    { role: "system", content: PRODUCER_SYSTEM },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Build messages for a reviewer LLM.
 *
 * - system: role description + perspective + JSON output format
 * - user: task + full history (all rounds including current production) + perspective
 *
 * NOTE: ctx should include the current round's production (partial round with reviews=[])
 * so the reviewer can see what to review.
 */
export function buildReviewerMessages(
  ctx: SharedContext,
  perspective: string,
): ChatMessage[] {
  const userParts: string[] = [`## Task\n${ctx.task}`];

  if (ctx.rounds.length > 0) {
    userParts.push(`## Deliberation History\n${serializeHistory(ctx.rounds)}`);
  }

  userParts.push(`## Your Perspective\nReview from the perspective of: **${perspective}**`);

  return [
    { role: "system", content: reviewerSystem(perspective) },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Build messages for the leader LLM.
 *
 * - system: role description + JSON output format
 * - user: task + full history (all rounds) + (instructions if provided)
 *
 * NOTE: ctx should include the current round (with production + reviews)
 * so the leader can synthesize the current state.
 */
export function buildLeaderMessages(
  ctx: SharedContext,
  instructions?: string,
): ChatMessage[] {
  const userParts: string[] = [`## Task\n${ctx.task}`];

  if (ctx.rounds.length > 0) {
    userParts.push(`## Deliberation History\n${serializeHistory(ctx.rounds)}`);
  }

  if (instructions) {
    userParts.push(`## Instructions\n${instructions}`);
  }

  return [
    { role: "system", content: LEADER_SYSTEM },
    { role: "user", content: userParts.join("\n\n") },
  ];
}
