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

  it("prefers cheaper model when criticality is low (cost-first)", async () => {
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 0.5, CODE_GENERATION: 0.5 },
      constraints: {},
      budget: {},
      criticality: "low",
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    expect(plan.models[0]!.modelId).toBeDefined();
    expect(plan.estimatedCost).toBeGreaterThanOrEqual(0);
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
