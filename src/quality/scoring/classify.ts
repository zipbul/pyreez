/**
 * Topic classification — 채점과 분리된 1콜. task를 고정 상위 도메인(15종) + kebab-case 하위주제로
 * 분류한다. 호스트가 --topic을 준 경우 이 콜 자체를 생략한다(비용 절감 + 호스트 의도 우선).
 */

import type { ChatMessage } from "../../llm/types";
import { CLASSIFIER_MODEL, DOMAIN_TAXONOMY } from "./constants";
import type { ScoringDeps } from "./interfaces";
import { normalizeDomain, normalizeSubtopic } from "./taxonomy";

const CLASSIFY_SYSTEM = `Classify the task into exactly one domain from this fixed list, plus an
optional English lowercase kebab-case subtopic. Output ONLY a JSON object:
{"domain": "...", "subtopic": "..."}. No prose, no code fence.
Domains: ${DOMAIN_TAXONOMY.join(", ")}`;

export function buildClassifyMessages(task: string): ChatMessage[] {
  return [
    { role: "system", content: CLASSIFY_SYSTEM },
    { role: "user", content: `<task>${task}</task>\n\nOutput only the JSON object.` },
  ];
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

/** 분류 응답을 [domain] 또는 [domain, subtopic] 세그먼트로 정규화한다. 파싱 실패는 ["general"]로 낙하한다. */
export function parseClassifyResult(text: string): string[] {
  const obj = extractJsonObject(text);
  const domain = normalizeDomain(typeof obj?.domain === "string" ? obj.domain : "");
  const subtopic = normalizeSubtopic(typeof obj?.subtopic === "string" ? obj.subtopic : undefined);
  return subtopic ? [domain, subtopic] : [domain];
}

/** 호스트가 --topic을 줬으면 콜 없이 그대로 쓰고, 아니면 분류 1콜을 수행한다. */
export async function classifyTopic(deps: ScoringDeps, task: string): Promise<string[]> {
  if (deps.hostTopicPath?.length) return [...deps.hostTopicPath];
  const r = await deps.chat(CLASSIFIER_MODEL, buildClassifyMessages(task), { webAccess: false });
  return parseClassifyResult(r.content);
}
