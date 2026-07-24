/**
 * Unit tests for selectionPosterior — 여러 축 사후를 1스칼라로 결합.
 */

import { describe, it, expect } from "bun:test";
import { effectivePosterior } from "./backoff";
import { ScoredProtocol } from "./enums";
import type { RatingsFile } from "./interfaces";
import { selectionPosterior } from "./selection";
import { EMPTY_RATINGS, recordObservation } from "./store";
import type { CellCoordBase } from "./types";

const BASE: CellCoordBase = {
  model: "xai/grok-4.5",
  protocol: ScoredProtocol.SharedConvergence,
  topicPath: "medicine/diagnosis",
};

describe("selectionPosterior", () => {
  it("combines axes as the mean of means and Σvar/k²", () => {
    let file: RatingsFile = EMPTY_RATINGS;
    for (let i = 0; i < 20; i++) file = recordObservation(file, { ...BASE, axis: "accuracy" }, 90, i);
    for (let i = 0; i < 20; i++) file = recordObservation(file, { ...BASE, axis: "depth" }, 70, 100 + i);

    const combined = selectionPosterior(file, BASE, ["accuracy", "depth"]);
    const accuracy = effectivePosterior(file, { ...BASE, axis: "accuracy" });
    const depth = effectivePosterior(file, { ...BASE, axis: "depth" });

    expect(combined.mean).toBeCloseTo((accuracy.mean + depth.mean) / 2);
    expect(combined.variance).toBeCloseTo((accuracy.variance + depth.variance) / 4);
  });

  it("rejects an empty axes list", () => {
    expect(() => selectionPosterior(EMPTY_RATINGS, BASE, [])).toThrow();
  });
});
