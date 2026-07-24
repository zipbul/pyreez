/**
 * Welford incremental statistics — 셀 하나의 (mean, n, m2) 갱신·병합.
 * 전 관측을 저장하지 않고 평균·분산을 한 패스로 누적한다.
 */

import type { RatingCell } from "./interfaces";

export const EMPTY_CELL: RatingCell = { mean: 0, n: 0, m2: 0 };

/** 관측 x를 반영한 새 셀을 반환한다 (입력 불변). */
export function updateCell(cell: RatingCell, x: number): RatingCell {
  if (!Number.isFinite(x)) {
    throw new Error(`updateCell: observation must be finite: ${x}`);
  }
  const n = cell.n + 1;
  const delta = x - cell.mean;
  const mean = cell.mean + delta / n;
  const m2 = cell.m2 + delta * (x - mean);
  return { mean, n, m2 };
}

/** 표본분산 (n-1 분모). 관측 2개 미만이면 정의되지 않는다. */
export function sampleVariance(cell: RatingCell): number | undefined {
  return cell.n >= 2 ? cell.m2 / (cell.n - 1) : undefined;
}

/**
 * 두 독립 셀을 하나로 병합한다 (Chan et al. parallel variance algorithm).
 * n이 0인 셀은 항등원 — 어느 쪽이 비어 있어도 다른 쪽을 그대로 반환한다.
 */
export function mergeCells(a: RatingCell, b: RatingCell): RatingCell {
  if (a.n === 0) return b;
  if (b.n === 0) return a;
  const n = a.n + b.n;
  const delta = b.mean - a.mean;
  const mean = a.mean + (delta * b.n) / n;
  const m2 = a.m2 + b.m2 + (delta * delta * a.n * b.n) / n;
  return { mean, n, m2 };
}
