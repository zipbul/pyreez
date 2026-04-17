/**
 * Unit tests for GenFuser pattern — LLM fuses candidates into a synthesis draft.
 */

import { describe, it, expect, mock } from "bun:test";
import { fuseCandidates } from "./fuser";

const cand = (id: string, content: string) => ({ id, content });

describe("fuseCandidates", () => {
  it("returns the single candidate's content when N=1", async () => {
    const chat = mock(async () => ({ content: "should not be called" }));
    const result = await fuseCandidates("test/judge", chat, "task", [cand("a", "only answer")]);
    expect(result.fused).toBe("only answer");
    expect(chat).not.toHaveBeenCalled();
  });

  it("returns empty string when no candidates", async () => {
    const chat = mock(async () => ({ content: "x" }));
    const result = await fuseCandidates("test/judge", chat, "task", []);
    expect(result.fused).toBe("");
    expect(chat).not.toHaveBeenCalled();
  });

  it("calls LLM once with all candidates", async () => {
    const chat = mock(async () => ({ content: "fused result" }));
    const result = await fuseCandidates("test/judge", chat, "task", [cand("a", "x"), cand("b", "y")]);
    expect(result.fused).toBe("fused result");
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("includes ranking weights in prompt when provided", async () => {
    const calls: string[] = [];
    const chat = async (_m: string, msgs: any) => {
      calls.push(msgs[1].content);
      return { content: "fused" };
    };
    await fuseCandidates(
      "test/judge", chat, "task",
      [cand("a", "alpha"), cand("b", "beta")],
      { ranking: [{ id: "a", wins: 2, losses: 0 }, { id: "b", wins: 0, losses: 2 }] },
    );
    expect(calls[0]!).toContain("wins=2");
    expect(calls[0]!).toContain("wins=0");
  });

  it("does not include ranking when not provided", async () => {
    const calls: string[] = [];
    const chat = async (_m: string, msgs: any) => {
      calls.push(msgs[1].content);
      return { content: "fused" };
    };
    await fuseCandidates("test/judge", chat, "task", [cand("a", "alpha"), cand("b", "beta")]);
    expect(calls[0]!).not.toContain("wins=");
  });
});
