/**
 * Deliberation prompt builders — multi-model deliberation.
 *
 * Design principles (2025-2026 research-backed):
 *   - No role differentiation: diversity comes from heterogeneous models, not assigned roles
 *     (Jekyll & Hyde, ICLR 2025: fixed personas hurt; model diversity is the real value)
 *   - Over-prompting hurts on latest models (Anthropic/OpenAI/Google consensus)
 *   - "Think thoroughly" > prescriptive steps (Anthropic official)
 *   - Depth techniques as general instructions:
 *     · Fundamental problem + multi-perspective identification (Five Whys + Multi-Perspective Probing, arXiv 2025)
 *     · Steelman solitaire with root-cause tracing (Steelman + Five Whys + Knowledge Boundary Probing, NeurIPS 2025)
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
import type { InteractionTechnique, SharedContext, WorkerResponse } from "./types";

// -- Types --

export interface RoundInfo {
  readonly current: number;
  readonly max: number;
}

// -- Core Prompt Fragments --

const DEPTH_INSTRUCTIONS_CRITIQUE = `First, identify the fundamental problem and its root cause. Then identify the different perspectives from which it can be analyzed. Think through each perspective thoroughly.

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.

After reaching your position, construct the strongest possible argument against it and defend against that argument. Then find the failure in your defense. For each failure reason, ask why it would happen — trace to the root cause. Stop only when a new challenge reveals nothing you haven't already addressed.

Before finishing, verify your key claims.`;

const DEPTH_INSTRUCTIONS_ARTIFACT = `First, identify the fundamental problem and its constraints. Then identify the different perspectives from which it can be approached. Think through each perspective thoroughly.

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.

After your implementation, construct the strongest possible argument against your approach and defend against it. Then find the failure in your defense. For each failure reason, ask why it would happen — trace to the root cause. Stop only when a new challenge reveals nothing you haven't already addressed.

Before finishing, verify your key claims.`;

// -- Interaction Technique Instructions --

export const TECHNIQUE_INSTRUCTIONS: Record<InteractionTechnique, string> = {
  challenge: "Focus on identifying weaknesses, counter-examples, and errors in these positions. Present specific evidence for each flaw. Include other relevant observations as they arise.",
  defend: "Focus on defending your position against challenges raised. Strengthen your argument with additional evidence and address objections. Note where challenges have merit.",
  accept: "Focus on identifying valid points from other positions. Modify your position where others present stronger evidence. State what changed and why.",
  probe: "Focus on identifying unexamined assumptions, blind spots, and open questions. What hasn't been considered? What conditions haven't been tested? Note strong points as well.",
  propose: "Focus on offering a new approach that differs from existing positions. Ground your proposal in specific evidence or reasoning. Acknowledge what existing approaches get right.",
  extend: "Focus on building on the strongest ideas presented. Add depth, detail, or specificity. What concrete next steps or implications follow? Note limitations or risks as they arise.",
  transform: "Focus on reshaping or combining existing ideas into a different framing, within the scope of the original question. What happens if we change the constraints, combine approaches, or shift the perspective? Note what works well in existing approaches.",
};

// -- Anti-Conformity --

export const ANTI_CONFORMITY = `Carefully assess the discrepancies between your analysis and others'.
Change your position only if there is clear evidence that your own analysis is incorrect,
not to reach consensus. You may not rely on the principle of conformity.`;

export const ANTI_CONFORMITY_ACCEPT = `Seek valid points to incorporate. Confirm agreement with independent reasoning —
state what specific evidence or logic led you to the same conclusion.
Change your position where evidence is stronger. Maintain where yours holds.`;

// -- Confidence & Uncertainty --

export const CONFIDENCE_AND_UNCERTAINTY = `For each major claim, indicate your confidence:
- HIGH: strong evidence or direct expertise
- MEDIUM: reasonable inference but limited evidence
- LOW: speculative or uncertain
Do not force confidence — if genuinely uncertain, say so.`;

// -- Helpers --

function buildSystemPrompt(
  roleDescription: string,
  nature: "artifact" | "critique",
): string {
  const parts: string[] = [];

  parts.push(`<role>${roleDescription}</role>`);

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
 * No role differentiation. Depth via general instructions (fundamental problem, multi-perspective, steelman solitaire).
 */
export function buildWorkerMessages(
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
  _workerIndex?: number,
  technique?: InteractionTechnique,
): ChatMessage[] {
  const nature = ctx.taskNature ?? "critique";
  const systemContent = buildSystemPrompt(
    "Think deeply, present concisely. No preamble — lead with your position.",
    nature,
  );

  const userParts: string[] = [];

  // Host instructions (in user message for prompt caching — system prefix stays constant)
  if (instructions) {
    userParts.push(`<host-instructions>${instructions}</host-instructions>`);
  }

  // Technique emphasis (user message)
  if (technique) {
    userParts.push(TECHNIQUE_INSTRUCTIONS[technique]);
  }

  // Confidence & uncertainty (always)
  userParts.push(CONFIDENCE_AND_UNCERTAINTY);

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
  technique?: InteractionTechnique,
): ChatMessage[] {
  const nature = ctx.taskNature ?? "critique";

  // System: depth instructions only (constant for prompt caching)
  const systemContent = buildSystemPrompt(
    "Think deeply, present concisely. No preamble — lead with your position. You are seeing other analysts' positions.",
    nature,
  );

  // User: instructions + technique + anti-conformity + context + task at end
  const userParts: string[] = [];

  // Host instructions (in user message for prompt caching)
  if (instructions) {
    userParts.push(`<host-instructions>${instructions}</host-instructions>`);
  }

  // Technique emphasis (user message)
  if (technique) {
    userParts.push(TECHNIQUE_INSTRUCTIONS[technique]);
  }

  // Anti-conformity (when other responses are shared)
  const hasOtherResponses = ctx.rounds.length > 0;
  if (hasOtherResponses) {
    userParts.push(technique === "accept" ? ANTI_CONFORMITY_ACCEPT : ANTI_CONFORMITY);
  }

  // Confidence & uncertainty (always)
  userParts.push(CONFIDENCE_AND_UNCERTAINTY);

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
    { role: "system", content: systemContent },
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
  instructions?: string,
  technique?: InteractionTechnique,
): ChatMessage {
  const parts: string[] = [];

  // Host instructions
  if (instructions) {
    parts.push(`<host-instructions>${instructions}</host-instructions>`);
  }

  // Technique emphasis
  if (technique) {
    parts.push(TECHNIQUE_INSTRUCTIONS[technique]);
  }

  // Anti-conformity (follow-up always has other responses context)
  parts.push(technique === "accept" ? ANTI_CONFORMITY_ACCEPT : ANTI_CONFORMITY);

  // Confidence & uncertainty
  parts.push(CONFIDENCE_AND_UNCERTAINTY);

  // Other workers' full responses in 3rd person (sycophancy reduction + full context)
  if (otherResponses.length > 0) {
    const others = otherResponses
      .map((r) => `One analyst argues:\n${escapeXmlContent(r.content)}`)
      .join("\n\n");
    parts.push(`## Other Positions\n${others}`);
  }

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
