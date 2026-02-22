/**
 * Pyreez configuration.
 * GitHub Models API only.
 */

export interface LLMProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  chatEndpoint?: string;
  headers?: Record<string, string>;
}

export interface PyreezConfig {
  llm: LLMProviderConfig;
}

/**
 * GitHub Models API provider config factory.
 */
export function githubModelsConfig(
  apiKey: string,
  model = "openai/gpt-4.1",
): LLMProviderConfig {
  return {
    baseUrl: "https://models.github.ai",
    apiKey,
    model,
    chatEndpoint: "/inference/chat/completions",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  };
}

/**
 * Load config from environment variables.
 * PYREEZ_GITHUB_PAT: GitHub PAT (required, models:read scope)
 * PYREEZ_MODEL: model name (optional, default "openai/gpt-4.1")
 */
export function loadConfigFromEnv(): PyreezConfig {
  const pat = Bun.env.PYREEZ_GITHUB_PAT;
  const model = Bun.env.PYREEZ_MODEL;

  if (!pat) {
    throw new Error(
      "PYREEZ_GITHUB_PAT is required when using GitHub Models provider",
    );
  }

  return {
    llm: githubModelsConfig(pat, model ?? "openai/gpt-4.1"),
  };
}
