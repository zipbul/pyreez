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
import { extractProvider } from "../deliberation/provider-util";

interface DeliberateLike {
  rounds?: readonly { number: number; responses?: readonly { model: string; content: string; confidence?: string; workerIndex?: number }[] }[];
  warnings?: readonly string[];
  r1Diversity?: number | null;
}

/**
 * Compute round-over-round stability: 1 - avg pairwise Levenshtein change rate
 * between matching workers' responses in the last round vs the previous round.
 * Returns 1.0 if there's no prior round (single-round case = trivially stable).
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev: number[] = new Array(b.length + 1).fill(0).map((_, i) => i);
  let curr: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

function computeRoundStability(
  rounds: readonly { number: number; responses?: readonly { model: string; content: string; workerIndex?: number }[] }[],
): number {
  if (rounds.length < 2) return 1.0;
  const last = rounds[rounds.length - 1];
  const prev = rounds[rounds.length - 2];
  const lastR = last?.responses ?? [];
  const prevR = prev?.responses ?? [];
  if (lastR.length === 0 || prevR.length === 0) return 1.0;
  const prevMap = new Map<string, string>();
  for (const r of prevR) {
    const key = r.workerIndex != null ? `idx:${r.workerIndex}` : `model:${r.model}`;
    prevMap.set(key, r.content);
  }
  let sum = 0;
  let pairs = 0;
  for (const r of lastR) {
    const key = r.workerIndex != null ? `idx:${r.workerIndex}` : `model:${r.model}`;
    const prevContent = prevMap.get(key);
    if (prevContent === undefined) continue;
    const maxLen = Math.max(r.content.length, prevContent.length);
    if (maxLen === 0) continue;
    sum += levenshteinDistance(r.content, prevContent) / maxLen;
    pairs++;
  }
  if (pairs === 0) return 1.0;
  return 1 - sum / pairs;
}

export interface InspectInput {
  task: string;
  deliberate: DeliberateLike;
  judgeModel: string;
  chat: (model: string, messages: ChatMessage[]) => Promise<{ content: string }>;
  /** Set true when responses likely contain factual claims worth cross-validating. */
  factualLikely?: boolean;
  /** Skip the always-on convergence-judge call (saves 1 LLM call when caller knows it isn't needed). */
  skipConvergence?: boolean;
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

  // Convergence-check via LLM judge. Default on; opt-out via skipConvergence
  // for cost-sensitive runs where the caller knows convergence is irrelevant.
  // Text-distance signals are dead in practice (measured), so the LLM judge
  // is the only reliable convergence read.
  if (!input.skipConvergence) {
    result.convergence = await judgeConvergence(input.judgeModel, input.chat, input.task, candidates);

    // Multi-component convergence score (Aragora pattern).
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
      stability: computeRoundStability(input.deliberate.rounds ?? []),
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
  }
  // Suppress unused-variable warnings for dead signals (kept in code for documentation)
  void conformitySuspected; void dissentSuspected; void diversityLow; void borderline;

  // 2. Ranking — only worth the LLM cost for N≥4 workers. Use eager position-bias
  // mitigation: research consensus (Lin Shi et al., Dartmouth — "Judging the
  // Judges") is that position bias in LLM judges is systematic; swap pass is
  // standard mitigation. Lazy mode trades accuracy for cost with no research
  // backing, so we don't apply it to inspection runs by default.
  if (responses.length >= RANK_MIN_WORKERS) {
    const judge = createLLMJudge(input.judgeModel, input.chat);
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

  // 5. Self-judge bias check — judge same provider as any worker = self-eval risk.
  // Cross-provider judging reduces this bias (LLM-as-Judge research).
  const judgeProvider = extractProvider(input.judgeModel);
  const workerProviders = new Set(responses.map((r) => extractProvider(r.model)));
  if (workerProviders.has(judgeProvider)) {
    actions.push(`self_judge_bias: judge "${input.judgeModel}" shares provider "${judgeProvider}" with at least one worker — convergence and ranking verdicts may be biased toward same-provider models. Re-run with a cross-provider judge for a sanity check.`);
  }

  if (actions.length === 0) {
    actions.push("no signal-triggered actions — proceed to Phase 1 synthesis");
  }

  return result;
}
