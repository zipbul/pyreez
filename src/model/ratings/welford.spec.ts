/**
 * Unit tests for Welford incremental statistics — the per-cell accumulator.
 */

import { describe, it, expect } from "bun:test";
import { EMPTY_CELL, updateCell, sampleVariance, mergeCells } from "./welford";

describe("updateCell", () => {
  it("records the first observation as the mean with zero spread", () => {
    const cell = updateCell(EMPTY_CELL, 90);
    expect(cell).toEqual({ mean: 90, n: 1, m2: 0 });
  });

  it("accumulates mean and squared deviations across observations", () => {
    let cell = EMPTY_CELL;
    for (const x of [80, 90, 100]) cell = updateCell(cell, x);
    expect(cell.n).toBe(3);
    expect(cell.mean).toBeCloseTo(90);
    // m2 = Σ(x - mean)² = 100 + 0 + 100
    expect(cell.m2).toBeCloseTo(200);
  });

  it("does not mutate the input cell", () => {
    const before = { mean: 50, n: 1, m2: 0 };
    updateCell(before, 70);
    expect(before).toEqual({ mean: 50, n: 1, m2: 0 });
  });

  it("matches the naive two-pass computation on a longer sequence", () => {
    const xs = [88, 91.5, 79, 95, 84.3, 90, 90];
    let cell = EMPTY_CELL;
    for (const x of xs) cell = updateCell(cell, x);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const m2 = xs.reduce((a, x) => a + (x - mean) ** 2, 0);
    expect(cell.mean).toBeCloseTo(mean);
    expect(cell.m2).toBeCloseTo(m2);
  });

  it("rejects a non-finite observation", () => {
    expect(() => updateCell(EMPTY_CELL, Number.NaN)).toThrow();
    expect(() => updateCell(EMPTY_CELL, Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("sampleVariance", () => {
  it("is undefined below two observations", () => {
    expect(sampleVariance(EMPTY_CELL)).toBeUndefined();
    expect(sampleVariance(updateCell(EMPTY_CELL, 90))).toBeUndefined();
  });

  it("computes the n-1 (sample) variance", () => {
    let cell = EMPTY_CELL;
    for (const x of [80, 90, 100]) cell = updateCell(cell, x);
    expect(sampleVariance(cell)).toBeCloseTo(100); // 200 / (3-1)
  });
});

describe("mergeCells", () => {
  it("matches sequential updateCell application (Chan 병렬 병합 항등성)", () => {
    const xs = [80, 90, 100, 95, 85];
    let sequential = EMPTY_CELL;
    for (const x of xs) sequential = updateCell(sequential, x);

    let a = EMPTY_CELL;
    for (const x of xs.slice(0, 2)) a = updateCell(a, x);
    let b = EMPTY_CELL;
    for (const x of xs.slice(2)) b = updateCell(b, x);
    const merged = mergeCells(a, b);

    expect(merged.n).toBe(sequential.n);
    expect(merged.mean).toBeCloseTo(sequential.mean);
    expect(merged.m2).toBeCloseTo(sequential.m2);
  });

  it("returns the other cell unchanged when one side is empty (항등원)", () => {
    const cell = updateCell(EMPTY_CELL, 90);
    expect(mergeCells(EMPTY_CELL, cell)).toEqual(cell);
    expect(mergeCells(cell, EMPTY_CELL)).toEqual(cell);
  });
});
