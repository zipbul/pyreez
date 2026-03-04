import { describe, it, expect } from "bun:test";
import { KnnSelector } from "./knn-selector";
import { PreferenceTable } from "./preference";
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
  taskType: "IMPLEMENT_FEATURE",
};

const budget: BudgetConfig = { perRequest: 1.0 };

function makeRegistry(models: ModelInfo[]) {
  const map = new Map(models.map((m) => [m.id, m]));
  return { getById: (id: string) => map.get(id) };
}

describe("KnnSelector", () => {
  it("should fall back to composite when no preference data exists", async () => {
    const table = new PreferenceTable();
    const registry = makeRegistry([makeInfo("m1"), makeInfo("m2")]);
    const selector = new KnnSelector({
      preferenceTable: table,
      registry,
      ensembleSize: 2,
      routing: { qualityWeight: 0.7, costWeight: 0.3 },
    });

    const scores = [makeScore("m1", 800), makeScore("m2", 600)];
    const plan = await selector.select(req, scores, budget);

    expect(plan.strategy).toBe("knn-fallback-composite");
    expect(plan.models.length).toBeGreaterThan(0);
  });

  it("should use preference data when sufficient confidence exists", async () => {
    const table = new PreferenceTable();
    // Record enough data for m2 to be confident winner
    for (let i = 0; i < 20; i++) {
      table.record({ modelA: "m2", modelB: "m1", outcome: "A>B" }, "IMPLEMENT_FEATURE");
    }

    const registry = makeRegistry([makeInfo("m1"), makeInfo("m2")]);
    const selector = new KnnSelector({
      preferenceTable: table,
      registry,
      ensembleSize: 2,
      minConfidence: 0.3,
      routing: { qualityWeight: 0.7, costWeight: 0.3 },
    });

    const scores = [makeScore("m1", 800), makeScore("m2", 600)];
    const plan = await selector.select(req, scores, budget);

    expect(plan.strategy).toBe("knn-preference");
    // m2 should be first despite lower BT score, because preference data favors it
    expect(plan.models[0]!.modelId).toBe("m2");
  });

  it("should respect budget constraint in preference mode", async () => {
    const table = new PreferenceTable();
    for (let i = 0; i < 20; i++) {
      table.record({ modelA: "expensive", modelB: "cheap", outcome: "A>B" }, "IMPLEMENT_FEATURE");
    }

    const registry = makeRegistry([
      makeInfo("expensive", 100, 400),
      makeInfo("cheap", 0.1, 0.1),
    ]);
    const selector = new KnnSelector({
      preferenceTable: table,
      registry,
      ensembleSize: 1,
      routing: { qualityWeight: 0.7, costWeight: 0.3 },
    });

    const scores = [makeScore("expensive"), makeScore("cheap")];
    const plan = await selector.select(req, scores, { perRequest: 0.01 });

    expect(plan.models[0]!.modelId).toBe("cheap");
  });

  it("should return empty models when no models available in fallback", async () => {
    const table = new PreferenceTable();
    const registry = makeRegistry([]);
    const selector = new KnnSelector({
      preferenceTable: table,
      registry,
      routing: { qualityWeight: 0.7, costWeight: 0.3 },
    });

    const plan = await selector.select(req, [makeScore("unknown")], budget);

    expect(plan.models).toEqual([]);
    expect(plan.strategy).toBe("knn-fallback-composite");
  });

  it("should limit selection to ensembleSize", async () => {
    const table = new PreferenceTable();
    for (let i = 0; i < 20; i++) {
      table.record({ modelA: "m1", modelB: "m2", outcome: "A>B" }, "IMPLEMENT_FEATURE");
      table.record({ modelA: "m3", modelB: "m2", outcome: "A>B" }, "IMPLEMENT_FEATURE");
    }

    const registry = makeRegistry([makeInfo("m1"), makeInfo("m2"), makeInfo("m3")]);
    const selector = new KnnSelector({
      preferenceTable: table,
      registry,
      ensembleSize: 1,
      routing: { qualityWeight: 0.7, costWeight: 0.3 },
    });

    const scores = [makeScore("m1"), makeScore("m2"), makeScore("m3")];
    const plan = await selector.select(req, scores, budget);

    expect(plan.models.length).toBe(1);
  });
});
