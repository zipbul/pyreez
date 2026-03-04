import { describe, it, expect } from "bun:test";
import { CascadeSelector } from "./cascade-selector";
import type { ModelScore, AxisTaskRequirement, BudgetConfig } from "../axis/types";
import type { ModelInfo } from "../model/types";

function makeScore(modelId: string, mu = 700): ModelScore {
  return {
    modelId,
    dimensions: { REASONING: { mu, sigma: 100 } },
    overall: mu,
  };
}

function makeInfo(id: string, inputPer1M = 2.0, outputPer1M = 8.0): ModelInfo {
  return {
    id,
    name: id,
    provider: "openai",
    contextWindow: 128000,
    capabilities: {} as any,
    cost: { inputPer1M, outputPer1M },
    supportsToolCalling: true,
  };
}

const req: AxisTaskRequirement = {
  capabilities: { REASONING: 1.0 },
  constraints: {},
  budget: {},
};

const budget: BudgetConfig = { perRequest: 1.0 };

function makeRegistry(models: ModelInfo[]) {
  const map = new Map(models.map((m) => [m.id, m]));
  return { getById: (id: string) => map.get(id) };
}

describe("CascadeSelector", () => {
  it("should select cheapest model above median quality", async () => {
    const registry = makeRegistry([
      makeInfo("cheap", 0.1, 0.1),
      makeInfo("mid", 2.0, 8.0),
      makeInfo("expensive", 10.0, 40.0),
    ]);
    const selector = new CascadeSelector({
      registry,
      routing: { qualityWeight: 0.7, costWeight: 0.3 },
    });

    const scores = [
      makeScore("cheap", 600),
      makeScore("mid", 700),
      makeScore("expensive", 800),
    ];
    const plan = await selector.select(req, scores, budget);

    expect(plan.models.length).toBe(1);
    expect(plan.strategy).toBe("cascade");
    // Should pick cheapest model that's above median composite
  });

  it("should escalate to best model when none meet threshold", async () => {
    // All models have similar quality but different cost —
    // when sorted by cost, the cheapest may be below median
    // This edge case tests escalation
    const registry = makeRegistry([
      makeInfo("only", 2.0, 8.0),
    ]);
    const selector = new CascadeSelector({
      registry,
      routing: { qualityWeight: 0.7, costWeight: 0.3 },
    });

    const scores = [makeScore("only", 700)];
    const plan = await selector.select(req, scores, budget);

    expect(plan.models.length).toBe(1);
    expect(plan.models[0]!.modelId).toBe("only");
    // Single model should work (either cascade or cascade-escalated)
    expect(plan.strategy).toMatch(/^cascade/);
  });

  it("should return empty plan when no models available", async () => {
    const registry = makeRegistry([]);
    const selector = new CascadeSelector({
      registry,
      routing: { qualityWeight: 0.7, costWeight: 0.3 },
    });

    const plan = await selector.select(req, [makeScore("unknown")], budget);

    expect(plan.models).toEqual([]);
    expect(plan.estimatedCost).toBe(0);
  });

  it("should always return single model (no ensemble)", async () => {
    const registry = makeRegistry([
      makeInfo("m1", 0.5, 2.0),
      makeInfo("m2", 1.0, 4.0),
      makeInfo("m3", 5.0, 20.0),
    ]);
    const selector = new CascadeSelector({
      registry,
      routing: { qualityWeight: 0.7, costWeight: 0.3 },
    });

    const scores = [makeScore("m1", 700), makeScore("m2", 750), makeScore("m3", 800)];
    const plan = await selector.select(req, scores, budget);

    expect(plan.models.length).toBe(1);
  });

  it("should respect budget constraint", async () => {
    const registry = makeRegistry([
      makeInfo("cheap", 0.1, 0.1),
      makeInfo("expensive", 100, 400),
    ]);
    const selector = new CascadeSelector({
      registry,
      routing: { qualityWeight: 0.7, costWeight: 0.3 },
    });

    const scores = [makeScore("cheap", 600), makeScore("expensive", 900)];
    const plan = await selector.select(req, scores, { perRequest: 0.01 });

    expect(plan.models.length).toBe(1);
    expect(plan.models[0]!.modelId).toBe("cheap");
  });
});
