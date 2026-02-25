import { describe, it, expect, mock } from "bun:test";
import { MabSelector } from "./wrappers";
import type { ModelScore, EnsemblePlan, AxisTaskRequirement, BudgetConfig } from "./types";

function makeScores(...entries: Array<{ id: string; overall: number }>): ModelScore[] {
  return entries.map((e) => ({
    modelId: e.id,
    dimensions: { JUDGMENT: { mu: e.overall, sigma: 100 } },
    overall: e.overall,
  }));
}

function makeReq(maxModelCount: number = 3): AxisTaskRequirement {
  return {
    capabilities: { JUDGMENT: 1.0 },
    constraints: {},
    budget: { maxPerRequest: 100, strategy: "balanced" },
    /** maxModelCount is encoded in budget or used via a convention. */
  } as AxisTaskRequirement & { maxModelCount?: number };
}

function makeBudget(perRequest: number = 100): BudgetConfig {
  return { perRequest };
}

describe("MabSelector", () => {
  // 17. [HP] selects via Thompson Sampling
  it("should select models using Thompson Sampling", async () => {
    const selector = new MabSelector();
    const scores = makeScores(
      { id: "model-a", overall: 500 },
      { id: "model-b", overall: 600 },
      { id: "model-c", overall: 400 },
    );

    const plan = await selector.select(makeReq(), scores, makeBudget());
    expect(plan.models.length).toBeGreaterThan(0);
    expect(plan.strategy).toBe("mab");
  });

  // 18. [HP] respects maxModels constructor param
  it("should respect maxModels from constructor", async () => {
    const selector = new MabSelector(2);
    const scores = makeScores(
      { id: "a", overall: 500 },
      { id: "b", overall: 600 },
      { id: "c", overall: 400 },
      { id: "d", overall: 700 },
    );

    const plan = await selector.select(makeReq(), scores, makeBudget());
    expect(plan.models.length).toBeLessThanOrEqual(2);
  });

  // 19. [NE] empty scores → empty plan
  it("should return empty plan for empty scores", async () => {
    const selector = new MabSelector();
    const plan = await selector.select(makeReq(), [], makeBudget());
    expect(plan.models.length).toBe(0);
  });

  // 20. [ED] single model always selected
  it("should always select single available model", async () => {
    const selector = new MabSelector();
    const scores = makeScores({ id: "only-model", overall: 500 });

    const plan = await selector.select(makeReq(), scores, makeBudget());
    expect(plan.models.length).toBe(1);
    expect(plan.models[0]!.modelId).toBe("only-model");
  });

  // 21. [ED] uniform prior samples from Beta(1,1)
  it("should use uniform prior with no preference history", async () => {
    const selector = new MabSelector();
    const scores = makeScores(
      { id: "a", overall: 500 },
      { id: "b", overall: 500 },
    );

    // With no history, all models have equal prior → selection works
    const plan = await selector.select(makeReq(), scores, makeBudget());
    expect(plan.models.length).toBeGreaterThan(0);
    expect(plan.strategy).toBe("mab");
  });

  // 22. [ST] after wins recorded → winner selected more often
  it("should favor models with recorded wins over many trials", async () => {
    const selector = new MabSelector(1);

    // Record many wins for model-a
    for (let i = 0; i < 50; i++) {
      selector.recordOutcome("model-a", true);
    }
    // Record many losses for model-b
    for (let i = 0; i < 50; i++) {
      selector.recordOutcome("model-b", false);
    }

    const scores = makeScores(
      { id: "model-a", overall: 500 },
      { id: "model-b", overall: 500 },
    );

    // Over many trials, model-a should be selected more often
    let aCount = 0;
    for (let i = 0; i < 20; i++) {
      const plan = await selector.select(makeReq(), scores, makeBudget());
      if (plan.models[0]!.modelId === "model-a") aCount++;
    }

    // model-a should be selected at least 60% of the time
    expect(aCount).toBeGreaterThanOrEqual(12);
  });

  // 23. [CO] budget=0 → minimal plan
  it("should return plan even with zero budget", async () => {
    const selector = new MabSelector();
    const scores = makeScores({ id: "a", overall: 500 });

    const plan = await selector.select(makeReq(), scores, makeBudget(0));
    // Should still attempt to select (budget is guidance)
    expect(plan.strategy).toBe("mab");
  });

  // 24. [ID] strategy reports "mab"
  it("should report strategy as mab", async () => {
    const selector = new MabSelector();
    const scores = makeScores({ id: "a", overall: 500 });

    const plan = await selector.select(makeReq(), scores, makeBudget());
    expect(plan.strategy).toBe("mab");
  });
});
