/**
 * Unit tests for the Normal–Normal conjugate posterior — v2 리뷰에서 잡힌
 * 분산 공식 오류(var/n + prior_var, 수렴 불가)의 교정본을 계약으로 고정한다.
 */

import { describe, it, expect } from "bun:test";
import { conjugatePosterior } from "./posterior";
import type { GaussianPosterior, RatingCell } from "./interfaces";

const PRIOR: GaussianPosterior = { mean: 85, variance: 100 };
const FLOOR = 9;

function cellOf(mean: number, n: number, m2: number): RatingCell {
  return { mean, n, m2 };
}

describe("conjugatePosterior", () => {
  it("returns the prior unchanged when the cell has no observations", () => {
    expect(conjugatePosterior(cellOf(0, 0, 0), PRIOR, FLOOR)).toEqual(PRIOR);
  });

  it("shrinks variance below the prior with every observation", () => {
    const post = conjugatePosterior(cellOf(90, 1, 0), PRIOR, FLOOR);
    expect(post.variance).toBeLessThan(PRIOR.variance);
    expect(post.variance).toBeGreaterThan(0);
  });

  it("converges: posterior variance approaches zero as n grows (v2 오류의 반대 성질)", () => {
    const post = conjugatePosterior(cellOf(90, 10_000, 9 * 9_999), PRIOR, FLOOR);
    expect(post.variance).toBeLessThan(0.01);
    expect(post.mean).toBeCloseTo(90, 1);
  });

  it("pulls a thin cell toward the prior", () => {
    const thin = conjugatePosterior(cellOf(95, 1, 0), PRIOR, FLOOR);
    expect(thin.mean).toBeGreaterThan(PRIOR.mean);
    expect(thin.mean).toBeLessThan(95);
  });

  it("pulls a heavy cell toward its own mean", () => {
    const heavy = conjugatePosterior(cellOf(95, 50, 9 * 49), PRIOR, FLOOR);
    expect(heavy.mean).toBeCloseTo(95, 0);
  });

  it("applies the variance floor: a single observation cannot collapse to a point mass", () => {
    // n=1 → sample variance undefined → floor must hold the posterior open (fable H3의 σ²=0 붕괴 차단)
    const post = conjugatePosterior(cellOf(90, 1, 0), PRIOR, FLOOR);
    const expectedVar = 1 / (1 / FLOOR + 1 / PRIOR.variance);
    expect(post.variance).toBeCloseTo(expectedVar);
  });

  it("floors an unrealistically tight measured variance (포화 점수 과신 차단)", () => {
    // n=5, m2=0 → σ̂²=0 → floor로 대체되어야 함
    const post = conjugatePosterior(cellOf(90, 5, 0), PRIOR, FLOOR);
    const expectedVar = 1 / (5 / FLOOR + 1 / PRIOR.variance);
    expect(post.variance).toBeCloseTo(expectedVar);
  });

  it("uses the measured variance once it exceeds the floor (floor 비-바인딩 분기)", () => {
    // n=5, m2=100 → 표본분산 = 100/4 = 25 > FLOOR(9) → floor가 바인딩되지 않는다
    const post = conjugatePosterior(cellOf(90, 5, 100), PRIOR, FLOOR);
    const expectedVar = 1 / (5 / 25 + 1 / PRIOR.variance);
    expect(post.variance).toBeCloseTo(expectedVar);
  });

  it("rejects a negative observation count", () => {
    expect(() => conjugatePosterior(cellOf(90, -1, 0), PRIOR, FLOOR)).toThrow();
  });

  it("rejects a non-finite cell mean or m2", () => {
    expect(() => conjugatePosterior(cellOf(Number.NaN, 1, 0), PRIOR, FLOOR)).toThrow();
    expect(() => conjugatePosterior(cellOf(90, 1, Number.POSITIVE_INFINITY), PRIOR, FLOOR)).toThrow();
  });

  it("rejects a non-positive prior variance", () => {
    expect(() => conjugatePosterior(cellOf(90, 1, 0), { mean: 85, variance: 0 }, FLOOR)).toThrow();
  });

  it("rejects a non-positive floor", () => {
    expect(() => conjugatePosterior(cellOf(90, 1, 0), PRIOR, 0)).toThrow();
  });
});
