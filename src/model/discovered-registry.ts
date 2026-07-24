/**
 * Discovery-backed registry adapter — presents live-discovered models through the same
 * `{ getAvailable, getById, buildProviderMap }` shape the wire/cli/engine already consume, so
 *
 * Discovery supplies only id and provider — that is all a ModelInfo carries.
 * as "unknown" defaults: cost {0,0}, contextWindow 0.
 */

import type { ModelInfo } from "./types";
import type { ProviderName } from "../llm/types";
import type { DiscoveredModel } from "./discovery";

/** Minimal registry surface consumed by wire/cli. */
export interface RegistryLike {
  getAvailable(): ModelInfo[];
  getById(id: string): ModelInfo | undefined;
  buildProviderMap(): ReadonlyMap<string, ProviderName>;
}

/** Map a DiscoveredModel to a ModelInfo with unknown-cost defaults. */
export function toModelInfo(m: DiscoveredModel): ModelInfo {
  return {
    id: m.id,
    provider: m.provider,
  };
}

/** Build a registry-shaped adapter over a ModelInfo list. */
function registryFromModels(infos: readonly ModelInfo[]): RegistryLike {
  const all = [...infos];
  const byId = new Map(all.map((m) => [m.id, m]));
  return {
    getAvailable: () => all,
    getById: (id) => byId.get(id),
    buildProviderMap: () => new Map(all.map((m) => [m.id, m.provider])),
  };
}

/** Build a registry-shaped adapter over a discovered model list. */
export function discoveredRegistry(models: readonly DiscoveredModel[]): RegistryLike {
  return registryFromModels(models.map(toModelInfo));
}

