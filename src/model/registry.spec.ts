/**
 * Unit tests for model registry.
 * SUT: ModelRegistry (getAll, getAvailable, getById, getByIds, buildProviderMap).
 * Models are injected (no on-disk catalog); an empty registry is a valid state.
 */

import { describe, it, expect } from "bun:test";
import { ModelRegistry } from "./registry";
import type { ModelInfo } from "./types";

function m(id: string, provider: ModelInfo["provider"], extra: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id,
    name: id,
    provider,
    contextWindow: 128000,
    cost: { inputPer1M: 1, outputPer1M: 1 },
    supportsToolCalling: true,
    available: true,
    ...extra,
  };
}

const SAMPLE = [
  m("anthropic/opus", "anthropic", { benchmark: { coding: 73, reasoning: 70 } }),
  m("openai/gpt", "openai"),
  m("xai/grok", "xai"),
  m("google/gemini", "google", { available: false }),
];

describe("ModelRegistry", () => {
  it("defaults to an empty registry when no models are supplied", () => {
    expect(new ModelRegistry().getAll()).toHaveLength(0);
  });

  describe("getAll", () => {
    it("returns every injected model", () => {
      expect(new ModelRegistry(SAMPLE).getAll().map((x) => x.id)).toEqual([
        "anthropic/opus",
        "openai/gpt",
        "xai/grok",
        "google/gemini",
      ]);
    });
  });

  describe("getAvailable", () => {
    it("excludes models marked available: false", () => {
      const ids = new ModelRegistry(SAMPLE).getAvailable().map((x) => x.id);
      expect(ids).not.toContain("google/gemini");
      expect(ids).toContain("anthropic/opus");
    });
  });

  describe("getById", () => {
    it("finds a model by id", () => {
      expect(new ModelRegistry(SAMPLE).getById("anthropic/opus")?.provider).toBe("anthropic");
    });
    it("returns undefined for an unknown id", () => {
      expect(new ModelRegistry(SAMPLE).getById("nope/model")).toBeUndefined();
    });
  });

  describe("getByIds", () => {
    it("returns models in requested order", () => {
      const models = new ModelRegistry(SAMPLE).getByIds(["openai/gpt", "anthropic/opus"]);
      expect(models.map((x) => x.id)).toEqual(["openai/gpt", "anthropic/opus"]);
    });
    it("skips unknown ids", () => {
      expect(new ModelRegistry(SAMPLE).getByIds(["xai/grok", "nope"])).toHaveLength(1);
    });
    it("returns empty for empty input", () => {
      expect(new ModelRegistry(SAMPLE).getByIds([])).toHaveLength(0);
    });
  });

  describe("buildProviderMap", () => {
    it("maps model ids to provider names", () => {
      const map = new ModelRegistry(SAMPLE).buildProviderMap();
      expect(map.get("anthropic/opus")).toBe("anthropic");
      expect(map.get("xai/grok")).toBe("xai");
    });
    it("is empty for an empty registry", () => {
      expect(new ModelRegistry().buildProviderMap().size).toBe(0);
    });
  });
});
