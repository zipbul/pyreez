/**
 * Unit tests for model registry.
 * SUT: ModelRegistry (getAll, getAvailable, getById, getByIds, buildProviderMap)
 */

import { describe, it, expect } from "bun:test";
import { ModelRegistry } from "./registry";

const registry = new ModelRegistry();

describe("ModelRegistry", () => {
  describe("getAll", () => {
    it("should return all models from models.jsonc", () => {
      const models = registry.getAll();
      expect(models.length).toBeGreaterThan(0);
    });

    it("should include known models", () => {
      const models = registry.getAll();
      const ids = models.map((m) => m.id);
      expect(ids).toContain("anthropic/claude-opus-4.6");
      expect(ids).toContain("openai/gpt-5.4");
    });
  });

  describe("getAvailable", () => {
    it("should return only available models", () => {
      const models = registry.getAvailable();
      for (const model of models) {
        expect(model.available).not.toBe(false);
      }
    });
  });

  describe("getById", () => {
    it("should find model by ID", () => {
      const model = registry.getById("anthropic/claude-opus-4.6");
      expect(model).toBeDefined();
      expect(model!.provider).toBe("anthropic");
    });

    it("should return undefined for unknown ID", () => {
      expect(registry.getById("nonexistent/model")).toBeUndefined();
    });
  });

  describe("getByIds", () => {
    it("should return models in requested order", () => {
      const ids = ["openai/gpt-5.4", "anthropic/claude-opus-4.6"];
      const models = registry.getByIds(ids);
      expect(models).toHaveLength(2);
      expect(models[0]!.id).toBe("openai/gpt-5.4");
      expect(models[1]!.id).toBe("anthropic/claude-opus-4.6");
    });

    it("should skip unknown IDs", () => {
      const models = registry.getByIds(["anthropic/claude-sonnet-4.6", "nonexistent"]);
      expect(models).toHaveLength(1);
    });

    it("should return empty array for empty input", () => {
      expect(registry.getByIds([])).toHaveLength(0);
    });
  });

  describe("buildProviderMap", () => {
    it("should map model IDs to provider names", () => {
      const map = registry.buildProviderMap();
      expect(map.get("anthropic/claude-opus-4.6")).toBe("anthropic");
      expect(map.get("openai/gpt-5.4")).toBe("openai");
      expect(map.get("xai/grok-4")).toBe("xai");
    });
  });

  describe("benchmark data", () => {
    it("should load benchmark scores for models that have them", () => {
      const model = registry.getById("anthropic/claude-opus-4.6");
      expect(model!.benchmark).toBeDefined();
      expect(model!.benchmark!.coding).toBeGreaterThan(0);
      expect(model!.benchmark!.reasoning).toBeGreaterThan(0);
    });

    it("should have undefined benchmark for models without scores", () => {
      const model = registry.getById("google/gemini-3.1-flash-lite-preview");
      expect(model!.benchmark).toBeUndefined();
    });
  });
});
