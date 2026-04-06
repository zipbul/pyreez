/**
 * Deliberation prompt builders — heterogeneous multi-model deliberation.
 *
 * Design principles (2025-2026 research-backed):
 *   - Responsibility separation: pyreez owns harness (anti-conformity, steelmanning,
 *     formatting, sharing). Host owns semantic payload (task, workerInstructions).
 *   - No role differentiation: diversity from heterogeneous models, not assigned roles
 *   - Over-prompting hurts on latest models (Anthropic/OpenAI/Google consensus)
 *   - XML tags for cross-model compatibility (3-provider consensus)
 *   - Task at end of user message (Lost-in-the-Middle, MIT 2025)
 *   - 3rd person for other positions reduces sycophancy (cross-verified)
 *   - CONSTRAINTS drive 42.7% of quality (sinc-LLM)
 *   - Steelmanning + 3rd person for anti-sycophancy (63.8% improvement)
 *   - System = fixed (caching), User = variable
 *
 * @module Deliberation Prompts
 */

import type { ChatMessage } from "../llm/types";
import type { InterrogationExchange, Protocol, SharedContext, WorkerResponse } from "./types";

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

// -- Harness Fragments (pyreez-owned, host cannot override) --

const ANTI_CONFORMITY = `Assess discrepancies between your analysis and others' using specific evidence.
Change your position only when evidence against your analysis is clear.
State what specific evidence or logic led you to agree or disagree.
Do not rely on conformity, consensus, or social pressure.`;

const ANTI_CONFORMITY_ADVERSARIAL = `For every position you encounter, identify its weakest point with specific evidence.
Before criticizing, restate the opposing argument in its strongest form (steelman).
Concede points where the opposing evidence is genuinely stronger than yours.
State what you concede and why, with the specific evidence that convinced you.
Do not agree to reach consensus. Do not soften criticism.`;

const CONFIDENCE_AND_UNCERTAINTY = `For each major claim, indicate your confidence:
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
 * Format other workers' responses in 3rd person (sycophancy reduction).
 */
function formatOtherPositions(responses: readonly WorkerResponse[], workerIndex?: number): string {
  return responses
    .filter((r) => workerIndex == null || r.workerIndex !== workerIndex)
    .map((r) => `One analyst argues:\n${escapeXmlContent(r.content)}`)
    .join("\n\n");
}

// -- Digest Helper (retained for external use) --

/**
 * Extract debate-relevant digest from a worker response as plain text.
 *
 * Extraction priority:
 * 1. <position> and <evidence> tags (backward compat)
 * 2. Last non-empty line as summary heuristic
 * 3. First 3 lines as fallback
 */
export function extractDebateDigest(content: string): string {
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

  const lines = content.trim().split("\n").filter((l) => l.trim().length > 0);
  if (lines.length > 3) {
    const lastLine = lines[lines.length - 1]!.trim();
    if (lastLine.length > 10 && lastLine.length < 500 && !lastLine.startsWith("```")) {
      return lastLine;
    }
  }

  return content.split("\n").slice(0, 3).join("\n").trim();
}

// ============================================================
// Protocol-specific Builders
// ============================================================

// -- 1. Shared Convergence --

const SHARED_CONVERGENCE_SYSTEM_CRITIQUE = buildSystemPrompt(
  "Think deeply, present concisely. No preamble — lead with your position.",
  "critique",
);

const SHARED_CONVERGENCE_SYSTEM_ARTIFACT = buildSystemPrompt(
  "Think deeply, present concisely. No preamble — lead with your position.",
  "artifact",
);

/**
 * Build R1 messages for shared_convergence (independent analysis).
 */
export function buildSharedConvergenceR1(
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
): ChatMessage[] {
  const system = (ctx.taskNature ?? "critique") === "artifact"
    ? SHARED_CONVERGENCE_SYSTEM_ARTIFACT
    : SHARED_CONVERGENCE_SYSTEM_CRITIQUE;

  const userParts: string[] = [];
  if (instructions) userParts.push(`<host-instructions>${instructions}</host-instructions>`);
  userParts.push(CONFIDENCE_AND_UNCERTAINTY);
  if (roundInfo && roundInfo.current === 1 && roundInfo.max > 1) {
    userParts.push("Explore broadly. Do not converge prematurely.");
  }
  userParts.push(`<task>${ctx.task}</task>`);

  return [
    { role: "system", content: system },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Build R2+ messages for shared_convergence (with other positions, sparse).
 */
export function buildSharedConvergenceR2(
  ctx: SharedContext,
  otherResponses: readonly WorkerResponse[],
  ownPrevious: WorkerResponse | undefined,
  instructions?: string,
  roundInfo?: RoundInfo,
): ChatMessage[] {
  const system = (ctx.taskNature ?? "critique") === "artifact"
    ? SHARED_CONVERGENCE_SYSTEM_ARTIFACT
    : SHARED_CONVERGENCE_SYSTEM_CRITIQUE;

  const userParts: string[] = [];
  if (instructions) userParts.push(`<host-instructions>${instructions}</host-instructions>`);

  // Anti-conformity harness
  userParts.push(`<constraints>\n${ANTI_CONFORMITY}\n</constraints>`);
  userParts.push(CONFIDENCE_AND_UNCERTAINTY);

  // Other positions (3rd person, sparse-selected)
  if (otherResponses.length > 0) {
    const others = formatOtherPositions(otherResponses);
    if (others) userParts.push(`<other-positions>\n${others}\n</other-positions>`);
  }

  // Own previous
  if (ownPrevious) {
    userParts.push(`<your-previous>${ownPrevious.content}</your-previous>`);
  } else if (ctx.rounds.length > 0) {
    // Cold join: full transcript
    const transcript = ctx.rounds.map((r) => {
      const workers = r.responses
        .map((resp) => `One analyst argues:\n${escapeXmlContent(resp.content)}`)
        .join("\n\n");
      return `### Round ${r.number}\n${workers}`;
    }).join("\n\n");
    userParts.push(`<debate-so-far>\n${transcript}\n</debate-so-far>`);
  }

  if (roundInfo && roundInfo.current === roundInfo.max && roundInfo.max > 1) {
    userParts.push("This is the final round. Commit to your strongest position.");
  }

  userParts.push(`<task>${ctx.task}</task>`);

  return [
    { role: "system", content: system },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Build follow-up message for session continuation in shared_convergence.
 */
export function buildSharedConvergenceFollowUp(
  ctx: SharedContext,
  otherResponses: readonly WorkerResponse[],
  instructions?: string,
  roundInfo?: RoundInfo,
): ChatMessage {
  const parts: string[] = [];
  if (instructions) parts.push(`<host-instructions>${instructions}</host-instructions>`);
  parts.push(`<constraints>\n${ANTI_CONFORMITY}\n</constraints>`);
  parts.push(CONFIDENCE_AND_UNCERTAINTY);

  if (otherResponses.length > 0) {
    const others = formatOtherPositions(otherResponses);
    if (others) parts.push(`<other-positions>\n${others}\n</other-positions>`);
  }

  if (roundInfo && roundInfo.current === roundInfo.max && roundInfo.max > 1) {
    parts.push("This is the final round. Commit to your strongest position.");
  }

  parts.push(`<task>${ctx.task}</task>`);
  return { role: "user", content: parts.join("\n\n") };
}

// -- 2. Adversarial Debate --

const ADVERSARIAL_SYSTEM_CRITIQUE = buildSystemPrompt(
  "Think deeply, present concisely. No preamble — lead with your position. You are seeing other analysts' positions. Your goal is to find weaknesses.",
  "critique",
);

const ADVERSARIAL_SYSTEM_ARTIFACT = buildSystemPrompt(
  "Think deeply, present concisely. No preamble — lead with your position. You are seeing other analysts' positions. Your goal is to find weaknesses.",
  "artifact",
);

/**
 * Build R1 for adversarial_debate (identical to shared_convergence R1).
 */
export function buildAdversarialDebateR1(
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
): ChatMessage[] {
  return buildSharedConvergenceR1(ctx, instructions, roundInfo);
}

/**
 * Build R2+ for adversarial_debate (steelman + challenge).
 */
export function buildAdversarialDebateR2(
  ctx: SharedContext,
  otherResponses: readonly WorkerResponse[],
  ownPrevious: WorkerResponse | undefined,
  instructions?: string,
  _roundInfo?: RoundInfo,
): ChatMessage[] {
  const system = (ctx.taskNature ?? "critique") === "artifact"
    ? ADVERSARIAL_SYSTEM_ARTIFACT
    : ADVERSARIAL_SYSTEM_CRITIQUE;

  const userParts: string[] = [];
  if (instructions) userParts.push(`<host-instructions>${instructions}</host-instructions>`);

  // Adversarial anti-conformity harness (steelman + challenge)
  userParts.push(`<constraints>\n${ANTI_CONFORMITY_ADVERSARIAL}\n</constraints>`);
  userParts.push(CONFIDENCE_AND_UNCERTAINTY);

  if (otherResponses.length > 0) {
    const others = formatOtherPositions(otherResponses);
    if (others) userParts.push(`<positions-to-challenge>\n${others}\n</positions-to-challenge>`);
  }

  if (ownPrevious) {
    userParts.push(`<your-previous>${ownPrevious.content}</your-previous>`);
  } else if (ctx.rounds.length > 0) {
    const transcript = ctx.rounds.map((r) => {
      const workers = r.responses
        .map((resp) => `One analyst argues:\n${escapeXmlContent(resp.content)}`)
        .join("\n\n");
      return `### Round ${r.number}\n${workers}`;
    }).join("\n\n");
    userParts.push(`<debate-so-far>\n${transcript}\n</debate-so-far>`);
  }

  userParts.push(`<task>${ctx.task}</task>`);

  return [
    { role: "system", content: system },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Build follow-up for adversarial_debate session continuation.
 */
export function buildAdversarialDebateFollowUp(
  ctx: SharedContext,
  otherResponses: readonly WorkerResponse[],
  instructions?: string,
  _roundInfo?: RoundInfo, // eslint-disable-line @typescript-eslint/no-unused-vars
): ChatMessage {
  const parts: string[] = [];
  if (instructions) parts.push(`<host-instructions>${instructions}</host-instructions>`);
  parts.push(`<constraints>\n${ANTI_CONFORMITY_ADVERSARIAL}\n</constraints>`);
  parts.push(CONFIDENCE_AND_UNCERTAINTY);

  if (otherResponses.length > 0) {
    const others = formatOtherPositions(otherResponses);
    if (others) parts.push(`<positions-to-challenge>\n${others}\n</positions-to-challenge>`);
  }

  parts.push(`<task>${ctx.task}</task>`);
  return { role: "user", content: parts.join("\n\n") };
}

// -- 3. Host Interrogation --

const HOST_INTERROGATION_SYSTEM = `<role>Answer the question directly and thoroughly. No preamble.</role>

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.
If the question challenges your previous answer, address the challenge with evidence — do not simply reaffirm.

<constraints>
Answer only what is asked. Do not volunteer unrelated analysis.
If you do not know, say so. Do not speculate without labeling it.
If the question contains a false premise, identify it before answering.
If genuinely uncertain, say so.
</constraints>`;

/**
 * Build messages for host_interrogation.
 */
export function buildHostInterrogationMessages(
  task: string,
  question: string,
  previousExchanges?: readonly InterrogationExchange[],
): ChatMessage[] {
  const userParts: string[] = [];

  if (previousExchanges && previousExchanges.length > 0) {
    const exchanges = previousExchanges.map((ex) =>
      `<question>${ex.question}</question>\n<your-answer>${ex.answer}</your-answer>`
    ).join("\n\n");
    userParts.push(`<previous-exchange>\n${exchanges}\n</previous-exchange>`);
  }

  userParts.push(`<question>${question}</question>`);
  userParts.push(`<context>${task}</context>`);

  return [
    { role: "system", content: HOST_INTERROGATION_SYSTEM },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

// -- 4. Sequential Refinement --

const SEQUENTIAL_REFINEMENT_SYSTEM = `<role>Improve the given work. Preserve what works, fix what doesn't, add what's missing. No preamble — lead with the improved version.</role>

Before modifying, identify what the previous version does well and must be preserved.
Then identify gaps, errors, or weaknesses. Improve only those areas.
Ground changes in specific reasoning.

<constraints>
Do not rewrite from scratch. Build on the previous version.
For every change, state what was wrong and why your version is better.
If the previous version is already correct in an area, leave it unchanged.
If genuinely uncertain about a change, flag it.
</constraints>`;

/**
 * Build messages for sequential_refinement.
 * First worker gets R1-style prompt; subsequent workers get previous output.
 */
export function buildSequentialRefinementMessages(
  ctx: SharedContext,
  previousWorkerOutput: string | undefined,
  instructions?: string,
): ChatMessage[] {
  // First worker in chain — no previous output, use R1-style
  if (!previousWorkerOutput) {
    return buildSharedConvergenceR1(ctx, instructions);
  }

  const userParts: string[] = [];
  if (instructions) userParts.push(`<host-instructions>${instructions}</host-instructions>`);
  userParts.push(`<previous-version>\n${previousWorkerOutput}\n</previous-version>`);
  userParts.push(`<task>${ctx.task}</task>`);

  return [
    { role: "system", content: SEQUENTIAL_REFINEMENT_SYSTEM },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

// -- 5. Evaluation Scoring --

const EVALUATION_SCORING_SYSTEM = `<role>Evaluate independently. No preamble — lead with your verdict.</role>

<constraints>
Evaluate against the provided criteria only. Do not invent additional criteria.
For each criterion, provide a score (1-10) and specific evidence from the subject.
If evidence is insufficient to judge a criterion, score it as "insufficient evidence."
Do not consider how other evaluators might score. Judge independently.
If genuinely uncertain, say so.
</constraints>

<output-format>
End your evaluation with exactly this format:
score: [overall 1-10]
verdict: [one sentence summary]
</output-format>`;

/**
 * Build messages for evaluation_scoring.
 */
export function buildEvaluationScoringMessages(
  task: string,
  criteria: string,
  subject: string,
  instructions?: string,
): ChatMessage[] {
  const userParts: string[] = [];
  if (instructions) userParts.push(`<host-instructions>${instructions}</host-instructions>`);
  userParts.push(`<evaluation-criteria>\n${criteria}\n</evaluation-criteria>`);
  userParts.push(`<subject>\n${subject}\n</subject>`);
  userParts.push(`<task>${task}</task>`);

  return [
    { role: "system", content: EVALUATION_SCORING_SYSTEM },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

// -- 6. Red Team --

const RED_TEAM_GENERATOR_SYSTEM = `<role>Produce the requested output. No preamble.</role>

Think through edge cases, failure modes, and adversarial inputs.
Anticipate how your output could be attacked or misused.

<constraints>
Produce the strongest version you can.
If you are aware of a weakness, address it proactively.
</constraints>`;

const RED_TEAM_ATTACKER_SYSTEM = `<role>Find vulnerabilities in the given output. No preamble — lead with the most critical finding.</role>

<constraints>
Find concrete, exploitable weaknesses — not theoretical concerns.
For each vulnerability, provide a specific attack scenario or proof.
Rank findings by severity (critical > high > medium > low).
If the output is robust against your analysis, say so.
Do not fabricate vulnerabilities.
</constraints>`;

/**
 * Build messages for red_team generator.
 */
export function buildRedTeamGeneratorMessages(
  task: string,
  instructions?: string,
  previousAttackResults?: string,
): ChatMessage[] {
  const userParts: string[] = [];
  if (instructions) userParts.push(`<host-instructions>${instructions}</host-instructions>`);
  if (previousAttackResults) {
    userParts.push(`<attack-results>\n${previousAttackResults}\n</attack-results>`);
  }
  userParts.push(`<task>${task}</task>`);

  return [
    { role: "system", content: RED_TEAM_GENERATOR_SYSTEM },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Build messages for red_team attacker.
 */
export function buildRedTeamAttackerMessages(
  task: string,
  targetOutputs: readonly string[],
  instructions?: string,
): ChatMessage[] {
  const userParts: string[] = [];
  if (instructions) userParts.push(`<host-instructions>${instructions}</host-instructions>`);
  const targets = targetOutputs.map((o) => `<target-output>\n${o}\n</target-output>`).join("\n\n");
  userParts.push(targets);
  userParts.push(`<task>${task}</task>`);

  return [
    { role: "system", content: RED_TEAM_ATTACKER_SYSTEM },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

// -- Acceptance Round (unchanged) --

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

// -- Protocol Dispatcher --

/**
 * Get the appropriate R1 builder for a protocol.
 */
export function getR1Builder(protocol: Protocol): (
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
) => ChatMessage[] {
  switch (protocol) {
    case "shared_convergence":
      return buildSharedConvergenceR1;
    case "adversarial_debate":
      return buildAdversarialDebateR1;
    case "sequential_refinement":
      return (ctx, instructions) => buildSequentialRefinementMessages(ctx, undefined, instructions);
    case "evaluation_scoring":
    case "host_interrogation":
    case "red_team":
      // These protocols have specialized input — handled directly by engine
      return buildSharedConvergenceR1;
    default:
      return buildSharedConvergenceR1;
  }
}
