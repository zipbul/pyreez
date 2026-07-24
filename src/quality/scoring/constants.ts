/**
 * Scoring feature constants.
 */

/** 공통 judge 패널 — provider당 1개 고정 모델. 자기배제 폐기(v5 §0), 3사 공통 저울로 채점한다. */
export const JUDGE_PANEL: readonly string[] = [
  "anthropic/sonnet",
  "openai/gpt-5.4-mini",
  "xai/grok-4.5",
];

/** 주제 분류 1콜을 맡는 고정 모델(패널과 분리된 역할 — 분류 불일치 문제를 분류자 1명으로 소멸시킨다). */
export const CLASSIFIER_MODEL = "anthropic/sonnet";

/** 판정 축 — 형식·길이 무시, 내용 3축만(v5 rubric 개정). */
export const CONTENT_AXES: readonly string[] = ["accuracy", "depth", "grounding"];

/** 고정 상위 도메인 taxonomy 15종(v5 부록 A) — 자유 라벨 파편화 억제. */
export const DOMAIN_TAXONOMY: readonly string[] = [
  "software",
  "medicine",
  "law",
  "mathematics",
  "natural-science",
  "engineering",
  "economics-finance",
  "history",
  "philosophy-ethics",
  "arts-literature",
  "social-science",
  "education",
  "business-strategy",
  "everyday-practical",
  "general",
];

export const RATINGS_PATH = ".pyreez/ratings.json";
export const RATINGS_LOG_PATH = ".pyreez/ratings-log.jsonl";
