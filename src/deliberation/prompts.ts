/**
 * Deliberation prompt builders — multi-model deliberation.
 *
 * Exported functions:
 *   buildWorkerMessages — build ChatMessage[] for a worker LLM (per-worker, role-aware)
 *   buildDebateWorkerMessages — build ChatMessage[] for debate-mode workers (full-sharing)
 *   assignWorkerRole — deterministic role assignment by worker index
 *
 * Pure functions: SharedContext in → ChatMessage[] out.
 * Host provides instructions; pyreez uses minimal defaults when absent.
 *
 * @module Deliberation Prompts
 */

import type { ChatMessage } from "../llm/types";
import type { DeliberationRole, SharedContext } from "./types";

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

// -- Debate Digest Helpers --

/**
 * Escape XML special characters to prevent structure injection.
 */
function escapeXmlContent(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Extract debate-relevant digest from a worker response as plain text.
 * Pulls <position> and <evidence> tag contents for compact cross-worker sharing.
 * Falls back to first 3 lines if neither tag is found.
 * Returns plain text (no XML tags) — caller wraps in safe outer tags.
 */
export function extractDebateDigest(content: string): string {
  const position = content.match(/<position>([\s\S]*?)<\/position>/);
  const evidence = content.match(/<evidence>([\s\S]*?)<\/evidence>/);

  if (position?.[1] || evidence?.[1]) {
    const parts: string[] = [];
    if (position?.[1]) parts.push(`Position: ${position[1].trim()}`);
    if (evidence?.[1]) parts.push(`Evidence: ${evidence[1].trim()}`);
    return parts.join("\n");
  }

  return content.split("\n").slice(0, 3).join("\n").trim();
}

// -- Exported Builders --

/**
 * Build messages for a worker LLM.
 *
 * Each worker receives a role-specific prompt based on workerIndex.
 */
export function buildWorkerMessages(
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
  workerIndex?: number,
): ChatMessage[] {
  const userParts: string[] = [`## Task\n${ctx.task}`];

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
      .map((r) => `<worker role="${r.role ?? "worker"}">\n${escapeXmlContent(extractDebateDigest(r.content))}\n</worker>`)
      .join("\n\n");
    if (others) {
      userParts.push(`## Other Workers' Positions\n${others}`);
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

// -- Cold Join (Replacement Worker in Debate R2+) --

/**
 * Build messages for a replacement worker joining a debate mid-round.
 *
 * Unlike buildDebateWorkerMessages, this shows the FULL debate transcript
 * (all rounds, all workers) instead of just the last round's positions.
 * No "Your Previous Response" section — the replacement has no prior participation.
 */
export function buildColdJoinMessages(
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
  workerIndex?: number,
): ChatMessage[] {
  const userParts: string[] = [`## Task\n${ctx.task}`];

  // Full debate transcript — all rounds, all workers
  if (ctx.rounds.length > 0) {
    const transcriptParts: string[] = [];
    for (const round of ctx.rounds) {
      const header = `### Round ${round.number}`;
      const workers = round.responses
        .map((r) => `<worker role="${r.role ?? "worker"}">\n${escapeXmlContent(extractDebateDigest(r.content))}\n</worker>`)
        .join("\n\n");
      transcriptParts.push(`${header}\n${workers}`);
    }
    userParts.push(`## Full Debate Transcript\n${transcriptParts.join("\n\n")}`);
  }

  if (roundInfo) {
    const budget = `## Round Budget\nRound ${roundInfo.current} of ${roundInfo.max}`;
    if (roundInfo.current === roundInfo.max) {
      userParts.push(`${budget}\n⚠️ This is the FINAL round. State your position clearly.`);
    } else {
      userParts.push(budget);
    }
  }

  const idx = workerIndex ?? 0;
  const roleConfig = WORKER_ROLES[idx % WORKER_ROLES.length]!;
  const nature = ctx.taskNature ?? "critique";

  const coldJoinInstructions = instructions
    ? `<host-instructions>${instructions}</host-instructions>\n\n`
    : "";

  const coldJoinContext =
    `${coldJoinInstructions}` +
    `<role>You are a ${roleConfig.role} joining an ongoing multi-round debate as a new participant.</role>\n\n` +
    `<rules>\n` +
    `- Read the full debate transcript carefully before responding.\n` +
    `- You have no prior position to defend — this is your advantage.\n` +
    `- Identify what ALL existing participants missed or got wrong.\n` +
    `- Bring fresh perspective: challenge consensus, surface overlooked angles.\n` +
    `- If you agree with an existing position, add NEW evidence or reasoning not yet presented.\n` +
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
    { role: "system", content: coldJoinContext + outputStructure },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

// -- Acceptance Round --

/**
 * Build messages for an acceptance round worker.
 * The worker verifies whether the host's synthesis accurately represents
 * their original position and addresses key concerns.
 */
export function buildAcceptanceMessages(
  synthesis: string,
  originalPosition: string,
  task: string,
): ChatMessage[] {
  const system = `<role>You are a verification reviewer. Check whether a synthesis accurately represents your original position.</role>

<rules>
- Compare the synthesis against your original position carefully.
- Accept if your key claims are fairly represented, even if the synthesis disagrees with you.
- Reject ONLY if the synthesis misrepresents your position or ignores critical unresolved issues.
- Be specific about what was misrepresented or unresolved.
</rules>

<output-format>
Respond with ONLY the following XML structure:
<acceptance>
  <verdict>accept or reject</verdict>
  <misrepresented>What was distorted or misattributed from your position. "None." if accept.</misrepresented>
  <unresolved>Critical issues from your position that were ignored. "None." if accept.</unresolved>
</acceptance>
</output-format>`;

  const user = `## Task\n${task}\n\n## Your Original Position\n${originalPosition}\n\n## Host Synthesis\n${synthesis}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
