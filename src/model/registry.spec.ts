/**
 * Unit tests for ModelRegistry.
 * PRUNE final list: 17 tests.
 */

import { describe, it, expect } from "bun:test";
import { ModelRegistry } from "./registry";
import { ALL_DIMENSIONS } from "./types";
import type { ModelInfo } from "./types";

// -- Tests --

describe("ModelRegistry", () => {
  const registry = new ModelRegistry();

  describe("getAll", () => {
    it("should return array of 18 models", () => {
      // Arrange & Act
      const models = registry.getAll();

      // Assert
      expect(models).toBeArrayOfSize(18);
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
    it('should return GPT-4.1 when id is "openai/gpt-4.1"', () => {
      // Arrange & Act
      const model = registry.getById("openai/gpt-4.1");

      // Assert
      expect(model).toBeDefined();
      expect(model!.id).toBe("openai/gpt-4.1");
      expect(model!.name).toBe("GPT-4.1");
    });

    it("should return model with correct capabilities when found", () => {
      // Arrange & Act
      const model = registry.getById("openai/gpt-4.1");

      // Assert
      expect(model).toBeDefined();
      expect(model!.capabilities.REASONING).toBe(9);
      expect(model!.capabilities.CODE_GENERATION).toBe(9);
      expect(model!.contextWindow).toBe(1_000_000);
    });

    it("should return model with REASONING=10 for DeepSeek-R1-0528", () => {
      // Arrange & Act
      const model = registry.getById("deepseek/DeepSeek-R1-0528");

      // Assert
      expect(model).toBeDefined();
      expect(model!.capabilities.REASONING).toBe(10);
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
    it("should have all 21 dimensions with values 0-10 for each model", () => {
      // Arrange
      const models = registry.getAll();

      // Act & Assert
      for (const model of models) {
        for (const dim of ALL_DIMENSIONS) {
          const score = model.capabilities[dim];
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(10);
        }
      }
    });

    it("should have cost with positive inputPer1M and outputPer1M for each model", () => {
      // Arrange
      const models = registry.getAll();

      // Act & Assert
      for (const model of models) {
        expect(model.cost.inputPer1M).toBeGreaterThan(0);
        expect(model.cost.outputPer1M).toBeGreaterThan(0);
      }
    });
  });

  describe("getByIds", () => {
    it("should return matching models for valid IDs", () => {
      // Arrange
      const ids = ["openai/gpt-4.1", "openai/gpt-4o-mini"];

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
      const ids = ["openai/gpt-4.1", "nonexistent", "microsoft/Phi-4"];

      // Act
      const models = registry.getByIds(ids);

      // Assert
      expect(models).toBeArrayOfSize(2);
      expect(models[0].id).toBe("openai/gpt-4.1");
      expect(models[1].id).toBe("microsoft/Phi-4");
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
      // Arrange — Phi-4 has 16K context
      const phi4 = registry.getById("microsoft/Phi-4")!;
      const threshold = phi4.contextWindow;

      // Act
      const models = registry.filterByContext(threshold);

      // Assert
      expect(models.some((m) => m.id === "microsoft/Phi-4")).toBe(true);
    });

    it("should exclude model when context is below threshold", () => {
      // Arrange — Phi-4 has 16K context
      const phi4 = registry.getById("microsoft/Phi-4")!;
      const threshold = phi4.contextWindow + 1;

      // Act
      const models = registry.filterByContext(threshold);

      // Assert
      expect(models.some((m) => m.id === "microsoft/Phi-4")).toBe(false);
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
  });

  describe("filterByMultilingual", () => {
    it("should return models with MULTILINGUAL >= threshold", () => {
      // Arrange & Act
      const models = registry.filterByMultilingual(7);

      // Assert
      for (const model of models) {
        expect(model.capabilities.MULTILINGUAL).toBeGreaterThanOrEqual(7);
      }
      expect(models.length).toBeGreaterThan(0);
    });
  });
});
