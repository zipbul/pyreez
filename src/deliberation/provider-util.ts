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
