/**
 * CascadeSelector tests — R-C3 wrapper (FrugalGPT cascade).
 */
import { describe, it, expect } from "bun:test";
import { CascadeSelector, BtScoringSystem } from "./wrappers";
import type { AxisTaskRequirement, ModelScore, BudgetConfig } from "./types";

describe("CascadeSelector", () => {
  const selector = new CascadeSelector();

  async function makeScores(): Promise<ModelScore[]> {
    const s = new BtScoringSystem();
    return s.getScores([
      "anthropic/claude-sonnet-4.6",
      "anthropic/claude-haiku-4.5",
      "google/gemini-2.5-flash-lite",
    ]);
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

  it("prefers the cheapest qualifying model (cost-ascending order)", async () => {
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 0.5, CODE_GENERATION: 0.5 },
      constraints: {},
      budget: {},
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    // flash-lite is cheaper than haiku, which is cheaper than sonnet
    // cascade should pick flash-lite or haiku first
    expect(["google/gemini-2.5-flash-lite", "anthropic/claude-haiku-4.5"]).toContain(plan.models[0]!.modelId);
  });

  it("falls back to last model when budget is very small", async () => {
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 1.0 },
      constraints: {},
      budget: {},
      estimatedInputTokens: 100,
      estimatedOutputTokens: 100,
    };
    const scores = await makeScores();
    // Very small budget — may hit budget exhaustion
    const plan = await selector.select(req, scores, { perRequest: 0.000001 });
    // Should still return a plan (fallback to last tried)
    expect(plan.models[0]!.modelId).toBeDefined();
  });

  it("strategy field is 'cascade'", async () => {
    const req: AxisTaskRequirement = {
      capabilities: { CODE_GENERATION: 1.0 },
      constraints: {},
      budget: {},
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    expect(plan.strategy).toBe("cascade");
  });
});
