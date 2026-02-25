/**
 * PreferenceSelector tests — R-C4 wrapper (win/loss history routing).
 */
import { describe, it, expect } from "bun:test";
import { PreferenceSelector, BtScoringSystem } from "./wrappers";
import { PreferenceTable } from "../router/preference";
import type { AxisTaskRequirement, BudgetConfig, ModelScore } from "./types";

describe("PreferenceSelector", () => {
  async function makeScores(): Promise<ModelScore[]> {
    const s = new BtScoringSystem();
    return s.getScores([
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "openai/gpt-4.1-nano",
    ]);
  }

  it("returns EnsemblePlan when no preference data (fallback to BT-based order)", async () => {
    const selector = new PreferenceSelector();
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

  it("prefers model with higher win rate when preference data exists", async () => {
    // Pre-populate preference table: gpt-4.1 beats mini/nano on CODING
    const table = new PreferenceTable();
    const base = {
      promptId: "test-1",
      judge: "human",
      swapped: false,
      reasoning: "better response",
      confidence: 0.9,
    };
    table.record({ ...base, modelA: "openai/gpt-4.1", modelB: "openai/gpt-4.1-mini", outcome: "A>>B" }, "CODING");
    table.record({ ...base, promptId: "test-2", modelA: "openai/gpt-4.1", modelB: "openai/gpt-4.1-nano", outcome: "A>>B" }, "CODING");

    const selector = new PreferenceSelector(table);
    const req: AxisTaskRequirement = {
      capabilities: { CODE_GENERATION: 0.7, REASONING: 0.3 },
      constraints: {},
      budget: {},
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    // gpt-4.1 should win with its high win rate
    expect(plan.models[0]!.modelId).toBe("openai/gpt-4.1");
  });

  it("strategy field is 'preference'", async () => {
    const selector = new PreferenceSelector();
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 1.0 },
      constraints: {},
      budget: {},
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    expect(plan.strategy).toBe("preference");
  });

  it("falls back gracefully when all models are unknown to preference table", async () => {
    const table = new PreferenceTable();
    // Table has entries for a different model, not the candidates
    const selector = new PreferenceSelector(table);
    const req: AxisTaskRequirement = {
      capabilities: { REASONING: 1.0 },
      constraints: {},
      budget: {},
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    // Should still return a valid plan
    expect(plan.models.length).toBeGreaterThan(0);
  });
});
