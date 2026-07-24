/**
 * Unit tests for hierarchical backoff — 배타적 슬라이스 체인.
 * 리프에만 저장하고(store.recordObservation), 조회 시 슬라이스를 병합해 조상 신호를 얻는다.
 */

import { describe, it, expect } from "bun:test";
import {
  cellKey,
  effectivePosterior,
  normalizeTopicPath,
  parseCellKey,
  topicAncestry,
  topicPathFromSegments,
} from "./backoff";
import { GLOBAL_PRIOR, SIGMA2_FLOOR, TAU2_PER_HOP } from "./constants";
import { ScoredProtocol } from "./enums";
import type { CellCoord, RatingsFile } from "./interfaces";
import { conjugatePosterior } from "./posterior";
import { EMPTY_RATINGS, recordObservation } from "./store";
import { EMPTY_CELL, updateCell } from "./welford";

const COORD: CellCoord = {
  model: "xai/grok-4.5",
  protocol: ScoredProtocol.SharedConvergence,
  topicPath: "medicine/diagnosis",
  axis: "accuracy",
};

describe("normalizeTopicPath", () => {
  it("drops a trailing separator", () => {
    expect(normalizeTopicPath("medicine/")).toBe("medicine");
  });

  it("rejects a path with no segments", () => {
    expect(() => normalizeTopicPath("///")).toThrow();
  });

  it("rejects a segment containing the key separator", () => {
    expect(() => normalizeTopicPath("a|b")).toThrow();
  });
});

describe("topicPathFromSegments", () => {
  it("joins and normalizes segments", () => {
    expect(topicPathFromSegments(["medicine", "diagnosis"])).toBe("medicine/diagnosis");
  });

  it("rejects a segment containing the key separator", () => {
    expect(() => topicPathFromSegments(["a|b"])).toThrow();
  });
});

describe("topicAncestry", () => {
  it("expands a path root-first", () => {
    expect(topicAncestry("medicine/diagnosis/pe")).toEqual([
      "medicine",
      "medicine/diagnosis",
      "medicine/diagnosis/pe",
    ]);
  });

  it("returns a single-segment path as itself", () => {
    expect(topicAncestry("law")).toEqual(["law"]);
  });
});

describe("cellKey", () => {
  it("is unique per coordinate component", () => {
    const a = cellKey(COORD);
    const b = cellKey({ ...COORD, axis: "depth" });
    const c = cellKey({ ...COORD, protocol: ScoredProtocol.AdversarialDebate });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("normalizes the topic path (trailing slash coordinate is the same cell)", () => {
    expect(cellKey(COORD)).toBe(cellKey({ ...COORD, topicPath: "medicine/diagnosis/" }));
  });

  it("rejects a topic path containing the separator (키 충돌 방지)", () => {
    expect(() => cellKey({ ...COORD, topicPath: "a|b" })).toThrow();
  });

  it("rejects an axis containing the separator", () => {
    expect(() => cellKey({ ...COORD, axis: "a|b" })).toThrow();
  });

  it("rejects an empty topic path", () => {
    expect(() => cellKey({ ...COORD, topicPath: "" })).toThrow();
  });

  it("rejects an empty protocol", () => {
    expect(() => cellKey({ ...COORD, protocol: "" as ScoredProtocol })).toThrow();
  });

  it("rejects an empty axis", () => {
    expect(() => cellKey({ ...COORD, axis: "" })).toThrow();
  });
});

describe("parseCellKey", () => {
  it("round-trips cellKey's output back into its components", () => {
    expect(parseCellKey(cellKey(COORD))).toEqual({
      model: COORD.model,
      protocol: COORD.protocol,
      topicPath: COORD.topicPath,
      axis: COORD.axis,
    });
  });

  it("round-trips a multi-segment topic path intact (no false split on its own slashes)", () => {
    const withDeepTopic = { ...COORD, topicPath: "medicine/diagnosis/pe" };
    expect(parseCellKey(cellKey(withDeepTopic))?.topicPath).toBe("medicine/diagnosis/pe");
  });

  it("returns undefined for a key with too few parts", () => {
    expect(parseCellKey("only|three|parts")).toBeUndefined();
  });

  it("returns undefined for a key with too many parts", () => {
    expect(parseCellKey("a|b|c|d|e")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(parseCellKey("")).toBeUndefined();
  });
});

describe("effectivePosterior", () => {
  it("stays at the prior mean when nothing has been observed, inflated by one hop per path segment", () => {
    const result = effectivePosterior(EMPTY_RATINGS, COORD);
    expect(result.mean).toBe(GLOBAL_PRIOR.mean);
    expect(result.variance).toBeCloseTo(GLOBAL_PRIOR.variance + TAU2_PER_HOP * 2);
  });

  it("a thin leaf stays caught by its sibling slice", () => {
    // 형제 슬라이스("medicine" 리프 셀)에 60점 관측 50개
    let file: RatingsFile = EMPTY_RATINGS;
    for (let i = 0; i < 50; i++) {
      file = recordObservation(file, { ...COORD, topicPath: "medicine" }, 60, i);
    }
    // 리프(medicine/diagnosis)에 90점 관측 1개 → 형제 신호에 붙잡혀야 함
    file = recordObservation(file, COORD, 90, 100);

    const thin = effectivePosterior(file, COORD);
    expect(thin.mean).toBeGreaterThan(65);
    expect(thin.mean).toBeLessThan(80);
  });

  it("a heavy leaf escapes its sibling slice", () => {
    let file: RatingsFile = EMPTY_RATINGS;
    for (let i = 0; i < 50; i++) {
      file = recordObservation(file, { ...COORD, topicPath: "medicine" }, 60, i);
    }
    // 리프에 90점 관측 50개 → 형제 신호에서 벗어나 리프 평균 근처
    for (let i = 0; i < 50; i++) {
      file = recordObservation(file, COORD, 90, 200 + i);
    }

    const heavy = effectivePosterior(file, COORD);
    expect(heavy.mean).toBeGreaterThan(85);
  });

  it("pools across domains through the global slice (교차-도메인 풀링)", () => {
    // law에만 90점 관측 100개 — medicine 조회는 형제·리프가 비어 전역 슬라이스만 작동한다
    let file: RatingsFile = EMPTY_RATINGS;
    for (let i = 0; i < 100; i++) {
      file = recordObservation(file, { ...COORD, topicPath: "law" }, 90, i);
    }

    const posterior = effectivePosterior(file, COORD);
    expect(posterior.mean).toBeGreaterThan(88);
    expect(posterior.variance).toBeGreaterThan(15);
  });

  it("does not leak across axes", () => {
    let file: RatingsFile = EMPTY_RATINGS;
    for (let i = 0; i < 20; i++) file = recordObservation(file, COORD, 95, i);

    const otherAxis = effectivePosterior(file, { ...COORD, axis: "depth" });
    expect(otherAxis.mean).toBe(GLOBAL_PRIOR.mean);
    expect(otherAxis.variance).toBeCloseTo(GLOBAL_PRIOR.variance + TAU2_PER_HOP * 2);
  });

  it("does not leak across protocols", () => {
    let file: RatingsFile = EMPTY_RATINGS;
    for (let i = 0; i < 20; i++) file = recordObservation(file, COORD, 95, i);

    const otherProtocol = effectivePosterior(file, { ...COORD, protocol: ScoredProtocol.AdversarialDebate });
    expect(otherProtocol.mean).toBe(GLOBAL_PRIOR.mean);
    expect(otherProtocol.variance).toBeCloseTo(GLOBAL_PRIOR.variance + TAU2_PER_HOP * 2);
  });

  it("ignores a malformed cell key when merging slices (손상 키 방어)", () => {
    const file: RatingsFile = {
      v: 1,
      updatedAt: 1,
      cells: { "bad|key": { mean: 999, n: 1, m2: 0 } },
    };
    const result = effectivePosterior(file, COORD);
    expect(result.mean).toBe(GLOBAL_PRIOR.mean);
  });

  it("double-counting regression: leaf-only variance stays within 20% of a single honest conjugate update", () => {
    // 리프에만 50관측(90±3 교차) — 폐기된 구현(전 계층 적립 + 조상 켤레 체인)은
    // 같은 관측을 depth번 계수해 이 값의 절반으로 나왔다.
    const scores = [87, 90, 93, 90, 87, 93, 90, 87, 93, 90];
    let file: RatingsFile = EMPTY_RATINGS;
    for (let i = 0; i < 50; i++) {
      file = recordObservation(file, COORD, scores[i % scores.length]!, i);
    }

    const chained = effectivePosterior(file, COORD);

    // honest baseline: GLOBAL_PRIOR에 리프 관측을 1회만 켤레 적용한다.
    let honestCell = EMPTY_CELL;
    for (let i = 0; i < 50; i++) honestCell = updateCell(honestCell, scores[i % scores.length]!);
    const honest = conjugatePosterior(honestCell, GLOBAL_PRIOR, SIGMA2_FLOOR);

    const ratio = chained.variance / honest.variance;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.2);
  });
});
