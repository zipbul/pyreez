/**
 * Unit tests for PairRanker — pairwise LLM judging of worker responses.
 */

import { describe, it, expect, mock } from "bun:test";
import { rankByPairwise, type Candidate, type JudgeFn } from "./pairranker";

function cand(id: string, content: string): Candidate {
  return { id, content };
}

describe("rankByPairwise", () => {
  it("returns single candidate unchanged when only 1 candidate", async () => {
    const judge = mock(async () => "A" as const);
    const result = await rankByPairwise("task", [cand("a", "x")], judge);
    expect(result.ranking).toEqual([{ id: "a", wins: 0, losses: 0 }]);
    expect(judge).not.toHaveBeenCalled();
  });

  it("ranks candidates by win count when judge consistently picks A", async () => {
    const judge: JudgeFn = mock(async () => "A");
    const cands = [cand("a", "first"), cand("b", "second"), cand("c", "third")];
    const result = await rankByPairwise("task", cands, judge);

    // Each pair: judge picks A (the first candidate in the pair).
    // For 3 candidates with stable order: a vs b → a wins; a vs c → a wins; b vs c → b wins.
    // a: 2 wins, b: 1 win 1 loss, c: 2 losses
    expect(result.ranking[0]!.id).toBe("a");
    expect(result.ranking[0]!.wins).toBe(2);
    expect(result.ranking[2]!.id).toBe("c");
    expect(result.ranking[2]!.losses).toBe(2);
  });

  it("calls judge N*(N-1)/2 times for N candidates", async () => {
    const judge = mock(async () => "A" as const);
    const cands = [cand("a", "x"), cand("b", "y"), cand("c", "z"), cand("d", "w")];
    await rankByPairwise("task", cands, judge);
    // 4 choose 2 = 6 pairs
    expect(judge).toHaveBeenCalledTimes(6);
  });

  it("treats invalid judge output (not 'A' or 'B') as a tie (no win for either)", async () => {
    const judge: JudgeFn = mock(async () => "tie" as any);
    const cands = [cand("a", "x"), cand("b", "y")];
    const result = await rankByPairwise("task", cands, judge);
    expect(result.ranking[0]!.wins).toBe(0);
    expect(result.ranking[1]!.wins).toBe(0);
  });

  it("preserves stable order on win-count ties", async () => {
    // Judge returns A then B then A again — alternating
    let calls = 0;
    const judge: JudgeFn = mock(async () => {
      calls++;
      return calls % 2 === 1 ? "A" : "B";
    });
    const cands = [cand("a", "x"), cand("b", "y"), cand("c", "z")];
    const result = await rankByPairwise("task", cands, judge);
    // Ranking length matches input
    expect(result.ranking).toHaveLength(3);
    // All candidates appear exactly once
    const ids = result.ranking.map((r) => r.id).sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("passes task and candidate contents to judge", async () => {
    const calls: { task: string; a: string; b: string }[] = [];
    const judge: JudgeFn = async (task, a, b) => {
      calls.push({ task, a: a.content, b: b.content });
      return "A";
    };
    await rankByPairwise("compare these", [cand("a", "alpha"), cand("b", "beta")], judge);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.task).toBe("compare these");
    expect(calls[0]!.a).toBe("alpha");
    expect(calls[0]!.b).toBe("beta");
  });

  it("propagates judge errors", async () => {
    const judge: JudgeFn = async () => {
      throw new Error("judge failed");
    };
    const cands = [cand("a", "x"), cand("b", "y")];
    await expect(rankByPairwise("task", cands, judge)).rejects.toThrow("judge failed");
  });
});
