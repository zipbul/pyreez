/**
 * Unit tests for shared-context.ts — SharedContext factory and query utilities.
 *
 * SUT: createSharedContext, addRound, latestRound, latestSynthesis,
 *      isConsensusReached, totalLLMCalls, modelsUsed
 *
 * Diverge-Synth model: Workers + Leader (no producer/reviewer distinction).
 */

import { describe, expect, it } from "bun:test";
import {
  addRound,
  createSharedContext,
  isConsensusReached,
  latestRound,
  latestSynthesis,
  modelsUsed,
  totalLLMCalls,
} from "./shared-context";
import type {
  Round,
  Synthesis,
  TeamComposition,
  TeamMember,
  WorkerResponse,
} from "./types";

// -- Fixtures --

function makeWorker(model: string): TeamMember {
  return { model, role: "worker" };
}

function makeLeader(model: string): TeamMember {
  return { model, role: "leader" };
}

function makeTeam(overrides?: Partial<TeamComposition>): TeamComposition {
  return {
    workers: [makeWorker("openai/gpt-4.1"), makeWorker("deepseek/deepseek-r1")],
    leader: makeLeader("openai/o4-mini"),
    ...overrides,
  };
}

function makeResponse(
  model = "openai/gpt-4.1",
  content = "function hello() { return 'world'; }",
): WorkerResponse {
  return { model, content };
}

function makeSynthesis(
  decision?: "continue" | "approve",
  model = "openai/o4-mini",
): Synthesis {
  return { model, content: "Synthesized result", decision };
}

function makeRound(
  number: number,
  options?: {
    responses?: WorkerResponse[];
    synthesis?: Synthesis;
  },
): Round {
  return {
    number,
    responses: options?.responses ?? [
      makeResponse("openai/gpt-4.1"),
      makeResponse("deepseek/deepseek-r1"),
    ],
    synthesis: options?.synthesis,
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
        leader: makeLeader("m1"),
      }),
    ).toThrow("Team must have at least one worker");
  });

  it("should throw when team.workers is undefined", () => {
    // Arrange / Act / Assert
    expect(() =>
      createSharedContext("task", {
        workers: undefined as unknown as readonly TeamMember[],
        leader: makeLeader("m1"),
      }),
    ).toThrow("Team must have at least one worker");
  });

  it("should throw when team has no leader", () => {
    // Arrange / Act / Assert
    expect(() =>
      createSharedContext("task", {
        workers: [makeWorker("m1")],
        leader: undefined as unknown as TeamMember,
      }),
    ).toThrow("Team must have a leader");
  });
});

// -- addRound --

describe("addRound", () => {
  it("should add first round to empty context", () => {
    // Arrange
    const ctx = createSharedContext("task", makeTeam());
    const round = makeRound(1, { synthesis: makeSynthesis("continue") });

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
    ctx = addRound(ctx, makeRound(1, { synthesis: makeSynthesis("continue") }));
    ctx = addRound(ctx, makeRound(2, { synthesis: makeSynthesis("continue") }));
    ctx = addRound(ctx, makeRound(3, { synthesis: makeSynthesis("approve") }));

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
    const r1 = makeRound(1, { synthesis: makeSynthesis("continue") });
    const r2 = makeRound(2, { synthesis: makeSynthesis("approve") });
    ctx = addRound(ctx, r1);
    ctx = addRound(ctx, r2);

    // Act / Assert
    expect(latestRound(ctx)).toBe(r2);
  });
});

// -- latestSynthesis --

describe("latestSynthesis", () => {
  it("should return undefined when no rounds exist", () => {
    // Arrange
    const ctx = createSharedContext("task", makeTeam());

    // Act / Assert
    expect(latestSynthesis(ctx)).toBeUndefined();
  });

  it("should return synthesis from the latest round", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    const synth = makeSynthesis("approve");
    ctx = addRound(ctx, makeRound(1, { synthesis: synth }));

    // Act / Assert
    expect(latestSynthesis(ctx)).toBe(synth);
  });
});

// -- isConsensusReached --

describe("isConsensusReached", () => {
  it("should return false when no rounds exist", () => {
    // Arrange
    const ctx = createSharedContext("task", makeTeam());

    // Act / Assert
    expect(isConsensusReached(ctx)).toBe(false);
  });

  it("should return true when latest synthesis decision is 'approve'", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(
      ctx,
      makeRound(1, { synthesis: makeSynthesis("approve") }),
    );

    // Act / Assert
    expect(isConsensusReached(ctx)).toBe(true);
  });

  it("should return false when decision is 'continue'", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(
      ctx,
      makeRound(1, { synthesis: makeSynthesis("continue") }),
    );

    // Act / Assert
    expect(isConsensusReached(ctx)).toBe(false);
  });

  it("should return false when round has no synthesis", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(ctx, makeRound(1)); // no synthesis

    // Act / Assert
    expect(isConsensusReached(ctx)).toBe(false);
  });

  it("should return false when synthesis has no decision field", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(
      ctx,
      makeRound(1, { synthesis: makeSynthesis(undefined) }),
    );

    // Act / Assert
    expect(isConsensusReached(ctx)).toBe(false);
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

  it("should count responses + synthesis correctly for a single round", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    // 2 worker responses + 1 synthesis = 3
    ctx = addRound(
      ctx,
      makeRound(1, { synthesis: makeSynthesis("continue") }),
    );

    // Act / Assert
    expect(totalLLMCalls(ctx)).toBe(3);
  });

  it("should count across multiple rounds", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    // Round 1: 2 responses + 1 synthesis = 3
    ctx = addRound(
      ctx,
      makeRound(1, { synthesis: makeSynthesis("continue") }),
    );
    // Round 2: 2 responses + 1 synthesis = 3
    ctx = addRound(
      ctx,
      makeRound(2, { synthesis: makeSynthesis("approve") }),
    );

    // Act / Assert
    expect(totalLLMCalls(ctx)).toBe(6);
  });

  it("should not count synthesis when absent", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    // 2 responses, no synthesis = 2
    ctx = addRound(ctx, makeRound(1));

    // Act / Assert
    expect(totalLLMCalls(ctx)).toBe(2);
  });

  it("should count failed workers as LLM calls", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    // 1 successful response + 1 failed worker + 1 synthesis = 3
    ctx = addRound(ctx, {
      number: 1,
      responses: [makeResponse("openai/gpt-4.1")],
      synthesis: makeSynthesis("continue"),
      failedWorkers: [{ model: "deepseek/deepseek-r1", error: "degenerate response" }],
    });

    // Act / Assert
    expect(totalLLMCalls(ctx)).toBe(3);
  });

  it("should handle mixed rounds (some with synthesis, some without)", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    // Round 1: 2 responses + 1 synthesis = 3
    ctx = addRound(
      ctx,
      makeRound(1, { synthesis: makeSynthesis("continue") }),
    );
    // Round 2: 2 responses, no synthesis = 2
    ctx = addRound(ctx, makeRound(2));
    // Round 3: 1 response + 1 synthesis = 2
    ctx = addRound(ctx, makeRound(3, {
      responses: [makeResponse("openai/gpt-4.1")],
      synthesis: makeSynthesis("approve"),
    }));

    // Act / Assert
    expect(totalLLMCalls(ctx)).toBe(7);
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

  it("should collect unique models from responses and synthesis", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(
      ctx,
      makeRound(1, { synthesis: makeSynthesis("approve") }),
    );

    // Act
    const models = modelsUsed(ctx);

    // Assert
    expect(models).toContain("openai/gpt-4.1"); // worker response
    expect(models).toContain("deepseek/deepseek-r1"); // worker response
    expect(models).toContain("openai/o4-mini"); // synthesis
    expect(models).toHaveLength(3);
  });

  it("should deduplicate when same model appears in multiple roles", () => {
    // Arrange
    const sameModel = "openai/gpt-4.1";
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(ctx, makeRound(1, {
      responses: [makeResponse(sameModel), makeResponse(sameModel)],
      synthesis: makeSynthesis("approve", sameModel),
    }));

    // Act / Assert
    expect(modelsUsed(ctx)).toEqual([sameModel]);
  });

  it("should collect across multiple rounds", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(ctx, makeRound(1, {
      responses: [makeResponse("model/a")],
      synthesis: makeSynthesis("continue", "model/b"),
    }));
    ctx = addRound(ctx, makeRound(2, {
      responses: [makeResponse("model/c")],
      synthesis: makeSynthesis("approve", "model/d"),
    }));

    // Act
    const models = modelsUsed(ctx);

    // Assert
    expect(models).toContain("model/a");
    expect(models).toContain("model/b");
    expect(models).toContain("model/c");
    expect(models).toContain("model/d");
    expect(models).toHaveLength(4);
  });

  it("should not include undefined when round has no synthesis", () => {
    // Arrange
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(ctx, makeRound(1)); // no synthesis

    // Act
    const models = modelsUsed(ctx);

    // Assert
    expect(models).toHaveLength(2);
    expect(models).toContain("openai/gpt-4.1");
    expect(models).toContain("deepseek/deepseek-r1");
    expect(models).not.toContain(undefined as any);
  });
});

// -- State Transition (lifecycle) --

describe("SharedContext lifecycle", () => {
  it("should transition from no-consensus to consensus across rounds", () => {
    // Arrange
    let ctx = createSharedContext("Implement a TypeScript lexer", makeTeam());

    // Assert — initial state
    expect(isConsensusReached(ctx)).toBe(false);
    expect(latestRound(ctx)).toBeUndefined();
    expect(totalLLMCalls(ctx)).toBe(0);
    expect(modelsUsed(ctx)).toEqual([]);

    // Act — round 1: continue
    ctx = addRound(
      ctx,
      makeRound(1, { synthesis: makeSynthesis("continue") }),
    );

    // Assert — after round 1
    expect(isConsensusReached(ctx)).toBe(false);
    expect(latestRound(ctx)?.number).toBe(1);
    expect(totalLLMCalls(ctx)).toBe(3); // 2 responses + 1 synthesis
    expect(modelsUsed(ctx)).toHaveLength(3);

    // Act — round 2: approve
    ctx = addRound(
      ctx,
      makeRound(2, { synthesis: makeSynthesis("approve") }),
    );

    // Assert — after round 2
    expect(isConsensusReached(ctx)).toBe(true);
    expect(latestRound(ctx)?.number).toBe(2);
    expect(totalLLMCalls(ctx)).toBe(6); // 2*(2 responses + 1 synthesis)
    expect(latestSynthesis(ctx)?.decision).toBe("approve");
  });
});
