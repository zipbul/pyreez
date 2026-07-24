/**
 * Domain/subtopic normalization — 고정 15종 taxonomy 강제 + kebab-case 하위주제 강제.
 * 자유 라벨을 그대로 저장하면 "pharmacology"/"약리"처럼 파편화된다(v5 §0) — 여기서 억제한다.
 */

import { DOMAIN_TAXONOMY } from "./constants";

/** LLM이 고른 도메인이 고정 15종 중 하나가 아니면 "general"로 강제한다. */
export function normalizeDomain(raw: string): string {
  const candidate = raw.trim().toLowerCase();
  return DOMAIN_TAXONOMY.includes(candidate) ? candidate : "general";
}

/** 영어 소문자 kebab-case로 강제한다. 정규화 후 빈 문자열이면 하위주제 없음(undefined)으로 취급한다. */
export function normalizeSubtopic(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const kebab = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return kebab.length > 0 ? kebab : undefined;
}
