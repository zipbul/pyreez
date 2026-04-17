/**
 * Unit tests for inspect — integrated post-deliberate workflow.
 */

import { describe, it, expect, mock } from "bun:test";
import { runInspection, type InspectInput } from "./inspect";

function makeDeliberateOutput(overrides?: Partial<any>): any {
  return {
    rounds: [{
      number: 1,
      responses: [
        { model: "a", content: "A says yes" },
        { model: "b", content: "B says yes" },
      ],
    }],
    warnings: [],
    r1Diversity: 0.6,
    ...overrides,
  };
}

describe("runInspection", () => {
  it("skips all checks when deliberate has no rounds", async () => {
    const judge = mock(async () => ({ content: "<convergence>HIGH</convergence>" }));
    const result = await runInspection({
      task: "task",
      deliberate: { rounds: [], warnings: [] },
      judgeModel: "test/judge",
      chat: judge,
    });
    expect(result.skipped).toBe(true);
    expect(judge).not.toHaveBeenCalled();
  });

  it("runs convergence-check when r1_conformity_suspected fires", async () => {
    const calls: string[] = [];
    const judge: InspectInput["chat"] = mock(async (_model, messages) => {
      calls.push(messages[0]!.content!.slice(0, 50));
      return { content: "<convergence>HIGH</convergence>" };
    });
    const result = await runInspection({
      task: "task",
      deliberate: makeDeliberateOutput({ warnings: ["r1_conformity_suspected: ..."], r1Diversity: 0.1 }),
      judgeModel: "test/judge",
      chat: judge,
    });
    expect(result.convergence).toBeDefined();
    expect(result.convergence!.level).toBe("high");
  });

  it("runs convergence-check when r1Diversity is in borderline range (0.20-0.50)", async () => {
    const judge: InspectInput["chat"] = mock(async () => ({
      content: "<convergence>MODERATE</convergence>",
    }));
    const result = await runInspection({
      task: "task",
      deliberate: makeDeliberateOutput({ r1Diversity: 0.35 }),
      judgeModel: "test/judge",
      chat: judge,
    });
    expect(result.convergence).toBeDefined();
  });

  it("ALWAYS runs convergence-check (text-distance signals are dead in practice)", async () => {
    const judge = mock(async () => ({ content: "<convergence>DIVERSE</convergence>" }));
    const result = await runInspection({
      task: "task",
      deliberate: makeDeliberateOutput({ r1Diversity: 0.7 }),
      judgeModel: "test/judge",
      chat: judge,
    });
    expect(result.convergence).toBeDefined();
    expect(judge).toHaveBeenCalled();
  });

  it("runs rank when N >= 4 workers", async () => {
    const responses = [
      { model: "a", content: "A" },
      { model: "b", content: "B" },
      { model: "c", content: "C" },
      { model: "d", content: "D" },
    ];
    const judge: InspectInput["chat"] = mock(async () => ({ content: "A" }));
    const result = await runInspection({
      task: "task",
      deliberate: { rounds: [{ number: 1, responses }], warnings: [], r1Diversity: 0.7 },
      judgeModel: "test/judge",
      chat: judge,
    });
    expect(result.ranking).toBeDefined();
    expect(result.ranking!.length).toBe(4);
  });

  it("skips rank when N < 4 workers (cost > value)", async () => {
    const judge = mock(async () => ({ content: "A" }));
    const result = await runInspection({
      task: "task",
      deliberate: makeDeliberateOutput({ r1Diversity: 0.7 }), // N=2
      judgeModel: "test/judge",
      chat: judge,
    });
    expect(result.ranking).toBeUndefined();
  });

  it("runs quality-check when factualLikely is true", async () => {
    const judge: InspectInput["chat"] = mock(async () => ({
      content: "<unsupported>- none</unsupported><contradicted>- none</contradicted>",
    }));
    const result = await runInspection({
      task: "task",
      deliberate: makeDeliberateOutput({ r1Diversity: 0.7 }),
      judgeModel: "test/judge",
      chat: judge,
      factualLikely: true,
    });
    expect(result.qualityFindings).toBeDefined();
  });

  it("skips quality-check by default (factualLikely undefined)", async () => {
    const judge = mock(async () => ({ content: "" }));
    const result = await runInspection({
      task: "task",
      deliberate: makeDeliberateOutput({ r1Diversity: 0.7 }),
      judgeModel: "test/judge",
      chat: judge,
    });
    expect(result.qualityFindings).toBeUndefined();
  });

  it("aggregates host_actions for each triggered signal", async () => {
    const judge: InspectInput["chat"] = mock(async () => ({
      content: "<convergence>HIGH</convergence>",
    }));
    const result = await runInspection({
      task: "task",
      deliberate: makeDeliberateOutput({
        warnings: ["r1_conformity_suspected: ..."],
        r1Diversity: 0.15,
      }),
      judgeModel: "test/judge",
      chat: judge,
    });
    expect(result.host_actions.length).toBeGreaterThan(0);
    expect(result.host_actions.some((a) => a.includes("reframe"))).toBe(true);
  });
});
