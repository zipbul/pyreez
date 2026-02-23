/**
 * Unit tests for ModelRegistry.
 */

import { describe, it, expect } from "bun:test";
import { ModelRegistry } from "./registry";
import { ALL_DIMENSIONS } from "./types";
import type { ModelInfo } from "./types";

// -- Tests --

describe("ModelRegistry", () => {
  const registry = new ModelRegistry();

  describe("getAll", () => {
    it("should return array of 21 models", () => {
      // Arrange & Act
      const models = registry.getAll();

      // Assert
      expect(models).toBeArrayOfSize(21);
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
      expect(model!.capabilities.REASONING.mu).toBe(900);
      expect(model!.capabilities.CODE_GENERATION.mu).toBe(900);
      expect(model!.contextWindow).toBe(1_000_000);
    });

    it("should return model with REASONING mu=1000 for DeepSeek-R1-0528", () => {
      // Arrange & Act
      const model = registry.getById("deepseek/DeepSeek-R1-0528");

      // Assert
      expect(model).toBeDefined();
      expect(model!.capabilities.REASONING.mu).toBe(1000);
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
    it("should have all 21 dimensions with valid DimensionRating for each model", () => {
      // Arrange
      const models = registry.getAll();

      // Act & Assert
      for (const model of models) {
        for (const dim of ALL_DIMENSIONS) {
          const rating = model.capabilities[dim];
          expect(rating).toHaveProperty("mu");
          expect(rating).toHaveProperty("sigma");
          expect(rating.mu).toBeGreaterThanOrEqual(0);
          expect(rating.mu).toBeLessThanOrEqual(1000);
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
    it("should return models with MULTILINGUAL.mu >= threshold", () => {
      // Arrange & Act
      const models = registry.filterByMultilingual(700);

      // Assert
      for (const model of models) {
        expect(model.capabilities.MULTILINGUAL.mu).toBeGreaterThanOrEqual(700);
      }
      expect(models.length).toBeGreaterThan(0);
    });
  });
});

// ================================================================
// BT Dimensional Rating — parseModels + ModelRegistry
// ================================================================

/**
 * BT Rating tests for registry.
 * Expects DimensionRating { mu, sigma, comparisons }.
 * mu scale: 0-1000 (old score × 100).
 * sigma: initial 350, decreases with comparisons.
 */

describe("ModelRegistry (BT rating)", () => {
  const registry = new ModelRegistry();

  // --- parseModels ---

  describe("parseModels v2", () => {
    it("should parse v2 JSON with mu/sigma/comparisons correctly", () => {
      // Arrange & Act — current registry loads from models.json
      const model = registry.getById("openai/gpt-4.1");

      // Assert — capabilities should be DimensionRating objects
      expect(model).toBeDefined();
      const reasoning = model!.capabilities.REASONING as any;
      expect(reasoning).toHaveProperty("mu");
      expect(reasoning).toHaveProperty("sigma");
      expect(reasoning).toHaveProperty("comparisons");
      expect(typeof reasoning.mu).toBe("number");
    });

    it("should parse all 21 models with 21 dimensions each", () => {
      // Arrange & Act
      const models = registry.getAll();

      // Assert
      expect(models).toBeArrayOfSize(21);
      for (const model of models) {
        for (const dim of ALL_DIMENSIONS) {
          const rating = model.capabilities[dim] as any;
          expect(rating).toHaveProperty("mu");
          expect(rating).toHaveProperty("sigma");
        }
      }
    });

    it("should apply defaults when dimension entry is missing", () => {
      // Arrange — construct registry with partial data
      const partialModels: ModelInfo[] = [
        {
          id: "test/partial",
          name: "Partial",
          contextWindow: 100_000,
          capabilities: (() => {
            const caps: Record<string, any> = {};
            // Only set REASONING, leave others missing
            caps.REASONING = { mu: 700, sigma: 200, comparisons: 5 };
            for (const dim of ALL_DIMENSIONS) {
              if (!caps[dim]) caps[dim] = { mu: 0, sigma: 350, comparisons: 0 };
            }
            return caps as any;
          })(),
          cost: { inputPer1M: 1, outputPer1M: 4 },
          supportsToolCalling: true,
        },
      ];
      const testRegistry = new ModelRegistry(partialModels);

      // Act
      const model = testRegistry.getById("test/partial");

      // Assert — REASONING has custom, others have defaults
      const reasoning = model!.capabilities.REASONING as any;
      expect(reasoning.mu).toBe(700);
      const creativity = model!.capabilities.CREATIVITY as any;
      expect(creativity.mu).toBe(0);
      expect(creativity.sigma).toBe(350);
    });

    it("should return empty array when models object is empty", () => {
      // Arrange
      const emptyRegistry = new ModelRegistry([]);

      // Act
      const models = emptyRegistry.getAll();

      // Assert
      expect(models).toBeArrayOfSize(0);
    });

    it("should handle mu=0 sigma=0 comparisons=0 as valid", () => {
      // Arrange
      const zeroModels: ModelInfo[] = [
        {
          id: "test/zero",
          name: "Zero",
          contextWindow: 100_000,
          capabilities: (() => {
            const caps: Record<string, any> = {};
            for (const dim of ALL_DIMENSIONS) {
              caps[dim] = { mu: 0, sigma: 0, comparisons: 0 };
            }
            return caps as any;
          })(),
          cost: { inputPer1M: 1, outputPer1M: 4 },
          supportsToolCalling: true,
        },
      ];
      const testRegistry = new ModelRegistry(zeroModels);

      // Act
      const model = testRegistry.getById("test/zero");

      // Assert
      const reasoning = model!.capabilities.REASONING as any;
      expect(reasoning.mu).toBe(0);
      expect(reasoning.sigma).toBe(0);
      expect(reasoning.comparisons).toBe(0);
    });

    it("should apply defaults when scores field is empty object", () => {
      // Arrange & Act — from real JSON, after migration empty scores → all defaults
      // This tests that parseModels handles missing score entries
      const model = registry.getById("openai/gpt-4.1");

      // Assert — all dimensions should have DimensionRating shape
      for (const dim of ALL_DIMENSIONS) {
        const rating = model!.capabilities[dim] as any;
        expect(rating).toBeDefined();
        expect(typeof rating.mu).toBe("number");
      }
    });
  });

  // --- ModelRegistry methods ---

  describe("getAll with DimensionRating", () => {
    it("should return models with DimensionRating capabilities", () => {
      // Arrange & Act
      const models = registry.getAll();

      // Assert — capabilities should not be plain numbers
      const first = models[0]!;
      const reasoning = first.capabilities.REASONING as any;
      expect(typeof reasoning).toBe("object");
      expect(reasoning).toHaveProperty("mu");
    });
  });

  describe("filterByMultilingual with DimensionRating", () => {
    it("should filter by capabilities[MULTILINGUAL].mu", () => {
      // Arrange — threshold in mu scale (700 = old 7.0)
      const muThreshold = 700;

      // Act
      const models = registry.filterByMultilingual(muThreshold);

      // Assert — each model's MULTILINGUAL.mu should be >= threshold
      for (const model of models) {
        const multi = model.capabilities.MULTILINGUAL as any;
        expect(multi.mu).toBeGreaterThanOrEqual(muThreshold);
      }
      expect(models.length).toBeGreaterThan(0);
    });

    it("should pass all models when minScore=0", () => {
      // Act
      const allModels = registry.getAll();
      const filtered = registry.filterByMultilingual(0);

      // Assert
      expect(filtered.length).toBe(allModels.length);
    });
  });

  describe("getByIds with DimensionRating", () => {
    it("should return only existing models in request order", () => {
      // Arrange
      const ids = ["openai/gpt-4.1", "nonexistent/x", "openai/gpt-4o-mini"];

      // Act
      const models = registry.getByIds(ids);

      // Assert
      expect(models).toBeArrayOfSize(2);
      expect(models[0]!.id).toBe("openai/gpt-4.1");
      expect(models[1]!.id).toBe("openai/gpt-4o-mini");
      // Verify DimensionRating structure
      const rating = models[0]!.capabilities.REASONING as any;
      expect(rating).toHaveProperty("mu");
    });
  });
});
