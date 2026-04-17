/**
 * LLM-judge-based convergence assessment.
 *
 * Text-distance heuristics (Levenshtein) miss semantic convergence: two LLM
 * responses can reach the same conclusion with very different wording. End-to-end
 * measurement showed the text-based conformity/diversity_low signals fail to
 * trigger even on obvious cases ("2+2=4?": 0.83 average pairwise distance).
 *
 * This module asks an LLM to read all R1 responses and classify them as:
 * - HIGH: all converge on the same core answer
 * - MODERATE: most converge, one or two outliers
 * - DIVERSE: meaningfully different positions across the board
 *
 * More accurate than text distance, but adds one LLM call per check.
 *
 * @module quality/convergence-judge
 */

import type { ChatMessage } from "../llm/types";

export interface ConvergenceCandidate {
  readonly id: string;
  readonly content: string;
}

export type ConvergenceLevel = "high" | "moderate" | "diverse" | "unknown" | "insufficient";

export interface ConvergenceResult {
  readonly level: ConvergenceLevel;
  readonly dissenterId?: string;
  readonly reasoning?: string;
}

export interface ChatFn {
  (model: string, messages: ChatMessage[]): Promise<{ content: string }>;
}

const SYSTEM = `You are assessing whether multiple analysts converged on the same answer to a task.
Read the task and each analyst's response. Judge whether their core conclusions agree, not whether their wording matches.

Output exactly this XML (the reasoning and dissenter tags are optional):
<reasoning>brief one-sentence justification</reasoning>
<convergence>HIGH</convergence>
<dissenter>analyst-id-of-the-outlier</dissenter>

Convergence levels:
- HIGH: all analysts reach the same core conclusion (wording differences ok)
- MODERATE: a clear majority agrees but at least one analyst disagrees on the core conclusion
- DIVERSE: analysts hold meaningfully different positions; no clear majority

Include <dissenter> only when level is MODERATE and you can name the single outlier. Use the analyst's id verbatim.`;

function buildMessages(task: string, candidates: readonly ConvergenceCandidate[]): ChatMessage[] {
  const blocks = candidates
    .map((c) => `<analyst id="${c.id}">\n${c.content}\n</analyst>`)
    .join("\n\n");
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `<task>${task}</task>\n\n${blocks}\n\nClassify the convergence level.`,
    },
  ];
}

function parseLevel(text: string): ConvergenceLevel {
  const m = text.match(/<convergence>\s*(HIGH|MODERATE|DIVERSE)\s*<\/convergence>/i);
  if (!m) return "unknown";
  const v = m[1]!.toUpperCase();
  if (v === "HIGH") return "high";
  if (v === "MODERATE") return "moderate";
  if (v === "DIVERSE") return "diverse";
  return "unknown";
}

function parseTag(text: string, tag: string): string | undefined {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m?.[1]?.trim() || undefined;
}

export async function judgeConvergence(
  model: string,
  chat: ChatFn,
  task: string,
  candidates: readonly ConvergenceCandidate[],
): Promise<ConvergenceResult> {
  if (candidates.length < 2) return { level: "insufficient" };

  const r = await chat(model, buildMessages(task, candidates));
  const level = parseLevel(r.content);
  const reasoning = parseTag(r.content, "reasoning");
  const dissenterRaw = parseTag(r.content, "dissenter");
  const dissenterId = dissenterRaw && candidates.some((c) => c.id === dissenterRaw)
    ? dissenterRaw
    : undefined;

  return {
    level,
    ...(dissenterId ? { dissenterId } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}
