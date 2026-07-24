/**
 * 3축 결합 — accuracy·depth·grounding 각각의 effectivePosterior를 하나의 스칼라
 * 사후로 합친다. 독립 가우시안 평균의 평균: variance = Σvar_i / k²
 * (v1 — task-축 가중은 후속).
 */

import type { GaussianPosterior, RatingsFile } from "./interfaces";
import type { CellCoordBase } from "./types";
import { effectivePosterior } from "./backoff";

export function selectionPosterior(
  file: RatingsFile,
  base: CellCoordBase,
  axes: readonly string[],
): GaussianPosterior {
  if (axes.length === 0) {
    throw new Error("selectionPosterior: axes must not be empty");
  }
  const posteriors = axes.map((axis) => effectivePosterior(file, { ...base, axis }));
  const k = posteriors.length;
  const mean = posteriors.reduce((sum, p) => sum + p.mean, 0) / k;
  const variance = posteriors.reduce((sum, p) => sum + p.variance, 0) / (k * k);
  return { mean, variance };
}
