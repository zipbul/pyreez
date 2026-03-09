/**
 * Deliberation prompt builders — Diverge-Synth model.
 *
 * Exported functions:
 *   buildWorkerMessages — build ChatMessage[] for a worker LLM
 *   buildLeaderMessages — build ChatMessage[] for the leader LLM
 *   buildDebateWorkerMessages — build ChatMessage[] for debate-mode workers
 *
 * Pure functions: SharedContext in → ChatMessage[] out.
 * Host provides instructions; pyreez uses minimal defaults when absent.
 *
 * Prompt design principles (based on 2025-2026 research):
 *   - XML tags for structural isolation of instruction domains
 *   - Positive framing with rationale over bare negations
 *   - Verification checkpoint before final output
 *   - Concrete constraints over vague directives
 *
 * @module Deliberation Prompts
 */

import type { ChatMessage } from "../llm/types";
import type { ConsensusMode, SharedContext } from "./types";

// -- Types --

export interface RoundInfo {
  readonly current: number;
  readonly max: number;
}

// -- Worker Prompts --

/**
 * Worker self-doubt block.
 * Workers doubt their own conclusions at the point of commitment.
 * Post-response reconsideration by others is less effective than
 * self-doubt at the moment of completion.
 */
const WORKER_SELF_DOUBT = `
<self-doubt>
After completing your analysis, add a final section:

## Self-Doubt
1. Name your single least-confident claim and the evidence gap that makes it fragile.
2. What specific evidence would prove your main conclusion wrong?
3. If your main conclusion is wrong, what is the most likely alternative and why?
</self-doubt>`;

/**
 * Default worker system prompt: fact-based analyst with evidence grounding.
 */
const WORKER_DEFAULT = `<role>You are a fact-based analyst. Respond with honest, grounded analysis.</role>

<rules>
- Ground every claim in specific evidence: data, source, or reasoning chain. State what you know vs. what you infer.
- For each key claim, state your confidence (high/medium/low) and the specific evidence gap that limits it.
</rules>
${WORKER_SELF_DOUBT}`;

/**
 * Appended to host-provided workerInstructions so self-doubt always applies.
 */
const POSTURE_SUFFIX = `\n${WORKER_SELF_DOUBT}`;

// -- Artifact Worker Prompt --

/**
 * Worker prompt for artifact tasks (code, config, schema, plan).
 * Produces working output directly, with a structured summary for the leader.
 */
const WORKER_ARTIFACT = `<role>You are an expert implementer. Produce working, production-quality output.</role>

<rules>
- Deliver the requested artifact directly — code, config, schema, test, plan. Start with the output, not analysis.
- Cover edge cases, error handling, and boundary conditions in the artifact itself.
- When multiple approaches exist, pick the best one and implement it. State your choice in one line.
- If the task specifies a language, framework, or format — follow it exactly.
</rules>

<worker-summary>
At the TOP of your response, include exactly this block:
<summary>
APPROACH: [1 line — your chosen approach]
TRADEOFF: [1 line — key tradeoff of this approach]
ASSUMPTION: [1 line — the assumption most likely to be wrong]
</summary>
Then produce the artifact.
</worker-summary>`;

// -- Leader Prompts --

/**
 * Leader core rules — role + behavioral rules for creative synthesis.
 */
const LEADER_OBLIGATIONS = `<role>You are a creative synthesizer. Find and maximize value from every worker response.</role>

<core-rules>
1. Integrate all responses — draw from every worker. Adopt strengths and actively incorporate unique contributions.
2. Question weaknesses — for each, ask: "Is this truly a flaw, or an unexplored angle?"
3. Challenge the premise before synthesizing.
4. Extract ideas from weaknesses. Maximum 2 genuinely novel ideas (not in any worker response, not repackaged strengths). If none, say "None."
5. Review worker self-doubt sections — evaluate which are valid. Use validated self-doubts as design constraints in your synthesis.
6. If a worker response is off-topic or degenerate, note this in the per-worker section and exclude from your synthesis.
</core-rules>`;

/**
 * Required output structure for leader synthesis.
 */
const LEADER_OUTPUT_FORMAT = `<output-format>
Before writing, verify:
- Every worker's strengths are adopted (not acknowledged — adopted)
- Ideas from Weaknesses cannot be found in any worker response, even partially
- Worker confidence levels are reflected — high-confidence claims weighted more heavily
- Your synthesis integrates, not selects a winner

Structure your response as follows. The final synthesis should be the most substantial section.

## Per-Worker Analysis
For each worker:
- **Adopted Strengths**: Unique value this worker contributed
- **Weakness Reexamination**: True flaw or unexplored angle? If the latter, what idea does it suggest?
- **Self-Doubt Review**: Which self-doubts are valid? Which are over-caution?

## Premise Check
Is the question well-framed? If not, reframe. Show how your reframe changes the synthesis.

## Ideas from Weaknesses (max 2)
Say "None." if none emerge genuinely.

## Synthesis
Integrated answer that draws from every worker.
</output-format>`;

const LEADER_DEFAULT =
  `${LEADER_OBLIGATIONS}\n\n${LEADER_OUTPUT_FORMAT}`;

/**
 * Appended to host-provided leaderInstructions.
 */
const LEADER_SUFFIX =
  `\n\n${LEADER_OBLIGATIONS}\n\n${LEADER_OUTPUT_FORMAT}`;

// -- Artifact Leader Prompt --

/**
 * Leader prompt for artifact tasks. Output = the deliverable itself (>95%).
 * Uses <deliberation> scratchpad that the engine strips before returning.
 */
const LEADER_ARTIFACT = `<role>You are the synthesis lead. Your ENTIRE output must be the final deliverable.</role>

<core-rules>
1. DO NOT write per-worker analysis, comparisons, or prose evaluation.
2. Silently incorporate the best elements from all workers.
3. Fix errors from any worker response. Do not propagate them.
4. Cover edge cases that individual workers missed.
</core-rules>

<output-format>
<deliberation>
[Max 5 lines: resolve conflicting approaches, note merge decisions]
</deliberation>

[THE ACTUAL DELIVERABLE — code, plan, schema. This must be >95% of your output.]

[Optional: Max 2 lines noting assumption conflicts the user must verify.]
</output-format>`;

/**
 * Appended to host-provided leaderInstructions for artifact tasks.
 */
const LEADER_ARTIFACT_SUFFIX = `\n\n${LEADER_ARTIFACT}`;

// -- Debate Moderator Prompt --

const DEBATE_MODERATOR = `<role>You are the moderator and verifier of a structured debate between multiple models.</role>

<rules>
1. Identify the specific points of AGREEMENT across all responses.
2. Identify the specific points of DISAGREEMENT and each side's argument.
3. For each disagreement, evaluate the evidence — do not side with the majority by default.
4. Identify gaps: perspectives or alternatives that NO worker raised.
5. Formulate clear questions that the next round should resolve.
</rules>

<constraint>Keep your summary compressed — workers will only see YOUR summary, not each other's raw responses.</constraint>`;

// -- Summary Manifest Helpers --

/**
 * Extract <summary>...</summary> content from a worker response.
 * Falls back to first 3 lines if no summary tags found.
 */
export function extractSummary(content: string): string {
  const match = content.match(/<summary>([\s\S]*?)<\/summary>/);
  if (match?.[1]) {
    return match[1].trim();
  }
  return content.split("\n").slice(0, 3).join("\n").trim();
}

// -- Exported Builders --

/**
 * Build messages for a worker LLM.
 *
 * Context optimization: workers only see the previous round's synthesis,
 * NOT full history. This keeps context O(1) per round.
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

  const nature = ctx.taskNature ?? "critique";
  let systemContent: string;
  if (instructions) {
    const suffix = nature === "artifact" ? "" : POSTURE_SUFFIX;
    systemContent = `<host-instructions>${instructions}</host-instructions>` + suffix;
  } else {
    systemContent = nature === "artifact" ? WORKER_ARTIFACT : WORKER_DEFAULT;
  }

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

  const debateInstructions = instructions
    ? `<host-instructions>${instructions}</host-instructions>\n\n`
    : "";

  const debateContext =
    `${debateInstructions}` +
    `<role>You are a debater in a structured multi-model deliberation.</role>\n\n` +
    `<context>A moderator has summarized the previous round's disagreements. You are responding to that summary.</context>\n\n` +
    `<rules>\n` +
    `- Before rebutting, restate each criticism in its strongest form.\n` +
    `- Concede where others are stronger.\n` +
    `- If you change position, explain exactly what new evidence or argument caused the change.\n` +
    `</rules>`;

  const nature = ctx.taskNature ?? "critique";
  const debateSuffix = nature === "artifact" ? "" : POSTURE_SUFFIX;

  return [
    { role: "system", content: debateContext + debateSuffix },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Build messages for the leader LLM.
 *
 * Context optimization: leader sees current round's worker responses only,
 * NOT full history. This keeps context O(workers) per round.
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

  const nature = ctx.taskNature ?? "critique";
  const isFinalRound = !roundInfo || roundInfo.current >= roundInfo.max;
  const isDebateIntermediate = !isFinalRound && protocol === "debate";

  let systemContent: string;
  if (isDebateIntermediate) {
    systemContent = instructions
      ? `<host-instructions>${instructions}</host-instructions>\n\n${DEBATE_MODERATOR}`
      : DEBATE_MODERATOR;
    if (consensus === "leader_decides") {
      systemContent += '\n\n<consensus>\nRespond with a JSON object: {"result": "<your summary>", "decision": "continue"}\n</consensus>';
    }
  } else if (nature === "artifact") {
    systemContent = instructions
      ? `<host-instructions>${instructions}</host-instructions>` + LEADER_ARTIFACT_SUFFIX
      : LEADER_ARTIFACT;
    if (consensus === "leader_decides" && !(instructions && /\bjson\b/i.test(instructions) && /\bdecision\b/i.test(instructions))) {
      systemContent += '\n\n<consensus>\nWrap your entire deliverable inside the "result" field.\nRespond with a JSON object: {"result": "<your full deliverable>", "decision": "approve" if consensus reached, "continue" if more rounds needed}.\n</consensus>';
    }
  } else {
    systemContent = instructions
      ? `<host-instructions>${instructions}</host-instructions>` + LEADER_SUFFIX
      : LEADER_DEFAULT;
    if (consensus === "leader_decides" && !(instructions && /\bjson\b/i.test(instructions) && /\bdecision\b/i.test(instructions))) {
      systemContent += '\n\n<consensus>\nYour structured analysis (Per-Worker Analysis through Synthesis) goes inside the "result" field.\nRespond with a JSON object: {"result": "<your full structured analysis>", "decision": "approve" if consensus reached, "continue" if more rounds needed}.\n</consensus>';
    }
  }

  // Summary Manifest: for artifact tasks, append worker summaries at end of user message
  if (nature === "artifact" && currentRound && currentRound.responses.length > 0) {
    const manifest = currentRound.responses
      .map((r, i) => `Worker ${i + 1} (${r.model}): ${extractSummary(r.content)}`)
      .join("\n");
    userParts.push(`[WORKER SUMMARY MANIFEST]\n${manifest}`);
  }

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userParts.join("\n\n") },
  ];
}
