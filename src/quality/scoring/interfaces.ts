/**
 * Scoring feature interfaces.
 */

import type { FileIO } from "../../report/types";
import type { ScoringSkipReason } from "./enums";
import type { ScoringChatFn } from "./types";

/**
 * 채점 훅의 의존성 — 전부 주입식(테스트는 fake로 구성한다).
 */
export interface ScoringDeps {
  readonly chat: ScoringChatFn;
  readonly fileIO: FileIO;
  readonly now: () => number;
  /** 판정 순서 셔플용 균등 [0,1) 난수원. */
  readonly rng: () => number;
  /** 호스트가 --topic으로 준 주제 경로 — 있으면 분류 콜 없이 그대로 쓴다. */
  readonly hostTopicPath?: readonly string[];
  /** eval(evaluation_scoring)은 1R 프로토콜 오버헤드가 커 기본 OFF — true일 때만 채점한다. */
  readonly scoreEvalEnabled?: boolean;
}

/** 판사 1명이 한 콜에서, 제시된 위치(라벨 순번)에 대해 매긴 점수. */
export interface JudgeVerdict {
  readonly position: number;
  readonly scores: Readonly<Record<string, number>>;
}

/** 워커 1명의 채점 결과 — raw 로그 1런 레코드의 원소. */
export interface WorkerScoringRecord {
  readonly model: string;
  readonly workerIndex: number;
  /** JUDGE_PANEL과 같은 순서의 판사별 원점수. 파싱 실패/누락은 undefined. */
  readonly judgeScores: readonly (Readonly<Record<string, number>> | undefined)[];
  /** 축별 중앙값 — 쿼럼(3/3) 충족 시에만 존재. */
  readonly median?: Readonly<Record<string, number>>;
  readonly skipReason?: ScoringSkipReason;
  /** 명명된 스킵 사유에 해당하지 않는 워커 단위 예외의 진단 메시지(예: 손상된 모델 id). */
  readonly error?: string;
}

/** 런 1건의 raw 로그 레코드 — `.pyreez/ratings-log.jsonl`에 1줄로 append된다. */
export interface RunScoringRecord {
  readonly v: 1;
  readonly ts: number;
  readonly protocol: string;
  /** 정규화된 주제 경로. 런 자체가 스킵되어 주제를 확보하지 못했으면 없음. */
  readonly topicPath?: string;
  readonly topicSource?: "host" | "classified";
  readonly webAccess?: boolean;
  readonly reasoningEffort?: number;
  readonly workers: readonly WorkerScoringRecord[];
  /** 런 전체가 스킵된 경우(프로토콜 게이트·주제 변환 실패·분류/판정 콜 전멸)의 사유. */
  readonly skipReason?: ScoringSkipReason;
}
