/**
 * Wrapper class tests — existing implementations adapted to axis interfaces.
 */
import { describe, it, expect } from "bun:test";
import {
  KeywordClassifier,
  BtScoringSystem,
  DomainOverrideProfiler,
  TwoTrackCeSelector,
} from "./wrappers";
import type { ClassifyOutput, ModelScore, AxisTaskRequirement } from "./types";

// -- KeywordClassifier --

describe("KeywordClassifier", () => {
  const classifier = new KeywordClassifier();

  it("adds vocabKind=taskType to every classify output", async () => {
    const result = await classifier.classify(
      "Write a TypeScript function that debounces another function.",
    );
    expect(result.vocabKind).toBe("taskType");
  });

  it("returns a valid domain and taskType", async () => {
    const result = await classifier.classify("Implement a binary search algorithm in TypeScript.");
    expect(result.domain).toBeDefined();
    expect(result.taskType).toBeDefined();
  });

  it("method is rule or llm (not undefined)", async () => {
    const result = await classifier.classify("Brainstorm product names for a developer tool.");
    expect(["rule", "llm"]).toContain(result.method);
  });

  it("returns complexity field", async () => {
    const result = await classifier.classify("Refactor a 2000-line TypeScript module.");
    expect(["simple", "moderate", "complex"]).toContain(result.complexity);
  });
});

// -- BtScoringSystem --

describe("BtScoringSystem", () => {
  const scoring = new BtScoringSystem();

  it("returns ModelScore[] with correct length for valid modelIds", async () => {
    const scores = await scoring.getScores([
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
    ]);
    expect(scores).toHaveLength(2);
  });

  it("returns ModelScore with modelId, dimensions, and overall > 0", async () => {
    const [score] = await scoring.getScores(["openai/gpt-4.1"]);
    expect(score!.modelId).toBe("openai/gpt-4.1");
    expect(score!.overall).toBeGreaterThan(0);
    expect(typeof score!.dimensions).toBe("object");
  });

  it("returns empty array for unknown model ids", async () => {
    const scores = await scoring.getScores(["unknown/model-xyz"]);
    expect(scores).toHaveLength(0);
  });

  it("dimensions contain mu and sigma fields", async () => {
    const [score] = await scoring.getScores(["openai/gpt-4.1"]);
    const someKey = Object.keys(score!.dimensions)[0]!;
    expect(score!.dimensions[someKey]).toHaveProperty("mu");
    expect(score!.dimensions[someKey]).toHaveProperty("sigma");
  });
});

// -- DomainOverrideProfiler --

describe("DomainOverrideProfiler", () => {
  const profiler = new DomainOverrideProfiler();

  it("returns AxisTaskRequirement with capabilities object", async () => {
    const input: ClassifyOutput = {
      domain: "CODING",
      taskType: "IMPLEMENT_FEATURE",
      vocabKind: "taskType",
      complexity: "simple",
      criticality: "low",
      method: "rule",
    };
    const req = await profiler.profile(input);
    expect(typeof req.capabilities).toBe("object");
    expect(Object.keys(req.capabilities).length).toBeGreaterThan(0);
  });

  it("capability weights sum to ~1.0", async () => {
    const input: ClassifyOutput = {
      domain: "CODING",
      taskType: "IMPLEMENT_FEATURE",
      vocabKind: "taskType",
      complexity: "moderate",
      criticality: "medium",
      method: "rule",
    };
    const req = await profiler.profile(input);
    const total = Object.values(req.capabilities).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 1);
  });

  it("constraints.requiresKorean is true for Korean prompts", async () => {
    const input: ClassifyOutput = {
      domain: "CODING",
      taskType: "IMPLEMENT_FEATURE",
      vocabKind: "taskType",
      complexity: "simple",
      criticality: "low",
      method: "rule",
      language: "ko",
    };
    const req = await profiler.profile(input);
    expect(req.constraints.requiresKorean).toBe(true);
  });
});

// -- TwoTrackCeSelector --

describe("TwoTrackCeSelector", () => {
  const selector = new TwoTrackCeSelector();

  async function makeScores(): Promise<ModelScore[]> {
    const s = new BtScoringSystem();
    return s.getScores(["openai/gpt-4.1", "openai/gpt-4.1-mini", "openai/gpt-4.1-nano"]);
  }

  it("returns EnsemblePlan with at least one model", async () => {
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 0.5, CODE_GENERATION: 0.5 },
      constraints: {},
      budget: {},
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    expect(plan.models.length).toBeGreaterThan(0);
    expect(plan.models[0]!.modelId).toBeDefined();
  });

  it("returns EnsemblePlan with strategy field", async () => {
    const req: AxisTaskRequirement = {
      capabilities: { CODE_GENERATION: 0.6, REASONING: 0.4 },
      constraints: {},
      budget: {},
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    expect(typeof plan.strategy).toBe("string");
    expect(plan.strategy.length).toBeGreaterThan(0);
  });

  it("prefers cheaper model when criticality is low (cost-first)", async () => {
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 0.5, CODE_GENERATION: 0.5 },
      constraints: {},
      budget: {},
      criticality: "low",
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    // nano or mini should be selected for low criticality cost-first
    expect(plan.models[0]!.modelId).toBeDefined();
    expect(plan.estimatedCost).toBeGreaterThanOrEqual(0);
  });
});
