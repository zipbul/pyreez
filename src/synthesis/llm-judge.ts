/**
 * LLM-backed JudgeFn for PairRanker.
 *
 * Asks an LLM to compare two candidates against a task. Returns "A" or "B" or "TIE".
 * Position bias mitigation (LLM-as-Judge research, NeurIPS 2023): swap A/B and run twice;
 * only count a winner when both orderings agree.
 */

import type { Candidate, JudgeFn } from "./pairranker";
import type { ChatMessage } from "../llm/types";

export interface ChatFn {
  (model: string, messages: ChatMessage[]): Promise<{ content: string }>;
}

const JUDGE_SYSTEM = `You are evaluating which of two candidate responses better addresses the user's task.
Reply with exactly one word on the last line: A, B, or TIE.
Use "TIE" only when neither candidate is meaningfully better than the other.
Do not be lenient — pick the stronger candidate when one is clearly better.`;

function buildJudgeMessages(task: string, a: Candidate, b: Candidate): ChatMessage[] {
  return [
    { role: "system", content: JUDGE_SYSTEM },
    {
      role: "user",
      content: `<task>${task}</task>

<candidate-a>
${a.content}
</candidate-a>

<candidate-b>
${b.content}
</candidate-b>

Which candidate better addresses the task? Reply with exactly: A, B, or TIE.`,
    },
  ];
}

function parseVerdict(text: string): "A" | "B" | "TIE" {
  // Look at the last non-empty line
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  const last = (lines[lines.length - 1] ?? "").trim().toUpperCase();
  if (last === "A" || last.startsWith("A ") || last.endsWith(" A")) return "A";
  if (last === "B" || last.startsWith("B ") || last.endsWith(" B")) return "B";
  if (last.includes("TIE")) return "TIE";
  // Fall back: scan whole text for last A/B mention
  const matches = text.toUpperCase().match(/\b(A|B|TIE)\b/g) ?? [];
  const candidate = matches[matches.length - 1];
  if (candidate === "A" || candidate === "B" || candidate === "TIE") return candidate;
  return "TIE";
}

export interface LLMJudgeOptions {
  /**
   * Position-bias mitigation strategy.
   * - "eager" (default, research-recommended): always run forward + swap pass.
   *   2N calls. Position bias in LLM judges is systematic, not random — see
   *   "Judging the Judges: A Systematic Investigation of Position Bias in
   *   Pairwise Comparative Assessments by LLMs" (Lin Shi et al., Dartmouth).
   *   Swap pass is the standard mitigation.
   * - "lazy": run forward only; swap only when forward verdict is TIE. ~N–2N calls.
   *   COST OPTIMIZATION ONLY — pyreez extension, no research backing. Trades
   *   accuracy for cost. Use when budget is tight and verdicts are expected
   *   decisive. Verdicts that look A/B but are position-bias artifacts will
   *   slip through unchallenged. Do NOT use for high-stakes ranking.
   */
  positionBias?: "eager" | "lazy";
}

/**
 * Create a JudgeFn that uses an LLM to compare candidates.
 * Default position-bias mitigation: judge A vs B AND B vs A; only declare a
 * winner when both orderings agree, else TIE. Doubles cost but halves
 * position-bias error (NeurIPS 2023 LLM-as-Judge research).
 *
 * Pass `{ positionBias: "lazy" }` to skip the swap pass when forward verdict
 * is already A or B; cuts cost ~50% when judges are decisive.
 */
export function createLLMJudge(
  model: string,
  chat: ChatFn,
  options?: LLMJudgeOptions,
): JudgeFn {
  const lazy = options?.positionBias === "lazy";
  return async (task, a, b) => {
    if (lazy) {
      const forward = await chat(model, buildJudgeMessages(task, a, b))
        .then((r) => parseVerdict(r.content));
      if (forward === "A" || forward === "B") return forward;
      // TIE — confirm with swap
      const swapped = await chat(model, buildJudgeMessages(task, b, a))
        .then((r) => parseVerdict(r.content));
      if (swapped === "A") return "B";
      if (swapped === "B") return "A";
      return "TIE";
    }
    const [forward, swapped] = await Promise.all([
      chat(model, buildJudgeMessages(task, a, b)).then((r) => parseVerdict(r.content)),
      chat(model, buildJudgeMessages(task, b, a)).then((r) => parseVerdict(r.content)),
    ]);
    if (forward === "A" && swapped === "B") return "A";
    if (forward === "B" && swapped === "A") return "B";
    return "TIE";
  };
}
