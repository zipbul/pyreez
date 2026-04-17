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

/**
 * Create a JudgeFn that uses an LLM to compare candidates.
 * Position bias mitigation: judges A vs B and B vs A; only declares a winner
 * when both orderings agree. Doubles cost but reduces position-bias noise.
 */
export function createLLMJudge(model: string, chat: ChatFn): JudgeFn {
  return async (task, a, b) => {
    const [forward, swapped] = await Promise.all([
      chat(model, buildJudgeMessages(task, a, b)).then((r) => parseVerdict(r.content)),
      chat(model, buildJudgeMessages(task, b, a)).then((r) => parseVerdict(r.content)),
    ]);
    // forward: A means a wins. swapped: A means b wins (because b was passed first).
    if (forward === "A" && swapped === "B") return "A";
    if (forward === "B" && swapped === "A") return "B";
    return "TIE";
  };
}
