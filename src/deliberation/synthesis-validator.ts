/**
 * Synthesis Structural Validator — Stage 1 quality gate.
 *
 * Validates that leader synthesis contains all required sections.
 * Zero-cost: no LLM calls, pure string analysis.
 *
 * @module Synthesis Validator
 */

import type { TaskNature } from "./task-nature";

/**
 * Result of structural validation.
 */
export interface SynthesisValidation {
  readonly valid: boolean;
  readonly missing: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Required top-level sections in leader synthesis output.
 */
const REQUIRED_SECTIONS = [
  "## Premise Check",
  "## Per-Worker Analysis",
  "## Ideas from Weaknesses",
  "## Synthesis",
] as const;

/**
 * Required sub-sections per worker within "## Per-Worker Analysis".
 */
const PER_WORKER_SUBSECTIONS = [
  "Adopted Strengths",
  "Weakness Reexamination",
] as const;

/** Max "Ideas from Weaknesses" items before padding warning. */
const MAX_IDEAS_BEFORE_WARNING = 2;

/**
 * Count numbered/bulleted items in the "Ideas from Weaknesses" section.
 * Looks for lines starting with digits, dashes, or asterisks.
 */
function countIdeasFromWeaknesses(content: string): number {
  const sectionMatch = content.match(
    /## Ideas from Weaknesses[\s\S]*?(?=## |$)/i,
  );
  if (!sectionMatch) return 0;
  const section = sectionMatch[0];
  // Count lines that start with a numbered item or bullet
  const items = section
    .split("\n")
    .filter((line) => /^\s*(?:\d+[.)]\s|[-*]\s)/.test(line));
  return items.length;
}

/**
 * Validate that leader synthesis contains all required structural sections.
 *
 * @param content - Leader synthesis output text.
 * @param workerCount - Number of workers whose analysis should appear.
 * @param taskNature - Optional task nature. Artifact tasks skip structural validation.
 * @returns Validation result with missing sections and warnings.
 */
export function validateSynthesisStructure(
  content: string,
  workerCount: number,
  taskNature?: TaskNature,
): SynthesisValidation {
  // Artifact tasks: the deliverable IS the output — no structural sections required
  if (taskNature === "artifact") {
    return { valid: true, missing: [], warnings: [] };
  }

  const missing: string[] = [];
  const warnings: string[] = [];

  // Check top-level required sections
  for (const section of REQUIRED_SECTIONS) {
    if (!content.includes(section)) {
      missing.push(section);
    }
  }

  // Check per-worker sub-sections within Per-Worker Analysis
  if (content.includes("## Per-Worker Analysis")) {
    // Extract section between "## Per-Worker Analysis" and next "## " header
    const sectionStart = content.indexOf("## Per-Worker Analysis");
    const afterHeader = sectionStart + "## Per-Worker Analysis".length;
    // Find next top-level section (## but not ###)
    let nextSection = -1;
    let searchFrom = afterHeader;
    while (searchFrom < content.length) {
      const idx = content.indexOf("\n## ", searchFrom);
      if (idx === -1) break;
      nextSection = idx;
      break;
    }
    const perWorkerSection = nextSection === -1
      ? content.slice(sectionStart)
      : content.slice(sectionStart, nextSection);

    for (const subsection of PER_WORKER_SUBSECTIONS) {
      // Count occurrences of this subsection keyword
      const regex = new RegExp(subsection, "gi");
      const matches = perWorkerSection.match(regex);
      const count = matches?.length ?? 0;

      if (count < workerCount) {
        missing.push(
          `${subsection} (found ${count}/${workerCount} workers)`,
        );
      }
    }
  }

  // Padding detection: too many "Ideas from Weaknesses"
  const ideaCount = countIdeasFromWeaknesses(content);
  if (ideaCount > MAX_IDEAS_BEFORE_WARNING) {
    warnings.push(
      `Ideas from Weaknesses has ${ideaCount} items (max recommended: ${MAX_IDEAS_BEFORE_WARNING}). Possible padding.`,
    );
  }

  // Empty Ideas from Weaknesses without "None" — section exists but has no content
  if (content.includes("## Ideas from Weaknesses") && ideaCount === 0) {
    const sectionMatch = content.match(
      /## Ideas from Weaknesses[\s\S]*?(?=## |$)/i,
    );
    if (sectionMatch && !/\bnone\b/i.test(sectionMatch[0])) {
      warnings.push(
        "Ideas from Weaknesses section is empty without stating \"None.\" — possible omission.",
      );
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
    "\n\n⚠️ STRUCTURAL REQUIREMENT: Your previous response was missing required sections: " +
    missing.join(", ") +
    ". You MUST include ALL required sections in your response."
  );
}
