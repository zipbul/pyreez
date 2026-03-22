/**
 * Deliberation prompt builders — multi-model deliberation.
 *
 * Design principles (2025-2026 research-backed):
 *   - No role differentiation: diversity comes from heterogeneous models, not assigned roles
 *     (Jekyll & Hyde, ICLR 2025: fixed personas hurt; model diversity is the real value)
 *   - Over-prompting hurts on latest models (Anthropic/OpenAI/Google consensus)
 *   - "Think thoroughly" > prescriptive steps (Anthropic official)
 *   - Depth techniques as general instructions:
 *     · Step-Back: identify underlying principles (ICLR 2024, +7-27%)
 *     · Recursive self-questioning until stable (Socratic recursive, EMNLP; AB-MCTS, NeurIPS 2025)
 *     · Self-verification before finishing (Anthropic official; OPENDEV self-critique)
 *     · Ground facts in evidence, speculative ideas need reasoning chain (CoVe principle)
 *   - Structured output forced on reasoning hurts 10-15% (cross-verified)
 *   - Input XML tags help parsing (3-provider consensus); output XML removed
 *   - Task at end of user message (Lost-in-the-Middle, MIT 2025)
 *   - 3rd person for other positions reduces sycophancy (cross-verified)
 *   - Diverge R1 / Converge final round (CreativeDC, NeurIPS 2025)
 *   - Cold join merged into debate builder (auto-detected via participation history)
 *
 * @module Deliberation Prompts
 */

import type { ChatMessage } from "../llm/types";
import type { SharedContext, WorkerResponse } from "./types";

// -- Types --

export interface RoundInfo {
  readonly current: number;
  readonly max: number;
}

// -- Domain Hints --

/**
 * Domain-specific hints injected into worker prompts.
 * Aligns worker "evidence" interpretation with evaluator expectations.
 */
const DOMAIN_WORKER_HINTS: Record<string, string> = {
  IDEATION: "In this domain, evidence means analogous cases, market data, and user behavior patterns.",
  CODING: "In this domain, evidence means execution paths, boundary conditions, and type safety.",
  DEBUGGING: "In this domain, evidence means reproduction steps and root cause vs symptom distinction.",
  REVIEW: "In this domain, evidence means specific code references and concrete impact of issues.",
  ARCHITECTURE: "In this domain, evidence means scalability analysis, failure scenarios, and dependency impact.",
  RESEARCH: "In this domain, evidence means source citations and methodology evaluation.",
  PLANNING: "In this domain, evidence means resource constraints, dependency ordering, and risk scenarios.",
  REQUIREMENTS: "In this domain, evidence means stakeholder needs, acceptance criteria, and edge cases.",
  TESTING: "In this domain, evidence means coverage gaps, edge cases, and failure reproduction.",
  DOCUMENTATION: "In this domain, evidence means accuracy of descriptions, completeness, and audience fit.",
  OPERATIONS: "In this domain, evidence means uptime data, incident patterns, and capacity metrics.",
  COMMUNICATION: "In this domain, evidence means audience context, clarity of message, and actionability.",
};

/**
 * Get domain hint for worker prompts. Returns empty string if domain unknown.
 */
export function getDomainHint(domain?: string): string {
  if (!domain) return "";
  return DOMAIN_WORKER_HINTS[domain] ?? "";
}

// -- Core Prompt Fragments --

const DEPTH_INSTRUCTIONS_CRITIQUE = `First, identify the different perspectives from which this problem can be analyzed. Then think through each perspective thoroughly.

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.

After reaching your position, construct the strongest possible argument against it and defend against that argument. Then find the failure in your defense. For each failure reason, ask why it would happen — trace to the root cause. Stop only when a new challenge reveals nothing you haven't already addressed.

Before finishing, verify your key claims.`;

const DEPTH_INSTRUCTIONS_ARTIFACT = `First, identify the different perspectives from which this task can be approached. Then think through each perspective thoroughly.

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.

After your implementation, construct the strongest possible argument against your approach and defend against it. Then find the failure in your defense. For each failure reason, ask why it would happen — trace to the root cause. Stop only when a new challenge reveals nothing you haven't already addressed.

Before finishing, verify your key claims.`;

// -- Helpers --

function buildSystemPrompt(
  roleDescription: string,
  nature: "artifact" | "critique",
  domain?: string,
  instructions?: string,
): string {
  const parts: string[] = [];

  if (instructions) {
    parts.push(`<host-instructions>${instructions}</host-instructions>`);
  }

  parts.push(`<role>${roleDescription}</role>`);

  const hint = getDomainHint(domain);
  if (hint) {
    parts.push(`<domain>${hint}</domain>`);
  }

  parts.push(nature === "artifact" ? DEPTH_INSTRUCTIONS_ARTIFACT : DEPTH_INSTRUCTIONS_CRITIQUE);

  return parts.join("\n\n");
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
 *
 * Extraction priority:
 * 1. <position> and <evidence> tags (backward compat with old structured output)
 * 2. Last non-empty line as summary heuristic
 * 3. First 3 lines as fallback
 *
 * Note: debate builders now share full responses. This function is retained
 * for potential external use (e.g., acceptance round digest, host-side extraction).
 */
export function extractDebateDigest(content: string): string {
  // Try structured tags first (backward compat)
  const position = content.match(/<position>([\s\S]*?)<\/position>/);
  const evidence = content.match(/<evidence>([\s\S]*?)<\/evidence>/);
  const alternatives = content.match(/<alternatives>([\s\S]*?)<\/alternatives>/);

  if (position?.[1] || evidence?.[1] || alternatives?.[1]) {
    const parts: string[] = [];
    if (position?.[1]) parts.push(`Position: ${position[1].trim()}`);
    if (evidence?.[1]) parts.push(`Evidence: ${evidence[1].trim()}`);
    if (alternatives?.[1]) parts.push(`Alternatives: ${alternatives[1].trim()}`);
    return parts.join("\n");
  }

  // Try last non-empty line as summary
  const lines = content.trim().split("\n").filter((l) => l.trim().length > 0);
  if (lines.length > 3) {
    const lastLine = lines[lines.length - 1]!.trim();
    if (lastLine.length > 10 && lastLine.length < 500 && !lastLine.startsWith("```")) {
      return lastLine;
    }
  }

  return content.split("\n").slice(0, 3).join("\n").trim();
}

// -- Exported Builders --

/**
 * Build messages for a worker LLM (R1 or diverge-synth).
 *
 * All workers receive identical prompts — diversity comes from heterogeneous models.
 * No role differentiation. Depth via general instructions (Step-Back, recursive self-questioning).
 */
export function buildWorkerMessages(
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
  _workerIndex?: number,
): ChatMessage[] {
  const nature = ctx.taskNature ?? "critique";
  const systemContent = buildSystemPrompt(
    "Think thoroughly. Identify the underlying principles before answering.",
    nature, ctx.domain, instructions,
  );

  const userParts: string[] = [];

  // Round strategy (CreativeDC: diverge R1, converge final)
  if (roundInfo && roundInfo.current === 1 && roundInfo.max > 1) {
    userParts.push("Explore broadly. Do not converge prematurely.");
  }
  if (roundInfo && roundInfo.current === roundInfo.max && roundInfo.max > 1) {
    userParts.push("This is the final round. Commit to your strongest position.");
  }

  // Task at end (Lost-in-the-Middle)
  userParts.push(`## Task\n${ctx.task}`);

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Build messages for a worker in debate mode (round 2+).
 *
 * Cold join auto-detected: if workerIndex has no response in last round,
 * full transcript is shown instead of last-round-only digests.
 * Other positions presented in 3rd person (sycophancy reduction).
 */
export function buildDebateWorkerMessages(
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
  workerIndex?: number,
): ChatMessage[] {
  const nature = ctx.taskNature ?? "critique";

  // System: same depth instructions + debate-specific rules
  const systemParts: string[] = [];

  if (instructions) {
    systemParts.push(`<host-instructions>${instructions}</host-instructions>`);
  }

  systemParts.push(`<role>Think thoroughly. You are seeing other analysts' positions.</role>`);

  const hint = getDomainHint(ctx.domain);
  if (hint) {
    systemParts.push(`<domain>${hint}</domain>`);
  }

  systemParts.push(
    `<rules>\n` +
    `- Respond to each analyst's key argument specifically.\n` +
    `- Then state whether and how your position changed.\n` +
    `</rules>`,
  );

  systemParts.push(nature === "artifact" ? DEPTH_INSTRUCTIONS_ARTIFACT : DEPTH_INSTRUCTIONS_CRITIQUE);

  // User: context + task at end
  const userParts: string[] = [];

  const lastRound = ctx.rounds[ctx.rounds.length - 1];

  // Auto-detect cold join: check if this worker has a response in the last round
  const ownPrevious = (workerIndex != null && lastRound)
    ? lastRound.responses.find((r) => r.workerIndex === workerIndex)
    : undefined;

  if (ownPrevious) {
    // Normal debate: show other workers' full responses + own previous
    if (lastRound && lastRound.responses.length > 0) {
      const others = lastRound.responses
        .filter((r) => workerIndex == null || r.workerIndex !== workerIndex)
        .map((r) => `One analyst argues:\n${escapeXmlContent(r.content)}`)
        .join("\n\n");
      if (others) {
        userParts.push(`## Other Positions\n${others}`);
      }
    }
    userParts.push(`## Your Previous Response\n${ownPrevious.content}`);
  } else {
    // Cold join: show full transcript (worker has no prior participation)
    if (ctx.rounds.length > 0) {
      const transcriptParts: string[] = [];
      for (const round of ctx.rounds) {
        const header = `### Round ${round.number}`;
        const workers = round.responses
          .map((r) => `One analyst argues:\n${escapeXmlContent(r.content)}`)
          .join("\n\n");
        transcriptParts.push(`${header}\n${workers}`);
      }
      userParts.push(`## Debate So Far\n${transcriptParts.join("\n\n")}`);
    }
  }

  // Round strategy
  if (roundInfo && roundInfo.current === roundInfo.max && roundInfo.max > 1) {
    userParts.push("This is the final round. Commit to your strongest position.");
  }

  // Task at end
  userParts.push(`## Task\n${ctx.task}`);

  return [
    { role: "system", content: systemParts.join("\n\n") },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

// -- Debate Follow-Up (session continuation) --

/**
 * Build a single user message to append to an existing worker session for R2+.
 *
 * Instead of rebuilding the entire prompt, this appends other workers' positions
 * to the existing conversation. The worker already has its full R1 reasoning
 * in the session — we only add what's new.
 *
 * Falls back to buildDebateWorkerMessages for cold join (no session history).
 */
export function buildDebateFollowUp(
  ctx: SharedContext,
  otherResponses: readonly WorkerResponse[],
  roundInfo?: RoundInfo,
): ChatMessage {
  const parts: string[] = [];

  // Other workers' full responses in 3rd person (sycophancy reduction + full context)
  if (otherResponses.length > 0) {
    const others = otherResponses
      .map((r) => `One analyst argues:\n${escapeXmlContent(r.content)}`)
      .join("\n\n");
    parts.push(`## Other Positions\n${others}`);
  }

  // Engagement + anti-sycophancy
  parts.push("Respond to each analyst's key argument specifically. Then state whether and how your position changed.");

  // Round strategy
  if (roundInfo && roundInfo.current === roundInfo.max && roundInfo.max > 1) {
    parts.push("This is the final round. Commit to your strongest position.");
  }

  // Task reminder at end (Lost-in-the-Middle)
  parts.push(`## Task\n${ctx.task}`);

  return { role: "user", content: parts.join("\n\n") };
}

// -- Acceptance Round --

/**
 * Build messages for an acceptance round worker.
 * Acceptance KEEPS structured XML output — host needs to parse verdict.
 */
export function buildAcceptanceMessages(
  synthesis: string,
  originalPosition: string,
  task: string,
): ChatMessage[] {
  const system = `<role>You are reviewing whether this synthesis accurately represents your position.</role>

<output-format>
Respond with ONLY the following XML structure:
<acceptance>
  <verdict>accept, partial, or reject</verdict>
  <misrepresented>What was distorted. "None." if accept.</misrepresented>
  <unresolved>Critical issues ignored. "None." if accept.</unresolved>
</acceptance>
</output-format>`;

  const user = `## Your Original Position\n${originalPosition}\n\n## Synthesis\n${synthesis}\n\n## Task\n${task}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
