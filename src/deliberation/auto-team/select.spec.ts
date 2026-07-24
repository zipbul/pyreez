/**
 * Unit tests for selectAutoTeam — score-based automatic team selection (P4).
 * rng 주입으로 결정론적 검증(콜드 모델의 넓은 사후가 유리한 rng를 뽑을 때만 선발되는 시나리오 포함).
 */

import { describe, it, expect } from "bun:test";
import type { ModelInfo } from "../../model/types";
import { EMPTY_RATINGS, recordObservation, ScoredProtocol, type RatingsFile } from "../../model/ratings";
import { CONTENT_AXES } from "../../quality/scoring";
import { AutoTeamErrorCode } from "./enums";
import { AutoTeamSelectionError, selectAutoTeam } from "./select";

const TOPIC = "software/testing";
const PROTOCOL = ScoredProtocol.SharedConvergence;

/** 결정론적 값 소스 — 목록이 소진되면 z≈-1.18(음의 방향, 무난한 값)이 되는 0.5로 낙하한다. */
function seqRng(values: readonly number[]): () => number {
  let i = 0;
  return () => (i < values.length ? values[i++]! : 0.5);
}

/** 결정론적 LCG — thompson.spec.ts와 동일한 소스. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** rng()가 계속 u1=1-rng()->targetU1, u2->targetU2가 되도록 [firstCall, secondCall] 쌍을 만든다. */
function drawPair(targetU1: number, targetU2: number): [number, number] {
  return [1 - targetU1, targetU2];
}

function model(id: string, provider: ModelInfo["provider"]): ModelInfo {
  return { id, provider };
}

/** n건의 동일 관측(axis마다)을 model/topicPath에 적립한다 — 낮은 분산(거의 SIGMA2_FLOOR)의 "핫" 모델 픽스처. */
function withObservations(file: RatingsFile, modelId: string, score: number, count: number): RatingsFile {
  let f = file;
  for (const axis of CONTENT_AXES) {
    for (let i = 0; i < count; i++) {
      f = recordObservation(f, { model: modelId, protocol: PROTOCOL, topicPath: TOPIC, axis }, score, i);
    }
  }
  return f;
}

describe("selectAutoTeam", () => {
  it("selects the top-N candidates by Thompson sample under a neutral rng", () => {
    let file = EMPTY_RATINGS;
    file = withObservations(file, "openai/hot", 95, 20);
    file = withObservations(file, "xai/mid", 85, 20);
    const candidates = [model("openai/hot", "openai"), model("xai/mid", "xai")];

    const result = selectAutoTeam({
      candidates,
      ratingsFile: file,
      protocol: PROTOCOL,
      topicPath: TOPIC,
      n: 2,
      rng: seqRng([]),
    });

    expect(result.models.slice().sort()).toEqual(["openai/hot", "xai/mid"]);
    expect(result.diagnostics).toHaveLength(2);
    for (let i = 0; i < result.models.length; i++) {
      expect(result.diagnostics[i]!.model).toBe(result.models[i]!);
    }
  });

  it("prefers established models over a cold model under a neutral (non-lucky) rng", () => {
    let file = EMPTY_RATINGS;
    file = withObservations(file, "openai/a", 90, 20);
    file = withObservations(file, "google/c", 88, 20);
    // "xai/b" has zero observations anywhere -- cold, wide posterior.
    const candidates = [model("openai/a", "openai"), model("xai/b", "xai"), model("google/c", "google")];

    const result = selectAutoTeam({
      candidates,
      ratingsFile: file,
      protocol: PROTOCOL,
      topicPath: TOPIC,
      n: 2,
      rng: seqRng([]), // every draw is the neutral fallback 0.5 -> negative z for everyone
    });

    expect(result.models.slice().sort()).toEqual(["google/c", "openai/a"]);
  });

  it("selects a cold model over an established one when its Thompson draw is lucky (exploration)", () => {
    let file = EMPTY_RATINGS;
    file = withObservations(file, "openai/a", 90, 20);
    file = withObservations(file, "google/c", 88, 20);
    // "xai/b" is cold (zero observations) -- wide posterior, so a lucky rng draw can push its
    // sample far above both established models.
    const candidates = [model("openai/a", "openai"), model("xai/b", "xai"), model("google/c", "google")];

    const [a1, a2] = drawPair(0.5, 0.5); // candidate A: neutral draw
    const [b1, b2] = drawPair(0.0439, 0); // candidate B (cold): lucky draw, large positive z
    const [c1, c2] = drawPair(0.5, 0.5); // candidate C: neutral draw
    const rng = seqRng([a1, a2, b1, b2, c1, c2, 0.3]); // trailing value feeds the final shuffle

    const result = selectAutoTeam({
      candidates,
      ratingsFile: file,
      protocol: PROTOCOL,
      topicPath: TOPIC,
      n: 2,
      rng,
    });

    expect(result.models.slice().sort()).toEqual(["openai/a", "xai/b"]);
  });

  it("is deterministic under a fixed rng (same inputs -> identical models + diagnostics)", () => {
    let file = EMPTY_RATINGS;
    file = withObservations(file, "openai/a", 90, 10);
    file = withObservations(file, "xai/b", 85, 5);
    file = withObservations(file, "google/c", 80, 15);
    const candidates = [model("openai/a", "openai"), model("xai/b", "xai"), model("google/c", "google")];
    const deps = { candidates, ratingsFile: file, protocol: PROTOCOL, topicPath: TOPIC, n: 2 };

    const result1 = selectAutoTeam({ ...deps, rng: lcg(42) });
    const result2 = selectAutoTeam({ ...deps, rng: lcg(42) });

    expect(result1).toEqual(result2);
  });

  it("swaps the weakest selected slot for the next-ranked candidate from a different provider when the greedy pick is single-provider", () => {
    let file = EMPTY_RATINGS;
    file = withObservations(file, "openai/x1", 95, 20);
    file = withObservations(file, "openai/x2", 93, 20);
    file = withObservations(file, "xai/y", 80, 20);
    // Neutral rng for every draw -> ranking follows the mean exactly: x1 > x2 > y.
    // Greedy top-2 would be {x1, x2}, both "openai" -- must swap x2 out for y ("xai").
    const candidates = [model("openai/x1", "openai"), model("openai/x2", "openai"), model("xai/y", "xai")];

    const result = selectAutoTeam({
      candidates,
      ratingsFile: file,
      protocol: PROTOCOL,
      topicPath: TOPIC,
      n: 2,
      rng: seqRng([]),
    });

    expect(result.models.slice().sort()).toEqual(["openai/x1", "xai/y"]);
  });

  it("throws SingleProviderAvailable when every candidate shares one provider (no replacement possible)", () => {
    let file = EMPTY_RATINGS;
    file = withObservations(file, "openai/x1", 95, 20);
    file = withObservations(file, "openai/x2", 93, 20);
    file = withObservations(file, "openai/x3", 91, 20);
    const candidates = [model("openai/x1", "openai"), model("openai/x2", "openai"), model("openai/x3", "openai")];

    expect(() =>
      selectAutoTeam({ candidates, ratingsFile: file, protocol: PROTOCOL, topicPath: TOPIC, n: 2, rng: seqRng([]) }),
    ).toThrow(AutoTeamSelectionError);

    try {
      selectAutoTeam({ candidates, ratingsFile: file, protocol: PROTOCOL, topicPath: TOPIC, n: 2, rng: seqRng([]) });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AutoTeamSelectionError);
      expect((e as AutoTeamSelectionError).code).toBe(AutoTeamErrorCode.SingleProviderAvailable);
    }
  });

  it("clamps N down to the number of available candidates", () => {
    let file = EMPTY_RATINGS;
    file = withObservations(file, "openai/a", 90, 10);
    file = withObservations(file, "xai/b", 85, 10);
    file = withObservations(file, "google/c", 80, 10);
    const candidates = [model("openai/a", "openai"), model("xai/b", "xai"), model("google/c", "google")];

    const result = selectAutoTeam({
      candidates,
      ratingsFile: file,
      protocol: PROTOCOL,
      topicPath: TOPIC,
      n: 10, // more than the 3 available candidates
      rng: seqRng([]),
    });

    expect(result.models.slice().sort()).toEqual(["google/c", "openai/a", "xai/b"]);
  });

  it("throws TeamTooSmall when N is below the minimum team size of 2", () => {
    let file = EMPTY_RATINGS;
    file = withObservations(file, "openai/a", 90, 10);
    file = withObservations(file, "xai/b", 85, 10);
    const candidates = [model("openai/a", "openai"), model("xai/b", "xai")];

    try {
      selectAutoTeam({ candidates, ratingsFile: file, protocol: PROTOCOL, topicPath: TOPIC, n: 1, rng: seqRng([]) });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AutoTeamSelectionError);
      expect((e as AutoTeamSelectionError).code).toBe(AutoTeamErrorCode.TeamTooSmall);
    }
  });

  it("throws TeamTooSmall for a non-integer N", () => {
    const candidates = [model("openai/a", "openai"), model("xai/b", "xai")];
    expect(() =>
      selectAutoTeam({ candidates, ratingsFile: EMPTY_RATINGS, protocol: PROTOCOL, topicPath: TOPIC, n: 2.5, rng: seqRng([]) }),
    ).toThrow(AutoTeamSelectionError);
  });

  it("throws TeamTooSmall for an empty candidate list", () => {
    try {
      selectAutoTeam({ candidates: [], ratingsFile: EMPTY_RATINGS, protocol: PROTOCOL, topicPath: TOPIC, n: 3, rng: seqRng([]) });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AutoTeamSelectionError);
      expect((e as AutoTeamSelectionError).code).toBe(AutoTeamErrorCode.TeamTooSmall);
    }
  });

  it("throws UnscoredProtocol for a protocol outside the scored set", () => {
    const candidates = [model("openai/a", "openai"), model("xai/b", "xai")];
    for (const protocol of ["host_interrogation", "sequential_refinement", "red_team", "bogus"]) {
      try {
        selectAutoTeam({ candidates, ratingsFile: EMPTY_RATINGS, protocol, topicPath: TOPIC, n: 2, rng: seqRng([]) });
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AutoTeamSelectionError);
        expect((e as AutoTeamSelectionError).code).toBe(AutoTeamErrorCode.UnscoredProtocol);
      }
    }
  });

  it("accepts all three ScoredProtocol values", () => {
    let file = EMPTY_RATINGS;
    file = withObservations(file, "openai/a", 90, 10);
    file = withObservations(file, "xai/b", 85, 10);
    const candidates = [model("openai/a", "openai"), model("xai/b", "xai")];

    for (const protocol of Object.values(ScoredProtocol)) {
      const result = selectAutoTeam({ candidates, ratingsFile: file, protocol, topicPath: TOPIC, n: 2, rng: seqRng([]) });
      expect(result.models).toHaveLength(2);
    }
  });
});
