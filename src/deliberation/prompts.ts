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

  let systemContent = instructions || LEADER_DEFAULT;
  // Inject JSON output format only when consensus is active AND host hasn't already specified format
  if (consensus === "leader_decides" && !(instructions && /\bjson\b/i.test(instructions) && /\bdecision\b/i.test(instructions))) {
    systemContent += '\n\nIMPORTANT: You MUST respond with a JSON object containing "result" (your synthesis) and "decision" ("approve" if consensus reached, "continue" if more rounds needed). Example: {"result": "...", "decision": "approve"}';
  }

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userParts.join("\n\n") },
  ];
}
