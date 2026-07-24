/**
 * Single provider registration point.
 * Adding a provider = create its file (with a `capabilities` declaration) and add one line here.
 *
 * All four providers authenticate through their own CLI/SDK login (claude-code, codex, gemini,
 * grok) — pyreez passes no API key, so none of them takes construction config.
 */

import type { LLMProvider } from "../types";
import { ClaudeAgentProvider } from "./claude-agent";
import { GeminiCliProvider } from "./gemini-cli";
import { CodexSdkProvider } from "./codex-sdk";
import { GrokCliProvider } from "./grok-cli";

export function buildProviders(): LLMProvider[] {
  return [
    new ClaudeAgentProvider(),
    new GeminiCliProvider(),
    new CodexSdkProvider(),
    new GrokCliProvider(),
  ];
}
