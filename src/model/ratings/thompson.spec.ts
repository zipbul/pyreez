/**
 * Unit tests for Thompson sampling — 사후분포에서의 1회 추출.
 * rng 주입으로 결정론적 검증.
 */

import { describe, it, expect } from "bun:test";
import { thompsonSample } from "./thompson";
import type { Rng } from "./types";

/** 결정론적 LCG — 테스트 전용 균등 [0,1) 소스. */
function lcg(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("thompsonSample", () => {
  it("is deterministic under a fixed rng", () => {
    const a = thompsonSample({ mean: 85, variance: 25 }, lcg(42));
    const b = thompsonSample({ mean: 85, variance: 25 }, lcg(42));
    expect(a).toBe(b);
  });

  it("returns exactly the mean when variance is zero", () => {
    expect(thompsonSample({ mean: 90, variance: 0 }, lcg(1))).toBe(90);
  });

  it("still consumes the rng twice when variance is zero (재현성 — 소비량이 데이터 의존이면 안 됨)", () => {
    let calls = 0;
    const rng: Rng = () => {
      calls++;
      return 0.5;
    };
    thompsonSample({ mean: 90, variance: 0 }, rng);
    expect(calls).toBe(2);
  });

  it("stays finite even when the rng emits 0 (Box–Muller 경계)", () => {
    const sample = thompsonSample({ mean: 85, variance: 25 }, () => 0);
    expect(Number.isFinite(sample)).toBe(true);
  });

  it("matches the target distribution over many draws (평균·표준편차)", () => {
    const rng = lcg(7);
    const draws: number[] = [];
    for (let i = 0; i < 20_000; i++) draws.push(thompsonSample({ mean: 85, variance: 25 }, rng));
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    const sd = Math.sqrt(draws.reduce((a, x) => a + (x - mean) ** 2, 0) / draws.length);
    expect(mean).toBeCloseTo(85, 0);
    expect(sd).toBeCloseTo(5, 0);
  });

  it("wider posteriors spread samples further (탐색 성질)", () => {
    const rng1 = lcg(9);
    const rng2 = lcg(9);
    const narrow: number[] = [];
    const wide: number[] = [];
    for (let i = 0; i < 5_000; i++) narrow.push(Math.abs(thompsonSample({ mean: 0, variance: 1 }, rng1)));
    for (let i = 0; i < 5_000; i++) wide.push(Math.abs(thompsonSample({ mean: 0, variance: 100 }, rng2)));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(wide)).toBeGreaterThan(avg(narrow) * 5);
  });

  it("rejects a negative variance", () => {
    expect(() => thompsonSample({ mean: 85, variance: -1 }, lcg(1))).toThrow();
  });

  it("rejects a non-finite mean or variance", () => {
    expect(() => thompsonSample({ mean: Number.NaN, variance: 25 }, lcg(1))).toThrow();
    expect(() => thompsonSample({ mean: 85, variance: Number.POSITIVE_INFINITY }, lcg(1))).toThrow();
  });
});
