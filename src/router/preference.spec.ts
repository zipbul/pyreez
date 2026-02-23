/**
 * Preference Router tests.
 */
import { describe, it, expect } from "bun:test";
import {
  PreferenceTable,
  winRate,
  entryConfidence,
  routeByPreference,
  type PreferenceEntry,
} from "./preference";
import type { PairwiseResult } from "../evaluation/types";

// -- Helpers --

function makePairwise(
  modelA: string,
  modelB: string,
  outcome: "A>>B" | "A>B" | "A=B" | "B>A" | "B>>A",
): PairwiseResult {
  return {
    promptId: "p1",
    modelA,
    modelB,
    judge: "judge",
    outcome,
    swapped: false,
    reasoning: "",
    confidence: 0.9,
  };
}

// ================================================================
// PreferenceTable
// ================================================================

describe("PreferenceTable", () => {
  it("should record wins and losses from A>B", () => {
    const table = new PreferenceTable();
    table.record(makePairwise("m1", "m2", "A>B"), "CODE_WRITE");
    const e1 = table.getEntry("CODE_WRITE", "m1")!;
    expect(e1.wins).toBe(1);
    expect(e1.losses).toBe(0);
    const e2 = table.getEntry("CODE_WRITE", "m2")!;
    expect(e2.wins).toBe(0);
    expect(e2.losses).toBe(1);
  });

  it("should record ties from A=B", () => {
    const table = new PreferenceTable();
    table.record(makePairwise("m1", "m2", "A=B"), "CODE_WRITE");
    expect(table.getEntry("CODE_WRITE", "m1")!.ties).toBe(1);
    expect(table.getEntry("CODE_WRITE", "m2")!.ties).toBe(1);
  });

  it("should record B>A as loss for A, win for B", () => {
    const table = new PreferenceTable();
    table.record(makePairwise("m1", "m2", "B>A"), "CODE_WRITE");
    expect(table.getEntry("CODE_WRITE", "m1")!.losses).toBe(1);
    expect(table.getEntry("CODE_WRITE", "m2")!.wins).toBe(1);
  });

  it("should track task types", () => {
    const table = new PreferenceTable();
    table.record(makePairwise("m1", "m2", "A>B"), "CODE_WRITE");
    table.record(makePairwise("m1", "m2", "A>B"), "TRANSLATE");
    expect(table.taskTypes().sort()).toEqual(["CODE_WRITE", "TRANSLATE"]);
  });

  it("should track model IDs across tasks", () => {
    const table = new PreferenceTable();
    table.record(makePairwise("m1", "m2", "A>B"), "CODE_WRITE");
    table.record(makePairwise("m3", "m2", "A>B"), "TRANSLATE");
    expect(table.modelIds().sort()).toEqual(["m1", "m2", "m3"]);
  });

  it("should count total comparisons", () => {
    const table = new PreferenceTable();
    table.record(makePairwise("m1", "m2", "A>B"), "CODE_WRITE");
    table.record(makePairwise("m1", "m3", "B>A"), "CODE_WRITE");
    expect(table.totalComparisons).toBe(2);
  });

  it("should return undefined for non-existent entry", () => {
    const table = new PreferenceTable();
    expect(table.getEntry("NONE", "m1")).toBeUndefined();
  });

  it("should return empty for non-existent task", () => {
    const table = new PreferenceTable();
    expect(table.getEntriesForTask("NONE")).toHaveLength(0);
  });
});

// ================================================================
// winRate & entryConfidence
// ================================================================

describe("winRate", () => {
  it("should return 1.0 for all wins", () => {
    expect(winRate({ modelId: "m", taskType: "t", wins: 10, losses: 0, ties: 0 })).toBe(1.0);
  });

  it("should return 0.0 for all losses", () => {
    expect(winRate({ modelId: "m", taskType: "t", wins: 0, losses: 10, ties: 0 })).toBe(0.0);
  });

  it("should return 0.5 for no data", () => {
    expect(winRate({ modelId: "m", taskType: "t", wins: 0, losses: 0, ties: 0 })).toBe(0.5);
  });

  it("should count ties as half wins", () => {
    // 0 wins + 2 ties → (0 + 1) / 2 = 0.5
    expect(winRate({ modelId: "m", taskType: "t", wins: 0, losses: 0, ties: 2 })).toBe(0.5);
    // 1 win + 1 tie → (1 + 0.5) / 2 = 0.75
    expect(winRate({ modelId: "m", taskType: "t", wins: 1, losses: 0, ties: 1 })).toBe(0.75);
  });
});

describe("entryConfidence", () => {
  it("should return 0 for no data", () => {
    expect(entryConfidence({ modelId: "m", taskType: "t", wins: 0, losses: 0, ties: 0 })).toBe(0);
  });

  it("should increase with more comparisons", () => {
    const few = entryConfidence({ modelId: "m", taskType: "t", wins: 2, losses: 1, ties: 0 });
    const many = entryConfidence({ modelId: "m", taskType: "t", wins: 20, losses: 10, ties: 0 });
    expect(many).toBeGreaterThan(few);
  });

  it("should approach 1.0 for many comparisons", () => {
    const conf = entryConfidence({ modelId: "m", taskType: "t", wins: 100, losses: 50, ties: 50 });
    expect(conf).toBeGreaterThan(0.9);
  });
});

// ================================================================
// routeByPreference
// ================================================================

describe("routeByPreference", () => {
  it("should rank models by win rate", () => {
    const table = new PreferenceTable();
    // m1 beats m2 three times
    for (let i = 0; i < 3; i++) {
      table.record(makePairwise("m1", "m2", "A>B"), "CODE_WRITE");
    }

    const ranked = routeByPreference(table, "CODE_WRITE", ["m1", "m2"]);
    expect(ranked[0].modelId).toBe("m1");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("should return 0.5 score for unknown models", () => {
    const table = new PreferenceTable();
    const ranked = routeByPreference(table, "CODE_WRITE", ["unknown"]);
    expect(ranked[0].score).toBe(0.5);
    expect(ranked[0].confidence).toBe(0);
  });

  it("should return 0.5 score for unknown task type", () => {
    const table = new PreferenceTable();
    table.record(makePairwise("m1", "m2", "A>B"), "CODE_WRITE");
    const ranked = routeByPreference(table, "UNKNOWN", ["m1", "m2"]);
    expect(ranked[0].score).toBe(0.5);
  });
});
