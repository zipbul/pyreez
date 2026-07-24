/**
 * Scoring 모듈 공개 API — wire.ts가 소비한다. 내부 구현(taxonomy, classify, rubric, panel, log)은
 * 배럴에서 노출하지 않는다.
 */

export { ScoringSkipReason } from "./enums";
export type { JudgeVerdict, RunScoringRecord, ScoringDeps, WorkerScoringRecord } from "./interfaces";
export type { ScoringChatFn } from "./types";
export {
  CLASSIFIER_MODEL,
  CONTENT_AXES,
  DOMAIN_TAXONOMY,
  JUDGE_PANEL,
  RATINGS_LOG_PATH,
  RATINGS_PATH,
} from "./constants";
export { scoreDeliberation } from "./hook";
/** classifyTopic — auto-team(P4)이 --topic 부재 시의 사전 분류 1콜에 재사용한다. */
export { classifyTopic } from "./classify";
