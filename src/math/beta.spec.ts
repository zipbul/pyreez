import { describe, it, expect } from "bun:test";
import { betaSample, betaMean, betaVariance } from "./beta";

describe("betaSample", () => {
  it("should return values in [0, 1]", () => {
    for (let i = 0; i < 1000; i++) {
      const v = betaSample(2, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("should throw for non-positive parameters", () => {
    expect(() => betaSample(0, 1)).toThrow();
    expect(() => betaSample(1, 0)).toThrow();
    expect(() => betaSample(-1, 1)).toThrow();
  });

  it("should converge to expected mean for Beta(2, 5)", () => {
    const N = 10000;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += betaSample(2, 5);
    }
    const sampleMean = sum / N;
    const expected = betaMean(2, 5); // 2/7 ≈ 0.2857
    expect(Math.abs(sampleMean - expected)).toBeLessThan(0.02);
  });

  it("should converge to expected mean for Beta(10, 2)", () => {
    const N = 10000;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += betaSample(10, 2);
    }
    const sampleMean = sum / N;
    const expected = betaMean(10, 2); // 10/12 ≈ 0.833
    expect(Math.abs(sampleMean - expected)).toBeLessThan(0.02);
  });

  it("should converge to expected variance for Beta(3, 3)", () => {
    const N = 10000;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) {
      samples.push(betaSample(3, 3));
    }
    const mean = samples.reduce((a, b) => a + b, 0) / N;
    const sampleVar = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (N - 1);
    const expectedVar = betaVariance(3, 3); // 0.0357
    expect(Math.abs(sampleVar - expectedVar)).toBeLessThan(0.005);
  });

  it("should handle Beta(1, 1) as uniform", () => {
    const N = 10000;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += betaSample(1, 1);
    }
    const sampleMean = sum / N;
    expect(Math.abs(sampleMean - 0.5)).toBeLessThan(0.02);
  });

  it("should handle very small alpha (exploration prior)", () => {
    const N = 1000;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += betaSample(0.5, 0.5);
    }
    const sampleMean = sum / N;
    expect(Math.abs(sampleMean - 0.5)).toBeLessThan(0.05);
  });

  it("should handle large alpha/beta (converged model)", () => {
    const N = 1000;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      sum += betaSample(95, 5);
    }
    const sampleMean = sum / N;
    const expected = betaMean(95, 5); // 0.95
    expect(Math.abs(sampleMean - expected)).toBeLessThan(0.02);
  });
});

describe("betaMean", () => {
  it("should return alpha / (alpha + beta)", () => {
    expect(betaMean(2, 5)).toBeCloseTo(2 / 7, 5);
    expect(betaMean(1, 1)).toBeCloseTo(0.5, 5);
    expect(betaMean(10, 2)).toBeCloseTo(10 / 12, 5);
  });
});

describe("betaVariance", () => {
  it("should return correct variance", () => {
    // Beta(3,3): var = 3*3 / (36*7) = 9/252 ≈ 0.0357
    expect(betaVariance(3, 3)).toBeCloseTo(9 / 252, 4);
  });
});
