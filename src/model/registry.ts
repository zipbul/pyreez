/**
 * Model registry — loads models from .pyreez/models.jsonc.
 */

import type { ModelInfo } from "./types";
import type { ProviderName } from "../llm/types";

// -- JSON → ModelInfo parser --

interface JsonModelEntry {
  name: string;
  provider: ProviderName;
  contextWindow: number;
  cost: { inputPer1M: number; outputPer1M: number };
  available?: boolean;
  family?: string;
  supportsToolCalling?: boolean;
  benchmark?: Record<string, number>;
}

interface ModelsJsonSchema {
  version: number;
  models: Record<string, JsonModelEntry>;
}

function parseModels(data: ModelsJsonSchema): ModelInfo[] {
  const result: ModelInfo[] = [];
  for (const [id, entry] of Object.entries(data.models)) {
    result.push({
      id,
      name: entry.name,
      provider: entry.provider,
      contextWindow: entry.contextWindow,
      cost: entry.cost,
      supportsToolCalling: entry.supportsToolCalling !== false,
      available: entry.available !== false,
      family: entry.family,
      benchmark: entry.benchmark,
    });
  }
  return result;
}

/** Load models from .pyreez/models.jsonc using Bun.JSONC parser. */
function loadModels(): readonly ModelInfo[] {
  const text = require("fs").readFileSync(".pyreez/models.jsonc", "utf-8");
  const data = Bun.JSONC.parse(text) as ModelsJsonSchema;
  return parseModels(data);
}

const MODELS: readonly ModelInfo[] = loadModels();

/**
 * Registry of available LLM models.
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

  getAll(): ModelInfo[] {
    return [...this.models.values()];
  }

  getAvailable(): ModelInfo[] {
    return this.getAll().filter((m) => m.available !== false);
  }

  getById(id: string): ModelInfo | undefined {
    return this.models.get(id);
  }

  getByIds(ids: string[]): ModelInfo[] {
    const result: ModelInfo[] = [];
    for (const id of ids) {
      const model = this.models.get(id);
      if (model) result.push(model);
    }
    return result;
  }

  buildProviderMap(): ReadonlyMap<string, ProviderName> {
    const map = new Map<string, ProviderName>();
    for (const model of this.models.values()) {
      map.set(model.id, model.provider);
    }
    return map;
  }
}

/** Exported for unit testing only. */
export const __testing__ = { parseModels } as const;
