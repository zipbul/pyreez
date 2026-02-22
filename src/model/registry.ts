/**
 * Model registry — loads models from scores/models.json.
 * 21-dimension capability model, 18 GitHub Models.
 */

import type {
  ModelInfo,
  ModelCapabilities,
  ModelConfidence,
  CapabilityDimension,
} from "./types";
import { ALL_DIMENSIONS } from "./types";
import modelsJson from "../../scores/models.json";

// -- JSON → ModelInfo parser --

interface ScoreEntry {
  score: number;
  confidence: number;
  dataPoints: number;
}

interface JsonModelEntry {
  name: string;
  contextWindow: number;
  supportsToolCalling: boolean;
  cost: { inputPer1M: number; outputPer1M: number };
  scores: Record<string, ScoreEntry>;
}

interface ModelsJsonSchema {
  version: number;
  models: Record<string, JsonModelEntry>;
}

function parseModels(data: ModelsJsonSchema): ModelInfo[] {
  const result: ModelInfo[] = [];

  for (const [id, entry] of Object.entries(data.models)) {
    const capabilities: Record<string, number> = {};
    const confidence: Record<string, number> = {};

    for (const dim of ALL_DIMENSIONS) {
      const scoreEntry = entry.scores[dim];
      capabilities[dim] = scoreEntry?.score ?? 0;
      confidence[dim] = scoreEntry?.confidence ?? 0.3;
    }

    result.push({
      id,
      name: entry.name,
      contextWindow: entry.contextWindow,
      capabilities: capabilities as ModelCapabilities,
      confidence: confidence as ModelConfidence,
      cost: entry.cost,
      supportsToolCalling: entry.supportsToolCalling,
    });
  }

  return result;
}

const MODELS: readonly ModelInfo[] = parseModels(modelsJson as unknown as ModelsJsonSchema);

/**
 * Registry of available LLM models with capability scores.
 */
export class ModelRegistry {
  private readonly models: ReadonlyMap<string, ModelInfo>;

  constructor(models?: readonly ModelInfo[]) {
    const map = new Map<string, ModelInfo>();
    for (const model of models ?? MODELS) {
      map.set(model.id, model);
    }
    this.models = map;
  }

  /** Return all registered models. */
  getAll(): ModelInfo[] {
    return [...this.models.values()];
  }

  /** Look up a model by its ID. */
  getById(id: string): ModelInfo | undefined {
    return this.models.get(id);
  }

  /** Batch lookup — returns only found models, preserving order. */
  getByIds(ids: string[]): ModelInfo[] {
    const result: ModelInfo[] = [];
    for (const id of ids) {
      const model = this.models.get(id);
      if (model) result.push(model);
    }
    return result;
  }

  /** Filter models by minimum context window size. */
  filterByContext(minContext: number): ModelInfo[] {
    return this.getAll().filter((m) => m.contextWindow >= minContext);
  }

  /** Filter models that support tool/function calling. */
  filterByToolCalling(): ModelInfo[] {
    return this.getAll().filter((m) => m.supportsToolCalling);
  }

  /** Filter models by minimum MULTILINGUAL capability score. */
  filterByMultilingual(minScore: number): ModelInfo[] {
    return this.getAll().filter(
      (m) => m.capabilities.MULTILINGUAL >= minScore,
    );
  }
}
