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
      "anthropic/claude-sonnet-4.6",
      "anthropic/claude-haiku-4.5",
      "google/gemini-2.5-flash-lite",
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
    table.record({ ...base, modelA: "anthropic/claude-sonnet-4.6", modelB: "anthropic/claude-haiku-4.5", outcome: "A>>B" }, "CODING");
    table.record({ ...base, promptId: "test-2", modelA: "anthropic/claude-sonnet-4.6", modelB: "google/gemini-2.5-flash-lite", outcome: "A>>B" }, "CODING");

    const selector = new PreferenceSelector(table);
    const req: AxisTaskRequirement = {
      capabilities: { CODE_GENERATION: 0.7, REASONING: 0.3 },
      constraints: {},
      budget: {},
    };
    const scores = await makeScores();
    const plan = await selector.select(req, scores, { perRequest: 1.0 });
    // claude-sonnet-4.6 should win with its high win rate
    expect(plan.models[0]!.modelId).toBe("anthropic/claude-sonnet-4.6");
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
