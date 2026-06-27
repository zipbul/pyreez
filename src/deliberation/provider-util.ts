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
 * All four providers now grant server-side web search via their official agent SDK / CLI:
 * claude-agent (WebSearch/WebFetch), codex-sdk (webSearchEnabled), gemini-cli (google_web_search,
 * on by default), grok-cli (web_search/web_fetch, on by default). So every provider may receive the
 * verify-with-tools prompt under a --web-access run. Keep this in sync if a provider loses web tools.
 */
export function providerGetsWebTools(modelId: string): boolean {
  const provider = extractProvider(modelId);
  return (
    provider === "anthropic" ||
    provider === "openai" ||
    provider === "google" ||
    provider === "xai"
  );
}
