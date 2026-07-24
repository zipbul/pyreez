/**
 * Rubric judge — score one worker response on a topic's capability axes (1-100 each) in a single call.
 *
 * The affinity store needs a per-model, per-axis measured signal each run. A pairwise ranker gives only
 * an overall ordinal; instead we ask a fixed neutral judge to rate a response against the topic's OWN
 * axes (topic-specific, supplied by the caller) and emit one score per axis. One call per response
 * (O(n)), offline — never on the deliberation hot path.
 */

import type { ChatMessage } from "../llm/types";

const RUBRIC_SYSTEM = `You are a strict evaluator. Score the response on each named axis from 1 to 100
(100 = excellent on that axis, 1 = very poor). Judge each axis independently on its own merit.
Output ONLY a JSON object mapping each axis name to its integer score, e.g. {"정확성": 82, "창의력": 60}.
No prose, no code fence — just the JSON object on the last line.`;

/** Build the judge messages: the task, the axes to score, and the response under evaluation. */
export function buildRubricMessages(task: string, axes: readonly string[], response: string): ChatMessage[] {
  return [
    { role: "system", content: RUBRIC_SYSTEM },
    {
      role: "user",
      content: `<task>${task}</task>

<axes>${axes.join(", ")}</axes>

<response>
${response}
</response>

Score the response on each axis (1-100). Output only the JSON object.`,
    },
  ];
}

/**
 * Parse the judge's JSON into {axis: score}, keeping only requested axes and clamping to 1-100.
 * Missing/unparseable axes are omitted (the log records only what was actually scored).
 */
export function parseRubricScores(text: string, axes: readonly string[]): Record<string, number> {
  const obj = extractJsonObject(text);
  if (!obj) return {};
  const out: Record<string, number> = {};
  for (const axis of axes) {
    const raw = obj[axis];
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) continue;
    out[axis] = Math.max(1, Math.min(100, Math.round(n)));
  }
  return out;
}

function extractJsonObject(text: string): Record<string, unknown> | undefined {
  // last {...} block, tolerant of surrounding prose / code fences
  const start = text.lastIndexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return undefined;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export type RubricChatFn = (model: string, messages: ChatMessage[]) => Promise<{ content: string }>;

/** Score one response on the given axes using a fixed judge model. Returns {} on judge failure. */
export async function scoreResponse(
  chat: RubricChatFn,
  judgeModel: string,
  task: string,
  axes: readonly string[],
  response: string,
): Promise<Record<string, number>> {
  if (axes.length === 0) return {};
  try {
    const r = await chat(judgeModel, buildRubricMessages(task, axes, response));
    return parseRubricScores(r.content, axes);
  } catch {
    return {};
  }
}
