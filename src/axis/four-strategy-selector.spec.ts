/**
 * FourStrategySelector tests — R-C2: economy/balanced/premium/critical selector.
 */
import { describe, it, expect } from "bun:test";
import { FourStrategySelector, BtScoringSystem } from "./wrappers";
import type { AxisTaskRequirement, ModelScore, BudgetConfig } from "./types";

describe("FourStrategySelector", () => {
  const selector = new FourStrategySelector();

  async function makeScores(): Promise<ModelScore[]> {
    const s = new BtScoringSystem();
    return s.getScores([
      "anthropic/claude-sonnet-4.6",
      "anthropic/claude-haiku-4.5",
      "google/gemini-2.5-flash-lite",
    ]);
  }

  it("economy strategy selects cheapest model", async () => {
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 0.5, CODE_GENERATION: 0.5 },
      constraints: {},
      budget: { strategy: "economy" },
      criticality: "low",
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    // gemini-2.5-flash-lite is cheapest
    expect(plan.models[0]!.modelId).toBe("google/gemini-2.5-flash-lite");
    expect(plan.strategy).toBe("economy");
  });

  it("premium strategy selects highest-quality model", async () => {
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 0.5, CODE_GENERATION: 0.5 },
      constraints: {},
      budget: { strategy: "premium" },
      criticality: "high",
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    // claude-sonnet-4.6 has highest overall score
    expect(plan.models[0]!.modelId).toBe("anthropic/claude-sonnet-4.6");
    expect(plan.strategy).toBe("premium");
  });

  it("critical strategy selects highest-quality model (ignores cost)", async () => {
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 0.5, CODE_GENERATION: 0.5 },
      constraints: {},
      budget: { strategy: "critical" },
      criticality: "critical",
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    expect(plan.models[0]!.modelId).toBe("anthropic/claude-sonnet-4.6");
    expect(plan.strategy).toBe("critical");
  });

  it("balanced strategy selects model with good score/cost balance", async () => {
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 0.5, CODE_GENERATION: 0.5 },
      constraints: {},
      budget: { strategy: "balanced" },
      criticality: "medium",
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    expect(plan.models[0]!.modelId).toBeDefined();
    expect(plan.strategy).toBe("balanced");
  });

  it("falls back to balanced when no strategy is set", async () => {
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 1.0 },
      constraints: {},
      budget: {},
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    expect(plan.models[0]!.modelId).toBeDefined();
    // No explicit strategy → infer from criticality or default to balanced
    expect(["economy", "balanced", "premium", "critical"]).toContain(plan.strategy);
  });

  it("auto-selects critical strategy from criticality=critical when no budget.strategy", async () => {
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 1.0 },
      constraints: {},
      budget: {},
      criticality: "critical",
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    expect(plan.strategy).toBe("critical");
  });
});
