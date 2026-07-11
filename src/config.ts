/**
 * Pyreez configuration.
 * Provider API keys come from environment variables (secrets); there is no on-disk config file.
 */

export interface PyreezConfig {
  providers: {
    xai?: { apiKey: string };
  };
}

/**
 * Build config from environment variables.
 *
 * PYREEZ_XAI_KEY — xAI (Grok) API key. The other providers (anthropic/openai/gemini via their
 * CLIs) use subscription auth and need no key here.
 */
export function loadConfigFromEnv(): PyreezConfig {
  const config: PyreezConfig = { providers: {} };

  const xaiKey = Bun.env.PYREEZ_XAI_KEY;
  if (xaiKey) {
    config.providers.xai = { apiKey: xaiKey };
  }

  return config;
}
