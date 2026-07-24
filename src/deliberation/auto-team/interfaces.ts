/**
 * Auto-team feature interfaces — score-based automatic team selection (P4).
 * 설계: docs/plans/scoring-redesign-v5.md §1, §1.5
 */

import type { ModelInfo } from "../../model/types";
import type { RatingsFile, Rng } from "../../model/ratings";
import type { ModelId } from "./types";

/** selectAutoTeam의 전체 입력 — 알고리즘은 순수 함수(파일 I/O·chat 호출 없음). */
export interface AutoTeamDeps {
  /** 가용 모델 목록 (registry.getAvailable() 그대로). */
  readonly candidates: readonly ModelInfo[];
  /** `.pyreez/ratings.json`을 로드한 전체 파일. */
  readonly ratingsFile: RatingsFile;
  /** 채점 대상 프로토콜(ScoredProtocol 3종)이어야 한다 — 아니면 throw. */
  readonly protocol: string;
  /** 정규화된(또는 정규화 가능한) 주제 경로. */
  readonly topicPath: string;
  /** 요청 팀 크기. */
  readonly n: number;
  /** 톰슨 샘플링 + 최종 순서 셔플에 쓰이는 균등 [0,1) 난수원. */
  readonly rng: Rng;
}

/** 선발된 모델 1개의 사후분포·샘플 진단 — raw 로그·호스트 디버깅용. */
export interface ModelDiagnostic {
  readonly model: ModelId;
  readonly mean: number;
  readonly variance: number;
  readonly sample: number;
}

/** selectAutoTeam의 결과. */
export interface AutoTeamResult {
  /** 선발된 모델 id — 최종 순서는 셔플되어 있다(렌즈 배정 회전용, v5 §0). */
  readonly models: readonly ModelId[];
  /** `models`와 같은 순서의 진단 — models[i]에 대응하는 진단은 diagnostics[i]다. */
  readonly diagnostics: readonly ModelDiagnostic[];
}
