/**
 * MoeGatingProfiler tests — R-B3 wrapper.
 */
import { describe, it, expect } from "bun:test";
import { MoeGatingProfiler } from "./wrappers";
import type { ClassifyOutput } from "./types";

describe("MoeGatingProfiler", () => {
  const profiler = new MoeGatingProfiler();

  it("returns AxisTaskRequirement with capabilities object", async () => {
    const input: ClassifyOutput = {
      domain: "CODING",
      taskType: "IMPLEMENT_FEATURE",
      vocabKind: "taskType",
      complexity: "moderate",
      criticality: "medium",
      method: "rule",
    };
    const req = await profiler.profile(input);
    expect(typeof req.capabilities).toBe("object");
    expect(Object.keys(req.capabilities).length).toBeGreaterThan(0);
  });

  it("capability weights sum to ~1.0 (normalized)", async () => {
    const input: ClassifyOutput = {
      domain: "DEBUGGING",
      taskType: "ROOT_CAUSE",
      vocabKind: "taskType",
      complexity: "complex",
      criticality: "high",
      method: "rule",
    };
    const req = await profiler.profile(input);
    const total = Object.values(req.capabilities).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 1);
  });

  it("produces different weights for CODING vs MATH domains", async () => {
    const coding: ClassifyOutput = {
      domain: "CODING",
      taskType: "IMPLEMENT_FEATURE",
      vocabKind: "taskType",
      complexity: "simple",
      criticality: "low",
      method: "rule",
    };
    const math: ClassifyOutput = {
      domain: "IDEATION",
      taskType: "BRAINSTORM",
      vocabKind: "taskType",
      complexity: "simple",
      criticality: "low",
      method: "rule",
    };
    const codingReq = await profiler.profile(coding);
    const mathReq = await profiler.profile(math);
    // Should have different top capability
    const topCoding = Object.entries(codingReq.capabilities).sort((a, b) => b[1] - a[1])[0]![0];
    const topMath = Object.entries(mathReq.capabilities).sort((a, b) => b[1] - a[1])[0]![0];
    expect(topCoding).not.toBe(topMath);
  });

  it("keeps constraints and budget fields", async () => {
    const input: ClassifyOutput = {
      domain: "CODING",
      taskType: "IMPLEMENT_FEATURE",
      vocabKind: "taskType",
      complexity: "simple",
      criticality: "low",
      method: "rule",
    };
    const req = await profiler.profile(input);
    expect(req.constraints).toBeDefined();
    expect(req.budget).toBeDefined();
  });
});
