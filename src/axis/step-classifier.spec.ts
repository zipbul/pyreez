/**
 * StepDeclareClassifier tests — R-A2: step-declare classifier.
 */
import { describe, it, expect } from "bun:test";
import { StepDeclareClassifier } from "./wrappers";
import type { RouteHints } from "./types";

describe("StepDeclareClassifier", () => {
  const classifier = new StepDeclareClassifier();

  it("returns vocabKind=step when step hint is provided", async () => {
    const hints: RouteHints = { step: "CODE" };
    const result = await classifier.classify("implement a function", hints);
    expect(result.vocabKind).toBe("step");
  });

  it("taskType matches the provided step hint", async () => {
    const hints: RouteHints = { step: "DEBUG" };
    const result = await classifier.classify("fix this error", hints);
    expect(result.taskType).toBe("DEBUG");
  });

  it("method is step-declare when step hint used", async () => {
    const hints: RouteHints = { step: "REVIEW" };
    const result = await classifier.classify("review my code", hints);
    expect(result.method).toBe("step-declare");
  });

  it("falls back to keyword classify (vocabKind=taskType) when no step hint", async () => {
    const result = await classifier.classify("implement a function");
    // No step hint → keyword fallback → vocabKind should be taskType
    expect(result.vocabKind).toBe("taskType");
  });

  it("returns valid complexity field", async () => {
    const hints: RouteHints = { step: "DESIGN" };
    const result = await classifier.classify("design the overall system architecture", hints);
    expect(["simple", "moderate", "complex"]).toContain(result.complexity);
  });

  it("returns valid criticality field", async () => {
    const hints: RouteHints = { step: "DEPLOY" };
    const result = await classifier.classify("deploy to production", hints);
    expect(["low", "medium", "high", "critical"]).toContain(result.criticality);
  });

  it("infers domain from step when no domain_hint provided", async () => {
    const hints: RouteHints = { step: "TEST" };
    const result = await classifier.classify("write unit tests", hints);
    expect(result.domain).toBeDefined();
    expect(result.domain.length).toBeGreaterThan(0);
  });
});
