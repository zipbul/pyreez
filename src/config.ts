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
  /** Selector variant. Default: "bt-ce". */
  selector?: "bt-ce" | "knn" | "cascade";
  /** Exploration strategy. Default: "thompson". */
  exploration?: "greedy" | "thompson";
  /** Weight for latency efficiency (default: 0, disabled). */
  latencyWeight?: number;
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  qualityWeight: 0.7,
  costWeight: 0.3,
};

export interface PyreezConfig {
  providers: {
    anthropic?: { apiKey: string; baseUrl?: string };
    google?: { apiKey: string };
    openai?: { apiKey: string };
    deepseek?: { apiKey: string };
    xai?: { apiKey: string };
    mistral?: { apiKey: string };
    qwen?: { apiKey: string };
    groq?: { apiKey: string };
    local?: { baseUrl: string; socketPath?: string };
    claudeCli?: { enabled: boolean };
  };
  defaultModel?: string;
  routing: RoutingConfig;
}

/**
 * Load config from environment variables.
 * All providers are optional — only configure ones with keys present.
 *
 * PYREEZ_ANTHROPIC_KEY — Anthropic API key
 * PYREEZ_GOOGLE_API_KEY — Google AI API key
 * PYREEZ_OPENAI_KEY — OpenAI API key
 * PYREEZ_DEEPSEEK_KEY — DeepSeek API key
 * PYREEZ_XAI_KEY — xAI (Grok) API key
 * PYREEZ_MISTRAL_KEY — Mistral AI API key
 * PYREEZ_QWEN_KEY — Qwen/Alibaba Cloud API key
 * PYREEZ_GROQ_KEY — Groq API key
 * PYREEZ_CLAUDE_CLI — set to "1" to use `claude -p` for anthropic/* models (no API cost)
 * PYREEZ_LOCAL_URL — Local LLM base URL (e.g., Docker Model Runner, Ollama, LM Studio)
 * PYREEZ_LOCAL_SOCKET — Unix socket path for Docker Model Runner (e.g., /var/run/docker.sock)
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
    const VALID_SELECTORS = ["bt-ce", "knn", "cascade"];
    const VALID_EXPLORATIONS = ["greedy", "thompson"];
    const raw = parsed.routing as Record<string, unknown>;
    const selectorRaw = raw.selector;
    const explorationRaw = raw.exploration;
    return {
      qualityWeight: typeof parsed.routing.qualityWeight === "number"
        ? Math.max(0, parsed.routing.qualityWeight)
        : DEFAULT_ROUTING_CONFIG.qualityWeight,
      costWeight: typeof parsed.routing.costWeight === "number"
        ? Math.max(0, parsed.routing.costWeight)
        : DEFAULT_ROUTING_CONFIG.costWeight,
      selector: typeof selectorRaw === "string" && VALID_SELECTORS.includes(selectorRaw)
        ? (selectorRaw as RoutingConfig["selector"])
        : undefined,
      exploration: typeof explorationRaw === "string" && VALID_EXPLORATIONS.includes(explorationRaw)
        ? (explorationRaw as RoutingConfig["exploration"])
        : undefined,
      latencyWeight: typeof raw.latencyWeight === "number"
        ? Math.max(0, raw.latencyWeight)
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

  const anthropicKey = Bun.env.PYREEZ_ANTHROPIC_KEY;
  if (anthropicKey) {
    config.providers.anthropic = { apiKey: anthropicKey };
  }

  const googleKey = Bun.env.PYREEZ_GOOGLE_API_KEY;
  if (googleKey) {
    config.providers.google = { apiKey: googleKey };
  }

  const openaiKey = Bun.env.PYREEZ_OPENAI_KEY;
  if (openaiKey) {
    config.providers.openai = { apiKey: openaiKey };
  }

  const deepseekKey = Bun.env.PYREEZ_DEEPSEEK_KEY;
  if (deepseekKey) {
    config.providers.deepseek = { apiKey: deepseekKey };
  }

  const xaiKey = Bun.env.PYREEZ_XAI_KEY;
  if (xaiKey) {
    config.providers.xai = { apiKey: xaiKey };
  }

  const mistralKey = Bun.env.PYREEZ_MISTRAL_KEY;
  if (mistralKey) {
    config.providers.mistral = { apiKey: mistralKey };
  }

  const qwenKey = Bun.env.PYREEZ_QWEN_KEY;
  if (qwenKey) {
    config.providers.qwen = { apiKey: qwenKey };
  }

  const groqKey = Bun.env.PYREEZ_GROQ_KEY;
  if (groqKey) {
    config.providers.groq = { apiKey: groqKey };
  }

  // Claude CLI provider: uses `claude -p` via Claude Code subscription
  // Takes priority over PYREEZ_ANTHROPIC_KEY when both are set
  const claudeCli = Bun.env.PYREEZ_CLAUDE_CLI;
  if (claudeCli === "1") {
    config.providers.claudeCli = { enabled: true };
    // Remove SDK-based anthropic provider — CLI replaces it
    delete config.providers.anthropic;
  }

  // Local LLM provider (Docker Model Runner, Ollama, LM Studio, etc.)
  const localUrl = Bun.env.PYREEZ_LOCAL_URL;
  const localSocket = Bun.env.PYREEZ_LOCAL_SOCKET;
  if (localUrl || localSocket) {
    config.providers.local = {
      baseUrl: localUrl ?? "http://localhost/exp/vDD4.40/engines",
      socketPath: localSocket,
    };
  }

  // At least one provider must be configured
  if (Object.keys(config.providers).length === 0) {
    throw new Error(
      "No LLM providers configured. Set at least one of: PYREEZ_ANTHROPIC_KEY, PYREEZ_GOOGLE_API_KEY, PYREEZ_OPENAI_KEY, PYREEZ_DEEPSEEK_KEY, PYREEZ_XAI_KEY, PYREEZ_MISTRAL_KEY, PYREEZ_QWEN_KEY, PYREEZ_GROQ_KEY, PYREEZ_LOCAL_URL, PYREEZ_LOCAL_SOCKET, or PYREEZ_CLAUDE_CLI=1",
    );
  }

  return config;
}
