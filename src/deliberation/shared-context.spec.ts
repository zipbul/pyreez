/**
 * Unit tests for shared-context.ts — SharedContext factory and query utilities.
 *
 * SUT: createSharedContext, addRound,
 *      totalLLMCalls, modelsUsed
 *
 * Workers only (no leader/synthesis in test scope).
 */

import { describe, expect, it } from "bun:test";
import {
  addRound,
  createSharedContext,
} from "./shared-context";
import type {
  Round,
  TeamComposition,
  TeamMember,
  WorkerResponse,
} from "./types";

// -- Fixtures --

function makeWorker(model: string): TeamMember {
  return { model};
}

function makeTeam(overrides?: Partial<TeamComposition>): TeamComposition {
  return {
    workers: [makeWorker("openai/gpt-4.1"), makeWorker("deepseek/deepseek-r1")],
    ...overrides,
  };
}

function makeResponse(
  model = "openai/gpt-4.1",
  content = "function hello() { return 'world'; }",
  workerIndex = 0,
): WorkerResponse {
  return { model, content, workerIndex };
}

function makeRound(
  number: number,
  options?: {
    responses?: WorkerResponse[];
  },
): Round {
  return {
    number,
    responses: options?.responses ?? [
      makeResponse("openai/gpt-4.1"),
      makeResponse("deepseek/deepseek-r1"),
    ],
  };
}

// -- createSharedContext --

describe("createSharedContext", () => {
  it("should create empty SharedContext with valid task and team", () => {
    // Arrange
    const team = makeTeam();

    // Act
    const ctx = createSharedContext("Implement a TypeScript lexer", team);

    // Assert
    expect(ctx.task).toBe("Implement a TypeScript lexer");
    expect(ctx.team).toBe(team);
    expect(ctx.rounds).toEqual([]);
  });

  it("should trim whitespace from task", () => {
    // Arrange / Act
    const ctx = createSharedContext("  hello world  ", makeTeam());

    // Assert
    expect(ctx.task).toBe("hello world");
  });

  it("should throw when task is empty string", () => {
    // Arrange / Act / Assert
    expect(() => createSharedContext("", makeTeam())).toThrow(
      "Task description must be a non-empty string",
    );
  });

  it("should throw when task is whitespace only", () => {
    // Arrange / Act / Assert
    expect(() => createSharedContext("   \t\n  ", makeTeam())).toThrow(
      "Task description must be a non-empty string",
    );
  });

  it("should throw when team has no workers", () => {
    // Arrange / Act / Assert
    expect(() =>
      createSharedContext("task", {
        workers: [],
      }),
    ).toThrow("Team must have at least one worker");
  });

  it("should throw when team.workers is undefined", () => {
    // Arrange / Act / Assert
    expect(() =>
      createSharedContext("task", {
        workers: undefined as unknown as readonly TeamMember[],
      }),
    ).toThrow("Team must have at least one worker");
  });
});

// -- addRound --

describe("addRound", () => {
  it("should add first round to empty context", () => {
    // Arrange
    const ctx = createSharedContext("task", makeTeam());
    const round = makeRound(1);

    // Act
    const updated = addRound(ctx, round);

    // Assert
    expect(updated.rounds).toHaveLength(1);
    expect(updated.rounds[0]).toBe(round);
  });

  it("should chain multiple rounds sequentially", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());

    // Act
    ctx = addRound(ctx, makeRound(1));
    ctx = addRound(ctx, makeRound(2));
    ctx = addRound(ctx, makeRound(3));

    // Assert
    expect(ctx.rounds).toHaveLength(3);
    expect(ctx.rounds[0]!.number).toBe(1);
    expect(ctx.rounds[1]!.number).toBe(2);
    expect(ctx.rounds[2]!.number).toBe(3);
  });

  it("should not mutate the original context (immutability)", () => {
    // Arrange
    const original = createSharedContext("task", makeTeam());
    const round = makeRound(1);

    // Act
    const updated = addRound(original, round);

    // Assert
    expect(original.rounds).toHaveLength(0);
    expect(updated.rounds).toHaveLength(1);
    expect(original).not.toBe(updated);
  });

  it("should throw when round number is not sequential", () => {
    // Arrange
    const ctx = createSharedContext("task", makeTeam());
    const round = makeRound(2); // expected 1

    // Act / Assert
    expect(() => addRound(ctx, round)).toThrow(
      "Round number must be 1, got 2",
    );
  });

  it("should throw when round number is 0 on empty context", () => {
    // Arrange
    const ctx = createSharedContext("task", makeTeam());
    const round: Round = { number: 0, responses: [] };

    // Act / Assert
    expect(() => addRound(ctx, round)).toThrow(
      "Round number must be 1, got 0",
    );
  });
});

// -- totalLLMCalls --
// -- modelsUsed --
// -- State Transition (lifecycle) --
