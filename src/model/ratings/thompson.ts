/**
 * Thompson sampling — 사후분포에서 1회 추출. 관측이 얇아 분산이 큰 모델은
 * 추출값이 크게 요동해 가끔 강자를 제치고 선발된다(내장 탐색).
 */

import type { GaussianPosterior } from "./interfaces";
import type { Rng } from "./types";

/**
 * N(mean, variance)에서 Box–Muller로 1회 추출.
 * variance가 0이어도 rng는 항상 2회 소비한다 — 소비량이 데이터 의존이면
 * 고정 시드로 이후 추출을 재현할 수 없다.
 */
export function thompsonSample(posterior: GaussianPosterior, rng: Rng): number {
  if (!Number.isFinite(posterior.mean) || !Number.isFinite(posterior.variance)) {
    throw new Error("thompsonSample: mean and variance must be finite");
  }
  if (posterior.variance < 0) {
    throw new Error(`thompsonSample: variance must not be negative: ${posterior.variance}`);
  }
  // u1 ∈ (0, 1]: rng()가 0을 반환해도 log(0) = -∞가 되지 않도록 1 - rng()를 쓴다.
  const u1 = 1 - rng();
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return posterior.mean + Math.sqrt(posterior.variance) * z;
}
