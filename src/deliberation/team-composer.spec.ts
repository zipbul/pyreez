/**
 * Unit tests for team-composer.ts — Team Composer.
 *
 * SUT: extractProvider, scoreModel, selectDiverseModels, composeTeam
 * @module Team Composer Tests
 */

import { describe, it, expect } from "bun:test";
import {
  extractProvider,
  scoreModel,
  selectDiverseModels,
  composeTeam,
  type ComposeTeamDeps,
} from "./team-composer";
import type { ModelInfo } from "../model/types";

// -- Fixtures --

function makeModel(overrides: Partial<ModelInfo> & { id: string }): ModelInfo {
  return {
    name: overrides.id.split("/")[1] ?? overrides.id,
    provider: "anthropic",
    contextWindow: 128_000,
    cost: { inputPer1M: 2, outputPer1M: 8 },
    supportsToolCalling: true,
    ...overrides,
  };
}

// -- extractProvider --

describe("extractProvider", () => {
  it("should extract provider from model ID", () => {
    expect(extractProvider("anthropic/claude-opus")).toBe("anthropic");
    expect(extractProvider("openai/gpt-5")).toBe("openai");
  });

  it("should use full ID if no slash", () => {
    expect(extractProvider("gpt-5")).toBe("gpt-5");
  });
});

// -- scoreModel --

describe("scoreModel", () => {
  it("should average benchmark scores penalized by coverage", () => {
    const model = makeModel({
      id: "test/model",
      benchmark: { coding: 80, reasoning: 60, math: 100 },
    });
    // avg=80, coverage=3/7 → 80 * 3/7 ≈ 34.3
    expect(scoreModel(model)).toBeCloseTo(80 * 3 / 7, 0);
  });

  it("should not penalize full benchmark (7 categories)", () => {
    const model = makeModel({
      id: "test/model",
      benchmark: { agentic: 80, coding: 80, reasoning: 80, knowledge: 80, multilingual: 80, instruction_following: 80, math: 80 },
    });
    expect(scoreModel(model)).toBe(80);
  });

  it("should fallback to cost proxy when no benchmark", () => {
    const model = makeModel({
      id: "test/model",
      cost: { inputPer1M: 5, outputPer1M: 25 },
    });
    // outputPer1M=25, cap=25 → 25/25*100 = 100
    expect(scoreModel(model)).toBe(100);
  });

  it("should cap cost proxy at 100", () => {
    const model = makeModel({
      id: "test/model",
      cost: { inputPer1M: 10, outputPer1M: 50 },
    });
    expect(scoreModel(model)).toBe(100);
  });

  it("should handle empty benchmark object", () => {
    const model = makeModel({
      id: "test/model",
      benchmark: {},
      cost: { inputPer1M: 1, outputPer1M: 10 },
    });
    // Empty benchmark → fallback to cost
    expect(scoreModel(model)).toBe(40); // 10/25*100
  });
});

// -- selectDiverseModels --

describe("selectDiverseModels", () => {
  it("should pick from different providers round-robin", () => {
    const models = [
      makeModel({ id: "anthropic/a", provider: "anthropic", benchmark: { coding: 90 } }),
      makeModel({ id: "anthropic/b", provider: "anthropic", benchmark: { coding: 80 } }),
      makeModel({ id: "openai/c", provider: "openai", benchmark: { coding: 85 } }),
      makeModel({ id: "xai/d", provider: "xai", benchmark: { coding: 70 } }),
    ];

    const selected = selectDiverseModels(models, 3);
    expect(selected).toHaveLength(3);

    const providers = new Set(selected.map((m) => m.provider));
    expect(providers.size).toBe(3);
  });

  it("should pick best model per provider", () => {
    const models = [
      makeModel({ id: "anthropic/weak", provider: "anthropic", benchmark: { coding: 50 } }),
      makeModel({ id: "anthropic/strong", provider: "anthropic", benchmark: { coding: 90 } }),
      makeModel({ id: "openai/mid", provider: "openai", benchmark: { coding: 70 } }),
    ];

    const selected = selectDiverseModels(models, 2);
    expect(selected.map((m) => m.id)).toContain("anthropic/strong");
    expect(selected.map((m) => m.id)).toContain("openai/mid");
  });

  it("should return all models if count >= models.length", () => {
    const models = [
      makeModel({ id: "anthropic/1", provider: "anthropic" }),
      makeModel({ id: "openai/2", provider: "openai" }),
    ];

    const selected = selectDiverseModels(models, 5);
    expect(selected).toHaveLength(2);
  });

  it("should handle single model", () => {
    const models = [makeModel({ id: "a/1" })];
    expect(selectDiverseModels(models, 3)).toHaveLength(1);
  });
});

// -- composeTeam --

describe("composeTeam", () => {
  const makeDeps = (models: ModelInfo[]): ComposeTeamDeps => ({
    getModels: () => models,
    getById: (id) => models.find((m) => m.id === id),
  });

  it("should create team from requested model IDs", () => {
    const models = [
      makeModel({ id: "a/1" }),
      makeModel({ id: "b/2" }),
    ];
    const team = composeTeam(
      { task: "test task", modelIds: ["a/1", "b/2"] },
      makeDeps(models),
    );
    expect(team.workers).toHaveLength(2);
    expect(team.workers[0]!.model).toBe("a/1");
    expect(team.workers[1]!.model).toBe("b/2");
  });

  it("should throw on empty task", () => {
    expect(() =>
      composeTeam({ task: "", modelIds: ["a/1"] }, makeDeps([])),
    ).toThrow("Task description must be a non-empty string");
  });

  it("should throw NoModelsAvailableError on empty modelIds", () => {
    expect(() =>
      composeTeam({ task: "test", modelIds: [] }, makeDeps([])),
    ).toThrow("No models available");
  });

  it("should throw on unknown model ID", () => {
    const models = [makeModel({ id: "a/1" })];
    expect(() =>
      composeTeam({ task: "test", modelIds: ["unknown/model"] }, makeDeps(models)),
    ).toThrow('Model "unknown/model" not found');
  });
});
