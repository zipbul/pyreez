/**
 * SharedContext factory and query utilities.
 *
 * All mutations are immutable — return new objects.
 * Diverge-Synth model: Workers + Leader (no producer/reviewer distinction).
 */

import type {
  Round,
  SharedContext,
  Synthesis,
  TeamComposition,
} from "./types";
import type { TaskNature } from "./task-nature";

/**
 * Create a new empty SharedContext.
 *
 * @param task - Task description (non-empty string required).
 * @param team - Team composition (must have ≥1 worker + leader).
 * @param taskNature - Optional task nature for prompt selection.
 * @throws {Error} If task is empty or team is invalid.
 */
export function createSharedContext(
  task: string,
  team: TeamComposition,
  taskNature?: TaskNature,
): SharedContext {
  if (!task || task.trim().length === 0) {
    throw new Error("Task description must be a non-empty string");
  }
  if (!team.workers || team.workers.length === 0) {
    throw new Error("Team must have at least one worker");
  }
  if (!team.leader) {
    throw new Error("Team must have a leader");
  }
  return { task: task.trim(), team, rounds: [], ...(taskNature ? { taskNature } : {}) };
}

/**
 * Add a completed round to the SharedContext.
 * Returns a new SharedContext (immutable).
 *
 * @param ctx - Current SharedContext.
 * @param round - Round to add.
 * @throws {Error} If round number is not sequential.
 */
export function addRound(ctx: SharedContext, round: Round): SharedContext {
  const expectedNumber = ctx.rounds.length + 1;
  if (round.number !== expectedNumber) {
    throw new Error(
      `Round number must be ${expectedNumber}, got ${round.number}`,
    );
  }
  return { ...ctx, rounds: [...ctx.rounds, round] };
}

/**
 * Get the latest (most recent) round.
 *
 * @returns The last round, or undefined if no rounds exist.
 */
export function latestRound(ctx: SharedContext): Round | undefined {
  if (ctx.rounds.length === 0) {
    return undefined;
  }
  return ctx.rounds[ctx.rounds.length - 1];
}

/**
 * Check if consensus has been reached.
 * Consensus = latest round has a synthesis with decision "approve".
 */
export function isConsensusReached(ctx: SharedContext): boolean {
  const latest = latestRound(ctx);
  if (!latest?.synthesis) {
    return false;
  }
  return latest.synthesis.decision === "approve";
}

/**
 * Count total LLM calls across all rounds.
 * Each round: N worker responses + 1 synthesis = N + 1 calls.
 */
export function totalLLMCalls(ctx: SharedContext): number {
  let count = 0;
  for (const round of ctx.rounds) {
    count += round.responses.length;
    if (round.synthesis) {
      count += 1;
    }
  }
  return count;
}

/**
 * Get all unique models used across all rounds.
 */
export function modelsUsed(ctx: SharedContext): string[] {
  const models = new Set<string>();
  for (const round of ctx.rounds) {
    for (const response of round.responses) {
      models.add(response.model);
    }
    if (round.synthesis) {
      models.add(round.synthesis.model);
    }
  }
  return [...models];
}

/**
 * Extract the latest synthesis, if any.
 */
export function latestSynthesis(ctx: SharedContext): Synthesis | undefined {
  const latest = latestRound(ctx);
  if (!latest) {
    return undefined;
  }
  return latest.synthesis;
}
