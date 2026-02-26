/**
 * Model registry — loads models from scores/models.json.
 * 21-dimension capability model, Anthropic + Google providers.
 */

import type {
  ModelInfo,
  ModelCapabilities,
  DimensionRating,
  CapabilityDimension,
} from "./types";
import type { ProviderName } from "../llm/types";
import { ALL_DIMENSIONS, SIGMA_BASE } from "./types";
import modelsJson from "../../scores/models.json";

// -- JSON → ModelInfo parser --

/** V2 score entry: BT dimensional rating. */
interface ScoreEntry {
  mu: number;
  sigma: number;
  comparisons: number;
}

/** V1 legacy score entry (auto-migrated). */
interface LegacyScoreEntry {
  score: number;
  confidence: number;
  dataPoints: number;
}

interface JsonModelEntry {
  name: string;
  provider: ProviderName;
  contextWindow: number;
  supportsToolCalling: boolean;
  cost: { inputPer1M: number; outputPer1M: number };
  scores: Record<string, ScoreEntry>;
  available?: boolean;
}

interface ModelsJsonSchema {
  version: number;
  models: Record<string, JsonModelEntry>;
}

/** Default DimensionRating for missing entries. */
const DEFAULT_RATING: DimensionRating = { mu: 0, sigma: SIGMA_BASE, comparisons: 0 };

/** Detect if entry is legacy v1 format (has 'score' key). */
function isLegacy(entry: unknown): entry is LegacyScoreEntry {
  return typeof entry === "object" && entry !== null && "score" in entry;
}

function parseModels(data: ModelsJsonSchema): ModelInfo[] {
  const result: ModelInfo[] = [];

  for (const [id, entry] of Object.entries(data.models)) {
    const capabilities: Record<string, DimensionRating> = {};

    for (const dim of ALL_DIMENSIONS) {
      const raw = entry.scores[dim] as unknown;
      if (!raw) {
        capabilities[dim] = { ...DEFAULT_RATING };
      } else if (isLegacy(raw)) {
        // V1 → V2 migration: score×100 → mu, confidence unused, dataPoints → comparisons
        capabilities[dim] = {
          mu: raw.score * 100,
          sigma: SIGMA_BASE,
          comparisons: raw.dataPoints,
        };
      } else {
        const v2 = raw as ScoreEntry;
        capabilities[dim] = {
          mu: v2.mu ?? 0,
          sigma: v2.sigma ?? SIGMA_BASE,
          comparisons: v2.comparisons ?? 0,
        };
      }
    }

    result.push({
      id,
      name: entry.name,
      provider: entry.provider,
      contextWindow: entry.contextWindow,
      capabilities: capabilities as ModelCapabilities,
      cost: entry.cost,
      supportsToolCalling: entry.supportsToolCalling,
      available: entry.available !== false,
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

  /** Return only models available in the API. */
  getAvailable(): ModelInfo[] {
    return this.getAll().filter((m) => m.available !== false);
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

  /** Filter models by minimum MULTILINGUAL mu score. */
  filterByMultilingual(minScore: number): ModelInfo[] {
    return this.getAll().filter(
      (m) => m.capabilities.MULTILINGUAL.mu >= minScore,
    );
  }

  /** Build a model ID → provider name map for ProviderRegistry. */
  buildProviderMap(): ReadonlyMap<string, ProviderName> {
    const map = new Map<string, ProviderName>();
    for (const model of this.models.values()) {
      map.set(model.id, model.provider);
    }
    return map;
  }
}

/** Exported for unit testing only — not part of public API. */
export const __testing__ = { parseModels } as const;