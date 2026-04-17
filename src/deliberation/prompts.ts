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
import type { InterrogationExchange, SharedContext, WorkerResponse } from "./types";

// -- Types --

export interface RoundInfo {
  readonly current: number;
  readonly max: number;
}

// -- Core Prompt Fragments --

// Global depth: applies to ALL protocols. GOAL-only, no PROCESS prescription.
const GLOBAL_DEPTH = `Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.
If a premise is flawed, reject it — do not build on a broken foundation.
Express uncertainty where it exists. Do not force confidence on ambiguous points.
Before finishing, verify your key claims.`;

// Protocol-specific depth extensions (additive to GLOBAL_DEPTH)
const DEPTH_EXPLORE = `Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.`;

const DEPTH_REFINE = `After your improvements, find the strongest argument against your changes. If you cannot defend a change, revert it.`;

// -- Harness Fragments (pyreez-owned, host cannot override) --

const ANTI_CONFORMITY = `Assess discrepancies between your analysis and others' using specific evidence.
Change your position only when evidence against your analysis is clear.
State what specific evidence or logic led you to agree or disagree.
Do not rely on conformity, consensus, or social pressure.
When others report their confidence, weigh their evidence against their stated certainty: high-confidence claims with weak evidence are red flags; low-confidence claims with strong evidence deserve attention.`;

const ANTI_CONFORMITY_ADVERSARIAL = `For every position you encounter, identify its weakest point with specific evidence.
Before criticizing, restate the opposing argument in its strongest form (steelman).
Concede points where the opposing evidence is genuinely stronger than yours.
State what you concede and why, with the specific evidence that convinced you.
Do not agree to reach consensus. Do not soften criticism.
When others report their confidence, weigh their evidence against their stated certainty: high-confidence claims with weak evidence are red flags; low-confidence claims with strong evidence deserve attention.`;

const CONFIDENCE_AND_UNCERTAINTY = `For each major claim, indicate your confidence:
- HIGH: strong evidence or direct expertise
- MEDIUM: reasonable inference but limited evidence
- LOW: speculative or uncertain
Do not force confidence — if genuinely uncertain, say so.`;

// -- Helpers --

function buildSystemPrompt(
  roleDescription: string,
  depthExtension?: string,
): string {
  const parts: string[] = [];
  parts.push(`<role>${roleDescription}</role>`);
  parts.push(GLOBAL_DEPTH);
  if (depthExtension) parts.push(depthExtension);
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
 * Includes confidence when reported (ConfMAD: agents condition updates on others' confidence).
 */
function formatOtherPositions(responses: readonly WorkerResponse[], workerIndex?: number): string {
  return responses
    .filter((r) => workerIndex == null || r.workerIndex !== workerIndex)
    .map((r) => {
      const conf = r.confidence ? ` (their confidence: ${r.confidence.toUpperCase()})` : "";
      return `One analyst argues${conf}:\n${escapeXmlContent(r.content)}`;
    })
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

const SHARED_CONVERGENCE_SYSTEM = buildSystemPrompt(
  "Think deeply, present concisely. No preamble — lead with your position.",
  DEPTH_EXPLORE,
);

// -- R1 Diversity Lenses (DMAD-inspired: diverse reasoning per worker) --

const DIVERSITY_LENSES = [
  "Prioritize practical constraints: cost, timeline, team capability, migration effort. What looks good on paper but fails in practice?",
  "Prioritize long-term consequences: maintenance burden, scalability ceiling, ecosystem trajectory, lock-in risk. What decision will you regret in 2 years?",
  "Prioritize risk and failure modes: what can go wrong, what are the hidden assumptions, what happens under adversarial conditions? Steelman the weakest option.",
  "Prioritize the contrarian view: argue for the less obvious choice. What is everyone else missing? What evidence contradicts the popular opinion?",
  "Prioritize first principles: strip away convention and trend. What does the fundamental problem actually require? Rebuild the analysis from constraints alone.",
  "Prioritize human factors: developer experience, onboarding, cognitive load, error-proneness. The best architecture that nobody can use correctly is the worst architecture.",
  "Prioritize empirical evidence: cite specific benchmarks, case studies, production incidents, or measured data. Reject claims without evidence.",
];

/**
 * Build R1 messages for shared_convergence (independent analysis).
 * Each worker gets a different analysis lens (DMAD-inspired diversity).
 */
export function buildSharedConvergenceR1(
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
  workerIndex?: number,
): ChatMessage[] {
  const system = SHARED_CONVERGENCE_SYSTEM;

  const userParts: string[] = [];

  if (instructions) userParts.push(`<host-instructions>${instructions}</host-instructions>`);

  // Assign diversity lens per worker (DMAD: diverse reasoning methods prevent mental set)
  if (workerIndex != null && roundInfo && roundInfo.max > 1) {
    const lens = DIVERSITY_LENSES[workerIndex % DIVERSITY_LENSES.length]!;
    userParts.push(`<analysis-lens>${lens}</analysis-lens>`);
  }

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
  workerIndex?: number,
): ChatMessage[] {
  const system = SHARED_CONVERGENCE_SYSTEM;

  const userParts: string[] = [];

  // Reference data (long content) at top — Lost-in-the-Middle: push to start
  if (otherResponses.length > 0) {
    const others = formatOtherPositions(otherResponses);
    if (others) userParts.push(`<other-positions>\n${others}\n</other-positions>`);
  }

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

  // Instructions and constraints at bottom — close to task for recall
  if (instructions) userParts.push(`<host-instructions>${instructions}</host-instructions>`);

  // Restore R1 diversity lens in R2+ (prevents lens loss across rounds)
  if (workerIndex != null && roundInfo && roundInfo.max > 1) {
    const lens = DIVERSITY_LENSES[workerIndex % DIVERSITY_LENSES.length]!;
    userParts.push(`<analysis-lens>${lens}</analysis-lens>`);
  }

  userParts.push(`<constraints>\n${ANTI_CONFORMITY}\n</constraints>`);
  userParts.push(CONFIDENCE_AND_UNCERTAINTY);

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
  workerIndex?: number,
): ChatMessage {
  const parts: string[] = [];

  // Reference data at top
  if (otherResponses.length > 0) {
    const others = formatOtherPositions(otherResponses);
    if (others) parts.push(`<other-positions>\n${others}\n</other-positions>`);
  }

  // Instructions and constraints at bottom
  if (instructions) parts.push(`<host-instructions>${instructions}</host-instructions>`);

  // Restore R1 diversity lens
  if (workerIndex != null && roundInfo && roundInfo.max > 1) {
    const lens = DIVERSITY_LENSES[workerIndex % DIVERSITY_LENSES.length]!;
    parts.push(`<analysis-lens>${lens}</analysis-lens>`);
  }

  parts.push(`<constraints>\n${ANTI_CONFORMITY}\n</constraints>`);
  parts.push(CONFIDENCE_AND_UNCERTAINTY);

  if (roundInfo && roundInfo.current === roundInfo.max && roundInfo.max > 1) {
    parts.push("This is the final round. Commit to your strongest position.");
  }

  parts.push(`<task>${ctx.task}</task>`);
  return { role: "user", content: parts.join("\n\n") };
}

// -- 2. Adversarial Debate --

const ADVERSARIAL_SYSTEM = buildSystemPrompt(
  "Think deeply, present concisely. No preamble — lead with your position. You are seeing other analysts' positions. Your goal is to find weaknesses.",
  DEPTH_EXPLORE,
);

// Adversarial stance lenses removed: heterogeneous models already provide
// perspective diversity. Assigning per-worker stances conflated two variables
// (model difference × question difference), and frame-rejecting lenses (3 of 7)
// produced outputs the synthesis/acceptance pipeline could not handle.
// Adversarial dynamics come from R2+ challenge structure + ANTI_CONFORMITY_ADVERSARIAL.

/**
 * Build R1 for adversarial_debate.
 * All workers receive the same prompt — diversity comes from heterogeneous models.
 */
export function buildAdversarialDebateR1(
  ctx: SharedContext,
  instructions?: string,
  _roundInfo?: RoundInfo,
  _workerIndex?: number,
): ChatMessage[] {
  const system = ADVERSARIAL_SYSTEM;

  const userParts: string[] = [];
  if (instructions) userParts.push(`<host-instructions>${instructions}</host-instructions>`);

  userParts.push(CONFIDENCE_AND_UNCERTAINTY);
  userParts.push(`<task>${ctx.task}</task>`);

  return [
    { role: "system", content: system },
    { role: "user", content: userParts.join("\n\n") },
  ];
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
  _workerIndex?: number,
): ChatMessage[] {
  const system = ADVERSARIAL_SYSTEM;

  const userParts: string[] = [];

  // Reference data at top
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

  // Instructions and constraints at bottom
  if (instructions) userParts.push(`<host-instructions>${instructions}</host-instructions>`);

  userParts.push(`<constraints>\n${ANTI_CONFORMITY_ADVERSARIAL}\n</constraints>`);
  userParts.push(CONFIDENCE_AND_UNCERTAINTY);

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
  _roundInfo?: RoundInfo,
  _workerIndex?: number,
): ChatMessage {
  const parts: string[] = [];

  // Reference data at top
  if (otherResponses.length > 0) {
    const others = formatOtherPositions(otherResponses);
    if (others) parts.push(`<positions-to-challenge>\n${others}\n</positions-to-challenge>`);
  }

  // Instructions and constraints at bottom
  if (instructions) parts.push(`<host-instructions>${instructions}</host-instructions>`);

  parts.push(`<constraints>\n${ANTI_CONFORMITY_ADVERSARIAL}\n</constraints>`);
  parts.push(CONFIDENCE_AND_UNCERTAINTY);

  parts.push(`<task>${ctx.task}</task>`);
  return { role: "user", content: parts.join("\n\n") };
}

// -- 3. Host Interrogation --

const HOST_INTERROGATION_SYSTEM = buildSystemPrompt(
  "Answer the question directly and thoroughly. No preamble.",
  DEPTH_EXPLORE,
) + `\n\nIf the question challenges your previous answer, address the challenge with evidence — do not simply reaffirm.

<constraints>
Answer only what is asked. Do not volunteer unrelated analysis.
If the question contains a false premise, identify it before answering.
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

const SEQUENTIAL_REFINEMENT_SYSTEM = buildSystemPrompt(
  "Improve the given work. Preserve what works, fix what doesn't, add what's missing. No preamble — lead with the improved version.",
  DEPTH_REFINE,
) + `\n\n<constraints>
Do not rewrite from scratch. Build on the previous version.
For every change, state what was wrong and why your version is better.
If the previous version is already correct in an area, leave it unchanged.
Your output must be at least as complete as the previous version. Do not remove content, detail, or explanations unless they are factually wrong. Shortening is not improving.
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

const EVALUATION_SCORING_SYSTEM = buildSystemPrompt(
  "Evaluate independently. No preamble — lead with your analysis.",
) + `\n\n<constraints>
Evaluate the subject against the provided criteria. Do not invent additional criteria.
For each criterion, provide your own analysis and reasoning about the subject.
Do not consider how other evaluators might score. Judge independently.
</constraints>

<output-format>
1. Analyze each criterion with your reasoning.
2. For each major claim, indicate your confidence (e.g., **HIGH**, [MEDIUM], confidence: LOW).
3. Write your verdict (one sentence overall judgment).
4. Based on your verdict, assign a score.

End with exactly this format:
verdict: [one sentence — must be consistent with your analysis above]
score: [overall 1-10 — must match the severity described in your verdict]

Score anchors: 1-2 = fundamentally flawed/broken, 3-4 = significant issues, 5-6 = acceptable with notable issues, 7-8 = good with minor issues, 9-10 = excellent/exceptional.
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

const RED_TEAM_GENERATOR_SYSTEM = buildSystemPrompt(
  "Produce the requested output. No preamble.",
) + `\n\nThink through edge cases, failure modes, and adversarial inputs.
Anticipate how your output could be attacked or misused.

<constraints>
Produce the strongest version you can.
If you are aware of a weakness, address it proactively.
</constraints>`;

const RED_TEAM_ATTACKER_SYSTEM = buildSystemPrompt(
  "Find vulnerabilities in the given output. No preamble — lead with the most critical finding.",
) + `\n\n<constraints>
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
  const system = `<role>You are reviewing whether this synthesis accurately represents your position and is factually grounded.</role>

<instructions>
1. Check if your position is accurately represented — not distorted, softened, or exaggerated.
2. Check if critical issues from your position are addressed — not ignored.
3. Check if factual claims in the synthesis are grounded — reject claims presented as facts without evidence or verification. Code/architecture claims must match actual code. External claims (benchmarks, statistics) must cite sources or be labeled uncertain.
</instructions>

<output-format>
Respond with ONLY the following XML structure:
<acceptance>
  <verdict>accept, partial, or reject</verdict>
  <misrepresented>What was distorted. "None." if accept.</misrepresented>
  <unresolved>Critical issues ignored OR ungrounded factual claims. "None." if accept.</unresolved>
</acceptance>
</output-format>`;

  const user = `## Your Original Position\n${originalPosition}\n\n## Synthesis\n${synthesis}\n\n## Task\n${task}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

