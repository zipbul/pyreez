/**
 * Deliberation prompt builders — Diverge-Synth model.
 *
 * Exported functions:
 *   buildWorkerMessages — build ChatMessage[] for a worker LLM
 *   buildLeaderMessages — build ChatMessage[] for the leader LLM
 *
 * Pure functions: SharedContext in → ChatMessage[] out.
 * Host provides instructions; pyreez uses minimal defaults when absent.
 * @module Deliberation Prompts
 */

import type { ChatMessage } from "../llm/types";
import type { ConsensusMode, SharedContext } from "./types";

// -- Minimal Default Prompts --

export interface RoundInfo {
  readonly current: number;
  readonly max: number;
}

/**
 * Minimal default for workers. Used only when host does not provide workerInstructions.
 */
const WORKER_DEFAULT = "Respond to the following task.";

/**
 * Minimal default for leader. Used only when host does not provide leaderInstructions.
 */
const LEADER_DEFAULT =
  "You are given multiple responses to a task. Compare, evaluate, and produce the best final answer.";

// -- Exported Builders --

/**
 * Build messages for a worker LLM.
 *
 * Context optimization: workers only see the previous round's synthesis,
 * NOT full history. This keeps context O(1) per round.
 *
 * - system: host-provided instructions OR minimal default
 * - user: task + (previous synthesis if rounds > 0) + (round budget)
 */
export function buildWorkerMessages(
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
): ChatMessage[] {
  const userParts: string[] = [`## Task\n${ctx.task}`];

  // Only pass the previous round's synthesis (not full history)
  if (ctx.rounds.length > 0) {
    const lastRound = ctx.rounds[ctx.rounds.length - 1];
    if (lastRound?.synthesis) {
      userParts.push(`## Previous Round Result\n${lastRound.synthesis.content}`);
    }
  }

  if (roundInfo) {
    const budget = `## Round Budget\nRound ${roundInfo.current} of ${roundInfo.max}`;
    userParts.push(
      roundInfo.current === roundInfo.max
        ? `${budget}\n⚠️ This is the FINAL round.`
        : budget,
    );
  }

  return [
    { role: "system", content: instructions || WORKER_DEFAULT },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Build messages for a worker in debate mode (round 2+).
 *
 * Workers see ONLY the leader's compressed summary from the previous round,
 * NOT raw responses. This keeps context O(1) per round and ensures workers
 * respond to curated disagreements rather than raw noise.
 *
 * Flow: workers respond → leader identifies disagreements → workers rebut/concede → repeat
 */
export function buildDebateWorkerMessages(
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
): ChatMessage[] {
  const userParts: string[] = [`## Task\n${ctx.task}`];

  // Only pass the leader's synthesis from the previous round (compressed context)
  const lastRound = ctx.rounds[ctx.rounds.length - 1];
  if (lastRound?.synthesis) {
    userParts.push(
      `## Previous Round Summary (by moderator)\n${lastRound.synthesis.content}\n\n` +
      `Review the summary above. Address specific criticisms of your position, ` +
      `rebut arguments you disagree with, concede points where others are stronger, ` +
      `and refine your recommendation.`,
    );
  }

  if (roundInfo) {
    const budget = `## Round Budget\nRound ${roundInfo.current} of ${roundInfo.max}`;
    if (roundInfo.current === roundInfo.max) {
      userParts.push(`${budget}\n⚠️ This is the FINAL round. State your final position clearly.`);
    } else {
      userParts.push(budget);
    }
  }

  const systemContent = instructions
    ? `${instructions}\n\nYou are in a structured debate. A moderator has summarized the previous round's disagreements. Respond specifically to the criticisms and refine your position.`
    : "You are in a structured debate with other models. A moderator has summarized the previous round's disagreements. Respond to specific criticisms, rebut or concede, and state your refined position clearly.";

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Build messages for the leader LLM.
 *
 * Context optimization: leader sees current round's worker responses only,
 * NOT full history. This keeps context O(workers) per round.
 *
 * - system: host-provided instructions OR minimal default
 * - user: task + current round's worker responses + (round budget)
 */
export function buildLeaderMessages(
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
  consensus?: ConsensusMode,
  protocol?: "diverge-synth" | "debate",
): ChatMessage[] {
  const userParts: string[] = [`## Task\n${ctx.task}`];

  // Current round's worker responses
  const currentRound = ctx.rounds[ctx.rounds.length - 1];
  if (currentRound && currentRound.responses.length > 0) {
    const responses = currentRound.responses
      .map((r, i) => `### Response ${i + 1} (${r.model})\n${r.content}`)
      .join("\n\n");
    userParts.push(`## Worker Responses\n${responses}`);
  }

  if (roundInfo) {
    const budget = `## Round Budget\nRound ${roundInfo.current} of ${roundInfo.max}`;
    userParts.push(
      roundInfo.current === roundInfo.max
        ? `${budget}\n⚠️ This is the FINAL round.`
        : budget,
    );
  }

  const isFinalRound = !roundInfo || roundInfo.current >= roundInfo.max;
  const isDebateIntermediate = !isFinalRound && protocol === "debate" && consensus === "leader_decides";

  let systemContent: string;
  if (isDebateIntermediate) {
    // Intermediate round: identify disagreements and frame questions for next round
    systemContent = instructions
      ? `${instructions}\n\n`
      : "";
    systemContent +=
      "You are the moderator of a structured debate between multiple models. " +
      "Your job for this round:\n" +
      "1. Identify the specific points of AGREEMENT across all responses.\n" +
      "2. Identify the specific points of DISAGREEMENT and each side's argument.\n" +
      "3. For each disagreement, summarize both sides concisely and fairly.\n" +
      "4. Formulate clear questions that the next round should resolve.\n\n" +
      "Keep your summary compressed — workers will only see YOUR summary, not each other's raw responses.";
    // Consensus JSON for intermediate rounds: always "continue"
    systemContent += '\n\nRespond with a JSON object: {"result": "<your summary>", "decision": "continue"}';
  } else {
    systemContent = instructions || LEADER_DEFAULT;
    // Inject JSON output format only when consensus is active AND host hasn't already specified format
    if (consensus === "leader_decides" && !(instructions && /\bjson\b/i.test(instructions) && /\bdecision\b/i.test(instructions))) {
      systemContent += '\n\nIMPORTANT: You MUST respond with a JSON object containing "result" (your synthesis) and "decision" ("approve" if consensus reached, "continue" if more rounds needed). Example: {"result": "...", "decision": "approve"}';
    }
  }

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userParts.join("\n\n") },
  ];
}
