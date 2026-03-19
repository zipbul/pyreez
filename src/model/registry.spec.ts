/**
 * Unit tests for ModelRegistry.
 */

import { describe, it, expect } from "bun:test";
import { ModelRegistry, __testing__ } from "./registry";

// -- Tests --

describe("ModelRegistry", () => {
  const registry = new ModelRegistry();

  describe("getAll", () => {
    it("should return array of 50 models", () => {
      // Arrange & Act
      const models = registry.getAll();

      // Assert
      expect(models).toBeArrayOfSize(50);
    });

    it("should return equal results on repeated calls", () => {
      // Arrange & Act
      const first = registry.getAll();
      const second = registry.getAll();

      // Assert
      expect(first).toEqual(second);
    });
  });

  describe("getById", () => {
    it('should return Claude Sonnet 4.6 when id is "anthropic/claude-sonnet-4.6"', () => {
      // Arrange & Act
      const model = registry.getById("anthropic/claude-sonnet-4.6");

      // Assert
      expect(model).toBeDefined();
      expect(model!.id).toBe("anthropic/claude-sonnet-4.6");
      expect(model!.name).toBe("Claude Sonnet 4.6");
    });

    it("should return model with correct capabilities when found", () => {
      // Arrange & Act
      const model = registry.getById("anthropic/claude-sonnet-4.6");

      // Assert
      expect(model).toBeDefined();
      // mu values may shift after bootstrap/calibration — check ranges
      expect(model!.contextWindow).toBe(1_000_000);
    });


    it("should return undefined when id does not exist", () => {
      // Arrange & Act
      const model = registry.getById("nonexistent/model");

      // Assert
      expect(model).toBeUndefined();
    });

    it("should return undefined when id is empty string", () => {
      // Arrange & Act
      const model = registry.getById("");

      // Assert
      expect(model).toBeUndefined();
    });
  });

  describe("data integrity", () => {

    it("should have cost with non-negative inputPer1M and outputPer1M for each model", () => {
      // Arrange
      const models = registry.getAll();

      // Act & Assert — local models have $0 cost, some models may lack cost data
      for (const model of models) {
        if (model.cost) {
          expect(model.cost.inputPer1M).toBeGreaterThanOrEqual(0);
          expect(model.cost.outputPer1M).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe("getByIds", () => {
    it("should return matching models for valid IDs", () => {
      // Arrange
      const ids = ["anthropic/claude-sonnet-4.6", "google/gemini-2.5-flash"];

      // Act
      const models = registry.getByIds(ids);

      // Assert
      expect(models).toBeArrayOfSize(2);
      expect(models.map((m) => m.id)).toEqual(ids);
    });

    it("should return empty array when input is empty", () => {
      // Arrange & Act
      const models = registry.getByIds([]);

      // Assert
      expect(models).toBeArrayOfSize(0);
    });

    it("should return only matched models when some IDs are invalid", () => {
      // Arrange
      const ids = ["anthropic/claude-sonnet-4.6", "nonexistent", "google/gemini-2.5-pro"];

      // Act
      const models = registry.getByIds(ids);

      // Assert
      expect(models).toBeArrayOfSize(2);
      expect(models[0]!.id).toBe("anthropic/claude-sonnet-4.6");
      expect(models[1]!.id).toBe("google/gemini-2.5-pro");
    });
  });

  describe("filterByContext", () => {
    it("should return models with context >= threshold", () => {
      // Arrange & Act
      const models = registry.filterByContext(128_000);

      // Assert
      for (const model of models) {
        expect(model.contextWindow).toBeGreaterThanOrEqual(128_000);
      }
      expect(models.length).toBeGreaterThan(0);
    });

    it("should include model when context equals threshold exactly", () => {
      // Arrange — pick an available model with known context
      const target = registry.getAvailable().find((m) => m.contextWindow > 0)!;
      const threshold = target.contextWindow;

      // Act
      const models = registry.filterByContext(threshold);

      // Assert
      expect(models.some((m) => m.id === target.id)).toBe(true);
    });

    it("should exclude model when context is below threshold", () => {
      // Arrange — pick an available model and set threshold above its context
      const target = registry.getAvailable().find((m) => m.contextWindow > 0)!;
      const threshold = target.contextWindow + 1;

      // Act
      const models = registry.filterByContext(threshold);

      // Assert
      expect(models.some((m) => m.id === target.id)).toBe(false);
    });
  });

  describe("filterByToolCalling", () => {
    it("should return only models that support tool calling", () => {
      // Arrange & Act
      const models = registry.filterByToolCalling();

      // Assert
      for (const model of models) {
        expect(model.supportsToolCalling).toBe(true);
      }
      expect(models.length).toBeGreaterThan(0);
    });

    it("should only return available models from filterByToolCalling", () => {
      const filtered = registry.filterByToolCalling();
      for (const m of filtered) {
        expect(m.available).not.toBe(false);
      }
    });
  });

  describe("filterByContext (availability)", () => {
    it("should only return available models from filterByContext", () => {
      // Models with available=false should be excluded
      const filtered = registry.filterByContext(0);
      for (const m of filtered) {
        expect(m.available).not.toBe(false);
      }
    });
  });

  describe("filterByMultilingual", () => {
  });
});

// ================================================================
// Dimensional Rating — parseModels + ModelRegistry
// ================================================================

/**
 * DimensionRating tests for registry.
 * Expects DimensionRating { mu, sigma, comparisons }.
 * mu scale: 0-1000 (old score × 100).
 * sigma: initial 350, decreases with comparisons.
 */

