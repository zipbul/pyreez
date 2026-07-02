/**
 * Unit tests for the affinity store: log→tree compaction, ancestor rollup, host read view.
 * Pure logic (no LLM, no discovery); I/O helpers exercised via a mocked FileIO.
 */

import { describe, it, expect, mock } from "bun:test";
import {
  compactAffinityLog,
  rollupAxisScore,
  readAffinityView,
  appendAffinityLog,
  THIN_N,
  type AffinityLogRecord,
  type AffinityTree,
} from "./affinity";
import type { FileIO } from "../report/types";

function rec(over: Partial<AffinityLogRecord> = {}): AffinityLogRecord {
  return {
    v: 1,
    ts: 1,
    protocol: "adversarial_debate",
    path: ["인증-보안", "토큰-캐싱"],
    model: "anthropic/claude-opus",
    axes: { "정확성": 80 },
    ...over,
  };
}

describe("compactAffinityLog", () => {
  it("builds a nested tree keyed by path segments under the protocol", () => {
    const tree = compactAffinityLog([rec({ path: ["인증-보안", "토큰-캐싱"] })]);
    const proto = tree["adversarial_debate"]!;
    expect(proto.children["인증-보안"]).toBeDefined();
    expect(proto.children["인증-보안"]!.children["토큰-캐싱"]).toBeDefined();
  });

  it("folds repeated (node,model,axis) observations into mean + n", () => {
    const tree = compactAffinityLog([
      rec({ axes: { "정확성": 60 } }),
      rec({ axes: { "정확성": 90 } }),
    ]);
    const node = tree["adversarial_debate"]!.children["인증-보안"]!.children["토큰-캐싱"]!;
    expect(node.scores["anthropic/claude-opus"]!["정확성"]).toEqual({ mean: 75, n: 2 });
  });

  it("records axes per node from observed axis keys (topic-specific, not global)", () => {
    const tree = compactAffinityLog([
      rec({ path: ["보안"], axes: { "취약점-탐지": 88, "정확성": 80 } }),
      rec({ path: ["창의"], axes: { "창의력": 70 } }),
    ]);
    const root = tree["adversarial_debate"]!;
    expect(new Set(root.children["보안"]!.axes)).toEqual(new Set(["취약점-탐지", "정확성"]));
    expect(root.children["창의"]!.axes).toEqual(["창의력"]);
  });

  it("keeps per-model, per-axis scores separate", () => {
    const tree = compactAffinityLog([
      rec({ model: "anthropic/claude-opus", axes: { "정확성": 88 } }),
      rec({ model: "xai/grok-build", axes: { "정확성": 70, "취약점-탐지": 90 } }),
    ]);
    const node = tree["adversarial_debate"]!.children["인증-보안"]!.children["토큰-캐싱"]!;
    expect(node.scores["anthropic/claude-opus"]!["정확성"]!.mean).toBe(88);
    expect(node.scores["xai/grok-build"]!["취약점-탐지"]!.mean).toBe(90);
  });
});

describe("rollupAxisScore", () => {
  // helper: build a tree where leaf is thin, ancestor is dense
  function tree(): AffinityTree {
    return compactAffinityLog([
      // ancestor "토큰-캐싱": 3 dense observations for opus/정확성 = mean 90, n 3
      rec({ path: ["인증-보안", "토큰-캐싱"], axes: { "정확성": 90 } }),
      rec({ path: ["인증-보안", "토큰-캐싱"], axes: { "정확성": 90 } }),
      rec({ path: ["인증-보안", "토큰-캐싱"], axes: { "정확성": 90 } }),
      // leaf "폐기": 1 thin observation = mean 60, n 1
      rec({ path: ["인증-보안", "토큰-캐싱", "폐기"], axes: { "정확성": 60 } }),
    ]);
  }

  it("uses the local score when n >= THIN_N", () => {
    const r = rollupAxisScore(tree(), "adversarial_debate", ["인증-보안", "토큰-캐싱"], "anthropic/claude-opus", "정확성");
    expect(r).toEqual({ mean: 90, n: 3, rolledUp: false });
  });

  it("blends a thin leaf (0<n<THIN_N) with the nearest ancestor", () => {
    // local mean 60 n1, ancestor mean 90 → (60*1 + 90*(3-1))/3 = (60+180)/3 = 80
    const r = rollupAxisScore(tree(), "adversarial_debate", ["인증-보안", "토큰-캐싱", "폐기"], "anthropic/claude-opus", "정확성");
    expect(r!.mean).toBe(80);
    expect(r!.rolledUp).toBe(true);
  });

  it("falls back to the ancestor when the node has no local score (n=0)", () => {
    const r = rollupAxisScore(tree(), "adversarial_debate", ["인증-보안", "토큰-캐싱", "폐기"], "anthropic/claude-opus", "논리성");
    // "논리성" absent everywhere → undefined (no ancestor has it either)
    expect(r).toBeUndefined();
  });

  it("rolls up only on an exact axis-name match (no inheritance of a different axis)", () => {
    const t = compactAffinityLog([
      rec({ path: ["인증-보안"], axes: { "정확성": 90 } }),
      rec({ path: ["인증-보안"], axes: { "정확성": 90 } }),
      rec({ path: ["인증-보안"], axes: { "정확성": 90 } }),
      rec({ path: ["인증-보안", "폐기"], axes: { "취약점-탐지": 50 } }),
    ]);
    // child axis 취약점-탐지 has n1, ancestor only has 정확성 → no same-axis ancestor → local-only blend impossible
    const r = rollupAxisScore(t, "adversarial_debate", ["인증-보안", "폐기"], "anthropic/claude-opus", "취약점-탐지");
    expect(r!.mean).toBe(50); // stays local; no ancestor prior for this axis
    expect(r!.n).toBe(1);
  });
});

describe("readAffinityView", () => {
  it("returns the node subtree plus nearest-first ancestors with their axes", () => {
    const t = compactAffinityLog([
      rec({ path: ["인증-보안"], axes: { "정확성": 80 } }),
      rec({ path: ["인증-보안", "토큰-캐싱"], axes: { "취약점-탐지": 88 } }),
    ]);
    const view = readAffinityView(t, "adversarial_debate", ["인증-보안", "토큰-캐싱"]);
    expect(view!.node.axes).toContain("취약점-탐지");
    // ancestors nearest-first: 인증-보안 (has 정확성), then protocol root
    expect(view!.ancestors[0]!.axes).toContain("정확성");
  });

  it("returns undefined for an unknown path", () => {
    const t = compactAffinityLog([rec()]);
    expect(readAffinityView(t, "adversarial_debate", ["없는-주제"])).toBeUndefined();
  });
});

describe("appendAffinityLog", () => {
  it("appends one JSONL line via FileIO.appendFile", async () => {
    const io: FileIO = {
      appendFile: mock(async () => {}),
      readFile: mock(async () => ""),
      writeFile: mock(async () => {}),
      mkdir: mock(async () => {}),
      glob: mock(async () => []),
      removeGlob: mock(async () => {}),
    };
    await appendAffinityLog(io, "/tmp/aff/log.jsonl", rec());
    expect(io.mkdir).toHaveBeenCalled();
    const [path, data] = (io.appendFile as ReturnType<typeof mock>).mock.calls[0]!;
    expect(path).toBe("/tmp/aff/log.jsonl");
    expect(JSON.parse((data as string).trim())).toMatchObject({ protocol: "adversarial_debate" });
    expect((data as string).endsWith("\n")).toBe(true);
  });
});

describe("THIN_N", () => {
  it("is 3", () => expect(THIN_N).toBe(3));
});
