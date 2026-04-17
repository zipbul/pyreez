/**
 * inspect — integrated post-deliberate inspection workflow.
 *
 * Reads a deliberate output and conditionally runs convergence-check, rank,
 * quality-check based on signal triggers. Aggregates host_actions per signal
 * so the host has a single report instead of orchestrating four CLI commands.
 *
 * Cost-discipline: each inspection sub-call is gated by a precondition.
 *
 * @module inspect
 */

import type { ChatMessage } from "../llm/types";
import type { ConvergenceLevel } from "../quality/convergence-judge";
import { judgeConvergence } from "../quality/convergence-judge";
import { rankByPairwise } from "../synthesis/pairranker";
import { createLLMJudge } from "../synthesis/llm-judge";
import { crossValidate } from "../quality/cross-validate";
import { createLLMCrossValidator } from "../quality/llm-cross-validator";
import { computeConvergenceScore, classifyStatus, type ConvergenceStatus } from "../quality/convergence-score";
import { computeEvidenceOverlap } from "../quality/evidence-overlap";

interface DeliberateLike {
  rounds?: readonly { number: number; responses?: readonly { model: string; content: string; confidence?: string }[] }[];
  warnings?: readonly string[];
  r1Diversity?: number | null;
}

export interface InspectInput {
  task: string;
  deliberate: DeliberateLike;
  judgeModel: string;
  chat: (model: string, messages: ChatMessage[]) => Promise<{ content: string }>;
  /** Set true when responses likely contain factual claims worth cross-validating. */
  factualLikely?: boolean;
}

export interface InspectResult {
  skipped?: boolean;
  convergence?: { level: ConvergenceLevel; dissenterId?: string; reasoning?: string };
  /** Aragora-style multi-component convergence score (synaptent/aragora CONVERGENCE.md). */
  convergenceScore?: {
    overall: number;
    status: ConvergenceStatus;
    components: { semantic: number; diversity: number; evidence: number; stability: number };
  };
  ranking?: readonly { id: string; wins: number; losses: number }[];
  qualityFindings?: readonly { id: string; unsupported: readonly string[]; contradicted: readonly string[] }[];
  host_actions: string[];
}

const RANK_MIN_WORKERS = 4;
const BORDERLINE_DIVERSITY_LO = 0.20;
const BORDERLINE_DIVERSITY_HI = 0.50;

export async function runInspection(input: InspectInput): Promise<InspectResult> {
  const r1 = input.deliberate.rounds?.[0];
  const responses = r1?.responses ?? [];
  if (responses.length === 0) {
    return { skipped: true, host_actions: ["No R1 responses to inspect."] };
  }

  const warnings = input.deliberate.warnings ?? [];
  const diversity = input.deliberate.r1Diversity ?? null;
  const actions: string[] = [];
  const result: InspectResult = { host_actions: actions };

  const candidates = responses.map((r) => ({ id: r.model, content: r.content }));

  // 1. Convergence check — when text-distance signals fired or diversity is borderline
  const conformitySuspected = warnings.some((w) => w.includes("r1_conformity_suspected"));
  const dissentSuspected = warnings.some((w) => w.includes("minority_dissent"));
  const diversityLow = warnings.some((w) => w.includes("r1_diversity_low"));
  const borderline = diversity !== null && diversity >= BORDERLINE_DIVERSITY_LO && diversity < BORDERLINE_DIVERSITY_HI;

  // Always run convergence-check via LLM judge.
  // Empirical measurement (7 tasks): text-distance r1Diversity ranges 0.737–0.853
  // even on math_obvious "2+2=4?" where semantic convergence is HIGH. Text-distance
  // signals (r1_conformity_suspected, r1_diversity_low, minority_dissent) are
  // dead in practice; only the LLM judge gives a reliable convergence read.
  result.convergence = await judgeConvergence(input.judgeModel, input.chat, input.task, candidates);

  // Multi-component convergence score (Aragora pattern).
  // semantic: from LLM judge level (HIGH=1.0, MODERATE=0.5, DIVERSE=0.0)
  // diversity: existing r1Diversity from text-distance (0=identical, 1=different)
  // evidence: jaccard of citation tokens across responses
  // stability: 1.0 for single-round (no prior to compare against)
  const semanticMap: Record<ConvergenceLevel, number> = {
    high: 1.0,
    moderate: 0.5,
    diverse: 0.0,
    unknown: 0.5,
    insufficient: 0.0,
  };
  const components = {
    semantic: semanticMap[result.convergence.level],
    diversity: diversity ?? 0.5,
    evidence: computeEvidenceOverlap(candidates.map((c) => c.content)),
    stability: 1.0, // single-round only — caller can extend for multi-round
  };
  const overall = computeConvergenceScore(components);
  const status = classifyStatus(overall, /* consecutive */ 1, /* needed */ 1);
  result.convergenceScore = { overall, status, components };
  actions.push(`convergence_score=${overall.toFixed(2)} status=${status}`);
  if (result.convergence.level === "high") {
    actions.push("convergence is HIGH — reframe task as failure-conditions question (HOST_QUESTIONING_DEPTH Rule 2) and re-run deliberate");
  } else if (result.convergence.level === "moderate" && result.convergence.dissenterId) {
    actions.push(`read ${result.convergence.dissenterId} response FIRST — convergence is moderate with named dissenter`);
  } else if (result.convergence.level === "moderate") {
    actions.push("convergence is MODERATE — review minority view before adopting majority");
  } else if (result.convergence.level === "diverse") {
    actions.push("convergence is DIVERSE — proceed to synthesis with full diversity");
  }
  // Suppress unused-variable warnings for dead signals (kept in code for documentation)
  void conformitySuspected; void dissentSuspected; void diversityLow; void borderline;

  // 2. Ranking — only worth the LLM cost for N≥4 workers. Use lazy position-bias
  // mitigation here: inspect runs as part of standard workflow, ~50% cost cut
  // when verdicts are decisive, with marginal accuracy loss on ties.
  if (responses.length >= RANK_MIN_WORKERS) {
    const judge = createLLMJudge(input.judgeModel, input.chat, { positionBias: "lazy" });
    const ranked = await rankByPairwise(input.task, candidates, judge);
    result.ranking = ranked.ranking;
    actions.push(`ranking computed — top response: ${ranked.ranking[0]?.id}, lowest: ${ranked.ranking[ranked.ranking.length - 1]?.id}`);
  }

  // 3. Quality check — opt-in via factualLikely
  if (input.factualLikely) {
    const validator = createLLMCrossValidator(input.judgeModel, input.chat);
    const findings = await crossValidate(candidates, validator);
    result.qualityFindings = findings.findings;
    const flagged = findings.findings.filter((f) => f.unsupported.length > 0 || f.contradicted.length > 0);
    if (flagged.length > 0) {
      actions.push(`quality issues found in ${flagged.length} response(s) — review unsupported/contradicted claims before including in synthesis`);
    }
  }

  // 4. Standing warnings → actions
  if (warnings.some((w) => w.includes("provider_diversity_low"))) {
    actions.push("provider_diversity_low — note in confidence assessment; re-run with 2+ providers if available");
  }

  if (actions.length === 0) {
    actions.push("no signal-triggered actions — proceed to Phase 1 synthesis");
  }

  return result;
}
