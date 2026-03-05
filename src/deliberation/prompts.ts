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

// -- Posture Prompts --

export interface RoundInfo {
  readonly current: number;
  readonly max: number;
}

/**
 * Universal posture principles for workers (Layer 1).
 * 8 principles from PLAN.md v2, each compressed to 1-2 actionable sentences.
 * Mapped 1:1: #1 evidence-confidence, #2 competing alternatives, #3 mode separation,
 * #4 independent judgment, #5 steel-man, #6 evidence-first, #7 pre-commit falsification,
 * #8 ego-belief separation.
 */
const WORKER_POSTURE =
  "- Classify every claim as {observed fact | inference | hypothesis}. State confidence (high/medium/low) for each. Never assert without basis.\n" +
  "- Generate at least 3 competing approaches before committing. Seek disconfirming evidence, not confirming evidence.\n" +
  "- Separate generation from judgment: when brainstorming, suspend criticism; when evaluating, be rigorous. Declare which mode you are in.\n" +
  "- Form your own position before considering others' conclusions. Update only when presented with new evidence or argument, not mere agreement.\n" +
  "- Before rebutting, restate the opposing argument in its strongest form. Attack the strongest version, not a straw man.\n" +
  "- Examine evidence and logic first, then draw conclusions. Do not start with a position and argue backward.\n" +
  "- State upfront what would change your mind. When you do change position, explain exactly why. Do not move the goalposts.\n" +
  "- Treat being wrong as progress, not failure. Attack reasoning, not the source. Welcome correction.";

/**
 * Standalone worker default: used when host provides no workerInstructions.
 */
const WORKER_DEFAULT =
  "You are a deliberation participant. Respond to the following task with your best analysis.\n\n" +
  `Follow these principles:\n${WORKER_POSTURE}`;

/**
 * Appended to host-provided workerInstructions so posture principles always apply.
 */
const POSTURE_SUFFIX =
  `\n\nFollow these deliberation principles:\n${WORKER_POSTURE}`;

/**
 * Leader verifier obligations (Layer 3).
 * Three duties from PLAN.md: independent verification, gap search, honest synthesis.
 */
const LEADER_VERIFIER_OBLIGATIONS =
  "1. Verify independently — judge each claim's evidence sufficiency. Majority agreement does not equal correctness. The higher workers' confidence, the more rigorously you must verify their basis.\n" +
  "2. Search for gaps — identify perspectives, alternatives, or edge cases that workers missed. Do not limit yourself to the scope workers explored.\n" +
  "3. Assess argument independence — when workers agree, check whether they reached the same conclusion via different reasoning paths (healthy) or the same reasoning chain (suspicious). Shared phrasing, identical examples, or lock-step logic suggest correlated training, not independent validation.\n" +
  "4. Synthesize honestly — distinguish certain conclusions from uncertain inferences and unresolved questions. Do not fabricate consensus. Unanimity is a warning signal, not reassurance.";

/**
 * Standalone leader default: used when host provides no leaderInstructions.
 */
/**
 * Required output structure for leader synthesis.
 * Forces verification behavior even on simple tasks.
 */
const LEADER_OUTPUT_STRUCTURE =
  "Structure your response as follows:\n" +
  "1. Verification: identify problems, disagreements, and gaps across worker responses.\n" +
  "   - Which worker claims you independently verified or challenged\n" +
  "   - Any gaps or alternatives workers missed\n" +
  "   - Whether workers reached agreement via independent reasoning or correlated logic\n" +
  "2. Synthesis: produce your final answer addressing the verification findings.";

const LEADER_DEFAULT =
  "You are the verifier-synthesizer in a multi-model deliberation. You receive multiple worker responses to a task.\n\n" +
  `Your obligations:\n${LEADER_VERIFIER_OBLIGATIONS}\n\n` +
  `${LEADER_OUTPUT_STRUCTURE}\n\n` +
  "Produce the best final answer grounded in evidence, not vote-counting.";

/**
 * Appended to host-provided leaderInstructions so verifier obligations always apply.
 */
const LEADER_VERIFIER_SUFFIX =
  `\n\nAs verifier-synthesizer, you must also:\n${LEADER_VERIFIER_OBLIGATIONS}\n\n${LEADER_OUTPUT_STRUCTURE}`;

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

  const systemContent = instructions
    ? instructions + POSTURE_SUFFIX
    : WORKER_DEFAULT;

  return [
    { role: "system", content: systemContent },
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
  workerModel?: string,
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

  // Include this worker's own previous response for identity continuity
  if (workerModel && lastRound) {
    const ownResponse = lastRound.responses.find((r) => r.model === workerModel);
    if (ownResponse) {
      userParts.push(`## Your Previous Response\n${ownResponse.content}`);
    }
  }

  if (roundInfo) {
    const budget = `## Round Budget\nRound ${roundInfo.current} of ${roundInfo.max}`;
    if (roundInfo.current === roundInfo.max) {
      userParts.push(`${budget}\n⚠️ This is the FINAL round. State your final position clearly.`);
    } else {
      userParts.push(budget);
    }
  }

  const debateContext = instructions
    ? `${instructions}\n\nYou are in a structured debate. A moderator has summarized the previous round's disagreements. Before rebutting, restate each criticism in its strongest form. If you change your position, explain exactly what new evidence or argument caused the change.`
    : "You are in a structured debate with other models. A moderator has summarized the previous round's disagreements. Before rebutting, restate each criticism in its strongest form. Concede where others are stronger. If you change position, explain exactly why. Do not move the goalposts.";

  return [
    { role: "system", content: debateContext + POSTURE_SUFFIX },
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
  const isDebateIntermediate = !isFinalRound && protocol === "debate";

  let systemContent: string;
  if (isDebateIntermediate) {
    // Intermediate round: identify disagreements and frame questions for next round
    systemContent = instructions
      ? `${instructions}\n\n`
      : "";
    systemContent +=
      "You are the moderator and verifier of a structured debate between multiple models. " +
      "Your job for this round:\n" +
      "1. Identify the specific points of AGREEMENT across all responses.\n" +
      "2. Identify the specific points of DISAGREEMENT and each side's argument.\n" +
      "3. For each disagreement, evaluate the evidence — do not side with the majority by default.\n" +
      "4. Identify gaps: perspectives or alternatives that NO worker raised.\n" +
      "5. Formulate clear questions that the next round should resolve.\n\n" +
      "Keep your summary compressed — workers will only see YOUR summary, not each other's raw responses.";
    // Consensus JSON for intermediate rounds: always "continue" (only when consensus mode is active)
    if (consensus === "leader_decides") {
      systemContent += '\n\nRespond with a JSON object: {"result": "<your summary>", "decision": "continue"}';
    }
  } else {
    systemContent = instructions
      ? instructions + LEADER_VERIFIER_SUFFIX
      : LEADER_DEFAULT;
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
