/**
 * Panel rubric — judge 1명이 런의 전 워커 답을 한 콜에 채점(런당 judge 3콜 고정, 2n 아님).
 * 답은 익명 라벨(A, B, C, ...)로 제시된다 — 판사는 어느 모델이 어느 답인지 모른다.
 */

import type { ChatMessage } from "../../llm/types";
import type { JudgeVerdict } from "./interfaces";

const PANEL_SYSTEM = `You are one of several independent judges scoring answers to the same task.
IGNORE length, formatting, style, and verbosity — a terse correct answer must outscore a verbose
wrong one. Score each answer on each axis independently, 1 to 100 (100 = excellent, 1 = very poor).
Output ONLY a JSON object mapping each answer's label to {axis: score}, e.g.
{"A": {"accuracy": 82, "depth": 70}, "B": {"accuracy": 55, "depth": 60}}. No prose, no code fence.`;

function labelOf(i: number): string {
  return String.fromCharCode(65 + i); // A, B, C, ...
}

/** 판정 대상 답을 라벨링된 순서(호출자가 이미 셔플한 순서)로 제시하는 메시지를 구성한다. */
export function buildPanelMessages(
  task: string,
  axes: readonly string[],
  contents: readonly string[],
): ChatMessage[] {
  const answers = contents
    .map((content, i) => `<answer label="${labelOf(i)}">\n${content}\n</answer>`)
    .join("\n\n");
  return [
    { role: "system", content: PANEL_SYSTEM },
    {
      role: "user",
      content: `<task>${task}</task>\n\n<axes>${axes.join(", ")}</axes>\n\n${answers}\n\nScore every answer on every axis. Output only the JSON object.`,
    },
  ];
}

function extractJsonObject(text: string): Record<string, unknown> | undefined {
  // first {...last} — the verdict object nests one level (label -> {axis: score}), so unlike
  // rubric-judge's flat-object extractor, the START must be the FIRST brace, not the last one
  // (lastIndexOf("{") would land on the last label's inner object and truncate everything before it).
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return undefined;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 라벨별로 축 점수를 뽑는다. 라벨이 없거나, 값이 객체가 아니거나, 유한수 축이 하나도 없으면
 * 그 위치는 undefined(파싱 실패로 취급 — 상위 panel.ts가 쿼럼 계산에 무효표로 반영한다).
 */
export function parsePanelVerdict(
  text: string,
  axes: readonly string[],
  count: number,
): (JudgeVerdict | undefined)[] {
  const obj = extractJsonObject(text);
  const out: (JudgeVerdict | undefined)[] = [];
  for (let i = 0; i < count; i++) {
    const raw = obj?.[labelOf(i)];
    if (!raw || typeof raw !== "object") {
      out.push(undefined);
      continue;
    }
    const rawScores = raw as Record<string, unknown>;
    const scores: Record<string, number> = {};
    for (const axis of axes) {
      const v = rawScores[axis];
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) scores[axis] = Math.max(1, Math.min(100, Math.round(n)));
    }
    out.push(Object.keys(scores).length > 0 ? { position: i, scores } : undefined);
  }
  return out;
}
