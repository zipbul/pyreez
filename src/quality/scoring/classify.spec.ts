/**
 * Unit tests for topic classification — 1콜 분류(고정 taxonomy + kebab 하위주제),
 * 호스트 --topic 우선(콜 생략).
 */

import { describe, it, expect, mock } from "bun:test";
import { buildClassifyMessages, classifyTopic, parseClassifyResult } from "./classify";
import { CLASSIFIER_MODEL, DOMAIN_TAXONOMY } from "./constants";
import type { ScoringDeps } from "./interfaces";

function fakeDeps(overrides?: Partial<ScoringDeps>): ScoringDeps {
  return {
    chat: mock(async () => ({ content: '{"domain": "medicine", "subtopic": "cardiac-arrhythmia"}' })),
    fileIO: {
      appendFile: mock(async () => {}),
      readFile: mock(async () => ""),
      writeFile: mock(async () => {}),
      mkdir: mock(async () => {}),
      glob: mock(async () => []),
      rename: mock(async () => {}),
    },
    now: () => 1_000,
    rng: () => 0.5,
    ...overrides,
  };
}

describe("buildClassifyMessages", () => {
  it("includes the task and the fixed taxonomy", () => {
    const msgs = buildClassifyMessages("diagnose this rash");
    expect(msgs[1]!.content).toContain("diagnose this rash");
    expect(msgs[0]!.content).toContain(DOMAIN_TAXONOMY[0]!);
  });
});

describe("parseClassifyResult", () => {
  it("parses a valid domain+subtopic", () => {
    expect(parseClassifyResult('{"domain": "medicine", "subtopic": "cardiac-arrhythmia"}')).toEqual([
      "medicine",
      "cardiac-arrhythmia",
    ]);
  });

  it("falls back to general when the domain is not in the taxonomy", () => {
    expect(parseClassifyResult('{"domain": "astrology", "subtopic": "horoscopes"}')).toEqual([
      "general",
      "horoscopes",
    ]);
  });

  it("returns a single-segment path when no subtopic is present", () => {
    expect(parseClassifyResult('{"domain": "law"}')).toEqual(["law"]);
  });

  it("falls back fully to general when there is no JSON object at all", () => {
    expect(parseClassifyResult("no json here")).toEqual(["general"]);
  });

  it("falls back fully to general when the braces contain invalid JSON", () => {
    expect(parseClassifyResult("{ domain: medicine }")).toEqual(["general"]);
  });

  it("kebab-cases a messy subtopic", () => {
    expect(parseClassifyResult('{"domain": "medicine", "subtopic": "Cardiac Arrhythmia!"}')).toEqual([
      "medicine",
      "cardiac-arrhythmia",
    ]);
  });
});

describe("classifyTopic", () => {
  it("calls the classifier model and returns the parsed path", async () => {
    const deps = fakeDeps();
    const path = await classifyTopic(deps, "diagnose this rash");
    expect(path).toEqual(["medicine", "cardiac-arrhythmia"]);
    expect(deps.chat).toHaveBeenCalledTimes(1);
    const [model] = (deps.chat as ReturnType<typeof mock>).mock.calls[0]!;
    expect(model).toBe(CLASSIFIER_MODEL);
  });

  it("forces webAccess off for the classifier call", async () => {
    const deps = fakeDeps();
    await classifyTopic(deps, "task");
    const [, , params] = (deps.chat as ReturnType<typeof mock>).mock.calls[0]!;
    expect(params).toMatchObject({ webAccess: false });
  });

  it("skips the call and uses the host topic path when given", async () => {
    const chat = mock(async () => ({ content: "should not be used" }));
    const deps = fakeDeps({ chat, hostTopicPath: ["test", "smoke"] });
    const path = await classifyTopic(deps, "task");
    expect(path).toEqual(["test", "smoke"]);
    expect(chat).not.toHaveBeenCalled();
  });
});
