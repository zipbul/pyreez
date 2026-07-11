/**
 * In-memory model registry. Models are supplied by the caller (live provider discovery);
 * there is no on-disk curated catalog — an empty registry is valid (discovery fills it).
 */

import type { ModelInfo } from "./types";
import type { ProviderName } from "../llm/types";

/**
 * Registry of available LLM models.
 */
export class ModelRegistry {
  private readonly models: ReadonlyMap<string, ModelInfo>;

  constructor(models: readonly ModelInfo[] = []) {
    const map = new Map<string, ModelInfo>();
    for (const model of models) {
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
