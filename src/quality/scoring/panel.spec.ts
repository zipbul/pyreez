/**
 * Unit tests for the 3-judge panel — 콜당 1 judge(런당 정확히 3콜), 셔플·역셔플, 쿼럼, 중앙값.
 */

import { describe, it, expect, mock } from "bun:test";
import { runPanel } from "./panel";
import { JUDGE_PANEL } from "./constants";
import type { ScoringDeps } from "./interfaces";

const AXES = ["accuracy", "depth"];

function fakeDeps(chat: ScoringDeps["chat"], rng: () => number = () => 0.9999): ScoringDeps {
  return {
    chat,
    fileIO: {
      appendFile: mock(async () => {}),
      readFile: mock(async () => ""),
      writeFile: mock(async () => {}),
      mkdir: mock(async () => {}),
      glob: mock(async () => []),
      rename: mock(async () => {}),
    },
    now: () => 1_000,
    rng,
  };
}

describe("runPanel", () => {
  it("computes the per-axis median across all 3 judges when quorum is met", async () => {
    const chat = mock(async () => ({
      content: '{"A": {"accuracy": 90, "depth": 80}, "B": {"accuracy": 60, "depth": 50}}',
    }));
    const result = await runPanel(fakeDeps(chat), "task", AXES, ["content A", "content B"]);

    expect(result.failedJudges).toEqual([]);
    expect(result.workers).toHaveLength(2);
    expect(result.workers[0]!.median).toEqual({ accuracy: 90, depth: 80 });
    expect(result.workers[1]!.median).toEqual({ accuracy: 60, depth: 50 });
  });

  it("calls exactly one chat per judge in the fixed panel (3 calls total, not per-worker)", async () => {
    const chat = mock(async () => ({ content: '{"A": {"accuracy": 90, "depth": 80}}' }));
    await runPanel(fakeDeps(chat), "task", AXES, ["only answer"]);
    expect(chat).toHaveBeenCalledTimes(JUDGE_PANEL.length);
  });

  it("forces webAccess off for every judge call", async () => {
    const chat = mock(async () => ({ content: '{"A": {"accuracy": 90, "depth": 80}}' }));
    await runPanel(fakeDeps(chat), "task", AXES, ["a"]);
    for (const call of (chat as ReturnType<typeof mock>).mock.calls) {
      expect(call[2]).toMatchObject({ webAccess: false });
    }
  });

  it("uses one of the fixed JUDGE_PANEL models for each call", async () => {
    const chat = mock(async () => ({ content: '{"A": {"accuracy": 90, "depth": 80}}' }));
    await runPanel(fakeDeps(chat), "task", AXES, ["a"]);
    const modelsCalled = (chat as ReturnType<typeof mock>).mock.calls.map((c) => c[0]);
    expect(modelsCalled).toEqual([...JUDGE_PANEL]);
  });

  it("skips a worker (quorum) when fewer than 3 judges return a usable verdict", async () => {
    let callIdx = 0;
    const chat = mock(async () => {
      callIdx++;
      // the last judge in the panel fails to produce anything usable
      if (callIdx === JUDGE_PANEL.length) return { content: "no json here" };
      return { content: '{"A": {"accuracy": 90, "depth": 80}}' };
    });
    const result = await runPanel(fakeDeps(chat), "task", AXES, ["only answer"]);

    expect(result.workers[0]!.median).toBeUndefined();
    expect(result.workers[0]!.judgeScores.filter((v) => v !== undefined)).toHaveLength(2);
  });

  it("treats a throwing judge as a fully invalid vote and records it in failedJudges", async () => {
    let callIdx = 0;
    const chat = mock(async () => {
      callIdx++;
      if (callIdx === 1) throw new Error("judge down");
      return { content: '{"A": {"accuracy": 90, "depth": 80}}' };
    });
    const result = await runPanel(fakeDeps(chat), "task", AXES, ["only answer"]);

    expect(result.failedJudges).toEqual([0]);
    expect(result.workers[0]!.median).toBeUndefined(); // only 2/3 valid now
  });

  it("un-shuffles judge scores back to the original worker index", async () => {
    const chat = mock(async () => ({
      content: '{"A": {"accuracy": 90, "depth": 80}, "B": {"accuracy": 60, "depth": 50}}',
    }));
    // n=2 Fisher–Yates with rng()=0.1 always swaps position 1 with position 0 -> order=[1,0]
    const rng = () => 0.1;
    const result = await runPanel(fakeDeps(chat, rng), "task", AXES, ["first-content", "second-content"]);

    // presented position 0 (label A) was original worker 1 (order[0]=1)
    expect(result.workers[1]!.median).toEqual({ accuracy: 90, depth: 80 });
    // presented position 1 (label B) was original worker 0
    expect(result.workers[0]!.median).toEqual({ accuracy: 60, depth: 50 });
  });
});
