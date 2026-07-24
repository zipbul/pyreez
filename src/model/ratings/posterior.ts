/**
 * Normal–Normal conjugate posterior.
 *
 * post_var  = 1 / (n/σ̂² + 1/prior_var)   — n이 커질수록 0으로 수렴 (exploit 수렴 보장)
 * post_mean = post_var · (n·x̄/σ̂² + prior_mean/prior_var)
 *
 * σ̂²에는 하한(floor)을 적용한다: n=1(분산 미정의)이나 포화 점수(m2≈0)가
 * 사후를 점질량으로 붕괴시켜 탐색을 죽이는 것을 막는다.
 */

import type { GaussianPosterior, RatingCell } from "./interfaces";
import { sampleVariance } from "./welford";

export function conjugatePosterior(
  cell: RatingCell,
  prior: GaussianPosterior,
  sigma2Floor: number,
): GaussianPosterior {
  if (cell.n < 0) {
    throw new Error(`conjugatePosterior: cell.n must not be negative: ${cell.n}`);
  }
  if (!Number.isFinite(cell.mean) || !Number.isFinite(cell.m2)) {
    throw new Error("conjugatePosterior: cell.mean and cell.m2 must be finite");
  }
  if (!(prior.variance > 0)) {
    throw new Error(`conjugatePosterior: prior.variance must be positive: ${prior.variance}`);
  }
  if (!(sigma2Floor > 0)) {
    throw new Error(`conjugatePosterior: sigma2Floor must be positive: ${sigma2Floor}`);
  }
  if (cell.n === 0) return prior;
  const obsVar = Math.max(sampleVariance(cell) ?? sigma2Floor, sigma2Floor);
  const variance = 1 / (cell.n / obsVar + 1 / prior.variance);
  const mean = variance * ((cell.n * cell.mean) / obsVar + prior.mean / prior.variance);
  return { mean, variance };
}
