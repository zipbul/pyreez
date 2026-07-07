/**
 * Deliberation prompt builders.
 *
 * Each protocol exposes R1 / R2+ / FollowUp builders that return ChatMessage[]
 * (system + user). The engine passes the result verbatim to LLM providers.
 *
 * Interpolated values (task, instructions, ownPrevious, otherResponses) are
 * XML-escaped before being inserted between tags.
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

// Applies to all protocols.
const GLOBAL_DEPTH = `<grounding>
- Every factual claim must point to specific evidence: a benchmark, a versioned spec, a production incident, or a measurable signal.
- For speculative reasoning, state the chain explicitly so it can be checked.
- Reject a flawed premise outright — do not build on a broken foundation.
- Express uncertainty where it exists; never force confidence on an ambiguous point.
</grounding>

<completion-check>
Before submitting, verify every major claim carries both evidence and a confidence marker. Drop any claim that fails this check.
</completion-check>`;

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
 * Format other workers' responses in 3rd person, with reported confidence inline.
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

/**
 * Format peer positions for adversarial challenge with turn-local "Analyst A/B" labels.
 * Labels are local to this turn — the visible subset changes per round via sparse sharing, so
 * they are NOT stable across rounds; they only let a worker reference distinct peers in this turn.
 */
function formatChallengePositions(responses: readonly WorkerResponse[]): string {
  return responses
    .map((r, i) => {
      const label = `Analyst ${String.fromCharCode(65 + (i % 26))}`;
      const conf = r.confidence ? ` (their confidence: ${r.confidence.toUpperCase()})` : "";
      return `${label} argues${conf}:\n${escapeXmlContent(r.content)}`;
    })
    .join("\n\n");
}

/** Final-round consolidation signal for adversarial debate (no forced convergence). */
const ADVERSARIAL_CLOSING = `<closing>This is the final round. Consolidate into one severity-ordered list: keep the weaknesses that survived challenge and fold in any new ones. State each weakness once with its full fields. When a finding challenges or absorbs a peer's position, lead it with the target field naming that analyst and keep the challenge inside that finding's own steelman/weakness/evidence — do not add separate per-peer challenge, unresolved-disagreement, or summary sections. Keep an unresolved disagreement inside its finding rather than forcing consensus.</closing>`;

function isFinalRound(roundInfo?: RoundInfo): boolean {
  return roundInfo != null && roundInfo.current === roundInfo.max && roundInfo.max > 1;
}

// ============================================================
// Protocol-specific Builders
// ============================================================

// -- 1. Shared Convergence --

const SHARED_CONVERGENCE_SYSTEM = buildSystemPrompt(
  "Think deeply, present concisely. No preamble — lead with your position.",
  DEPTH_EXPLORE,
);

// -- R1 Diversity Lenses --

const DIVERSITY_LENSES = [
  "Prioritize practical constraints: cost, time, the skills and resources required, and the effort to move from the current situation. What looks good in principle but fails in practice?",
  "Prioritize long-term consequences: ongoing burden, limits that appear as scale or stakes grow, where the field is heading, and how hard the choice is to reverse. What decision will you regret in 2 years?",
  "Prioritize risk and failure modes: what can go wrong, what are the hidden assumptions, what happens under adversarial conditions? Steelman the weakest option.",
  "Prioritize the contrarian view: argue for the less obvious choice. What is everyone else missing? What evidence contradicts the popular opinion?",
  "Prioritize first principles: strip away convention and trend. What does the fundamental problem actually require? Rebuild the analysis from constraints alone.",
  "Prioritize human factors: ease of use, learning curve, cognitive load, how easily people make mistakes. The best solution nobody can use correctly is the worst solution.",
  "Prioritize empirical evidence: cite specific studies, documented cases, measured outcomes, or hard data. Reject claims without evidence.",
];

/**
 * Build R1 messages for shared_convergence (independent analysis).
 * Each worker gets a different analysis lens by workerIndex.
 */
export function buildSharedConvergenceR1(
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
  workerIndex?: number,
): ChatMessage[] {
  const system = SHARED_CONVERGENCE_SYSTEM;

  const userParts: string[] = [];

  if (instructions) userParts.push(`<host-instructions>${escapeXmlContent(instructions)}</host-instructions>`);

  // Assign one of the DIVERSITY_LENSES per worker (cycles by workerIndex).
  if (workerIndex != null && roundInfo && roundInfo.max > 1) {
    const lens = DIVERSITY_LENSES[workerIndex % DIVERSITY_LENSES.length]!;
    userParts.push(`<analysis-lens>${lens}</analysis-lens>`);
  }

  userParts.push(CONFIDENCE_AND_UNCERTAINTY);
  if (roundInfo && roundInfo.current === 1 && roundInfo.max > 1) {
    userParts.push("Explore broadly. Do not converge prematurely.");
  }
  userParts.push(`<task>${escapeXmlContent(ctx.task)}</task>`);

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

  // Reference data first, task last.
  if (otherResponses.length > 0) {
    const others = formatOtherPositions(otherResponses);
    if (others) userParts.push(`<other-positions>\n${others}\n</other-positions>`);
  }

  if (ownPrevious) {
    userParts.push(`<your-previous>${escapeXmlContent(ownPrevious.content)}</your-previous>`);
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
  if (instructions) userParts.push(`<host-instructions>${escapeXmlContent(instructions)}</host-instructions>`);

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

  userParts.push(`<task>${escapeXmlContent(ctx.task)}</task>`);

  return [
    { role: "system", content: system },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Build follow-up message for session continuation in shared_convergence.
 */
export function buildSharedConvergenceFollowUp(
  _ctx: SharedContext,
  otherResponses: readonly WorkerResponse[],
  _instructions?: string,
  roundInfo?: RoundInfo,
  workerIndex?: number,
): ChatMessage {
  // FollowUp runs in session-continuation mode (engine.ts callWithFallback).
  // The full R1 message[1] — host-instructions, CONFIDENCE anchor, <task> — is
  // already in history. We only emit deltas: new opposing positions, the
  // adversarial-style constraints for this round, the per-worker analysis
  // lens, and the final-round commit signal (none of which are in history).
  const parts: string[] = [];

  if (otherResponses.length > 0) {
    const others = formatOtherPositions(otherResponses);
    if (others) parts.push(`<other-positions>\n${others}\n</other-positions>`);
  }

  if (workerIndex != null && roundInfo && roundInfo.max > 1) {
    const lens = DIVERSITY_LENSES[workerIndex % DIVERSITY_LENSES.length]!;
    parts.push(`<analysis-lens>${lens}</analysis-lens>`);
  }

  parts.push(`<constraints>\n${ANTI_CONFORMITY}\n</constraints>`);

  if (roundInfo && roundInfo.current === roundInfo.max && roundInfo.max > 1) {
    parts.push("This is the final round. Commit to your strongest position.");
  }

  return { role: "user", content: parts.join("\n\n") };
}

// -- 2. Adversarial Debate --

// Standing reference (static). NOT built via buildSystemPrompt: adversarial does not use
// GLOBAL_DEPTH/DEPTH_EXPLORE — its evidence/confidence/output rules live here, once.
// Role, evidence-and-confidence, and output-format are all tool-agnostic and static. The prompt
// deliberately does NOT mention or branch on web access: whether a worker holds web tools is set by
// the harness wiring (request.webAccess → provider tool set), the single source of truth. The prompt
// states one discipline that is TRUE either way — "assert a specific only when you can confirm it" —
// so it can never desync from the wiring (claim a tool the worker lacks, or suppress one it has).
const ADVERSARIAL_ROLE = `<role>
You are one of several independent analysts stress-testing a proposal. Surface its strongest, evidence-backed weaknesses. Enumerate candidate failure modes and attack each. When a finding rests on a stated cause, check for a distinct mechanism one step beneath it: if that mechanism has a different fix or a different falsification test, surface it as its own finding rather than absorbing it as a subspecies. Drop a finding when any of these hold: (a) your own counter-attack defeats it; (b) it fires only under conditions the proposal rules out; (c) you cannot ground it in the proposal's content or a concrete failure mechanism.
</role>`;

// Tool-agnostic evidence-and-confidence discipline. ONE block for all workers, web-wired or not: the
// invariant "assert a specific only when you can confirm it" holds either way (a web worker confirms by
// running a check; a no-tool worker confirms by exact recall, else abstains). No tool is named, so the
// prompt never claims a capability the wiring didn't grant.
// NOTE: adversarial confidence uses a falsifier-decisiveness scale (HIGH = a cheap deterministic check
// settles it) INTENTIONALLY distinct from the shared CONFIDENCE_AND_UNCERTAINTY (evidence-strength) used by
// the other protocols. The labels (HIGH/MEDIUM/LOW) collide but the semantics differ — do not "dedupe" the
// two definitions. (Measured: the falsifier rubric is reliably judgeable, kappa 0.60.)
const ADVERSARIAL_EVIDENCE = `<evidence-and-confidence>
- Reason from the proposal's content or a concrete failure mechanism (mechanism → break → consequence). Assert a specific — a source, quoted string, number, or named identifier (command/flag/function/API/config-key and its default) — only when you can confirm it with the means available to you (certain recall, or verification if you have tools). If you cannot confirm it, do not assert it: describe it without naming, drop the quote, give an order-of-magnitude range instead of a figure, and mark it [unverified]. An operational number you estimated rather than confirmed (hours, %, throughput, counts) must carry [unverified] — never state it as measured fact.
- Put quotation marks only around text you can reproduce verbatim from a confirmed source; if you are giving the gist, paraphrase without quotes. A citation, URL, or "(verified)" beside a claim you did not actually confirm manufactures false authority — worse than none.
- Confidence: HIGH = a confirmed source or one cheap deterministic check decides it; a missing/ambiguous spec is not HIGH unless the failure it implies is itself deterministically checkable. MEDIUM = needs a benchmark/load test/other contingent evidence, or the reasoning has a gap, or it only bites under particular load/timing/config; LOW = speculative or [unverified]. Your reasoning chain is valid evidence but does not by itself earn HIGH. Never inflate.
- A flawed premise is itself a weakness — surface it with reasoning; never build on it or refuse.
- Before submitting, fix any finding whose own text undercuts its label, severity, or confidence.
</evidence-and-confidence>`;

const ADVERSARIAL_OUTPUT_FORMAT = `<output-format>
If <host-instructions> specifies an output format, follow it; otherwise use this. Order findings by severity, most critical first. When an <attack-angle> is present, follow it for which weaknesses to search and lead with, and order by severity within the scope it sets; a finding that challenges a peer (using target) may fall outside your current lens. Every finding MUST use the exact field labels below — no markdown headings, no free-form prose, no renamed, added, or omitted fields (target is the sole exception: include it only when your finding challenges or absorbs a specific peer). Your entire response is the findings then the single final line — no preamble, and never narrate your searching or consolidating (do that in your reasoning) before, between, or after findings. Per finding, in this field order:
- target (only when your finding challenges or absorbs a specific peer): the analyst, e.g. "Analyst B"
- steelman: strongest form of the position you attack (1-2 sentences)
- weakness: the scenario/condition under which it breaks (one paragraph)
- evidence: your reasoning chain, or an exact-recall citation (per the rules above)
- falsification: the cheapest concrete test that would change your mind
- verdict: <severity>, <confidence> — lowercase severity (critical | high | medium | low), uppercase confidence (HIGH | MEDIUM | LOW), nothing else; no backticks, quotes, or a repeated "verdict" label in the value. e.g. critical, HIGH
End with exactly one line — the single condition under which the proposal is acceptable, or, when it needs several fixes, "None — requires X, Y, Z" naming the missing pieces inline. Collapse multiple conditions into that one line; do not expand into a numbered list or multiple sentences.
</output-format>`;

/**
 * Adversarial system message. Tool-agnostic and static: it does not depend on web access — the worker's
 * tool set is wired by the harness, and the evidence discipline here is true with or without tools.
 */
function adversarialSystem(): string {
  return [
    ADVERSARIAL_ROLE,
    ADVERSARIAL_EVIDENCE,
    ADVERSARIAL_OUTPUT_FORMAT,
  ].join("\n\n");
}

// Drift-sensitive directives, re-injected into the user turn so late-round conformity pressure cannot
// erode them. Split by round: R1 has no peers/prior, so peer-relative lines (consensus, weighing others,
// not-restating) would be dead weight; they appear only from R2. Steelmanning lives in the output-format
// steelman field, not here.
const ADVERSARIAL_APPROACH_R1 = `<approach>
Do not soften your criticism.
</approach>`;

const ADVERSARIAL_APPROACH_PEER = `<approach>
- Do not soften criticism, and do not agree merely to reach consensus.
- Revise your prior position only when evidence in the record — including a peer's concrete evidence — falsifies it; never because another analyst sounded confident.
- Weigh others' evidence against their stated confidence: high confidence on weak evidence is a red flag; low confidence on strong evidence deserves attention.
- If a new substantive, falsifiable critique survives your counter-attack, add it. If none does, do not pad — instead engage the weakest peer finding head-on within a finding (its target/steelman/weakness) and give the test that would settle it.
</approach>`;

// Per-worker R1 attack-angle: each worker is steered toward a distinct
// weakness-search frame at R1, so the round opens with five different angles
// of critique instead of five copies of the same critique.
const ATTACK_ANGLES = [
  "Focus on hidden assumptions — what implicit premises must hold for this to work?",
  "Focus on evidence gaps — if an asserted premise is false, what concrete failure path follows?",
  "Focus on operational failure — under what real-world conditions does this break once deployed?",
  "Focus on second-order harm — when this works as intended, what new damage does it create (induced behavior, displaced risk, collateral harm to those it acts on)?",
  "Focus on incentive misalignment — whose interests does this serve vs whose does it harm?",
];

// R2+/FollowUp rotate to a new angle each round. In session-continuation the prior round's <attack-angle>
// stays in history, so the new one must announce that it SUPERSEDES it — otherwise the worker sees two
// lenses with no precedence and guesses which governs (surfaced by worker interrogation).
function rotatedAttackAngle(angle: string): string {
  return `<attack-angle>New lens for this round — it replaces the lens you led with earlier; do not keep leading from the old one. ${angle}</attack-angle>`;
}

// Final-round angle. The closing tells the worker to CONSOLIDATE all surviving findings, so a
// "re-lead from a new lens" framing (rotatedAttackAngle) would contradict it — the worker then obeys
// the closing and applies the lens only cosmetically, burying any genuinely new weakness the lens
// surfaces (observed via worker interrogation). Here the lens is a final search pass whose output is
// folded into the consolidated list by severity, which the closing governs — no contradiction.
function finalAttackAngle(angle: string): string {
  return `<attack-angle>Before consolidating, run one last search pass through this lens; fold anything new it surfaces into the consolidated list by severity. ${angle}</attack-angle>`;
}

/**
 * Build R1 for adversarial_debate.
 * Shared system + per-worker attack-angle: diversity comes from heterogeneous models AND a
 * distinct weakness-search frame per worker (workerIndex-keyed).
 */
export function buildAdversarialDebateR1(
  ctx: SharedContext,
  instructions?: string,
  _roundInfo?: RoundInfo,
  workerIndex?: number,
): ChatMessage[] {
  const system = adversarialSystem();

  const userParts: string[] = [];
  if (instructions) userParts.push(`<host-instructions>${escapeXmlContent(instructions)}</host-instructions>`);

  userParts.push(ADVERSARIAL_APPROACH_R1);

  if (workerIndex != null) {
    const angle = ATTACK_ANGLES[workerIndex % ATTACK_ANGLES.length]!;
    // Bind the lead finding to this angle: "most critical first" otherwise pulls every worker to the
    // same obvious top weakness, collapsing the per-worker diversity this angle exists to create.
    userParts.push(`<attack-angle>Stay within this assigned lens: lead with the strongest weakness it reveals, and avoid obvious/standard critiques any model would reach without this lens. ${angle}</attack-angle>`);
  }

  userParts.push(`<task>${escapeXmlContent(ctx.task)}</task>`);

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
  roundInfo?: RoundInfo,
  workerIndex?: number,
): ChatMessage[] {
  const system = adversarialSystem();

  const userParts: string[] = [];

  // Reference data at top
  if (otherResponses.length > 0) {
    const others = formatChallengePositions(otherResponses);
    if (others) userParts.push(`<positions-to-challenge>\n${others}\n</positions-to-challenge>`);
  }

  if (ownPrevious) {
    userParts.push(`<your-previous>${escapeXmlContent(ownPrevious.content)}</your-previous>`);
  } else if (ctx.rounds.length > 0) {
    // Cold join: full transcript with turn-local labels + confidence.
    const transcript = ctx.rounds.map((r) => {
      const workers = r.responses
        .map((resp, i) => {
          const label = `Analyst ${String.fromCharCode(65 + (i % 26))}`;
          const conf = resp.confidence ? ` (their confidence: ${resp.confidence.toUpperCase()})` : "";
          return `${label} argues${conf}:\n${escapeXmlContent(resp.content)}`;
        })
        .join("\n\n");
      return `### Round ${r.number}\n${workers}`;
    }).join("\n\n");
    userParts.push(`<debate-so-far>\n${transcript}\n</debate-so-far>`);
  }

  // A swapped (cold-rebuild) model lacks history, so re-send host-instructions here.
  if (instructions) userParts.push(`<host-instructions>${escapeXmlContent(instructions)}</host-instructions>`);

  userParts.push(ADVERSARIAL_APPROACH_PEER);

  if (workerIndex != null) {
    // Rotate the angle by round so each worker gets a DIFFERENT angle than it held in R1 (fresh
    // per-worker — NOT guaranteed distinct from a peer's angle, and collides past `len` workers).
    // Measured to break the R2 finding-set lock-in seen when R1 angles were re-injected unchanged.
    const shift = roundInfo?.current ? roundInfo.current - 1 : 0;
    const angle = ATTACK_ANGLES[(workerIndex + shift) % ATTACK_ANGLES.length]!;
    // On the final round the closing governs (consolidate); the lens becomes a search pass, not a re-lead.
    userParts.push(isFinalRound(roundInfo) ? finalAttackAngle(angle) : rotatedAttackAngle(angle));
  }

  if (isFinalRound(roundInfo)) userParts.push(ADVERSARIAL_CLOSING);

  userParts.push(`<task>${escapeXmlContent(ctx.task)}</task>`);

  return [
    { role: "system", content: system },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

/**
 * Build follow-up for adversarial_debate session continuation.
 */
export function buildAdversarialDebateFollowUp(
  _ctx: SharedContext,
  otherResponses: readonly WorkerResponse[],
  _instructions?: string,
  roundInfo?: RoundInfo,
  workerIndex?: number,
): ChatMessage {
  // Session-continuation mode. The system block (rules/output-format/confidence taxonomy) and the
  // R1 user turn (<host-instructions>, <task>) are already in history. Emit only deltas: new
  // positions, the re-injected drift-sensitive <approach>, the per-worker attack-angle, and the
  // final-round closing. Task is intentionally NOT re-anchored (consistent with shared_convergence
  // session-continuation) — it lives in history.
  const parts: string[] = [];

  if (otherResponses.length > 0) {
    const others = formatChallengePositions(otherResponses);
    if (others) parts.push(`<positions-to-challenge>\n${others}\n</positions-to-challenge>`);
  }

  parts.push(ADVERSARIAL_APPROACH_PEER);

  if (workerIndex != null) {
    // Rotate by round (same as R2): a different angle than R1 per-worker (not peer-collision-free).
    const shift = roundInfo?.current ? roundInfo.current - 1 : 0;
    const angle = ATTACK_ANGLES[(workerIndex + shift) % ATTACK_ANGLES.length]!;
    // On the final round the closing governs (consolidate); the lens becomes a search pass, not a re-lead.
    parts.push(isFinalRound(roundInfo) ? finalAttackAngle(angle) : rotatedAttackAngle(angle));
  }

  if (isFinalRound(roundInfo)) parts.push(ADVERSARIAL_CLOSING);

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
      `<question>${escapeXmlContent(ex.question)}</question>\n<your-answer>${escapeXmlContent(ex.answer)}</your-answer>`
    ).join("\n\n");
    userParts.push(`<previous-exchange>\n${exchanges}\n</previous-exchange>`);
  }

  userParts.push(`<question>${escapeXmlContent(question)}</question>`);
  userParts.push(`<context>${escapeXmlContent(task)}</context>`);

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
  if (instructions) userParts.push(`<host-instructions>${escapeXmlContent(instructions)}</host-instructions>`);
  userParts.push(`<previous-version>\n${escapeXmlContent(previousWorkerOutput)}\n</previous-version>`);
  userParts.push(`<task>${escapeXmlContent(ctx.task)}</task>`);

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
2. For each major claim, indicate your confidence as plain text (e.g., confidence: HIGH).
3. Disclose your scoring basis (not the verdict — that goes in the closing block): which criterion or criteria weighed most, and the rule turning your per-criterion assessments into the overall score (e.g. the worst criterion floors it, or strengths and weaknesses balance out). The rule is yours; state it, so a split score reflects genuine disagreement rather than a hidden weighting.
4. Close with the three-line block below. State the judgment sentence only in that block's judgment line, not earlier in the body.

End with exactly these three lines, as plain text with no markdown emphasis on the labels or values — they are read literally. The verdict is one of the five fixed tier words below so independent evaluations can be compared:
judgment: [one sentence — must be consistent with your analysis above]
verdict: [exactly one of: broken, significant-issues, acceptable, good, excellent — matching the score tier]
score: [overall 1-10 — must match the tier in your verdict]

Score anchors: 1-2 = broken (fundamentally flawed), 3-4 = significant-issues, 5-6 = acceptable (notable issues), 7-8 = good (minor issues), 9-10 = excellent.
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
  if (instructions) userParts.push(`<host-instructions>${escapeXmlContent(instructions)}</host-instructions>`);
  userParts.push(`<evaluation-criteria>\n${escapeXmlContent(criteria)}\n</evaluation-criteria>`);
  userParts.push(`<subject>\n${escapeXmlContent(subject)}\n</subject>`);
  userParts.push(`<task>${escapeXmlContent(task)}</task>`);

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
  if (instructions) userParts.push(`<host-instructions>${escapeXmlContent(instructions)}</host-instructions>`);
  if (previousAttackResults) {
    userParts.push(`<attack-results>\n${escapeXmlContent(previousAttackResults)}\n</attack-results>`);
  }
  userParts.push(`<task>${escapeXmlContent(task)}</task>`);

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
  if (instructions) userParts.push(`<host-instructions>${escapeXmlContent(instructions)}</host-instructions>`);
  const targets = targetOutputs.map((o) => `<target-output>\n${escapeXmlContent(o)}\n</target-output>`).join("\n\n");
  userParts.push(targets);
  userParts.push(`<task>${escapeXmlContent(task)}</task>`);

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

  // Markdown body: do NOT escape — synthesis/position may contain legitimate
  // code samples (`Array<T>`, comparisons, HTML) that must round-trip verbatim.
  const user = `## Your Original Position\n${originalPosition}\n\n## Synthesis\n${synthesis}\n\n## Task\n${task}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

