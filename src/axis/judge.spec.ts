import { describe, it, expect, mock } from "bun:test";
import type { FileIO } from "../report/types";
import { LlmJudge } from "./judge";
import type { ChatFn } from "./types";

function makeMockChat(response: string): ChatFn {
  return mock(async (_model: string, _input: string | any[]) => response) as any;
}

describe("LlmJudge", () => {
  const judgeModel = "gpt-4.1-nano";

  // 1. [HP] valid JSON score response extracted correctly
  it("should extract score from valid JSON response", async () => {
    const chat = makeMockChat('{"score": 8}');
    const judge = new LlmJudge({ chatFn: chat, judgeModel });

    const score = await judge.evaluate("Write a function", "function add(a,b){return a+b}");
    expect(score).toBe(8);
  });

  // 2. [HP] regex fallback when JSON fails
  it("should fall back to regex when JSON parsing fails", async () => {
    const chat = makeMockChat("I would rate this a 7 out of 10.");
    const judge = new LlmJudge({ chatFn: chat, judgeModel });

    const score = await judge.evaluate("task", "response");
    expect(score).toBe(7);
  });

  // 3. [NE] chat throws → default score 5
  it("should return default score when chat throws", async () => {
    const chat = mock(async () => {
      throw new Error("API down");
    }) as any;
    const judge = new LlmJudge({ chatFn: chat, judgeModel });

    const score = await judge.evaluate("task", "response");
    expect(score).toBe(5);
  });

  // 4. [NE] score > 10 → clamped to 10
  it("should clamp score to 10 when above range", async () => {
    const chat = makeMockChat('{"score": 15}');
    const judge = new LlmJudge({ chatFn: chat, judgeModel });

    const score = await judge.evaluate("task", "response");
    expect(score).toBe(10);
  });

  // 5. [NE] score < 0 → clamped to 0
  it("should clamp score to 0 when below range", async () => {
    const chat = makeMockChat('{"score": -3}');
    const judge = new LlmJudge({ chatFn: chat, judgeModel });

    const score = await judge.evaluate("task", "response");
    expect(score).toBe(0);
  });

  // 6. [ED] empty response → default score
  it("should return default score for empty response", async () => {
    const chat = makeMockChat("");
    const judge = new LlmJudge({ chatFn: chat, judgeModel });

    const score = await judge.evaluate("task", "response");
    expect(score).toBe(5);
  });

  // 7. [CO] no valid score format → default
  it("should return default when response has no parseable score", async () => {
    const chat = makeMockChat("This is a great response with excellent quality.");
    const judge = new LlmJudge({ chatFn: chat, judgeModel });

    const score = await judge.evaluate("task", "response");
    expect(score).toBe(5);
  });

  // 8. [ID] repeated evaluation same inputs → same result
  it("should return consistent results for same inputs", async () => {
    const chat = makeMockChat('{"score": 7}');
    const judge = new LlmJudge({ chatFn: chat, judgeModel });

    const s1 = await judge.evaluate("task", "response");
    const s2 = await judge.evaluate("task", "response");
    expect(s1).toBe(s2);
  });
});
