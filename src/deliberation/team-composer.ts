/**
 * Team Composer — builds worker team for deliberation.
 *
 * Fallback: cost-descending (expensive models are generally more capable).
 *
 * @module Team Composer
 */

import type { ModelInfo } from "../model/types";
import type { TeamComposition, TeamMember } from "./types";

// -- Error types --

export class NoModelsAvailableError extends Error {
  readonly code = "NO_MODELS_AVAILABLE";
  readonly remediation: string[];

  constructor(reason: string, remediation?: string[]) {
    super(reason);
    this.name = "NoModelsAvailableError";
    this.remediation = remediation ?? [
      "Pass at least one model id (e.g. --models anthropic/sonnet)",
      "Check that the provider CLI is logged in and its models were discovered",
      "If models were recently failing, they may be on cooldown — retry in a few minutes",
    ];
  }
}

// -- Public types --

interface ComposeTeamOptions {
  readonly task: string;
  readonly modelIds: readonly string[];
}

export interface ComposeTeamDeps {
  getById: (id: string) => ModelInfo | undefined;
}

// -- Scoring --

import { extractProvider } from "./provider-util";
export { extractProvider };

// -- Main function --

export function composeTeam(
  options: ComposeTeamOptions,
  deps: ComposeTeamDeps,
): TeamComposition {
  if (!options.task || options.task.trim().length === 0) {
    throw new Error("Task description must be a non-empty string");
  }

  const resolveModel = (id: string): ModelInfo => {
    const found = deps.getById(id);
    if (!found) {
      throw new Error(`Model "${id}" not found in registry`);
    }
    return found;
  };

  const requestedModels = options.modelIds.map(resolveModel);
  const workers: TeamMember[] = requestedModels.map((m) => ({
    model: m.id,
  }));

  return { workers };
}
