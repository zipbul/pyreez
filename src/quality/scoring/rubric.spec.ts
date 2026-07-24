/**
 * Unit tests for the panel rubric — merged prompt (라벨링된 답 N개) + 라벨별 판정 파싱.
 */

import { describe, it, expect } from "bun:test";
import { buildPanelMessages, parsePanelVerdict } from "./rubric";

const AXES = ["accuracy", "depth", "grounding"];

describe("buildPanelMessages", () => {
  it("labels every answer and includes the task and axes", () => {
    const msgs = buildPanelMessages("do X", AXES, ["answer one", "answer two"]);
    const user = msgs[1]!.content!;
    expect(user).toContain("do X");
    expect(user).toContain("accuracy, depth, grounding");
    expect(user).toContain("answer one");
    expect(user).toContain("answer two");
    expect(user).toContain('label="A"');
    expect(user).toContain('label="B"');
  });

  it("instructs the judge to ignore formatting/length", () => {
    const msgs = buildPanelMessages("t", AXES, ["a"]);
    expect(msgs[0]!.content).toContain("IGNORE length, formatting, style");
  });
});

describe("parsePanelVerdict", () => {
  it("parses a clean multi-label JSON object", () => {
    const text =
      '{"A": {"accuracy": 90, "depth": 80, "grounding": 70}, "B": {"accuracy": 50, "depth": 40, "grounding": 30}}';
    const verdicts = parsePanelVerdict(text, AXES, 2);
    expect(verdicts).toEqual([
      { position: 0, scores: { accuracy: 90, depth: 80, grounding: 70 } },
      { position: 1, scores: { accuracy: 50, depth: 40, grounding: 30 } },
    ]);
  });

  it("clamps out-of-range scores and rounds", () => {
    const text = '{"A": {"accuracy": 140, "depth": 0.4, "grounding": 50}}';
    const verdicts = parsePanelVerdict(text, AXES, 1);
    expect(verdicts[0]!.scores).toEqual({ accuracy: 100, depth: 1, grounding: 50 });
  });

  it("omits axes the judge did not score", () => {
    const text = '{"A": {"accuracy": 90}}';
    const verdicts = parsePanelVerdict(text, AXES, 1);
    expect(verdicts[0]!.scores).toEqual({ accuracy: 90 });
  });

  it("marks a label as undefined when it is missing from the output", () => {
    const text = '{"A": {"accuracy": 90, "depth": 80, "grounding": 70}}'; // B missing
    const verdicts = parsePanelVerdict(text, AXES, 2);
    expect(verdicts[0]).toBeDefined();
    expect(verdicts[1]).toBeUndefined();
  });

  it("marks a label as undefined when it has no finite axis scores at all", () => {
    const text = '{"A": {"accuracy": "not a number"}}';
    const verdicts = parsePanelVerdict(text, AXES, 1);
    expect(verdicts[0]).toBeUndefined();
  });

  it("marks a label as undefined when its value is not an object", () => {
    const text = '{"A": "not an object"}';
    const verdicts = parsePanelVerdict(text, AXES, 1);
    expect(verdicts[0]).toBeUndefined();
  });

  it("returns all-undefined when there is no JSON object at all", () => {
    expect(parsePanelVerdict("no json here", AXES, 2)).toEqual([undefined, undefined]);
  });

  it("returns all-undefined when the braces contain invalid JSON", () => {
    expect(parsePanelVerdict("{ A: broken }", AXES, 1)).toEqual([undefined]);
  });

  it("tolerates surrounding prose / code fences", () => {
    const text = 'Here:\n```json\n{"A": {"accuracy": 70, "depth": 60, "grounding": 50}}\n```';
    const verdicts = parsePanelVerdict(text, AXES, 1);
    expect(verdicts[0]!.scores).toEqual({ accuracy: 70, depth: 60, grounding: 50 });
  });
});
