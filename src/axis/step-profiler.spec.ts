/**
 * StepProfiler tests — R-B2: 1-level WorkflowStep lookup.
 */
import { describe, it, expect } from "bun:test";
import { StepProfiler } from "./wrappers";
import type { ClassifyOutput } from "./types";

describe("StepProfiler", () => {
  const profiler = new StepProfiler();

  it("returns capabilities object for vocabKind=step input", async () => {
    const input: ClassifyOutput = {
      domain: "CODING",
      taskType: "CODE",
      vocabKind: "step",
      complexity: "moderate",
      criticality: "medium",
      method: "step-declare",
    };
    const req = await profiler.profile(input);
    expect(typeof req.capabilities).toBe("object");
    expect(Object.keys(req.capabilities).length).toBeGreaterThan(0);
  });

  it("capability weights sum to ~1.0", async () => {
    const input: ClassifyOutput = {
      domain: "CODING",
      taskType: "DEBUG",
      vocabKind: "step",
      complexity: "complex",
      criticality: "high",
      method: "step-declare",
    };
    const req = await profiler.profile(input);
    const total = Object.values(req.capabilities).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 1);
  });

  it("CODE step has CODE_GENERATION as top capability", async () => {
    const input: ClassifyOutput = {
      domain: "CODING",
      taskType: "CODE",
      vocabKind: "step",
      complexity: "simple",
      criticality: "low",
      method: "step-declare",
    };
    const req = await profiler.profile(input);
    const top = Object.entries(req.capabilities).sort((a, b) => b[1] - a[1])[0]![0];
    expect(top).toBe("CODE_GENERATION");
  });

  it("DEBUG step has DEBUGGING as top capability", async () => {
    const input: ClassifyOutput = {
      domain: "DEBUGGING",
      taskType: "DEBUG",
      vocabKind: "step",
      complexity: "moderate",
      criticality: "high",
      method: "step-declare",
    };
    const req = await profiler.profile(input);
    const top = Object.entries(req.capabilities).sort((a, b) => b[1] - a[1])[0]![0];
    expect(top).toBe("DEBUGGING");
  });

  it("IDEATE step has CREATIVITY as top capability", async () => {
    const input: ClassifyOutput = {
      domain: "IDEATION",
      taskType: "IDEATE",
      vocabKind: "step",
      complexity: "moderate",
      criticality: "low",
      method: "step-declare",
    };
    const req = await profiler.profile(input);
    const top = Object.entries(req.capabilities).sort((a, b) => b[1] - a[1])[0]![0];
    expect(top).toBe("CREATIVITY");
  });

  it("falls back to GENERAL profile for unknown step", async () => {
    const input: ClassifyOutput = {
      domain: "UNKNOWN",
      taskType: "UNKNOWN_STEP_XYZ",
      vocabKind: "step",
      complexity: "simple",
      criticality: "low",
      method: "step-declare",
    };
    const req = await profiler.profile(input);
    expect(Object.keys(req.capabilities).length).toBeGreaterThan(0);
    const total = Object.values(req.capabilities).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 1);
  });
});
