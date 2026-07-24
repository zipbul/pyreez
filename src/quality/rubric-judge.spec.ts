/**
 * Unit tests for the rubric judge: per-axis JSON parsing (clamp, requested-only, tolerant extraction),
 * message construction, and scoreResponse over a mocked judge chat.
 */

import { describe, it, expect, mock } from "bun:test";
import { buildRubricMessages, parseRubricScores, scoreResponse } from "./rubric-judge";

describe("parseRubricScores", () => {
  const axes = ["정확성", "창의력"];

  it("parses a clean JSON object, keeping only requested axes", () => {
    expect(parseRubricScores('{"정확성": 82, "창의력": 60, "잡음": 99}', axes)).toEqual({ "정확성": 82, "창의력": 60 });
  });

  it("clamps to 1-100 and rounds", () => {
    expect(parseRubricScores('{"정확성": 140, "창의력": 0.4}', axes)).toEqual({ "정확성": 100, "창의력": 1 });
  });

  it("tolerates surrounding prose / code fences (extracts the last object)", () => {
    expect(parseRubricScores('Here you go:\n```json\n{"정확성": 70, "창의력": 55}\n```', axes)).toEqual({ "정확성": 70, "창의력": 55 });
  });

  it("omits axes the judge did not score", () => {
    expect(parseRubricScores('{"정확성": 90}', axes)).toEqual({ "정확성": 90 });
  });

  it("returns {} on malformed output", () => {
    expect(parseRubricScores("no json here", axes)).toEqual({});
  });
});

describe("buildRubricMessages", () => {
  it("includes the task, axes, and response", () => {
    const msgs = buildRubricMessages("eval X", ["정확성", "창의력"], "the answer");
    const user = msgs[1]!.content!;
    expect(user).toContain("eval X");
    expect(user).toContain("정확성, 창의력");
    expect(user).toContain("the answer");
  });
});

describe("scoreResponse", () => {
  it("returns parsed per-axis scores from the judge", async () => {
    const chat = mock(async () => ({ content: '{"정확성": 88, "창의력": 40}' }));
    const scores = await scoreResponse(chat, "judge/model", "task", ["정확성", "창의력"], "resp");
    expect(scores).toEqual({ "정확성": 88, "창의력": 40 });
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("returns {} when there are no axes (no call made)", async () => {
    const chat = mock(async () => ({ content: "{}" }));
    expect(await scoreResponse(chat, "judge/model", "task", [], "resp")).toEqual({});
    expect(chat).not.toHaveBeenCalled();
  });

  it("returns {} when the judge call throws", async () => {
    const chat = mock(async () => { throw new Error("judge down"); });
    expect(await scoreResponse(chat, "judge/model", "task", ["정확성"], "resp")).toEqual({});
  });
});
