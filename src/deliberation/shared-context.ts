/**
 * SharedContext factory and round accumulation.
 *
 * All mutations are immutable — return new objects.
 * Workers only, Host handles synthesis.
 */

import type {
  Round,
  SharedContext,
  TeamComposition,
} from "./types";

/**
 * Create a new empty SharedContext.
 *
 * @param task - Task description (non-empty string required).
 * @param team - Team composition (must have ≥1 worker).
 * @throws {Error} If task is empty or team is invalid.
 */
export function createSharedContext(
  task: string,
  team: TeamComposition,
): SharedContext {
  if (!task || task.trim().length === 0) {
    throw new Error("Task description must be a non-empty string");
  }
  if (!team.workers || team.workers.length === 0) {
    throw new Error("Team must have at least one worker");
  }
  return {
    task: task.trim(), team, rounds: [],
  };
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

