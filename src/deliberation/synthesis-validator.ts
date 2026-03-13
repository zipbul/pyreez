/**
 * Synthesis Structural Validator — quality gate for leader output.
 *
 * Validates that leader synthesis contains required XML tags.
 * Zero-cost: no LLM calls, pure string analysis.
 *
 * @module Synthesis Validator
 */

/**
 * Result of structural validation.
 */
export interface SynthesisValidation {
  readonly valid: boolean;
  readonly missing: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Default required XML tags (used when caller passes undefined).
 */
export const REQUIRED_XML_TAGS = [
  "verification",
  "adopted",
  "novel",
  "result",
] as const;

/**
 * Validate that leader synthesis contains all required structural XML tags.
 *
 * @param content - Leader synthesis output text.
 * @param tags - Tags to validate. Undefined → default REQUIRED_XML_TAGS. Empty array → skip validation.
 * @returns Validation result with missing tags and warnings.
 */
export function validateSynthesisStructure(
  content: string,
  tags?: readonly string[],
): SynthesisValidation {
  const effectiveTags = tags ?? REQUIRED_XML_TAGS;
  if (effectiveTags.length === 0) {
    return { valid: true, missing: [], warnings: [] };
  }

  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required XML tags (both opening and closing must be present)
  for (const tag of effectiveTags) {
    if (!content.includes(`<${tag}>`) || !content.includes(`</${tag}>`)) {
      missing.push(`<${tag}>`);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * Build a retry hint to append to leader system prompt on structural validation failure.
 */
export function buildRetryHint(missing: readonly string[]): string {
  return (
    "\n\n⚠️ STRUCTURAL REQUIREMENT: Your previous response was missing required XML tags: " +
    missing.join(", ") +
    ". You MUST include ALL required tags in your <synthesis> output."
  );
}
