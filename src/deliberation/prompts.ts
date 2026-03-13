/**
 * Deliberation prompt builders — Diverge-Synth model.
 *
 * Exported functions:
 *   buildWorkerMessages — build ChatMessage[] for a worker LLM (per-worker, role-aware)
 *   buildLeaderMessages — build ChatMessage[] for the leader LLM
 *   buildDebateWorkerMessages — build ChatMessage[] for debate-mode workers (full-sharing)
 *   assignWorkerRole — deterministic role assignment by worker index
 *
 * Pure functions: SharedContext in → ChatMessage[] out.
 * Host provides instructions; pyreez uses minimal defaults when absent.
 *
 * @module Deliberation Prompts
 */

import type { ChatMessage } from "../llm/types";
import type { ConsensusMode, DeliberationRole, SharedContext } from "./types";

// -- Types --

export interface RoundInfo {
  readonly current: number;
  readonly max: number;
}

export interface WorkerRoleConfig {
  readonly role: DeliberationRole;
  readonly critiquePrompt: string;
  readonly artifactPrompt: string;
}

// -- Worker Role Configs --

const WORKER_ROLES: readonly WorkerRoleConfig[] = [
  {
    role: "advocate",
    critiquePrompt: `<role>You are an advocate analyst. Champion the strongest solution with concrete evidence.</role>

<rules>
- Present the best available answer and defend it with specific data, sources, or reasoning chains.
- Ground every claim in evidence. State what you know vs. what you infer.
- Anticipate objections and address them preemptively.
</rules>

<output-structure>
Structure your response. Min 200 characters, max 600 words.
<response>
  <position>[Core claim, 1-2 sentences]</position>
  <evidence>[Key evidence, max 3 points]</evidence>
  <concerns>[Risks or counterarguments]</concerns>
  <certainty>
    <verifiable_claims>[Claims that can be fact-checked]</verifiable_claims>
    <assumptions>[Unstated assumptions your analysis depends on]</assumptions>
    <uncertainty>[What you're least sure about and why]</uncertainty>
  </certainty>
</response>
</output-structure>`,
    artifactPrompt: `<role>You are an advocate implementer. Pick the strongest approach and deliver a complete implementation.</role>

<rules>
- Choose the best approach and implement it fully. State your choice in one line.
- Cover edge cases, error handling, and boundary conditions in the artifact itself.
- If the task specifies a language, framework, or format — follow it exactly.
- Your response MUST be at least 200 characters.
</rules>

<output-structure>
Keep prose minimal. Artifact has no word limit.
<response>
  <summary>APPROACH: [1 line] / TRADEOFF: [1 line] / ASSUMPTION: [1 line]</summary>
  <artifact>[The deliverable]</artifact>
  <confidence>[Justify your approach: why this solution, what tradeoffs were made]</confidence>
</response>
</output-structure>`,
  },
  {
    role: "critic",
    critiquePrompt: `<role>You are a critic analyst. Find weaknesses, failure modes, and unstated assumptions.</role>

<rules>
- Attack the problem from failure modes first: what could go wrong?
- Identify unstated assumptions and boundary conditions that could invalidate common approaches.
- For each weakness, state the specific scenario where it causes failure.
</rules>

<output-structure>
Structure your response. Min 200 characters, max 600 words.
<response>
  <position>[Core claim, 1-2 sentences]</position>
  <evidence>[Key evidence, max 3 points]</evidence>
  <concerns>[Risks or counterarguments]</concerns>
  <certainty>
    <verifiable_claims>[Claims that can be fact-checked]</verifiable_claims>
    <assumptions>[Unstated assumptions your analysis depends on]</assumptions>
    <uncertainty>[What you're least sure about and why]</uncertainty>
  </certainty>
</response>
</output-structure>`,
    artifactPrompt: `<role>You are a critic implementer. Focus on edge cases, error handling, and robustness.</role>

<rules>
- Prioritize correctness over elegance. Cover every edge case explicitly.
- Add defensive error handling and input validation.
- If the task specifies a language, framework, or format — follow it exactly.
- Your response MUST be at least 200 characters.
</rules>

<output-structure>
Keep prose minimal. Artifact has no word limit.
<response>
  <summary>APPROACH: [1 line] / TRADEOFF: [1 line] / ASSUMPTION: [1 line]</summary>
  <artifact>[The deliverable]</artifact>
  <confidence>[Justify your approach: why this solution, what tradeoffs were made]</confidence>
</response>
</output-structure>`,
  },
  {
    role: "wildcard",
    critiquePrompt: `<role>You are a wildcard analyst. Explore unconventional angles and cross-domain insights.</role>

<rules>
- Look beyond the obvious. Draw from adjacent domains, unusual patterns, or contrarian viewpoints.
- Question the framing of the problem itself — is there a better question to ask?
- Propose at least one approach that others are unlikely to consider.
</rules>

<output-structure>
Structure your response. Min 200 characters, max 600 words.
<response>
  <position>[Core claim, 1-2 sentences]</position>
  <evidence>[Key evidence, max 3 points]</evidence>
  <concerns>[Risks or counterarguments]</concerns>
  <certainty>
    <verifiable_claims>[Claims that can be fact-checked]</verifiable_claims>
    <assumptions>[Unstated assumptions your analysis depends on]</assumptions>
    <uncertainty>[What you're least sure about and why]</uncertainty>
  </certainty>
</response>
</output-structure>`,
    artifactPrompt: `<role>You are a wildcard implementer. Explore alternative approaches and unconventional patterns.</role>

<rules>
- Consider approaches others would skip. If a non-obvious pattern fits better, use it.
- Still deliver working, production-quality code — creativity does not mean impractical.
- If the task specifies a language, framework, or format — follow it exactly.
- Your response MUST be at least 200 characters.
</rules>

<output-structure>
Keep prose minimal. Artifact has no word limit.
<response>
  <summary>APPROACH: [1 line] / TRADEOFF: [1 line] / ASSUMPTION: [1 line]</summary>
  <artifact>[The deliverable]</artifact>
  <confidence>[Justify your approach: why this solution, what tradeoffs were made]</confidence>
</response>
</output-structure>`,
  },
];

/**
 * Assign a deliberation role by worker index (round-robin).
 */
export function assignWorkerRole(workerIndex: number): DeliberationRole {
  return WORKER_ROLES[workerIndex % WORKER_ROLES.length]!.role;
}

// -- Leader Prompts --

/**
 * Leader core rules — verification-first synthesis.
 */
const LEADER_OBLIGATIONS = `<role>You are a verification-first synthesizer. Verify claims, then integrate and improve.</role>

<core-rules>
1. Verify first — for each key worker claim, independently check: grounded in evidence or speculative? Flag unsubstantiated claims.
2. Cross-check: when workers agree, verify the shared claim isn't a common misconception. When they disagree, determine which position has stronger evidence.
3. Integrate all responses — adopt strengths and actively improve upon them (don't just repeat).
4. Question weaknesses — true flaw or unexplored angle?
5. Challenge the premise before synthesizing.
6. Maximum 2 genuinely novel ideas. If none, say "None."
7. Exclude off-topic or degenerate responses.
</core-rules>`;

/**
 * Leader output format for critique tasks (XML structure).
 */
const LEADER_CRITIQUE_OUTPUT = `<output-format>
<synthesis>
  <verification>
    For each key claim from workers:
    1. State the claim.
    2. Is it verifiable? If yes, verify it independently.
    3. Verdict: CONFIRMED / REFUTED / UNVERIFIABLE.
    Flag any claim where workers agree but evidence is weak (consensus ≠ correctness).
  </verification>
  <adopted>[Best ideas, improved upon — state HOW you improved each.]</adopted>
  <novel>[Max 2 new ideas not in any worker response. "None." if none.]</novel>
  <result>[Final integrated answer.]</result>
</synthesis>
</output-format>`;

const LEADER_DEFAULT =
  `${LEADER_OBLIGATIONS}\n\n${LEADER_CRITIQUE_OUTPUT}`;

const LEADER_SUFFIX =
  `\n\n${LEADER_OBLIGATIONS}\n\n${LEADER_CRITIQUE_OUTPUT}`;

// -- Artifact Leader Prompt --

const LEADER_ARTIFACT = `<role>You are the synthesis lead. Your ENTIRE output must be the final deliverable.</role>

<core-rules>
1. DO NOT write per-worker analysis, comparisons, or prose evaluation.
2. Silently incorporate the best elements from all workers. Prioritize workers whose approach justification is strongest.
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

const LEADER_ARTIFACT_SUFFIX = `\n\n${LEADER_ARTIFACT}`;

// -- Debate Intermediate Leader Prompt --

const DEBATE_INTERMEDIATE_LEADER = `<role>Intermediate synthesis lead.</role>
<rules>
1. Summarize agreement/disagreement across workers.
2. Note which positions are strengthening/weakening by evidence quality.
3. Identify remaining gaps.
</rules>
<constraint>Concise checkpoint — not the final answer.</constraint>`;

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
 * Each worker receives a role-specific prompt based on workerIndex.
 * Context optimization: workers only see the previous round's synthesis,
 * NOT full history.
 */
export function buildWorkerMessages(
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
  workerIndex?: number,
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
  const idx = workerIndex ?? 0;
  const roleConfig = WORKER_ROLES[idx % WORKER_ROLES.length]!;

  let systemContent: string;
  if (instructions) {
    const rolePrompt = nature === "artifact"
      ? roleConfig.artifactPrompt
      : roleConfig.critiquePrompt;
    systemContent = `<host-instructions>${instructions}</host-instructions>\n\n${rolePrompt}`;
  } else {
    systemContent = nature === "artifact"
      ? roleConfig.artifactPrompt
      : roleConfig.critiquePrompt;
  }

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Build messages for a worker in debate mode (round 2+).
 *
 * Full-sharing: workers see ALL other workers' raw responses from the previous round,
 * labeled by role (not model name) to prevent sycophancy bias.
 */
export function buildDebateWorkerMessages(
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
  _workerModel?: string,
  workerIndex?: number,
): ChatMessage[] {
  const userParts: string[] = [`## Task\n${ctx.task}`];

  const lastRound = ctx.rounds[ctx.rounds.length - 1];

  // Full-sharing: show all other workers' responses (labeled by role, not model).
  // Filter by workerIndex (positional identity) to correctly handle 4+ worker teams
  // where roles collide (index 0 and 3 are both "advocate").
  if (lastRound && lastRound.responses.length > 0) {
    const others = lastRound.responses
      .filter((r) => workerIndex == null || r.workerIndex !== workerIndex)
      .map((r) => `<worker role="${r.role ?? "worker"}">\n${r.content}\n</worker>`)
      .join("\n\n");
    if (others) {
      userParts.push(`## Other Workers' Responses\n${others}`);
    }
  }

  // Include this worker's own previous response for identity continuity
  if (workerIndex != null && lastRound) {
    const ownResponse = lastRound.responses.find((r) => r.workerIndex === workerIndex);
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

  const idx = workerIndex ?? 0;
  const roleConfig = WORKER_ROLES[idx % WORKER_ROLES.length]!;
  const nature = ctx.taskNature ?? "critique";

  const debateInstructions = instructions
    ? `<host-instructions>${instructions}</host-instructions>\n\n`
    : "";

  const debateContext =
    `${debateInstructions}` +
    `<role>You are a ${roleConfig.role} debater in a structured multi-model deliberation.</role>\n\n` +
    `<rules>\n` +
    `- You can now see all other workers' full responses directly.\n` +
    `- Before rebutting, restate each criticism in its strongest form.\n` +
    `- Concede where others are stronger — but ONLY when presented with new evidence or a logical flaw in your reasoning.\n` +
    `- Do NOT agree merely to be polite or to reach consensus. Disagreement backed by evidence is more valuable than premature agreement.\n` +
    `- If no new evidence was presented against your position, maintain it and explain why the criticism does not change your conclusion.\n` +
    `- If you change position, explain exactly what new evidence or argument caused the change.\n` +
    `</rules>`;

  const outputStructure = nature === "artifact"
    ? "\n\nYour response MUST be at least 200 characters."
    : `\n\n<output-structure>
Structure your response. Min 200 characters, max 600 words.
<response>
  <position>[Core claim, 1-2 sentences]</position>
  <evidence>[Key evidence, max 3 points]</evidence>
  <concerns>[Risks or counterarguments]</concerns>
  <certainty>
    <verifiable_claims>[Claims that can be fact-checked]</verifiable_claims>
    <assumptions>[Unstated assumptions your analysis depends on]</assumptions>
    <uncertainty>[What you're least sure about and why]</uncertainty>
  </certainty>
</response>
</output-structure>`;

  return [
    { role: "system", content: debateContext + outputStructure },
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

  // Current round's worker responses (labeled by role)
  const currentRound = ctx.rounds[ctx.rounds.length - 1];
  if (currentRound && currentRound.responses.length > 0) {
    const responses = currentRound.responses
      .map((r) => `<worker role="${r.role ?? "worker"}">\n${r.content}\n</worker>`)
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
      ? `<host-instructions>${instructions}</host-instructions>\n\n${DEBATE_INTERMEDIATE_LEADER}`
      : DEBATE_INTERMEDIATE_LEADER;
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
      systemContent += '\n\n<consensus>\nYour structured synthesis goes inside the "result" field.\nRespond with a JSON object: {"result": "<your full structured synthesis>", "decision": "approve" if consensus reached, "continue" if more rounds needed}.\n</consensus>';
    }
  }

  // Summary Manifest: for artifact tasks, append worker summaries at end of user message
  if (nature === "artifact" && currentRound && currentRound.responses.length > 0) {
    const manifest = currentRound.responses
      .map((r, i) => `Worker ${i + 1} (${r.role ?? "worker"}): ${extractSummary(r.content)}`)
      .join("\n");
    userParts.push(`[WORKER SUMMARY MANIFEST]\n${manifest}`);
  }

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userParts.join("\n\n") },
  ];
}
