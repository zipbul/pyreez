import { describe, it, expect, mock } from "bun:test";
import { AbSplitter } from "./ab-splitter";
import type { Selector } from "../axis/interfaces";
import type { AxisTaskRequirement, ModelScore, BudgetConfig, EnsemblePlan } from "../axis/types";

function makeSelector(strategy: string): Selector {
  return {
    select: mock(async (): Promise<EnsemblePlan> => ({
      models: [{ modelId: "m1", weight: 1.0 }],
      strategy,
      estimatedCost: 0.01,
      reason: `${strategy} reason`,
    })),
  };
}

const req: AxisTaskRequirement = {
  capabilities: { REASONING: 1.0 },
  constraints: {},
  budget: {},
};

const scores: ModelScore[] = [
  { modelId: "m1", dimensions: { REASONING: { mu: 700, sigma: 100 } }, overall: 700 },
];

const budget: BudgetConfig = { perRequest: 1.0 };

describe("AbSplitter", () => {
  it("should route to selector A when random < bFraction threshold", async () => {
    const selectorA = makeSelector("A-strategy");
    const selectorB = makeSelector("B-strategy");
    const splitter = new AbSplitter({
      selectorA,
      selectorB,
      bFraction: 0.5,
      randomFn: () => 0.9, // > 0.5 → use A
    });

    const plan = await splitter.select(req, scores, budget);

    expect(plan.reason).toContain("[A]");
    expect(plan.strategy).toBe("A-strategy");
    expect(selectorA.select).toHaveBeenCalledTimes(1);
    expect(selectorB.select).not.toHaveBeenCalled();
  });

  it("should route to selector B when random < bFraction", async () => {
    const selectorA = makeSelector("A-strategy");
    const selectorB = makeSelector("B-strategy");
    const splitter = new AbSplitter({
      selectorA,
      selectorB,
      bFraction: 0.5,
      randomFn: () => 0.3, // < 0.5 → use B
    });

    const plan = await splitter.select(req, scores, budget);

    expect(plan.reason).toContain("[B]");
    expect(plan.strategy).toBe("B-strategy");
    expect(selectorB.select).toHaveBeenCalledTimes(1);
    expect(selectorA.select).not.toHaveBeenCalled();
  });

  it("should respect custom bFraction", async () => {
    const selectorA = makeSelector("A");
    const selectorB = makeSelector("B");

    // bFraction=0.1, random=0.05 → B
    const splitter = new AbSplitter({
      selectorA,
      selectorB,
      bFraction: 0.1,
      randomFn: () => 0.05,
    });

    const plan = await splitter.select(req, scores, budget);
    expect(plan.reason).toContain("[B]");
  });

  it("should default to 50/50 split", async () => {
    let callCount = 0;
    const selectorA = makeSelector("A");
    const selectorB = makeSelector("B");
    const splitter = new AbSplitter({
      selectorA,
      selectorB,
      randomFn: () => {
        callCount++;
        return callCount % 2 === 0 ? 0.3 : 0.7;
      },
    });

    const plan1 = await splitter.select(req, scores, budget);
    const plan2 = await splitter.select(req, scores, budget);

    expect(plan1.reason).toContain("[A]");
    expect(plan2.reason).toContain("[B]");
  });

  it("should pass through all plan fields except reason", async () => {
    const selectorA: Selector = {
      select: mock(async () => ({
        models: [{ modelId: "m1", weight: 0.8 }, { modelId: "m2", weight: 0.2 }],
        strategy: "test-strategy",
        estimatedCost: 0.05,
        effectiveCost: 0.03,
        reason: "original reason",
      })),
    };
    const selectorB = makeSelector("B");
    const splitter = new AbSplitter({
      selectorA,
      selectorB,
      randomFn: () => 0.99, // → A
    });

    const plan = await splitter.select(req, scores, budget);

    expect(plan.models).toHaveLength(2);
    expect(plan.estimatedCost).toBe(0.05);
    expect(plan.effectiveCost).toBe(0.03);
    expect(plan.reason).toBe("[A] original reason");
  });
});
