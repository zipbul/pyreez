/**
 * Unit tests for LLM-judge.
 */

import { describe, it, expect, mock } from "bun:test";
import { createLLMJudge } from "./llm-judge";
import type { ChatFn } from "./llm-judge";

const cand = (id: string, content: string) => ({ id, content });

function makeChat(verdicts: string[]): ChatFn {
  let i = 0;
  return mock(async () => ({ content: verdicts[i++ % verdicts.length]! }));
}

describe("createLLMJudge", () => {
  it("returns A when both orderings agree (forward=A, swapped=B)", async () => {
    // forward A vs B → A wins. Swapped B vs A → B wins (because b passed first, but a is stronger).
    const chat = makeChat(["A", "B"]);
    const judge = createLLMJudge("test/judge", chat);
    const verdict = await judge("task", cand("a", "x"), cand("b", "y"));
    expect(verdict).toBe("A");
  });

  it("returns B when both orderings agree (forward=B, swapped=A)", async () => {
    const chat = makeChat(["B", "A"]);
    const judge = createLLMJudge("test/judge", chat);
    const verdict = await judge("task", cand("a", "x"), cand("b", "y"));
    expect(verdict).toBe("B");
  });

  it("returns TIE when orderings disagree (position bias)", async () => {
    // forward says A, swapped also says A — that means model has positional bias toward first slot
    const chat = makeChat(["A", "A"]);
    const judge = createLLMJudge("test/judge", chat);
    const verdict = await judge("task", cand("a", "x"), cand("b", "y"));
    expect(verdict).toBe("TIE");
  });

  it("returns TIE when judge says TIE in either pass", async () => {
    const chat = makeChat(["TIE", "B"]);
    const judge = createLLMJudge("test/judge", chat);
    const verdict = await judge("task", cand("a", "x"), cand("b", "y"));
    expect(verdict).toBe("TIE");
  });

  it("parses verdict from last non-empty line", async () => {
    const chat = makeChat(["Reasoning here.\n\nThe answer is A.\nA", "B"]);
    const judge = createLLMJudge("test/judge", chat);
    const verdict = await judge("task", cand("a", "x"), cand("b", "y"));
    expect(verdict).toBe("A");
  });

  it("falls back to last A/B/TIE mention when last line is not a clean verdict", async () => {
    const chat = makeChat(["I think B is stronger.", "I think A is stronger."]);
    const judge = createLLMJudge("test/judge", chat);
    const verdict = await judge("task", cand("a", "x"), cand("b", "y"));
    expect(verdict).toBe("B");
  });
});

describe("createLLMJudge with positionBias=lazy", () => {
  it("makes only 1 call when forward verdict is decisive (A)", async () => {
    let calls = 0;
    const chat = async () => {
      calls++;
      return { content: "A" };
    };
    const judge = createLLMJudge("test/judge", chat, { positionBias: "lazy" });
    const verdict = await judge("task", { id: "a", content: "x" }, { id: "b", content: "y" });
    expect(calls).toBe(1);
    expect(verdict).toBe("A");
  });

  it("makes only 1 call when forward verdict is decisive (B)", async () => {
    let calls = 0;
    const chat = async () => {
      calls++;
      return { content: "B" };
    };
    const judge = createLLMJudge("test/judge", chat, { positionBias: "lazy" });
    const verdict = await judge("task", { id: "a", content: "x" }, { id: "b", content: "y" });
    expect(calls).toBe(1);
    expect(verdict).toBe("B");
  });

  it("falls back to swap when forward is TIE", async () => {
    let calls = 0;
    const chat = async () => {
      calls++;
      return { content: calls === 1 ? "TIE" : "A" };
    };
    const judge = createLLMJudge("test/judge", chat, { positionBias: "lazy" });
    const verdict = await judge("task", { id: "a", content: "x" }, { id: "b", content: "y" });
    expect(calls).toBe(2);
    // swap was a vs b passed as (b,a) — A means b wins
    expect(verdict).toBe("B");
  });
});
