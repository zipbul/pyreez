/**
 * Ratings feature interfaces — (model, protocol, topic-path, axis) 셀 단위 점수 축적.
 * 설계: docs/plans/scoring-redesign-v5.md
 */

import type { ScoredProtocol } from "./enums";

/** Welford 누적 상태. 관측 1건 = 한 심의 런의 (3-judge 중앙값) 1개. */
export interface RatingCell {
  readonly mean: number;
  readonly n: number;
  /** Σ(x - mean)² — 표본분산은 m2/(n-1). */
  readonly m2: number;
}

/** 점수 셀의 좌표. topicPath는 저장 전 정규화된다 (backoff.normalizeTopicPath). */
export interface CellCoord {
  readonly model: string;
  readonly protocol: ScoredProtocol;
  /** 계층 주제 경로 (예: "medicine/diagnosis"). 정규화 후 비어있을 수 없고 '|'를 포함할 수 없다. */
  readonly topicPath: string;
  readonly axis: string;
}

/** `.pyreez/ratings.json`의 전체 형태. cells의 키는 cellKey() 산출물, 값은 리프 셀만. */
export interface RatingsFile {
  readonly v: 1;
  readonly updatedAt: number;
  readonly cells: Readonly<Record<string, RatingCell>>;
}

/** 정규 사후분포 — 톰슨 샘플링의 입력. */
export interface GaussianPosterior {
  readonly mean: number;
  readonly variance: number;
}

/** cellKey()가 만드는 저장 키를 4파트로 분해한 형태 — parseCellKey()의 반환 타입. */
export interface ParsedKey {
  readonly model: string;
  readonly protocol: string;
  readonly topicPath: string;
  readonly axis: string;
}
