/**
 * Pyreez configuration.
 * Provider API keys: environment variables (secrets).
 * Routing policy: .pyreez/config.jsonc (version-controlled).
 */

export interface RoutingConfig {
  /** Weight for model capability quality (default: 0.7). */
  qualityWeight: number;
  /** Weight for cost efficiency (default: 0.3). */
  costWeight: number;
  /** Weight for latency efficiency (default: 0, disabled). */
  latencyWeight?: number;
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  qualityWeight: 0.7,
  costWeight: 0.3,
};

export interface PyreezConfig {
  providers: {
    xai?: { apiKey: string };
  };
  defaultModel?: string;
  routing: RoutingConfig;
}

/**
 * Load config from environment variables.
 * All providers are optional — only configure ones with keys present.
 *
 * PYREEZ_XAI_KEY — xAI (Grok) API key
 * PYREEZ_MODEL — default model (optional, default "anthropic/claude-sonnet-4.6")
 */

/**
 * Load routing config from .pyreez/config.jsonc using Bun.JSONC.
 * Returns defaults if file doesn't exist or is invalid.
 */
export async function loadRoutingConfig(path = ".pyreez/config.jsonc"): Promise<RoutingConfig> {
  try {
    const file = Bun.file(path);
    if (!await file.exists()) return { ...DEFAULT_ROUTING_CONFIG };
    const text = await file.text();
    const parsed = Bun.JSONC.parse(text) as { routing?: Partial<RoutingConfig> };
    if (!parsed?.routing) return { ...DEFAULT_ROUTING_CONFIG };
    return {
      qualityWeight: typeof parsed.routing.qualityWeight === "number"
        ? Math.max(0, parsed.routing.qualityWeight)
        : DEFAULT_ROUTING_CONFIG.qualityWeight,
      costWeight: typeof parsed.routing.costWeight === "number"
        ? Math.max(0, parsed.routing.costWeight)
        : DEFAULT_ROUTING_CONFIG.costWeight,
      latencyWeight: typeof (parsed.routing as Record<string, unknown>).latencyWeight === "number"
        ? Math.max(0, (parsed.routing as Record<string, unknown>).latencyWeight as number)
        : undefined,
    };
  } catch {
    return { ...DEFAULT_ROUTING_CONFIG };
  }
}

export function loadConfigFromEnv(routing?: RoutingConfig): PyreezConfig {
  const config: PyreezConfig = {
    providers: {},
    defaultModel: Bun.env.PYREEZ_MODEL ?? "anthropic/claude-sonnet-4.6",
    routing: routing ?? { ...DEFAULT_ROUTING_CONFIG },
  };

  const xaiKey = Bun.env.PYREEZ_XAI_KEY;
  if (xaiKey) {
    config.providers.xai = { apiKey: xaiKey };
  }

  // At least one provider must be configured
  if (Object.keys(config.providers).length === 0) {
    throw new Error(
      "No LLM providers configured. Set PYREEZ_XAI_KEY.",
    );
  }

  return config;
}
