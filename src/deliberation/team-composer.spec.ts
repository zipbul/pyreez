/**
 * Unit tests for team-composer.ts — Diverge-Synth Team Composer.
 *
 * SUT: extractProvider, scoreDimensions, selectTopModel, composeTeam
 * @module Team Composer Tests
 */

import { describe, it, expect } from "bun:test";
import {
  extractProvider,
  scoreDimensions,
  selectTopModel,
  selectDiverseModels,
  composeTeam,
  orderWorkersByRole,
  type ComposeTeamDeps,
} from "./team-composer";
import type { TeamMember } from "./types";
import type { ModelInfo, CapabilityDimension, DimensionRating } from "../model/types";
import { ALL_DIMENSIONS, SIGMA_BASE } from "../model/types";

// -- Fixtures --

/** Default DimensionRating for test models. sigma=350 matches SIGMA_BASE. */
const TEST_DEFAULT_RATING: DimensionRating = { mu: 500, sigma: 350, comparisons: 0 };

/**
 * Create a ModelInfo with DimensionRating capabilities.
 * Number values in overrides are treated as old 0-10 scale (x100 -> mu).
 */
function makeModel(overrides: {
  id: string;
  capabilities?: Partial<Record<CapabilityDimension, number>>;
}): ModelInfo {
  const caps: Record<string, DimensionRating> = {};
  for (const dim of ALL_DIMENSIONS) {
    const val = overrides.capabilities?.[dim as CapabilityDimension];
    if (val !== undefined) {
      caps[dim] = { mu: val * 100, sigma: SIGMA_BASE, comparisons: 0 };
    } else {
      caps[dim] = { ...TEST_DEFAULT_RATING };
    }
  }
  return {
    id: overrides.id,
    name: overrides.id.split("/")[1] ?? overrides.id,
    provider: "anthropic",
    contextWindow: 128_000,
    capabilities: caps as any,
    cost: { inputPer1M: 2, outputPer1M: 8 },
    supportsToolCalling: true,
  };
}

/** Create a ModelInfo with explicit DimensionRating values (BT rating style). */
function makeBTModel(overrides: {
  id: string;
  capabilities?: Partial<
    Record<CapabilityDimension, { mu: number; sigma: number; comparisons: number }>
  >;
}): ModelInfo {
  const caps: Record<string, { mu: number; sigma: number; comparisons: number }> = {};
  for (const dim of ALL_DIMENSIONS) {
    caps[dim] = overrides.capabilities?.[dim] ?? { mu: 500, sigma: 350, comparisons: 0 };
  }
  return {
    id: overrides.id,
    name: overrides.id.split("/")[1] ?? overrides.id,
    provider: "anthropic",
    contextWindow: 128_000,
    capabilities: caps as any,
    cost: { inputPer1M: 2, outputPer1M: 8 },
    supportsToolCalling: true,
  };
}

/** Multiple models from different providers. */
function makeModels(): ModelInfo[] {
  return [
    makeModel({
      id: "openai/gpt-4.1",
      capabilities: {
        CODE_GENERATION: 9,
        CREATIVITY: 8,
        JUDGMENT: 7,
        ANALYSIS: 7,
        REASONING: 8,
      },
    }),
    makeModel({
      id: "openai/gpt-4.1-mini",
      capabilities: {
        CODE_GENERATION: 7,
        CREATIVITY: 6,
        JUDGMENT: 6,
        ANALYSIS: 6,
      },
    }),
    makeModel({
      id: "meta/llama-4-scout",
      capabilities: {
        CODE_GENERATION: 7,
        CREATIVITY: 7,
        JUDGMENT: 8,
        ANALYSIS: 8,
        HALLUCINATION_RESISTANCE: 7,
        DEBUGGING: 7,
      },
    }),
    makeModel({
      id: "deepseek/deepseek-v3",
      capabilities: {
        CODE_GENERATION: 8,
        CREATIVITY: 6,
        JUDGMENT: 6,
        ANALYSIS: 7,
        SPEED: 8,
        SYSTEM_THINKING: 7,
      },
    }),
    makeModel({
      id: "mistral/mistral-large",
      capabilities: {
        JUDGMENT: 9,
        ANALYSIS: 9,
        REASONING: 8,
        SELF_CONSISTENCY: 8,
        CODE_UNDERSTANDING: 8,
      },
    }),
  ];
}

function makeDeps(models?: ModelInfo[]): ComposeTeamDeps {
  const m = models ?? makeModels();
  return {
    getModels: () => m,
    getById: (id: string) => m.find((x) => x.id === id),
  };
}

// ================================================================
// extractProvider
// ================================================================

describe("extractProvider", () => {
  it("should extract provider from standard provider/model format", () => {
    expect(extractProvider("openai/gpt-4.1")).toBe("openai");
  });

  it("should return entire string when no slash present", () => {
    expect(extractProvider("gpt-4.1")).toBe("gpt-4.1");
  });

  it("should handle multiple slashes by taking first segment", () => {
    expect(extractProvider("provider/model/version")).toBe("provider");
  });
});

// ================================================================
// scoreDimensions
// ================================================================

describe("scoreDimensions", () => {
  it("should compute weighted sum for single dimension", () => {
    // mu=900, sigma=SIGMA_BASE -> penalty=0.5
    const model = makeModel({
      id: "openai/gpt-4.1",
      capabilities: { CODE_GENERATION: 9 },
    });
    const score = scoreDimensions(model, [
      { dimension: "CODE_GENERATION", weight: 1.0 },
    ]);
    // score = 900 * (1/(1+350/350)) * 1.0 = 900 * 0.5 = 450
    expect(score).toBeCloseTo(450, 0);
  });

  it("should compute weighted sum for multiple dimensions", () => {
    const model = makeModel({
      id: "openai/gpt-4.1",
      capabilities: { CODE_GENERATION: 8, CREATIVITY: 6 },
    });
    const score = scoreDimensions(model, [
      { dimension: "CODE_GENERATION", weight: 0.6 },
      { dimension: "CREATIVITY", weight: 0.4 },
    ]);
    // = 800*0.5*0.6 + 600*0.5*0.4 = 240 + 120 = 360
    expect(score).toBeCloseTo(360, 0);
  });

  it("should return 0 for empty dimensions array", () => {
    const model = makeModel({ id: "openai/gpt-4.1" });
    expect(scoreDimensions(model, [])).toBe(0);
  });
});

describe("scoreDimensions (BT rating)", () => {
  it("should compute weighted sum using mu and sigma", () => {
    // Arrange -- mu=800, sigma=350 -> penalty = 1/(1+350/350) = 0.5
    const model = makeBTModel({
      id: "test/bt-model",
      capabilities: {
        CODE_GENERATION: { mu: 800, sigma: 350, comparisons: 10 },
      },
    });

    // Act
    const score = scoreDimensions(model, [
      { dimension: "CODE_GENERATION", weight: 1.0 },
    ]);

    // Assert -- 800 * 0.5 * 1.0 = 400
    expect(score).toBeCloseTo(400, 1);
  });

  it("should return 0 for empty dimensions", () => {
    const model = makeBTModel({ id: "test/empty-dims" });
    expect(scoreDimensions(model, [])).toBe(0);
  });

  it("should use penalty=1 when sigma=0", () => {
    // sigma=0 -> penalty = 1/(1+0/350) = 1
    const model = makeBTModel({
      id: "test/full-confidence",
      capabilities: {
        REASONING: { mu: 900, sigma: 0, comparisons: 100 },
      },
    });

    const score = scoreDimensions(model, [
      { dimension: "REASONING", weight: 1.0 },
    ]);

    // 900 * 1.0 * 1.0 = 900
    expect(score).toBeCloseTo(900, 1);
  });

  it("should produce same result regardless of dimension order", () => {
    const model = makeBTModel({
      id: "test/order",
      capabilities: {
        CODE_GENERATION: { mu: 800, sigma: 100, comparisons: 20 },
        REASONING: { mu: 600, sigma: 200, comparisons: 15 },
      },
    });
    const dimsAB = [
      { dimension: "CODE_GENERATION" as CapabilityDimension, weight: 0.6 },
      { dimension: "REASONING" as CapabilityDimension, weight: 0.4 },
    ];
    const dimsBA = [
      { dimension: "REASONING" as CapabilityDimension, weight: 0.4 },
      { dimension: "CODE_GENERATION" as CapabilityDimension, weight: 0.6 },
    ];

    const scoreAB = scoreDimensions(model, dimsAB);
    const scoreBA = scoreDimensions(model, dimsBA);

    expect(scoreAB).toBeCloseTo(scoreBA, 5);
  });
});

// ================================================================
// selectTopModel
// ================================================================

describe("selectTopModel", () => {
  it("should return highest scoring model", () => {
    const models = [
      makeModel({ id: "a/low", capabilities: { CODE_GENERATION: 3 } }),
      makeModel({ id: "b/high", capabilities: { CODE_GENERATION: 9 } }),
      makeModel({ id: "c/mid", capabilities: { CODE_GENERATION: 6 } }),
    ];
    const dims = [{ dimension: "CODE_GENERATION" as CapabilityDimension, weight: 1.0 }];
    const result = selectTopModel(models, dims);
    expect(result?.id).toBe("b/high");
  });

  it("should skip excluded models", () => {
    const models = [
      makeModel({ id: "a/best", capabilities: { CODE_GENERATION: 9 } }),
      makeModel({ id: "b/second", capabilities: { CODE_GENERATION: 7 } }),
    ];
    const dims = [{ dimension: "CODE_GENERATION" as CapabilityDimension, weight: 1.0 }];
    const result = selectTopModel(models, dims, new Set(["a/best"]));
    expect(result?.id).toBe("b/second");
  });

  it("should return undefined for empty model array", () => {
    const dims = [{ dimension: "CODE_GENERATION" as CapabilityDimension, weight: 1.0 }];
    expect(selectTopModel([], dims)).toBeUndefined();
  });

  it("should return undefined when all models excluded", () => {
    const models = [makeModel({ id: "a/only" })];
    const dims = [{ dimension: "CODE_GENERATION" as CapabilityDimension, weight: 1.0 }];
    expect(selectTopModel(models, dims, new Set(["a/only"]))).toBeUndefined();
  });
});

// ================================================================
// selectDiverseModels
// ================================================================

describe("selectDiverseModels", () => {
  it("should return all models when count >= models.length", () => {
    const models = [
      makeModel({ id: "openai/a" }),
      makeModel({ id: "anthropic/b" }),
    ];
    const result = selectDiverseModels(models, 5);
    expect(result).toHaveLength(2);
  });

  it("should select one model per provider before doubling up", () => {
    // 3 openai, 2 anthropic, 1 deepseek — select 3 → should get 1 from each provider
    const models = [
      makeModel({ id: "openai/a", capabilities: { JUDGMENT: 9 } }),
      makeModel({ id: "openai/b", capabilities: { JUDGMENT: 7 } }),
      makeModel({ id: "openai/c", capabilities: { JUDGMENT: 5 } }),
      makeModel({ id: "anthropic/d", capabilities: { JUDGMENT: 8 } }),
      makeModel({ id: "anthropic/e", capabilities: { JUDGMENT: 6 } }),
      makeModel({ id: "deepseek/f", capabilities: { JUDGMENT: 7 } }),
    ];
    const result = selectDiverseModels(models, 3);

    expect(result).toHaveLength(3);
    const providers = result.map((m) => extractProvider(m.id));
    // All 3 providers represented
    expect(new Set(providers).size).toBe(3);
  });

  it("should pick best model from each provider (sorted by JUDGMENT composite)", () => {
    const models = [
      makeModel({ id: "openai/weak", capabilities: { JUDGMENT: 3 } }),
      makeModel({ id: "openai/strong", capabilities: { JUDGMENT: 9 } }),
      makeModel({ id: "anthropic/mid", capabilities: { JUDGMENT: 6 } }),
    ];
    const result = selectDiverseModels(models, 2);

    // Should pick openai/strong (best openai) and anthropic/mid (best anthropic)
    expect(result).toHaveLength(2);
    const ids = result.map((m) => m.id);
    expect(ids).toContain("openai/strong");
    expect(ids).toContain("anthropic/mid");
  });

  it("should round-robin second picks when count exceeds provider count", () => {
    const models = [
      makeModel({ id: "openai/a", capabilities: { JUDGMENT: 9 } }),
      makeModel({ id: "openai/b", capabilities: { JUDGMENT: 7 } }),
      makeModel({ id: "anthropic/c", capabilities: { JUDGMENT: 8 } }),
    ];
    const result = selectDiverseModels(models, 3);

    // Round 1: openai/a, anthropic/c; Round 2: openai/b
    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe("openai/a");
    expect(result[1]!.id).toBe("anthropic/c");
    expect(result[2]!.id).toBe("openai/b");
  });

  it("should handle single provider gracefully", () => {
    const models = [
      makeModel({ id: "openai/a", capabilities: { JUDGMENT: 9 } }),
      makeModel({ id: "openai/b", capabilities: { JUDGMENT: 7 } }),
      makeModel({ id: "openai/c", capabilities: { JUDGMENT: 5 } }),
    ];
    const result = selectDiverseModels(models, 2);
    expect(result).toHaveLength(2);
    // Best two from the single provider
    expect(result[0]!.id).toBe("openai/a");
    expect(result[1]!.id).toBe("openai/b");
  });
});

// ================================================================
// composeTeam -- validation
// ================================================================

describe("composeTeam", () => {
  describe("validation", () => {
    it("should throw when task is empty", () => {
      expect(() =>
        composeTeam(
          { task: "", modelIds: ["openai/gpt-4.1"] },
          makeDeps(),
        ),
      ).toThrow(/task/i);
    });

    it("should throw when task is whitespace", () => {
      expect(() =>
        composeTeam(
          { task: "   ", modelIds: ["openai/gpt-4.1"] },
          makeDeps(),
        ),
      ).toThrow(/task/i);
    });

    it("should throw when modelIds is empty", () => {
      expect(() =>
        composeTeam(
          { task: "Do something", modelIds: [] },
          makeDeps(),
        ),
      ).toThrow(/at least one model/i);
    });

    it("should throw when a model ID is not found in registry", () => {
      expect(() =>
        composeTeam(
          { task: "Do something", modelIds: ["nonexistent/model"] },
          makeDeps(),
        ),
      ).toThrow(/not found/i);
    });
  });

  // ================================================================
  // composeTeam -- auto selection (leader by JUDGMENT)
  // ================================================================

  describe("auto selection", () => {
    it("should auto-select leader with best JUDGMENT composite score", () => {
      const judgeModel = makeModel({
        id: "mistral/judge",
        capabilities: { JUDGMENT: 10, ANALYSIS: 10, REASONING: 10, SELF_CONSISTENCY: 10 },
      });
      const otherModel = makeModel({
        id: "openai/other",
        capabilities: { JUDGMENT: 3, ANALYSIS: 3 },
      });
      const thirdModel = makeModel({
        id: "meta/third",
        capabilities: { JUDGMENT: 2, ANALYSIS: 2 },
      });
      const deps = makeDeps([judgeModel, otherModel, thirdModel]);

      const team = composeTeam(
        { task: "Evaluate", modelIds: ["mistral/judge", "openai/other", "meta/third"] },
        deps,
      );
      expect(team.leader.model).toBe("mistral/judge");
      expect(team.leader.role).toBe("leader");
    });

    it("should assign remaining models as workers", () => {
      const deps = makeDeps();
      const modelIds = ["openai/gpt-4.1", "deepseek/deepseek-v3", "mistral/mistral-large"];

      const team = composeTeam({ task: "Build feature", modelIds }, deps);

      // Leader is one of the models, workers are the rest
      expect(team.workers.length).toBe(2);
      expect(team.workers.every((w) => w.role === "worker")).toBe(true);
      // All models accounted for
      const allModels = [...team.workers.map((w) => w.model), team.leader.model];
      expect(allModels.sort()).toEqual([...modelIds].sort());
    });

    it("should create full team with workers and leader", () => {
      const deps = makeDeps();
      const team = composeTeam(
        { task: "Build feature", modelIds: ["openai/gpt-4.1", "meta/llama-4-scout", "mistral/mistral-large"] },
        deps,
      );
      expect(team.workers.length).toBeGreaterThanOrEqual(1);
      expect(team.leader).toBeDefined();
      expect(team.leader.role).toBe("leader");
      expect(team.leader.model).toMatch(/\w+\/\w+/);
    });
  });

  // ================================================================
  // composeTeam -- single model
  // ================================================================

  describe("single model", () => {
    it("should use single model as both worker and leader", () => {
      const models = [
        makeModel({
          id: "openai/only",
          capabilities: { CODE_GENERATION: 8, JUDGMENT: 8, ANALYSIS: 8 },
        }),
      ];
      const deps = makeDeps(models);

      const team = composeTeam(
        { task: "Build", modelIds: ["openai/only"] },
        deps,
      );
      // Single model is both leader and the sole worker
      expect(team.leader.model).toBe("openai/only");
      expect(team.workers).toHaveLength(1);
      expect(team.workers[0]!.model).toBe("openai/only");
    });
  });

  // ================================================================
  // composeTeam -- leader override
  // ================================================================

  describe("leader override", () => {
    it("should use override leader model directly", () => {
      const deps = makeDeps();

      const team = composeTeam(
        {
          task: "Build feature",
          modelIds: ["openai/gpt-4.1", "meta/llama-4-scout", "mistral/mistral-large"],
          overrides: { leader: "openai/gpt-4.1" },
        },
        deps,
      );
      expect(team.leader.model).toBe("openai/gpt-4.1");
      expect(team.leader.role).toBe("leader");
    });

    it("should place non-leader models as workers when leader is overridden", () => {
      const deps = makeDeps();

      const team = composeTeam(
        {
          task: "Build feature",
          modelIds: ["openai/gpt-4.1", "meta/llama-4-scout", "mistral/mistral-large"],
          overrides: { leader: "openai/gpt-4.1" },
        },
        deps,
      );
      const workerModels = team.workers.map((w) => w.model).sort();
      expect(workerModels).toEqual(["meta/llama-4-scout", "mistral/mistral-large"]);
    });

    it("should throw when override leader is not found in registry", () => {
      expect(() =>
        composeTeam(
          {
            task: "Build",
            modelIds: ["openai/gpt-4.1"],
            overrides: { leader: "nonexistent/model" },
          },
          makeDeps(),
        ),
      ).toThrow(/not found/i);
    });
  });

  // ================================================================
  // composeTeam -- deterministic results
  // ================================================================

  describe("deterministic results", () => {
    it("should return identical team for identical inputs", () => {
      const deps = makeDeps();
      const opts = {
        task: "Build feature",
        modelIds: ["openai/gpt-4.1", "meta/llama-4-scout", "mistral/mistral-large"] as readonly string[],
      };

      const team1 = composeTeam(opts, deps);
      const team2 = composeTeam(opts, deps);

      expect(team1.leader.model).toBe(team2.leader.model);
      expect(team1.workers.map((w) => w.model)).toEqual(
        team2.workers.map((w) => w.model),
      );
    });

    it("should select same team regardless of model array order in registry", () => {
      const models = makeModels();
      const reversed = [...models].reverse();
      const modelIds = ["openai/gpt-4.1", "deepseek/deepseek-v3", "mistral/mistral-large"];

      const team1 = composeTeam(
        { task: "Build", modelIds },
        makeDeps(models),
      );
      const team2 = composeTeam(
        { task: "Build", modelIds },
        makeDeps(reversed),
      );

      expect(team1.leader.model).toBe(team2.leader.model);
    });
  });
});

// =============================================================================
// orderWorkersByRole
// =============================================================================

describe("orderWorkersByRole", () => {
  function makeWorkerMember(model: string): TeamMember {
    return { model, role: "worker" };
  }

  it("should reorder 3 workers by capability fit (REASONING→0, ANALYSIS→1, CREATIVITY→2)", () => {
    // Model A: strong CREATIVITY (best wildcard)
    // Model B: strong REASONING (best advocate)
    // Model C: strong ANALYSIS (best critic)
    const modelA = makeModel({ id: "p/creativity", capabilities: { CREATIVITY: 9, REASONING: 3, ANALYSIS: 3 } });
    const modelB = makeModel({ id: "p/reasoning", capabilities: { REASONING: 9, ANALYSIS: 3, CREATIVITY: 3 } });
    const modelC = makeModel({ id: "p/analysis", capabilities: { ANALYSIS: 9, REASONING: 3, CREATIVITY: 3 } });

    const workers = [makeWorkerMember("p/creativity"), makeWorkerMember("p/reasoning"), makeWorkerMember("p/analysis")];
    const registry = new Map([["p/creativity", modelA], ["p/reasoning", modelB], ["p/analysis", modelC]]);

    const ordered = orderWorkersByRole(workers, (id) => registry.get(id));

    // Slot 0 (advocate = REASONING-heavy) → p/reasoning
    expect(ordered[0]!.model).toBe("p/reasoning");
    // Slot 1 (critic = ANALYSIS-heavy) → p/analysis
    expect(ordered[1]!.model).toBe("p/analysis");
    // Slot 2 (wildcard = CREATIVITY-heavy) → p/creativity
    expect(ordered[2]!.model).toBe("p/creativity");
  });

  it("should return copy unchanged for single worker", () => {
    const workers = [makeWorkerMember("p/solo")];
    const model = makeModel({ id: "p/solo" });
    const ordered = orderWorkersByRole(workers, () => model);

    expect(ordered).toHaveLength(1);
    expect(ordered[0]!.model).toBe("p/solo");
    expect(ordered).not.toBe(workers); // new array
  });

  it("should return original order when registry cannot resolve models", () => {
    const workers = [makeWorkerMember("p/a"), makeWorkerMember("p/b"), makeWorkerMember("p/c")];
    const ordered = orderWorkersByRole(workers, () => undefined);

    expect(ordered.map((w) => w.model)).toEqual(["p/a", "p/b", "p/c"]);
  });

  it("should wrap roles for 4+ workers (index 3 reuses advocate dimensions)", () => {
    const modelA = makeModel({ id: "p/a", capabilities: { REASONING: 9 } });
    const modelB = makeModel({ id: "p/b", capabilities: { ANALYSIS: 9 } });
    const modelC = makeModel({ id: "p/c", capabilities: { CREATIVITY: 9 } });
    const modelD = makeModel({ id: "p/d", capabilities: { REASONING: 8 } });

    const workers = [
      makeWorkerMember("p/a"), makeWorkerMember("p/b"),
      makeWorkerMember("p/c"), makeWorkerMember("p/d"),
    ];
    const registry = new Map([["p/a", modelA], ["p/b", modelB], ["p/c", modelC], ["p/d", modelD]]);
    const ordered = orderWorkersByRole(workers, (id) => registry.get(id));

    expect(ordered).toHaveLength(4);
    // Slot 0 (advocate=REASONING) → p/a (REASONING=9)
    expect(ordered[0]!.model).toBe("p/a");
    // Slot 3 (advocate wrap=REASONING) → p/d (REASONING=8, next best)
    expect(ordered[3]!.model).toBe("p/d");
  });

  it("should return empty array for empty input", () => {
    const ordered = orderWorkersByRole([], () => undefined);
    expect(ordered).toEqual([]);
  });
});
