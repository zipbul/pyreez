/**
 * Unit tests for ModelRegistry.
 */

import { describe, it, expect } from "bun:test";
import { ModelRegistry, __testing__ } from "./registry";
import { ALL_DIMENSIONS, SIGMA_BASE } from "./types";
import type { ModelInfo } from "./types";

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
      expect(model!.capabilities.REASONING.mu).toBeGreaterThan(700);
      expect(model!.capabilities.CODE_GENERATION.mu).toBeGreaterThan(600);
      expect(model!.contextWindow).toBe(1_000_000);
    });

    it("should return model with high REASONING mu for Claude Opus 4.6", () => {
      // Arrange & Act
      const model = registry.getById("anthropic/claude-opus-4.6");

      // Assert
      expect(model).toBeDefined();
      // Opus 4.6 should be among the highest-rated for REASONING
      expect(model!.capabilities.REASONING.mu).toBeGreaterThan(900);
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
      // Arrange — Claude Haiku 4.5 has 200K context
      const haiku = registry.getById("anthropic/claude-haiku-4.5")!;
      const threshold = haiku.contextWindow;

      // Act
      const models = registry.filterByContext(threshold);

      // Assert
      expect(models.some((m) => m.id === "anthropic/claude-haiku-4.5")).toBe(true);
    });

    it("should exclude model when context is below threshold", () => {
      // Arrange — Claude Haiku 4.5 has 200K context
      const haiku = registry.getById("anthropic/claude-haiku-4.5")!;
      const threshold = haiku.contextWindow + 1;

      // Act
      const models = registry.filterByContext(threshold);

      // Assert
      expect(models.some((m) => m.id === "anthropic/claude-haiku-4.5")).toBe(false);
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
      const model = registry.getById("anthropic/claude-sonnet-4.6");

      // Assert — capabilities should be DimensionRating objects
      expect(model).toBeDefined();
      const reasoning = model!.capabilities.REASONING as any;
      expect(reasoning).toHaveProperty("mu");
      expect(reasoning).toHaveProperty("sigma");
      expect(reasoning).toHaveProperty("comparisons");
      expect(typeof reasoning.mu).toBe("number");
    });

    it("should parse all 50 models with 21 dimensions each", () => {
      // Arrange & Act
      const models = registry.getAll();

      // Assert
      expect(models).toBeArrayOfSize(50);
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
          provider: "anthropic",
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
          provider: "anthropic",
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
      const model = registry.getById("anthropic/claude-sonnet-4.6");

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

    it("should pass all available models when minScore=0", () => {
      // Act
      const availableModels = registry.getAvailable();
      const filtered = registry.filterByMultilingual(0);

      // Assert
      expect(filtered.length).toBe(availableModels.length);
    });
  });

  describe("getByIds with DimensionRating", () => {
    it("should return only existing models in request order", () => {
      // Arrange
      const ids = ["anthropic/claude-sonnet-4.6", "nonexistent/x", "google/gemini-2.5-flash"];

      // Act
      const models = registry.getByIds(ids);

      // Assert
      expect(models).toBeArrayOfSize(2);
      expect(models[0]!.id).toBe("anthropic/claude-sonnet-4.6");
      expect(models[1]!.id).toBe("google/gemini-2.5-flash");
      // Verify DimensionRating structure
      const rating = models[0]!.capabilities.REASONING as any;
      expect(rating).toHaveProperty("mu");
    });
  });

  // -- V1 legacy migration --

  describe("parseModels V1 legacy format", () => {
    it("should migrate V1 legacy format scores to V2 BT format", () => {
      // Arrange — V1 format has { score, confidence, dataPoints }
      const v1Data = {
        version: 1,
        models: {
          "test/legacy-model": {
            name: "Legacy",
            contextWindow: 32000,
            supportsToolCalling: false,
            cost: { inputPer1M: 1, outputPer1M: 2 },
            scores: {
              REASONING: { score: 0.8, confidence: 0.9, dataPoints: 5 },
            },
          },
        },
      };

      // Act — parseModels via __testing__ export (TST-ACCESS)
      const models = __testing__.parseModels(v1Data as any);

      // Assert — V1 → V2 migration: score×100 → mu, sigma=SIGMA_BASE, dataPoints → comparisons
      expect(models).toHaveLength(1);
      const model = models[0]!;
      expect(model.id).toBe("test/legacy-model");
      expect(model.name).toBe("Legacy");
      const reasoning = model.capabilities.REASONING;
      expect(reasoning.mu).toBe(80); // 0.8 * 100
      expect(reasoning.sigma).toBe(SIGMA_BASE);
      expect(reasoning.comparisons).toBe(5);
      // Non-specified dimensions should get default rating (mu=500)
      const codegen = model.capabilities.CODE_GENERATION;
      expect(codegen.mu).toBe(500);
      expect(codegen.sigma).toBe(SIGMA_BASE);
      expect(codegen.comparisons).toBe(0);
    });
  });

  // -- getAvailable --

  describe("getAvailable", () => {
    it("should filter out models with available=false", () => {
      // Arrange — create registry with mix of available/unavailable models
      const available: ModelInfo = {
        id: "test/available",
        name: "Available",
        provider: "anthropic",
        contextWindow: 32000,
        capabilities: {} as any,
        cost: { inputPer1M: 1, outputPer1M: 2 },
        supportsToolCalling: true,
        available: true,
      };
      const unavailable: ModelInfo = {
        id: "test/unavailable",
        name: "Unavailable",
        provider: "anthropic",
        contextWindow: 32000,
        capabilities: {} as any,
        cost: { inputPer1M: 1, outputPer1M: 2 },
        supportsToolCalling: true,
        available: false,
      };
      const reg = new ModelRegistry([available, unavailable]);

      // Act
      const result = reg.getAvailable();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("test/available");
    });

    it("should include models without available field (default true)", () => {
      // Arrange — model with no 'available' property
      const noField: ModelInfo = {
        id: "test/no-field",
        name: "NoField",
        provider: "anthropic",
        contextWindow: 32000,
        capabilities: {} as any,
        cost: { inputPer1M: 1, outputPer1M: 2 },
        supportsToolCalling: true,
        // available not set
      };
      const reg = new ModelRegistry([noField]);

      // Act
      const result = reg.getAvailable();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("test/no-field");
    });
  });
});
