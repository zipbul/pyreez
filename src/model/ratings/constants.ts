/**
 * Ratings feature constants.
 */

import type { GaussianPosterior } from "./interfaces";

/**
 * 관측이 전혀 없는 좌표의 사전분포 (1-100 rubric 척도).
 * 실측 5·6 전 셀 총평균(~88) 부근 + 모델 간 최대 격차(15점)를 덮는 폭.
 */
export const GLOBAL_PRIOR: GaussianPosterior = { mean: 85, variance: 100 };

/**
 * 관측분산 하한.
 * 실측 5↔6 동일 셀 런 간 중앙값 이동 2~3점(σ≈3).
 */
export const SIGMA2_FLOOR = 9;

/**
 * 계층 홉 1단계당 사후분산 팽창분.
 * 실측 6 모델별 도메인 간 분산 평균 ≈9.9 (gpt 22.6 / opus 1.7 / grok 5.3).
 * 하위주제 홉(실측 3, ≈2.2)에는 과대 팽창이지만 탐색 여유 방향이라 안전.
 */
export const TAU2_PER_HOP = 9;

/** rubric 점수 하한. */
export const SCORE_MIN = 1;

/** rubric 점수 상한. */
export const SCORE_MAX = 100;

/** 슬라이스 표본 n이 이 미만이면 floor에 TAU2_PER_HOP을 더해 원샷 절벽을 완화한다. */
export const BOOT_N_THRESHOLD = 3;
