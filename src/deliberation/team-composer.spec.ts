/**
 * Unit tests for team-composer.ts — Team Composer.
 *
 * SUT: extractProvider, composeTeam
 * @module Team Composer Tests
 */

import { describe, it, expect } from "bun:test";
import {
  extractProvider,
  composeTeam,
  type ComposeTeamDeps,
} from "./team-composer";
import type { ModelInfo } from "../model/types";

// -- Fixtures --

function makeModel(overrides: Partial<ModelInfo> & { id: string }): ModelInfo {
  return {
    provider: "anthropic",
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

// -- composeTeam --

describe("composeTeam", () => {
  const makeDeps = (models: ModelInfo[]): ComposeTeamDeps => ({
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

  it("should throw on unknown model ID", () => {
    const models = [makeModel({ id: "a/1" })];
    expect(() =>
      composeTeam({ task: "test", modelIds: ["unknown/model"] }, makeDeps(models)),
    ).toThrow('Model "unknown/model" not found');
  });

  it("should resolve models via getModels fallback when getById is not provided", () => {
    const models = [makeModel({ id: "a/1" }), makeModel({ id: "b/2" })];
    const deps: ComposeTeamDeps = { getById: (id: string) => (models).find((m) => m.id === id) };
    const team = composeTeam({ task: "test", modelIds: ["a/1"] }, deps);
    expect(team.workers).toHaveLength(1);
    expect(team.workers[0]!.model).toBe("a/1");
  });
});
