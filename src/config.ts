/**
 * Pyreez configuration.
 * Provider-based architecture: each provider has its own optional config block.
 */

export interface PyreezConfig {
  providers: {
    github?: { apiKey: string };
    anthropic?: { apiKey: string; baseUrl?: string };
    google?: { apiKey: string };
    openai?: { apiKey: string };
  };
  defaultModel?: string;
}

/**
 * Load config from environment variables.
 * All providers are optional — only configure ones with keys present.
 *
 * PYREEZ_GITHUB_PAT  — GitHub PAT (models:read scope)
 * PYREEZ_ANTHROPIC_KEY — Anthropic API key
 * PYREEZ_GOOGLE_API_KEY — Google AI API key
 * PYREEZ_OPENAI_KEY — OpenAI API key
 * PYREEZ_MODEL — default model (optional, default "openai/gpt-4.1")
 */
export function loadConfigFromEnv(): PyreezConfig {
  const config: PyreezConfig = {
    providers: {},
    defaultModel: Bun.env.PYREEZ_MODEL ?? "openai/gpt-4.1",
  };

  const githubPat = Bun.env.PYREEZ_GITHUB_PAT;
  if (githubPat) {
    config.providers.github = { apiKey: githubPat };
  }

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

  // At least one provider must be configured
  if (Object.keys(config.providers).length === 0) {
    throw new Error(
      "No LLM providers configured. Set at least one of: PYREEZ_GITHUB_PAT, PYREEZ_ANTHROPIC_KEY, PYREEZ_GOOGLE_KEY, PYREEZ_OPENAI_KEY",
    );
  }

  return config;
}
