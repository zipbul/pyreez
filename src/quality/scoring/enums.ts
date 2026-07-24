/**
 * Scoring feature enums.
 */

/** 런/워커 채점이 스킵된 사유 — raw 로그에 남겨 진단한다. */
export enum ScoringSkipReason {
  /** 유효 judge < 3 — 워커 단위. */
  Quorum = "quorum",
  /** ScoredProtocol 3종이 아니거나(eval은 옵트인 미충족) — 런 단위. */
  Protocol = "protocol",
  /** topicPathFromSegments가 거부한 세그먼트(빈 값·"|" 포함) — 런 단위. */
  InvalidTopic = "invalid_topic",
  /** 분류·판정 콜 자체가 던지거나 아무것도 파싱하지 못함. */
  JudgeFailure = "judge_failure",
}
