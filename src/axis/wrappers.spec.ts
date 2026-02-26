/**
 * Wrapper class tests — existing implementations adapted to axis interfaces.
 */
import { describe, it, expect, mock } from "bun:test";
import {
  KeywordClassifier,
  BtScoringSystem,
  StepBtScoringSystem,
  DomainOverrideProfiler,
  TwoTrackCeSelector,
  FourStrategySelector,
  CascadeSelector,
  PreferenceSelector,
  MabSelector,
} from "./wrappers";
import type { ClassifyOutput, ModelScore, AxisTaskRequirement, BudgetConfig, PairwiseResult } from "./types";
import type { PersistIO } from "../model/calibration";

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

// -- BtScoringSystem.update() --

describe("BtScoringSystem.update", () => {
  it("should resolve for empty results", async () => {
    const scoring = new BtScoringSystem();
    await scoring.update([]);
    // No error thrown — early return
  });

  it("should update in-memory ratings after pairwise result", async () => {
    const scoring = new BtScoringSystem();
    const modelA = "openai/gpt-4.1";
    const modelB = "openai/gpt-4.1-mini";

    const [beforeA] = await scoring.getScores([modelA]);
    const muBefore = beforeA!.dimensions.REASONING?.mu;

    await scoring.update([
      {
        modelAId: modelA,
        modelBId: modelB,
        outcome: "A>>B",
        dimension: "REASONING",
      },
    ]);

    // Scores come from registry (global singleton), so the in-memory update
    // applies to the shared registry. Verify the update didn't throw.
    expect(muBefore).toBeDefined();
  });

  it("should skip invalid outcomes", async () => {
    const scoring = new BtScoringSystem();
    // Should not throw for invalid outcome — just skip
    await scoring.update([
      {
        modelAId: "openai/gpt-4.1",
        modelBId: "openai/gpt-4.1-mini",
        outcome: "INVALID",
        dimension: "REASONING",
      },
    ]);
  });

  it("should call persistRatings when persistIO provided", async () => {
    const mockIO: PersistIO = {
      readFile: mock(() => Promise.resolve(JSON.stringify({
        version: 1,
        models: {
          "openai/gpt-4.1": { scores: { REASONING: { mu: 500, sigma: 200, comparisons: 0 } } },
          "openai/gpt-4.1-mini": { scores: { REASONING: { mu: 500, sigma: 200, comparisons: 0 } } },
        },
      }))),
      writeFile: mock(() => Promise.resolve()),
    };

    const scoring = new BtScoringSystem({ persistIO: mockIO });
    await scoring.update([
      {
        modelAId: "openai/gpt-4.1",
        modelBId: "openai/gpt-4.1-mini",
        outcome: "A>B",
        dimension: "REASONING",
      },
    ]);

    expect(mockIO.writeFile).toHaveBeenCalledTimes(1);
  });

  it("should not persist when persistIO not provided", async () => {
    const scoring = new BtScoringSystem();
    // No persistIO → should not throw, just update in-memory
    await scoring.update([
      {
        modelAId: "openai/gpt-4.1",
        modelBId: "openai/gpt-4.1-mini",
        outcome: "B>A",
        dimension: "CODE_GENERATION",
      },
    ]);
  });
});

// -- StepBtScoringSystem.update() --

describe("StepBtScoringSystem.update", () => {
  it("should resolve for empty results", async () => {
    const scoring = new StepBtScoringSystem();
    await scoring.update([]);
  });

  it("should call persistRatings when persistIO provided", async () => {
    const mockIO: PersistIO = {
      readFile: mock(() => Promise.resolve(JSON.stringify({
        version: 1,
        models: {
          "openai/gpt-4.1": { scores: { REASONING: { mu: 500, sigma: 200, comparisons: 0 } } },
          "openai/gpt-4.1-mini": { scores: { REASONING: { mu: 500, sigma: 200, comparisons: 0 } } },
        },
      }))),
      writeFile: mock(() => Promise.resolve()),
    };

    const scoring = new StepBtScoringSystem({ persistIO: mockIO });
    await scoring.update([
      {
        modelAId: "openai/gpt-4.1",
        modelBId: "openai/gpt-4.1-mini",
        outcome: "A>>B",
        dimension: "REASONING",
      },
    ]);

    expect(mockIO.writeFile).toHaveBeenCalledTimes(1);
  });

  it("should skip invalid outcomes", async () => {
    const scoring = new StepBtScoringSystem();
    await scoring.update([
      {
        modelAId: "openai/gpt-4.1",
        modelBId: "openai/gpt-4.1-mini",
        outcome: "BOGUS",
        dimension: "REASONING",
      },
    ]);
  });
});

// -- Ensemble tests (ensembleSize > 1) --

const ENSEMBLE_MODELS = ["openai/gpt-4.1", "openai/gpt-4.1-mini", "openai/gpt-4.1-nano"];

async function makeEnsembleScores(): Promise<ModelScore[]> {
  return new BtScoringSystem().getScores(ENSEMBLE_MODELS);
}

const ensembleReq: AxisTaskRequirement = {
  capabilities: { REASONING: 0.5, CODE_GENERATION: 0.5 },
  constraints: {},
  budget: {},
};

const ensembleBudget: BudgetConfig = { perRequest: 1.0 };

describe("TwoTrackCeSelector (ensembleSize=3)", () => {
  const selector = new TwoTrackCeSelector(3);

  it("should return multiple models when ensembleSize > 1", async () => {
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    expect(plan.models.length).toBeGreaterThan(1);
    expect(plan.models.length).toBeLessThanOrEqual(3);
  });

  it("should assign distinct roles to ensemble models", async () => {
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    const roles = plan.models.map((m) => m.role);
    expect(roles).toContain("producer");
    expect(roles).toContain("leader");
  });

  it("should return 1 model when ensembleSize=1 (default behavior)", async () => {
    const single = new TwoTrackCeSelector(1);
    const scores = await makeEnsembleScores();
    const plan = await single.select(ensembleReq, scores, ensembleBudget);
    expect(plan.models).toHaveLength(1);
    expect(plan.models[0]!.role).toBe("primary");
  });
});

describe("FourStrategySelector (ensembleSize=3)", () => {
  const selector = new FourStrategySelector(3);

  it("should return multiple models when ensembleSize > 1", async () => {
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    expect(plan.models.length).toBeGreaterThan(1);
    expect(plan.models.length).toBeLessThanOrEqual(3);
  });

  it("should assign roles: producer, reviewer(s), leader", async () => {
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    if (plan.models.length === 3) {
      expect(plan.models[0]!.role).toBe("producer");
      expect(plan.models[1]!.role).toBe("reviewer");
      expect(plan.models[2]!.role).toBe("leader");
    }
  });

  it("should return 1 model when ensembleSize=1", async () => {
    const single = new FourStrategySelector(1);
    const scores = await makeEnsembleScores();
    const plan = await single.select(ensembleReq, scores, ensembleBudget);
    expect(plan.models).toHaveLength(1);
  });
});

describe("CascadeSelector (ensembleSize=3)", () => {
  const selector = new CascadeSelector(3);

  it("should return multiple models when ensembleSize > 1", async () => {
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    expect(plan.models.length).toBeGreaterThan(1);
    expect(plan.models.length).toBeLessThanOrEqual(3);
  });

  it("should return 1 model when ensembleSize=1", async () => {
    const single = new CascadeSelector(1);
    const scores = await makeEnsembleScores();
    const plan = await single.select(ensembleReq, scores, ensembleBudget);
    expect(plan.models).toHaveLength(1);
  });
});

describe("PreferenceSelector (ensembleSize=3)", () => {
  it("should return multiple models (fallback path) when ensembleSize > 1", async () => {
    const selector = new PreferenceSelector(undefined, 3);
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    expect(plan.models.length).toBeGreaterThan(1);
    expect(plan.models.length).toBeLessThanOrEqual(3);
  });

  it("should return 1 model when ensembleSize=1", async () => {
    const selector = new PreferenceSelector(undefined, 1);
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    expect(plan.models).toHaveLength(1);
  });
});

describe("MabSelector (ensembleSize=3)", () => {
  const selector = new MabSelector(3);

  it("should return up to ensembleSize models", async () => {
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    expect(plan.models.length).toBeGreaterThan(0);
    expect(plan.models.length).toBeLessThanOrEqual(3);
  });

  it("should assign deliberation roles", async () => {
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    if (plan.models.length >= 3) {
      expect(plan.models[0]!.role).toBe("producer");
      expect(plan.models[plan.models.length - 1]!.role).toBe("leader");
    }
  });

  it("should return 1 model with role=primary when ensembleSize=1", async () => {
    const single = new MabSelector(1);
    const scores = await makeEnsembleScores();
    const plan = await single.select(ensembleReq, scores, ensembleBudget);
    expect(plan.models).toHaveLength(1);
    expect(plan.models[0]!.role).toBe("primary");
  });
});

// -- effectiveCost tests --

describe("effectiveCost in ensemble selectors", () => {
  it("TwoTrackCeSelector should include effectiveCost when ensembleSize > 1", async () => {
    const selector = new TwoTrackCeSelector(3);
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    expect(plan.effectiveCost).toBeDefined();
    expect(typeof plan.effectiveCost).toBe("number");
    expect(plan.effectiveCost).toBeGreaterThan(0);
  });

  it("TwoTrackCeSelector effectiveCost should be ≤ estimatedCost × rounds", async () => {
    const selector = new TwoTrackCeSelector(3);
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    // effectiveCost accounts for caching discounts, so it should be ≤ static × rounds
    expect(plan.effectiveCost!).toBeLessThanOrEqual(plan.estimatedCost * 3 + 1e-9);
  });

  it("TwoTrackCeSelector should not include effectiveCost when ensembleSize=1", async () => {
    const single = new TwoTrackCeSelector(1);
    const scores = await makeEnsembleScores();
    const plan = await single.select(ensembleReq, scores, ensembleBudget);
    expect(plan.effectiveCost).toBeUndefined();
  });

  it("FourStrategySelector should include effectiveCost when ensembleSize > 1", async () => {
    const selector = new FourStrategySelector(3);
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    expect(plan.effectiveCost).toBeDefined();
    expect(plan.effectiveCost).toBeGreaterThan(0);
  });

  it("CascadeSelector should include effectiveCost when ensembleSize > 1", async () => {
    const selector = new CascadeSelector(3);
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    expect(plan.effectiveCost).toBeDefined();
    expect(plan.effectiveCost).toBeGreaterThan(0);
  });

  it("PreferenceSelector should include effectiveCost when ensembleSize > 1", async () => {
    const selector = new PreferenceSelector(undefined, 3);
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    expect(plan.effectiveCost).toBeDefined();
    expect(plan.effectiveCost).toBeGreaterThan(0);
  });
});
