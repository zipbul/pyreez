/**
 * Pyreez configuration.
 * Provider-based architecture: each provider has its own optional config block.
 */

export interface PyreezConfig {
  providers: {
    anthropic?: { apiKey: string; baseUrl?: string };
    google?: { apiKey: string };
    openai?: { apiKey: string };
    local?: { baseUrl: string; socketPath?: string };
    claudeCli?: { enabled: boolean };
  };
  defaultModel?: string;
}

/**
 * Load config from environment variables.
 * All providers are optional — only configure ones with keys present.
 *
 * PYREEZ_ANTHROPIC_KEY — Anthropic API key
 * PYREEZ_GOOGLE_API_KEY — Google AI API key
 * PYREEZ_OPENAI_KEY — OpenAI API key
 * PYREEZ_CLAUDE_CLI — set to "1" to use `claude -p` for anthropic/* models (no API cost)
 * PYREEZ_LOCAL_URL — Local LLM base URL (e.g., Docker Model Runner, Ollama, LM Studio)
 * PYREEZ_LOCAL_SOCKET — Unix socket path for Docker Model Runner (e.g., /var/run/docker.sock)
 * PYREEZ_MODEL — default model (optional, default "openai/gpt-4.1")
 */
export function loadConfigFromEnv(): PyreezConfig {
  const config: PyreezConfig = {
    providers: {},
    defaultModel: Bun.env.PYREEZ_MODEL ?? "anthropic/claude-sonnet-4.6",
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
      "No LLM providers configured. Set at least one of: PYREEZ_ANTHROPIC_KEY, PYREEZ_GOOGLE_API_KEY, PYREEZ_OPENAI_KEY, PYREEZ_LOCAL_URL, PYREEZ_LOCAL_SOCKET, or PYREEZ_CLAUDE_CLI=1",
    );
  }

  return config;
}
