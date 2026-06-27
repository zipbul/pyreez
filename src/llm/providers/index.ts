/**
 * Single provider registration point.
 * Adding a provider = create its file (with a `capabilities` declaration) and add one line here.
 * Replaces the per-call-site manual provider lists in cli.ts / scripts.
 */

import type { LLMProvider } from "../types";
import { ClaudeAgentProvider } from "./claude-agent";
import { GeminiCliProvider } from "./gemini-cli";
import { CodexSdkProvider } from "./codex-sdk";
import { GrokCliProvider } from "./grok-cli";

/** The `providers` section of the app config (only xAI needs construction config). */
export interface ProviderBuildConfig {
  readonly xai?: { readonly apiKey: string };
}

export function buildProviders(config: ProviderBuildConfig): LLMProvider[] {
  // Subscription-auth providers take no config; xAI needs its API key.
  const providers: LLMProvider[] = [
    new ClaudeAgentProvider(),
    new GeminiCliProvider(),
    new CodexSdkProvider(),
  ];
  if (config.xai) providers.push(new GrokCliProvider(config.xai));
  return providers;
}
