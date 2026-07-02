/**
 * Discovery-backed registry adapter — presents live-discovered models through the same
 * `{ getAll, getAvailable, getById, buildProviderMap }` shape the wire/cli/engine already consume, so
 * the curated ModelRegistry can be swapped out with minimal churn.
 *
 * Discovery supplies only id/provider/displayName/description. The other ModelInfo fields are synthesized
 * as "unknown" defaults: cost {0,0} (so scoreModel degrades to its cost-proxy path), contextWindow 0,
 * supportsToolCalling true. Curated metadata (cost/benchmark), if ever reintroduced, would overlay by id.
 */

import type { ModelInfo } from "./types";
import type { ProviderName } from "../llm/types";
import type { DiscoveredModel } from "./discovery";

/** Minimal registry surface consumed by wire/cli. */
export interface RegistryLike {
  getAll(): ModelInfo[];
  getAvailable(): ModelInfo[];
  getById(id: string): ModelInfo | undefined;
  buildProviderMap(): ReadonlyMap<string, ProviderName>;
}

/** Map a DiscoveredModel to a ModelInfo with unknown-cost defaults. */
export function toModelInfo(m: DiscoveredModel): ModelInfo {
  return {
    id: m.id,
    name: m.displayName ?? m.id,
    provider: m.provider,
    contextWindow: 0,
    cost: { inputPer1M: 0, outputPer1M: 0 },
    supportsToolCalling: true,
    available: true,
  };
}

/** Build a registry-shaped adapter over a discovered model list. */
export function discoveredRegistry(models: readonly DiscoveredModel[]): RegistryLike {
  const infos = models.map(toModelInfo);
  const byId = new Map(infos.map((m) => [m.id, m]));
  return {
    getAll: () => [...infos],
    getAvailable: () => infos.filter((m) => m.available !== false),
    getById: (id) => byId.get(id),
    buildProviderMap: () => new Map(infos.map((m) => [m.id, m.provider])),
  };
}
