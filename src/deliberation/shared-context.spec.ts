/**
 * Unit tests for shared-context.ts — SharedContext factory and query utilities.
 *
 * SUT: createSharedContext, addRound, latestRound,
 *      totalLLMCalls, modelsUsed
 *
 * Leaderless model: Workers only (no leader/synthesis).
 */

import { describe, expect, it } from "bun:test";
import {
  addRound,
  createSharedContext,
  latestRound,
  modelsUsed,
  totalLLMCalls,
} from "./shared-context";
import type {
  Round,
  TeamComposition,
  TeamMember,
  WorkerResponse,
} from "./types";

// -- Fixtures --

function makeWorker(model: string): TeamMember {
  return { model, role: "worker" };
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
): WorkerResponse {
  return { model, content };
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

// -- latestRound --

describe("latestRound", () => {
  it("should return undefined when no rounds exist", () => {
    // Arrange
    const ctx = createSharedContext("task", makeTeam());

    // Act / Assert
    expect(latestRound(ctx)).toBeUndefined();
  });

  it("should return the most recent round", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    const r1 = makeRound(1);
    const r2 = makeRound(2);
    ctx = addRound(ctx, r1);
    ctx = addRound(ctx, r2);

    // Act / Assert
    expect(latestRound(ctx)).toBe(r2);
  });
});

// -- totalLLMCalls --

describe("totalLLMCalls", () => {
  it("should return 0 when no rounds exist", () => {
    // Arrange
    const ctx = createSharedContext("task", makeTeam());

    // Act / Assert
    expect(totalLLMCalls(ctx)).toBe(0);
  });

  it("should count responses correctly for a single round", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    // 2 worker responses = 2
    ctx = addRound(ctx, makeRound(1));

    // Act / Assert
    expect(totalLLMCalls(ctx)).toBe(2);
  });

  it("should count across multiple rounds", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    // Round 1: 2 responses = 2
    ctx = addRound(ctx, makeRound(1));
    // Round 2: 2 responses = 2
    ctx = addRound(ctx, makeRound(2));

    // Act / Assert
    expect(totalLLMCalls(ctx)).toBe(4);
  });

  it("should count failed workers as LLM calls", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    // 1 successful response + 1 failed worker = 2
    ctx = addRound(ctx, {
      number: 1,
      responses: [makeResponse("openai/gpt-4.1")],
      failedWorkers: [{ model: "deepseek/deepseek-r1", error: "degenerate response" }],
    });

    // Act / Assert
    expect(totalLLMCalls(ctx)).toBe(2);
  });

  it("should handle mixed rounds", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    // Round 1: 2 responses = 2
    ctx = addRound(ctx, makeRound(1));
    // Round 2: 2 responses = 2
    ctx = addRound(ctx, makeRound(2));
    // Round 3: 1 response = 1
    ctx = addRound(ctx, makeRound(3, {
      responses: [makeResponse("openai/gpt-4.1")],
    }));

    // Act / Assert
    expect(totalLLMCalls(ctx)).toBe(5);
  });
});

// -- modelsUsed --

describe("modelsUsed", () => {
  it("should return empty array when no rounds exist", () => {
    // Arrange
    const ctx = createSharedContext("task", makeTeam());

    // Act / Assert
    expect(modelsUsed(ctx)).toEqual([]);
  });

  it("should collect unique models from responses", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(ctx, makeRound(1));

    // Act
    const models = modelsUsed(ctx);

    // Assert
    expect(models).toContain("openai/gpt-4.1"); // worker response
    expect(models).toContain("deepseek/deepseek-r1"); // worker response
    expect(models).toHaveLength(2);
  });

  it("should deduplicate when same model appears multiple times", () => {
    // Arrange
    const sameModel = "openai/gpt-4.1";
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(ctx, makeRound(1, {
      responses: [makeResponse(sameModel), makeResponse(sameModel)],
    }));

    // Act / Assert
    expect(modelsUsed(ctx)).toEqual([sameModel]);
  });

  it("should collect across multiple rounds", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(ctx, makeRound(1, {
      responses: [makeResponse("model/a")],
    }));
    ctx = addRound(ctx, makeRound(2, {
      responses: [makeResponse("model/c")],
    }));

    // Act
    const models = modelsUsed(ctx);

    // Assert
    expect(models).toContain("model/a");
    expect(models).toContain("model/c");
    expect(models).toHaveLength(2);
  });
});

// -- State Transition (lifecycle) --

describe("SharedContext lifecycle", () => {
  it("should track rounds across lifecycle", () => {
    // Arrange
    let ctx = createSharedContext("Implement a TypeScript lexer", makeTeam());

    // Assert — initial state
    expect(latestRound(ctx)).toBeUndefined();
    expect(totalLLMCalls(ctx)).toBe(0);
    expect(modelsUsed(ctx)).toEqual([]);

    // Act — round 1
    ctx = addRound(ctx, makeRound(1));

    // Assert — after round 1
    expect(latestRound(ctx)?.number).toBe(1);
    expect(totalLLMCalls(ctx)).toBe(2); // 2 responses
    expect(modelsUsed(ctx)).toHaveLength(2);

    // Act — round 2
    ctx = addRound(ctx, makeRound(2));

    // Assert — after round 2
    expect(latestRound(ctx)?.number).toBe(2);
    expect(totalLLMCalls(ctx)).toBe(4); // 2*(2 responses)
  });
});
