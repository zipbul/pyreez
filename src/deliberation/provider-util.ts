/**
 * Shared provider utility — extracts provider prefix from model IDs.
 *
 * "anthropic/claude-opus-4.6" → "anthropic"
 * "gpt-5" → "gpt-5" (no slash)
 *
 * @module Provider Util
 */

/**
 * Extract provider prefix from a model ID.
 */
export function extractProvider(modelId: string): string {
  const idx = modelId.indexOf("/");
  return idx === -1 ? modelId : modelId.slice(0, idx);
}

/**
 * Whether a model's provider actually grants web search/fetch tools under webAccess.
 *
 * Mirrors tool-granting in src/llm/providers/claude-cli.ts (only the claude/anthropic provider
 * pushes WebSearch/WebFetch). codex (openai) and xai grant no web tools — so they must NOT receive
 * the verify-with-tools prompt during a --web-access run: it would instruct them to fetch/cite from
 * tools they lack, producing citation theater (fabricated "I fetched it / per the docs, lines N-M").
 * Keep this in sync if another provider gains web tools.
 */
export function providerGetsWebTools(modelId: string): boolean {
  return extractProvider(modelId) === "anthropic";
}
