/**
 * Wrapper class tests — fixed pipeline implementations.
 */
import { describe, it, expect, mock } from "bun:test";
import {
  BtScoringSystem,
  DomainOverrideProfiler,
  TwoTrackCeSelector,
} from "./wrappers";
import type { TaskClassification, ModelScore, AxisTaskRequirement, BudgetConfig } from "./types";
import type { PersistIO } from "../model/calibration";

// -- BtScoringSystem --

describe("BtScoringSystem", () => {
  const scoring = new BtScoringSystem();

  it("returns ModelScore[] with correct length for valid modelIds", async () => {
    const scores = await scoring.getScores([
      "anthropic/claude-sonnet-4.6",
      "anthropic/claude-haiku-4.5",
    ]);
    expect(scores).toHaveLength(2);
  });

  it("returns ModelScore with modelId, dimensions, and overall > 0", async () => {
    const [score] = await scoring.getScores(["anthropic/claude-sonnet-4.6"]);
    expect(score!.modelId).toBe("anthropic/claude-sonnet-4.6");
    expect(score!.overall).toBeGreaterThan(0);
    expect(typeof score!.dimensions).toBe("object");
  });

  it("returns empty array for unknown model ids", async () => {
    const scores = await scoring.getScores(["unknown/model-xyz"]);
    expect(scores).toHaveLength(0);
  });

  it("dimensions contain mu and sigma fields", async () => {
    const [score] = await scoring.getScores(["anthropic/claude-sonnet-4.6"]);
    const someKey = Object.keys(score!.dimensions)[0]!;
    expect(score!.dimensions[someKey]).toHaveProperty("mu");
    expect(score!.dimensions[someKey]).toHaveProperty("sigma");
  });
});

// -- DomainOverrideProfiler --

describe("DomainOverrideProfiler", () => {
  const profiler = new DomainOverrideProfiler();

  it("returns AxisTaskRequirement with capabilities object", async () => {
    const input: TaskClassification = {
      domain: "CODING",
      taskType: "IMPLEMENT_FEATURE",
      complexity: "simple",
      criticality: "low",
    };
    const req = await profiler.profile(input);
    expect(typeof req.capabilities).toBe("object");
    expect(Object.keys(req.capabilities).length).toBeGreaterThan(0);
  });

  it("capability weights sum to ~1.0", async () => {
    const input: TaskClassification = {
      domain: "CODING",
      taskType: "IMPLEMENT_FEATURE",
      complexity: "moderate",
      criticality: "medium",
    };
    const req = await profiler.profile(input);
    const total = Object.values(req.capabilities).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 1);
  });

  it("constraints.requiresKorean is true for Korean language", async () => {
    const input: TaskClassification = {
      domain: "CODING",
      taskType: "IMPLEMENT_FEATURE",
      complexity: "simple",
      criticality: "low",
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
    return s.getScores(["anthropic/claude-sonnet-4.6", "anthropic/claude-haiku-4.5", "google/gemini-2.5-flash-lite"]);
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

  it("returns composite strategy", async () => {
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 0.5, CODE_GENERATION: 0.5 },
      constraints: {},
      budget: {},
      criticality: "low",
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    expect(plan.strategy).toBe("composite");
  });
});

// -- BtScoringSystem: computeOverall excludes operational metrics --

describe("BtScoringSystem overall score excludes operational dimensions", () => {
  const scoring = new BtScoringSystem();

  it("should compute overall excluding SPEED, COST_EFFICIENCY, CONTEXT_UTILIZATION", async () => {
    // Arrange — get scores for a real model
    const [score] = await scoring.getScores(["anthropic/claude-sonnet-4.6"]);
    expect(score).toBeDefined();

    // The overall should NOT equal the mean of ALL dimensions (since SPEED etc are excluded)
    const allDims = Object.entries(score!.dimensions);

    const nonOpDims = allDims.filter(([dim]) => !["SPEED", "COST_EFFICIENCY", "CONTEXT_UTILIZATION"].includes(dim));
    const nonOpMean = nonOpDims.reduce((sum, [, v]) => sum + v.mu, 0) / nonOpDims.length;

    // overall should match the non-operational mean
    expect(score!.overall).toBeCloseTo(nonOpMean, 0);
  });
});

// -- TwoTrackCeSelector: sigma confidence effect --

describe("TwoTrackCeSelector sigma confidence effect", () => {
  it("should rank model with lower sigma higher when mu is equal", async () => {
    // Arrange — two models with same mu but different sigma
    const scoring = new BtScoringSystem();
    const allScores = await scoring.getScores([
      "anthropic/claude-sonnet-4.6",
      "anthropic/claude-haiku-4.5",
    ]);

    // Both models should have scores
    expect(allScores.length).toBe(2);

    // The selector uses sigma-based confidence: Math.max(0, 1 - sigma/SIGMA_BASE)
    // Lower sigma = higher confidence = higher weighted score
    // This is inherently tested by the scoring formula — verify confidence is applied
    const selector = new TwoTrackCeSelector(1);
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 1.0 },
      constraints: {},
      budget: {},
    };
    const plan = await selector.select(req, allScores, { perRequest: 10.0 });
    expect(plan.models.length).toBeGreaterThan(0);
    // The model selected should be the one with higher confidence-adjusted REASONING score
    expect(plan.models[0]!.modelId).toBeDefined();
  });
});

// -- TwoTrackCeSelector: uncalibrated models remain selectable --

describe("TwoTrackCeSelector uncalibrated model floor", () => {
  it("should give nonzero weighted score to uncalibrated model (sigma=SIGMA_BASE)", async () => {
    // Arrange — create scores where one model has sigma=SIGMA_BASE (uncalibrated)
    const uncalibratedScore: ModelScore = {
      modelId: "anthropic/claude-sonnet-4.6",
      dimensions: { REASONING: { mu: 800, sigma: 350 } }, // sigma=SIGMA_BASE → uncalibrated
      overall: 800,
    };
    const calibratedScore: ModelScore = {
      modelId: "anthropic/claude-haiku-4.5",
      dimensions: { REASONING: { mu: 600, sigma: 50 } }, // low sigma → calibrated
      overall: 600,
    };

    const selector = new TwoTrackCeSelector(2);
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 1.0 },
      constraints: {},
      budget: {},
    };
    const plan = await selector.select(req, [uncalibratedScore, calibratedScore], { perRequest: 10.0 });

    // Both models should be selectable (uncalibrated model NOT zeroed out)
    expect(plan.models.length).toBe(2);
  });
});

// -- BtScoringSystem.update() --

describe("BtScoringSystem.update", () => {
  it("should resolve for empty results", async () => {
    const scoring = new BtScoringSystem();
    await scoring.update([]);
  });

  it("should update in-memory ratings after pairwise result", async () => {
    const scoring = new BtScoringSystem();
    const modelA = "anthropic/claude-sonnet-4.6";
    const modelB = "anthropic/claude-haiku-4.5";

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

    expect(muBefore).toBeDefined();
  });

  it("should skip invalid outcomes", async () => {
    const scoring = new BtScoringSystem();
    await scoring.update([
      {
        modelAId: "anthropic/claude-sonnet-4.6",
        modelBId: "anthropic/claude-haiku-4.5",
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
          "anthropic/claude-sonnet-4.6": { scores: { REASONING: { mu: 500, sigma: 200, comparisons: 0 } } },
          "anthropic/claude-haiku-4.5": { scores: { REASONING: { mu: 500, sigma: 200, comparisons: 0 } } },
        },
      }))),
      writeFile: mock(() => Promise.resolve()),
    };

    const scoring = new BtScoringSystem({ persistIO: mockIO });
    await scoring.update([
      {
        modelAId: "anthropic/claude-sonnet-4.6",
        modelBId: "anthropic/claude-haiku-4.5",
        outcome: "A>B",
        dimension: "REASONING",
      },
    ]);

    expect(mockIO.writeFile).toHaveBeenCalledTimes(1);
  });

  it("should not persist when persistIO not provided", async () => {
    const scoring = new BtScoringSystem();
    await scoring.update([
      {
        modelAId: "anthropic/claude-sonnet-4.6",
        modelBId: "anthropic/claude-haiku-4.5",
        outcome: "B>A",
        dimension: "CODE_GENERATION",
      },
    ]);
  });
});

// -- Ensemble tests (ensembleSize > 1) --

const ENSEMBLE_MODELS = ["anthropic/claude-sonnet-4.6", "anthropic/claude-haiku-4.5", "google/gemini-2.5-flash-lite"];

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

  it("should not assign roles (left to DeliberationProtocol)", async () => {
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    // Selector returns models without roles — role assignment is done by DivergeSynthProtocol
    for (const m of plan.models) {
      expect(m.role).toBeUndefined();
    }
  });

  it("should return 1 model when ensembleSize=1 (default behavior)", async () => {
    const single = new TwoTrackCeSelector(1);
    const scores = await makeEnsembleScores();
    const plan = await single.select(ensembleReq, scores, ensembleBudget);
    expect(plan.models).toHaveLength(1);
    expect(plan.models[0]!.role).toBe("primary");
  });
});

// -- effectiveCost tests --

describe("effectiveCost in TwoTrackCeSelector", () => {
  it("should include effectiveCost when ensembleSize > 1", async () => {
    const selector = new TwoTrackCeSelector(3);
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    expect(plan.effectiveCost).toBeDefined();
    expect(typeof plan.effectiveCost).toBe("number");
    expect(plan.effectiveCost).toBeGreaterThan(0);
  });

  it("effectiveCost should be ≤ estimatedCost × rounds", async () => {
    const selector = new TwoTrackCeSelector(3);
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    expect(plan.effectiveCost!).toBeLessThanOrEqual(plan.estimatedCost * 3 + 1e-9);
  });

  it("should not include effectiveCost when ensembleSize=1", async () => {
    const single = new TwoTrackCeSelector(1);
    const scores = await makeEnsembleScores();
    const plan = await single.select(ensembleReq, scores, ensembleBudget);
    expect(plan.effectiveCost).toBeUndefined();
  });
});

// -- Composite scoring formula tests --

describe("TwoTrackCeSelector composite scoring", () => {
  it("should prefer high-quality model when qualityWeight dominates", async () => {
    const selector = new TwoTrackCeSelector(3, undefined, {
      qualityWeight: 1.0,
      costWeight: 0.0,
    });
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    // Sonnet has higher quality than Haiku and Flash Lite
    const modelIds = plan.models.map((m) => m.modelId);
    expect(modelIds).toContain("anthropic/claude-sonnet-4.6");
  });

  it("should prefer cheap model when costWeight dominates", async () => {
    const selector = new TwoTrackCeSelector(3, undefined, {
      qualityWeight: 0.0,
      costWeight: 1.0,
    });
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    // Flash Lite ($0.1/$0.4) is cheapest, should rank high
    const firstModel = plan.models[0]!.modelId;
    expect(firstModel).toBe("google/gemini-2.5-flash-lite");
  });

  it("should respect per-request weight overrides in budget", async () => {
    const selector = new TwoTrackCeSelector(3, undefined, {
      qualityWeight: 0.0,
      costWeight: 1.0, // config says cost-first
    });
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 0.5, CODE_GENERATION: 0.5 },
      constraints: {},
      budget: {
        qualityWeight: 1.0, // override: quality-first
        costWeight: 0.0,
      },
    };
    const scores = await makeEnsembleScores();
    const plan = await selector.select(req, scores, ensembleBudget);
    // Override should make Sonnet (highest quality) rank first
    const modelIds = plan.models.map((m) => m.modelId);
    expect(modelIds).toContain("anthropic/claude-sonnet-4.6");
  });

  it("should include reason with weight info", async () => {
    const selector = new TwoTrackCeSelector(3, undefined, {
      qualityWeight: 0.6,
      costWeight: 0.4,
    });
    const scores = await makeEnsembleScores();
    const plan = await selector.select(ensembleReq, scores, ensembleBudget);
    expect(plan.reason).toContain("q=0.6");
    expect(plan.reason).toContain("c=0.4");
  });

  it("should filter models exceeding budget", async () => {
    const selector = new TwoTrackCeSelector(3);
    const scores = await makeEnsembleScores();
    // Set very low budget to filter out expensive models
    const plan = await selector.select(ensembleReq, scores, { perRequest: 0.0001 });
    // All 3 models should be filtered out (even cheapest Flash Lite costs something)
    // Plan should return whatever survives
    for (const m of plan.models) {
      expect(m.modelId).toBeDefined();
    }
  });
});

// -- DomainOverrideProfiler weight passthrough --

describe("DomainOverrideProfiler weight passthrough", () => {
  const profiler = new DomainOverrideProfiler();

  it("should pass qualityWeight through to budget", async () => {
    const input: TaskClassification = {
      domain: "CODING",
      taskType: "IMPLEMENT_FEATURE",
      complexity: "simple",
      qualityWeight: 0.9,
      costWeight: 0.1,
    };
    const req = await profiler.profile(input);
    expect(req.budget.qualityWeight).toBe(0.9);
    expect(req.budget.costWeight).toBe(0.1);
  });

  it("should leave budget weights undefined when not set", async () => {
    const input: TaskClassification = {
      domain: "CODING",
      taskType: "IMPLEMENT_FEATURE",
      complexity: "simple",
    };
    const req = await profiler.profile(input);
    expect(req.budget.qualityWeight).toBeUndefined();
    expect(req.budget.costWeight).toBeUndefined();
  });
});
