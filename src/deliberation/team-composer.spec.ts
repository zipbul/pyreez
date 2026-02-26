/**
 * Unit tests for team-composer.ts — Team Composer (Diversity Engine).
 *
 * 37 tests across 5 exported functions.
 * @module Diversity Engine
 */

import { describe, it, expect } from "bun:test";
import {
  extractProvider,
  perspectiveToDimensions,
  scoreDimensions,
  selectTopModel,
  composeTeam,
  type ComposeTeamDeps,
} from "./team-composer";
import type { ModelInfo, CapabilityDimension, DimensionRating } from "../model/types";
import { ALL_DIMENSIONS, SIGMA_BASE } from "../model/types";

// -- Fixtures --

/** Default DimensionRating for test models. sigma=350 matches SIGMA_BASE. */
const TEST_DEFAULT_RATING: DimensionRating = { mu: 500, sigma: 350, comparisons: 0 };

/**
 * Create a ModelInfo with DimensionRating capabilities.
 * Number values in overrides are treated as old 0-10 scale (×100 → mu).
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
    provider: "github",
    contextWindow: 128_000,
    capabilities: caps as any,
    cost: { inputPer1M: 2, outputPer1M: 8 },
    supportsToolCalling: true,
  };
}

/** 7 models from 4 providers for diversity testing. */
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
    makeModel({
      id: "cohere/command-a",
      capabilities: {
        ANALYSIS: 7,
        JUDGMENT: 7,
        HALLUCINATION_RESISTANCE: 8,
        DEBUGGING: 8,
      },
    }),
    makeModel({
      id: "microsoft/phi-4",
      capabilities: {
        CODE_GENERATION: 6,
        SPEED: 9,
        COST_EFFICIENCY: 9,
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
// perspectiveToDimensions
// ================================================================

describe("perspectiveToDimensions", () => {
  it("should map security keywords to security dimensions", () => {
    const dims = perspectiveToDimensions("보안 검토");
    const dimNames = dims.map((d) => d.dimension);
    expect(dimNames).toContain("HALLUCINATION_RESISTANCE");
    expect(dimNames).toContain("DEBUGGING");
  });

  it("should map performance keywords to speed dimensions", () => {
    const dims = perspectiveToDimensions("performance optimization");
    const dimNames = dims.map((d) => d.dimension);
    expect(dimNames).toContain("SPEED");
    expect(dimNames).toContain("SYSTEM_THINKING");
  });

  it("should return default dimensions for unknown keywords", () => {
    const dims = perspectiveToDimensions("something completely unrelated 12345");
    const dimNames = dims.map((d) => d.dimension);
    expect(dimNames).toContain("ANALYSIS");
    expect(dimNames).toContain("JUDGMENT");
  });

  it("should handle multi-keyword perspective matching first pattern", () => {
    // Contains both security and performance keywords
    const dims = perspectiveToDimensions("보안 and performance");
    // Should match at least one pattern
    expect(dims.length).toBeGreaterThan(0);
    const dimNames = dims.map((d) => d.dimension);
    // First match wins - security keywords
    expect(dimNames).toContain("HALLUCINATION_RESISTANCE");
  });
});

// ================================================================
// scoreDimensions
// ================================================================

describe("scoreDimensions", () => {
  it("should compute weighted sum for single dimension", () => {
    // mu=900, sigma=SIGMA_BASE → penalty=0.5
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
    // CODE_GENERATION: mu=800, sigma=350 → penalty=0.5
    // CREATIVITY: mu=600, sigma=350 → penalty=0.5
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
// composeTeam — validation
// ================================================================

describe("composeTeam", () => {
  describe("validation", () => {
    it("should throw when perspectives has fewer than 2 items", () => {
      expect(() =>
        composeTeam(
          { task: "Do something", perspectives: ["only one"] },
          makeDeps(),
        ),
      ).toThrow(/at least 2 perspectives/i);
    });

    it("should throw when perspectives is empty", () => {
      expect(() =>
        composeTeam({ task: "Do something", perspectives: [] }, makeDeps()),
      ).toThrow(/at least 2 perspectives/i);
    });

    it("should throw when override model ID not found in registry", () => {
      expect(() =>
        composeTeam(
          {
            task: "Do something",
            perspectives: ["a", "b"],
            overrides: { producer: "nonexistent/model" },
          },
          makeDeps(),
        ),
      ).toThrow(/not found/i);
    });

    it("should throw when no models available", () => {
      expect(() =>
        composeTeam(
          { task: "Do something", perspectives: ["a", "b"] },
          makeDeps([]),
        ),
      ).toThrow(/no models/i);
    });

    it("should throw when task is empty or whitespace", () => {
      expect(() =>
        composeTeam({ task: "", perspectives: ["a", "b"] }, makeDeps()),
      ).toThrow(/task/i);

      expect(() =>
        composeTeam({ task: "   ", perspectives: ["a", "b"] }, makeDeps()),
      ).toThrow(/task/i);
    });
  });

  // ================================================================
  // composeTeam — auto selection
  // ================================================================

  describe("auto selection", () => {
    it("should auto-select producer with CODE_GENERATION emphasis", () => {
      const codeModel = makeModel({
        id: "openai/code-king",
        capabilities: { CODE_GENERATION: 10, CREATIVITY: 10 },
      });
      const otherModel = makeModel({
        id: "meta/other",
        capabilities: { CODE_GENERATION: 3, CREATIVITY: 3 },
      });
      const weakModel = makeModel({
        id: "deepseek/weak",
        capabilities: { CODE_GENERATION: 2, CREATIVITY: 2 },
      });
      const deps = makeDeps([codeModel, otherModel, weakModel]);

      const team = composeTeam(
        { task: "Write code", perspectives: ["보안", "성능"] },
        deps,
      );
      expect(team.producer.model).toBe("openai/code-king");
    });

    it("should auto-select reviewers matching each perspective", () => {
      const team = composeTeam(
        { task: "Review code", perspectives: ["보안 검토", "성능 최적화"] },
        makeDeps(),
      );
      expect(team.reviewers).toHaveLength(2);
      expect(team.reviewers[0]!.perspective).toBe("보안 검토");
      expect(team.reviewers[1]!.perspective).toBe("성능 최적화");
    });

    it("should auto-select leader with JUDGMENT emphasis", () => {
      const judgeModel = makeModel({
        id: "mistral/judge",
        capabilities: { JUDGMENT: 10, ANALYSIS: 10, REASONING: 10 },
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
        { task: "Evaluate", perspectives: ["a", "b"] },
        deps,
      );
      expect(team.leader.model).toBe("mistral/judge");
    });

    it("should create full team with no overrides", () => {
      const team = composeTeam(
        { task: "Build feature", perspectives: ["코드 품질", "보안"] },
        makeDeps(),
      );
      expect(team.producer).toBeDefined();
      expect(team.producer.role).toBe("producer");
      expect(team.producer.model).toMatch(/\w+\/\w+/);
      expect(team.reviewers).toHaveLength(2);
      expect(team.reviewers.every((r) => r.role === "reviewer")).toBe(true);
      expect(team.leader).toBeDefined();
      expect(team.leader.role).toBe("leader");
      expect(team.leader.model).toMatch(/\w+\/\w+/);
    });
  });

  // ================================================================
  // composeTeam — overrides
  // ================================================================

  describe("overrides", () => {
    it("should use override producer model directly", () => {
      const team = composeTeam(
        {
          task: "Build feature",
          perspectives: ["a", "b"],
          overrides: { producer: "microsoft/phi-4" },
        },
        makeDeps(),
      );
      expect(team.producer.model).toBe("microsoft/phi-4");
    });

    it("should use override reviewer models directly", () => {
      const team = composeTeam(
        {
          task: "Build feature",
          perspectives: ["보안", "성능"],
          overrides: { reviewers: ["cohere/command-a", "deepseek/deepseek-v3"] },
        },
        makeDeps(),
      );
      expect(team.reviewers[0]!.model).toBe("cohere/command-a");
      expect(team.reviewers[1]!.model).toBe("deepseek/deepseek-v3");
    });

    it("should use override leader model directly", () => {
      const team = composeTeam(
        {
          task: "Build feature",
          perspectives: ["a", "b"],
          overrides: { leader: "meta/llama-4-scout" },
        },
        makeDeps(),
      );
      expect(team.leader.model).toBe("meta/llama-4-scout");
    });

    it("should handle partial overrides mixing auto and manual", () => {
      const team = composeTeam(
        {
          task: "Build feature",
          perspectives: ["보안", "성능"],
          overrides: { producer: "microsoft/phi-4" },
        },
        makeDeps(),
      );
      expect(team.producer.model).toBe("microsoft/phi-4");
      // Reviewers and leader auto-selected
      expect(team.reviewers).toHaveLength(2);
      expect(team.leader).toBeDefined();
      expect(team.leader.model).toMatch(/\w+\/\w+/);
    });
  });

  // ================================================================
  // composeTeam — diversity
  // ================================================================

  describe("diversity", () => {
    it("should achieve ≥3 providers when models are diverse", () => {
      const team = composeTeam(
        { task: "Build", perspectives: ["보안", "성능"] },
        makeDeps(),
      );
      const providers = new Set([
        extractProvider(team.producer.model),
        ...team.reviewers.map((r) => extractProvider(r.model)),
        extractProvider(team.leader.model),
      ]);
      expect(providers.size).toBeGreaterThanOrEqual(3);
    });

    it("should swap reviewer to meet diversity threshold", () => {
      // 3 models: 2 from openai, 1 from meta, 1 from deepseek
      // Force producer+leader to openai, reviewer should get non-openai
      const models = [
        makeModel({
          id: "openai/best-code",
          capabilities: { CODE_GENERATION: 10, CREATIVITY: 10, JUDGMENT: 10, ANALYSIS: 10 },
        }),
        makeModel({
          id: "openai/second",
          capabilities: { CODE_GENERATION: 8, HALLUCINATION_RESISTANCE: 8, DEBUGGING: 8 },
        }),
        makeModel({
          id: "meta/diverse",
          capabilities: { CODE_GENERATION: 6, HALLUCINATION_RESISTANCE: 7, DEBUGGING: 7 },
        }),
        makeModel({
          id: "deepseek/also-diverse",
          capabilities: { SPEED: 8, SYSTEM_THINKING: 7 },
        }),
      ];
      const deps = makeDeps(models);

      const team = composeTeam(
        { task: "Code", perspectives: ["보안", "성능"] },
        deps,
      );

      const providers = new Set([
        extractProvider(team.producer.model),
        ...team.reviewers.map((r) => extractProvider(r.model)),
        extractProvider(team.leader.model),
      ]);
      expect(providers.size).toBeGreaterThanOrEqual(3);
    });

    it("should handle all overrides from same provider as best effort", () => {
      const team = composeTeam(
        {
          task: "Build",
          perspectives: ["a", "b"],
          overrides: {
            producer: "openai/gpt-4.1",
            reviewers: ["openai/gpt-4.1-mini", "openai/gpt-4.1"],
            leader: "openai/gpt-4.1",
          },
        },
        makeDeps(),
      );
      // All overrides accepted even though single provider
      expect(team.producer.model).toBe("openai/gpt-4.1");
      expect(team.leader.model).toBe("openai/gpt-4.1");
    });

    it("should handle registry with only 2 providers as best effort", () => {
      const models = [
        makeModel({
          id: "openai/a",
          capabilities: { CODE_GENERATION: 9, JUDGMENT: 8, ANALYSIS: 8 },
        }),
        makeModel({
          id: "openai/b",
          capabilities: { HALLUCINATION_RESISTANCE: 8, DEBUGGING: 8 },
        }),
        makeModel({
          id: "meta/c",
          capabilities: { SPEED: 8, SYSTEM_THINKING: 7 },
        }),
      ];
      const deps = makeDeps(models);

      // Should not throw — forms best available team
      const team = composeTeam(
        { task: "Build", perspectives: ["보안", "성능"] },
        deps,
      );
      expect(team.producer).toBeDefined();
      expect(team.producer.model).toMatch(/\w+\/\w+/);
      expect(team.reviewers).toHaveLength(2);
      expect(team.leader).toBeDefined();
      expect(team.leader.model).toMatch(/\w+\/\w+/);
    });

    it("should not swap when diversity is already met", () => {
      // 4 models from 4 providers — diversity natural
      const models = [
        makeModel({
          id: "openai/a",
          capabilities: { CODE_GENERATION: 9, CREATIVITY: 9 },
        }),
        makeModel({
          id: "meta/b",
          capabilities: { HALLUCINATION_RESISTANCE: 9, DEBUGGING: 9 },
        }),
        makeModel({
          id: "deepseek/c",
          capabilities: { SPEED: 9, SYSTEM_THINKING: 9 },
        }),
        makeModel({
          id: "mistral/d",
          capabilities: { JUDGMENT: 9, ANALYSIS: 9, REASONING: 9 },
        }),
      ];
      const deps = makeDeps(models);

      const team = composeTeam(
        { task: "Build", perspectives: ["보안", "성능"] },
        deps,
      );
      const providers = new Set([
        extractProvider(team.producer.model),
        ...team.reviewers.map((r) => extractProvider(r.model)),
        extractProvider(team.leader.model),
      ]);
      expect(providers.size).toBeGreaterThanOrEqual(3);
    });
  });

  // ================================================================
  // composeTeam — corner cases
  // ================================================================

  describe("corner cases", () => {
    it("should handle 1 model in registry for all roles", () => {
      const models = [
        makeModel({
          id: "openai/only",
          capabilities: { CODE_GENERATION: 8, JUDGMENT: 8, ANALYSIS: 8 },
        }),
      ];
      const deps = makeDeps(models);

      const team = composeTeam(
        { task: "Build", perspectives: ["a", "b"] },
        deps,
      );
      // Single model used for all roles
      expect(team.producer.model).toBe("openai/only");
      expect(team.reviewers[0]!.model).toBe("openai/only");
      expect(team.reviewers[1]!.model).toBe("openai/only");
      expect(team.leader.model).toBe("openai/only");
    });

    it("should reject when task empty AND perspectives < 2", () => {
      expect(() =>
        composeTeam({ task: "", perspectives: ["one"] }, makeDeps()),
      ).toThrow();
    });

    it("should return identical team for identical inputs", () => {
      const deps = makeDeps();
      const opts = {
        task: "Build feature",
        perspectives: ["보안", "성능"] as readonly string[],
      };

      const team1 = composeTeam(opts, deps);
      const team2 = composeTeam(opts, deps);

      expect(team1.producer.model).toBe(team2.producer.model);
      expect(team1.reviewers.map((r) => r.model)).toEqual(
        team2.reviewers.map((r) => r.model),
      );
      expect(team1.leader.model).toBe(team2.leader.model);
    });
  });

  // ================================================================
  // composeTeam — ordering
  // ================================================================

  describe("ordering", () => {
    it("should select same team regardless of model array order", () => {
      const models = makeModels();
      const reversed = [...models].reverse();

      const team1 = composeTeam(
        { task: "Build", perspectives: ["보안", "성능"] },
        makeDeps(models),
      );
      const team2 = composeTeam(
        { task: "Build", perspectives: ["보안", "성능"] },
        makeDeps(reversed),
      );

      expect(team1.producer.model).toBe(team2.producer.model);
      expect(team1.leader.model).toBe(team2.leader.model);
    });

    it("should map perspectives to reviewers preserving perspective order", () => {
      const team = composeTeam(
        { task: "Build", perspectives: ["보안 검토", "성능 최적화", "코드 품질"] },
        makeDeps(),
      );
      expect(team.reviewers[0]!.perspective).toBe("보안 검토");
      expect(team.reviewers[1]!.perspective).toBe("성능 최적화");
      expect(team.reviewers[2]!.perspective).toBe("코드 품질");
    });
  });
});

// ================================================================
// scoreDimensions — BT Dimensional Rating
// ================================================================

/**
 * BT Rating tests for scoreDimensions.
 * Uses DimensionRating { mu, sigma, comparisons }.
 * Expected formula: mu * (1 / (1 + sigma / SIGMA_BASE)) * weight
 * SIGMA_BASE = 350.
 */

const SIGMA_BASE_LOCAL = 350;

/** Create a ModelInfo with DimensionRating-style capabilities for BT rating. */
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
  // Cast to ModelInfo — capabilities shape is intentionally DimensionRating.
  // This will cause runtime failures until SUT is updated (RED).
  return {
    id: overrides.id,
    name: overrides.id.split("/")[1] ?? overrides.id,
    provider: "github",
    contextWindow: 128_000,
    capabilities: caps as any,

    cost: { inputPer1M: 2, outputPer1M: 8 },
    supportsToolCalling: true,
  };
}

describe("scoreDimensions (BT rating)", () => {
  it("should compute weighted sum using mu and sigma", () => {
    // Arrange — mu=800, sigma=350 → penalty = 1/(1+350/350) = 0.5
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

    // Assert — 800 * 0.5 * 1.0 = 400
    expect(score).toBeCloseTo(400, 1);
  });

  it("should return 0 for empty dimensions", () => {
    // Arrange
    const model = makeBTModel({ id: "test/empty-dims" });

    // Act
    const score = scoreDimensions(model, []);

    // Assert
    expect(score).toBe(0);
  });

  it("should use penalty=1 when sigma=0", () => {
    // Arrange — sigma=0 → penalty = 1/(1+0/350) = 1
    const model = makeBTModel({
      id: "test/full-confidence",
      capabilities: {
        REASONING: { mu: 900, sigma: 0, comparisons: 100 },
      },
    });

    // Act
    const score = scoreDimensions(model, [
      { dimension: "REASONING", weight: 1.0 },
    ]);

    // Assert — 900 * 1.0 * 1.0 = 900
    expect(score).toBeCloseTo(900, 1);
  });

  it("should produce same result regardless of dimension order", () => {
    // Arrange
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

    // Act
    const scoreAB = scoreDimensions(model, dimsAB);
    const scoreBA = scoreDimensions(model, dimsBA);

    // Assert
    expect(scoreAB).toBeCloseTo(scoreBA, 5);
  });

  // -- leader auto-select edge --

  it("should throw when auto-selecting leader with empty models and producer override", () => {
    // Arrange — producer is overridden, but models is empty, leader needs auto-select
    const deps: ComposeTeamDeps = {
      getModels: () => [],
      getById: (id: string) => {
        if (id === "openai/gpt-4.1") {
          return makeModel({ id: "openai/gpt-4.1" });
        }
        return undefined;
      },
    };

    // Act & Assert — producer override succeeds, but leader auto-select fails
    expect(() =>
      composeTeam(
        {
          task: "Test task",
          perspectives: ["security", "performance"],
          overrides: { producer: "openai/gpt-4.1" },
        },
        deps,
      ),
    ).toThrow("No models available to auto-select leader");
  });
});
