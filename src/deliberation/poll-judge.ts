/**
 * PoLL Judge — Panel of LLM Judges for quality evaluation.
 *
 * Implements PoLL (Verga 2024, EMNLP): 3-model cross-family panel scoring
 * with median aggregation and pairwise comparison generation.
 *
 * Key design decisions:
 * - Cross-family: judges must be from different providers than team models
 * - Temperature 0: deterministic scoring to avoid "Rating Roulette" (EMNLP 2025)
 * - Median aggregation: robust to single-judge outliers
 * - Graceful degradation: skip PoLL when < 2 judges available
 */

import type { ChatMessage } from "../llm/types";
import type { ModelInfo } from "../model/types";
import type { WorkerResponse } from "./types";

// -- Public types --

export interface PollJudgeConfig {
  readonly chatFn: (model: string, messages: ChatMessage[]) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;
  readonly getAvailableModels: () => ModelInfo[];
}

export interface PollScore {
  readonly model: string;
  readonly score: number;
}

export interface PollPairwiseResult {
  readonly modelAId: string;
  readonly modelBId: string;
  readonly outcome: "A>>B" | "A>B" | "A=B" | "B>A" | "B>>A";
  readonly dimension: "JUDGMENT";
}

export interface PollResult {
  readonly workerScores: readonly PollScore[];
  readonly pairwise: readonly PollPairwiseResult[];
  readonly judgeModels: readonly string[];
}

// -- Constants --

const MIN_JUDGES = 2;
const MAX_JUDGES = 3;

// -- Prompt --

function buildPollPrompt(task: string, responses: readonly WorkerResponse[]): string {
  const responsesXml = responses
    .map((r, i) => `<response id="${i}">\n${r.content}\n</response>`)
    .join("\n");

  return `<role>You are a strict, objective evaluator scoring LLM responses on a task.</role>

<task>
${task}
</task>

<responses>
${responsesXml}
</responses>

<rubric>
Score EACH response on three criteria (0-10 integer each):
1. **Relevance** — directly addresses the task requirements
2. **Accuracy** — claims are factually correct and logically sound
3. **Completeness** — covers key aspects without major gaps

Average the three criteria to produce a **final score** per response, rounded to nearest integer.
</rubric>

<rules>
- Evaluate each response INDEPENDENTLY — do not compare them to each other.
- Use the FULL 0-10 range. Reserve 9-10 for exceptional responses only.
- When uncertain about factual accuracy, score conservatively.
- Do not penalize concise responses if they cover key aspects.
</rules>

<output-format>
Respond ONLY with a JSON array. One object per response, in order:
[{"id": 0, "relevance": N, "accuracy": N, "completeness": N, "score": N}, ...]
</output-format>`;
}

// -- Judge Selection --

/**
 * Select judge models: exclude team models and same-provider models (cross-family).
 * Sort by cost (cheapest first) and take up to MAX_JUDGES.
 */
export function selectJudges(
  available: readonly ModelInfo[],
  teamModelIds: ReadonlySet<string>,
): ModelInfo[] {
  // Extract providers used by the team
  const teamProviders = new Set<string>();
  for (const id of teamModelIds) {
    const provider = id.split("/")[0];
    if (provider) teamProviders.add(provider);
  }

  // Filter: not in team, not same provider (cross-family)
  const candidates = available.filter((m) => {
    if (teamModelIds.has(m.id)) return false;
    const provider = m.id.split("/")[0];
    if (provider && teamProviders.has(provider)) return false;
    return true;
  });

  // Sort by cost (cheapest first)
  candidates.sort((a, b) => {
    const costA = a.cost.inputPer1M + a.cost.outputPer1M;
    const costB = b.cost.inputPer1M + b.cost.outputPer1M;
    return costA - costB;
  });

  return candidates.slice(0, MAX_JUDGES);
}

// -- JSON Parsing --

interface JudgeScore {
  id: number;
  score: number;
}

function parseJudgeResponse(content: string, expectedCount: number): JudgeScore[] | null {
  try {
    // Try to extract JSON array from response
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as unknown[];
    if (!Array.isArray(parsed)) return null;

    const scores: JudgeScore[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) return null;
      const obj = item as Record<string, unknown>;
      if (typeof obj.id !== "number" || typeof obj.score !== "number") return null;
      if (obj.score < 0 || obj.score > 10) return null;
      scores.push({ id: obj.id, score: Math.round(obj.score) });
    }

    if (scores.length !== expectedCount) return null;
    return scores;
  } catch {
    return null;
  }
}

// -- Aggregation --

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

// -- Pairwise Generation --

function generatePairwise(
  scores: readonly PollScore[],
): PollPairwiseResult[] {
  const results: PollPairwiseResult[] = [];

  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      const a = scores[i]!;
      const b = scores[j]!;
      const diff = a.score - b.score;

      if (Math.abs(diff) < 1) continue; // tie — no signal

      let outcome: PollPairwiseResult["outcome"];
      if (diff >= 3) outcome = "A>>B";
      else if (diff >= 1) outcome = "A>B";
      else if (diff <= -3) outcome = "B>>A";
      else outcome = "B>A";

      results.push({
        modelAId: a.model,
        modelBId: b.model,
        outcome,
        dimension: "JUDGMENT",
      });
    }
  }

  return results;
}

// -- Main Entry Point --

const EMPTY_RESULT: PollResult = {
  workerScores: [],
  pairwise: [],
  judgeModels: [],
};

/**
 * Evaluate worker responses using a PoLL (Panel of LLM Judges).
 *
 * Algorithm:
 * 1. Select cross-family judges (exclude team providers)
 * 2. If < 2 judges available, return empty (graceful skip)
 * 3. Call all judges in parallel (Promise.allSettled)
 * 4. Parse and validate scores, discard failures
 * 5. Aggregate via median per worker
 * 6. Generate pairwise comparisons from score differences
 */
export async function evaluateWithPoll(
  task: string,
  workerResponses: readonly WorkerResponse[],
  teamModelIds: ReadonlySet<string>,
  config: PollJudgeConfig,
): Promise<PollResult> {
  if (workerResponses.length < 2) return EMPTY_RESULT;

  // 1. Select judges
  const judges = selectJudges(config.getAvailableModels(), teamModelIds);
  if (judges.length < MIN_JUDGES) return EMPTY_RESULT;

  // 2. Build prompt
  const prompt = buildPollPrompt(task, workerResponses);
  const messages: ChatMessage[] = [{ role: "user", content: prompt }];

  // 3. Call judges in parallel
  const judgeResults = await Promise.allSettled(
    judges.map((j) => config.chatFn(j.id, messages)),
  );

  // 4. Parse responses
  const allJudgeScores: { judgeModel: string; scores: JudgeScore[] }[] = [];
  for (let i = 0; i < judgeResults.length; i++) {
    const result = judgeResults[i]!;
    if (result.status !== "fulfilled") continue;

    const parsed = parseJudgeResponse(result.value.content, workerResponses.length);
    if (!parsed) continue;

    allJudgeScores.push({ judgeModel: judges[i]!.id, scores: parsed });
  }

  // Need at least 1 successful judge
  if (allJudgeScores.length === 0) return EMPTY_RESULT;

  // 5. Median aggregation per worker
  const workerScores: PollScore[] = [];
  for (let w = 0; w < workerResponses.length; w++) {
    const scoresForWorker = allJudgeScores
      .map((j) => j.scores.find((s) => s.id === w)?.score)
      .filter((s): s is number => s != null);

    workerScores.push({
      model: workerResponses[w]!.model,
      score: median(scoresForWorker),
    });
  }

  // 6. Generate pairwise
  const pairwise = generatePairwise(workerScores);

  return {
    workerScores,
    pairwise,
    judgeModels: allJudgeScores.map((j) => j.judgeModel),
  };
}
