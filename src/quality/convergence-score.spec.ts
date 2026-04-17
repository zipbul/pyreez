/**
 * Unit tests for multi-component convergence score (Aragora pattern).
 */

import { describe, it, expect } from "bun:test";
import {
  computeConvergenceScore,
  classifyStatus,
  type ConvergenceComponents,
} from "./convergence-score";

describe("computeConvergenceScore", () => {
  it("returns Aragora-weighted combination (semantic 0.4 + diversity 0.2 + evidence 0.2 + stability 0.2)", () => {
    // synaptent/aragora docs/algorithms/CONVERGENCE.md
    const components: ConvergenceComponents = {
      semantic: 1.0,    // perfect convergence
      diversity: 0.0,   // no diversity = fully converged
      evidence: 1.0,    // total overlap
      stability: 1.0,   // no change between rounds
    };
    // score = 1.0*0.4 + (1-0.0)*0.2 + 1.0*0.2 + (1-(1-1.0))*0.2 wait — check formula
    // From source: score = semantic*0.4 + (1-diversity)*0.2 + evidence*0.2 + (1-volatility)*0.2
    // We pass `stability` as already-inverted volatility (stability = 1 - volatility)
    // So: 1.0*0.4 + (1-0.0)*0.2 + 1.0*0.2 + 1.0*0.2 = 1.0
    expect(computeConvergenceScore(components)).toBeCloseTo(1.0);
  });

  it("returns 0 when all components signal max divergence", () => {
    const components: ConvergenceComponents = {
      semantic: 0.0, diversity: 1.0, evidence: 0.0, stability: 0.0,
    };
    // 0*0.4 + (1-1)*0.2 + 0*0.2 + 0*0.2 = 0
    expect(computeConvergenceScore(components)).toBeCloseTo(0.0);
  });

  it("clamps to [0, 1]", () => {
    const high: ConvergenceComponents = { semantic: 2.0, diversity: -1.0, evidence: 2.0, stability: 2.0 };
    expect(computeConvergenceScore(high)).toBeLessThanOrEqual(1.0);
    const low: ConvergenceComponents = { semantic: -1.0, diversity: 2.0, evidence: -1.0, stability: -1.0 };
    expect(computeConvergenceScore(low)).toBeGreaterThanOrEqual(0.0);
  });

  it("weights semantic at 0.4 (highest)", () => {
    // Only semantic is 1, others 0
    const onlySemantic: ConvergenceComponents = { semantic: 1.0, diversity: 1.0, evidence: 0.0, stability: 0.0 };
    // 1*0.4 + 0*0.2 + 0*0.2 + 0*0.2 = 0.4
    expect(computeConvergenceScore(onlySemantic)).toBeCloseTo(0.4);
  });
});

describe("classifyStatus", () => {
  it("returns 'converged' when score >= 0.85 and consecutive stable rounds >= required", () => {
    expect(classifyStatus(0.90, 1, 1)).toBe("converged");
    expect(classifyStatus(0.85, 1, 1)).toBe("converged");
  });

  it("returns 'refining' when score is between thresholds", () => {
    expect(classifyStatus(0.60, 0, 1)).toBe("refining");
    expect(classifyStatus(0.84, 0, 1)).toBe("refining");
  });

  it("returns 'diverging' when score < 0.40", () => {
    expect(classifyStatus(0.30, 0, 1)).toBe("diverging");
    expect(classifyStatus(0.10, 0, 1)).toBe("diverging");
  });

  it("returns 'refining' when score is converged-eligible but consecutive_stable < required", () => {
    expect(classifyStatus(0.90, 0, 2)).toBe("refining");
  });
});
