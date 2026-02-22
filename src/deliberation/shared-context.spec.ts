/**
 * Unit tests for shared-context.ts — SharedContext factory and query utilities.
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
  Production,
  Review,
  Round,
  Synthesis,
  TeamComposition,
  TeamMember,
} from "./types";

// -- Fixtures --

function makeTeamMember(
  model: string,
  role: "producer" | "reviewer" | "leader",
  perspective?: string,
): TeamMember {
  return { model, role, perspective };
}

function makeTeam(overrides?: Partial<TeamComposition>): TeamComposition {
  return {
    producer: makeTeamMember("openai/gpt-4.1", "producer"),
    reviewers: [
      makeTeamMember("deepseek/deepseek-r1", "reviewer", "코드 품질"),
      makeTeamMember("meta/llama-4-scout", "reviewer", "보안"),
    ],
    leader: makeTeamMember("openai/o4-mini", "leader"),
    ...overrides,
  };
}

function makeProduction(model = "openai/gpt-4.1"): Production {
  return { model, content: "function hello() { return 'world'; }" };
}

function makeReview(
  model = "deepseek/deepseek-r1",
  perspective = "코드 품질",
): Review {
  return {
    model,
    perspective,
    issues: [{ severity: "minor", description: "변수명 불명확" }],
    approval: true,
    reasoning: "전반적으로 양호",
  };
}

function makeSynthesis(
  decision: "continue" | "approve" | "escalate" = "continue",
  model = "openai/o4-mini",
): Synthesis {
  return {
    model,
    consensusStatus: decision === "approve" ? "reached" : "progressing",
    keyAgreements: ["기본 구조 합의"],
    keyDisagreements: [],
    actionItems: decision === "continue" ? ["변수명 개선"] : [],
    decision,
  };
}

function makeRound(
  number: number,
  options?: {
    production?: Production;
    reviews?: Review[];
    synthesis?: Synthesis;
  },
): Round {
  return {
    number,
    production: options?.production ?? makeProduction(),
    reviews: options?.reviews ?? [
      makeReview("deepseek/deepseek-r1", "코드 품질"),
      makeReview("meta/llama-4-scout", "보안"),
    ],
    synthesis: options?.synthesis,
  };
}

// -- createSharedContext --

describe("createSharedContext", () => {
  it("should create empty SharedContext with valid task and team", () => {
    const team = makeTeam();
    const ctx = createSharedContext("TypeScript 렉서 구현", team);

    expect(ctx.task).toBe("TypeScript 렉서 구현");
    expect(ctx.team).toBe(team);
    expect(ctx.rounds).toEqual([]);
  });

  it("should trim whitespace from task", () => {
    const ctx = createSharedContext("  hello world  ", makeTeam());

    expect(ctx.task).toBe("hello world");
  });

  it("should throw when task is empty string", () => {
    expect(() => createSharedContext("", makeTeam())).toThrow(
      "Task description must be a non-empty string",
    );
  });

  it("should throw when task is whitespace only", () => {
    expect(() => createSharedContext("   \t\n  ", makeTeam())).toThrow(
      "Task description must be a non-empty string",
    );
  });

  it("should throw when team has no producer", () => {
    expect(() =>
      createSharedContext("task", {
        producer: undefined as unknown as TeamMember,
        reviewers: [makeTeamMember("m1", "reviewer")],
        leader: makeTeamMember("m2", "leader"),
      }),
    ).toThrow("Team must have a producer");
  });

  it("should throw when team has no reviewers", () => {
    expect(() =>
      createSharedContext("task", {
        producer: makeTeamMember("m1", "producer"),
        reviewers: [],
        leader: makeTeamMember("m2", "leader"),
      }),
    ).toThrow("Team must have at least one reviewer");
  });

  it("should throw when team has no leader", () => {
    expect(() =>
      createSharedContext("task", {
        producer: makeTeamMember("m1", "producer"),
        reviewers: [makeTeamMember("m2", "reviewer")],
        leader: undefined as unknown as TeamMember,
      }),
    ).toThrow("Team must have a leader");
  });
});

// -- addRound --

describe("addRound", () => {
  it("should add first round to empty context", () => {
    const ctx = createSharedContext("task", makeTeam());
    const round = makeRound(1, { synthesis: makeSynthesis("continue") });
    const updated = addRound(ctx, round);

    expect(updated.rounds).toHaveLength(1);
    expect(updated.rounds[0]).toBe(round);
  });

  it("should chain multiple rounds sequentially", () => {
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(ctx, makeRound(1, { synthesis: makeSynthesis("continue") }));
    ctx = addRound(ctx, makeRound(2, { synthesis: makeSynthesis("continue") }));
    ctx = addRound(ctx, makeRound(3, { synthesis: makeSynthesis("approve") }));

    expect(ctx.rounds).toHaveLength(3);
    expect(ctx.rounds[0].number).toBe(1);
    expect(ctx.rounds[1].number).toBe(2);
    expect(ctx.rounds[2].number).toBe(3);
  });

  it("should not mutate the original context (immutability)", () => {
    const original = createSharedContext("task", makeTeam());
    const round = makeRound(1);
    const updated = addRound(original, round);

    expect(original.rounds).toHaveLength(0);
    expect(updated.rounds).toHaveLength(1);
    expect(original).not.toBe(updated);
  });

  it("should throw when round number is not sequential", () => {
    const ctx = createSharedContext("task", makeTeam());
    const round = makeRound(2); // expected 1

    expect(() => addRound(ctx, round)).toThrow(
      "Round number must be 1, got 2",
    );
  });

  it("should throw when round number is 0 on empty context", () => {
    const ctx = createSharedContext("task", makeTeam());
    const round: Round = { number: 0, reviews: [] };

    expect(() => addRound(ctx, round)).toThrow(
      "Round number must be 1, got 0",
    );
  });
});

// -- latestRound --

describe("latestRound", () => {
  it("should return undefined when no rounds exist", () => {
    const ctx = createSharedContext("task", makeTeam());

    expect(latestRound(ctx)).toBeUndefined();
  });

  it("should return the most recent round", () => {
    let ctx = createSharedContext("task", makeTeam());
    const r1 = makeRound(1, { synthesis: makeSynthesis("continue") });
    const r2 = makeRound(2, { synthesis: makeSynthesis("approve") });
    ctx = addRound(ctx, r1);
    ctx = addRound(ctx, r2);

    expect(latestRound(ctx)).toBe(r2);
  });
});

// -- isConsensusReached --

describe("isConsensusReached", () => {
  it("should return false when no rounds exist", () => {
    const ctx = createSharedContext("task", makeTeam());

    expect(isConsensusReached(ctx)).toBe(false);
  });

  it("should return true when latest synthesis decision is 'approve'", () => {
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(
      ctx,
      makeRound(1, { synthesis: makeSynthesis("approve") }),
    );

    expect(isConsensusReached(ctx)).toBe(true);
  });

  it("should return false when decision is 'continue' despite synthesis existing", () => {
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(
      ctx,
      makeRound(1, { synthesis: makeSynthesis("continue") }),
    );

    expect(isConsensusReached(ctx)).toBe(false);
  });

  it("should return false when round has no synthesis", () => {
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(ctx, makeRound(1)); // no synthesis

    expect(isConsensusReached(ctx)).toBe(false);
  });
});

// -- totalLLMCalls --

describe("totalLLMCalls", () => {
  it("should return 0 when no rounds exist", () => {
    const ctx = createSharedContext("task", makeTeam());

    expect(totalLLMCalls(ctx)).toBe(0);
  });

  it("should count all LLM calls across rounds", () => {
    let ctx = createSharedContext("task", makeTeam());
    // Round 1: 1 production + 2 reviews + 1 synthesis = 4
    ctx = addRound(
      ctx,
      makeRound(1, { synthesis: makeSynthesis("continue") }),
    );
    // Round 2: 1 production + 2 reviews + 1 synthesis = 4
    ctx = addRound(
      ctx,
      makeRound(2, { synthesis: makeSynthesis("approve") }),
    );

    expect(totalLLMCalls(ctx)).toBe(8);
  });

  it("should handle round with partial data (no production or synthesis)", () => {
    let ctx = createSharedContext("task", makeTeam());
    // Round with no production, 2 reviews, no synthesis = 2
    ctx = addRound(ctx, {
      number: 1,
      production: undefined,
      reviews: [
        makeReview("deepseek/deepseek-r1"),
        makeReview("meta/llama-4-scout"),
      ],
      synthesis: undefined,
    });

    expect(totalLLMCalls(ctx)).toBe(2);
  });

  it("should correctly count mixed rounds (some partial)", () => {
    let ctx = createSharedContext("task", makeTeam());
    // Round 1: full = 1 + 2 + 1 = 4
    ctx = addRound(
      ctx,
      makeRound(1, { synthesis: makeSynthesis("continue") }),
    );
    // Round 2: no synth = 1 + 2 = 3
    ctx = addRound(ctx, makeRound(2));
    // Round 3: no prod, 1 review, synth = 0 + 1 + 1 = 2
    ctx = addRound(ctx, {
      number: 3,
      production: undefined,
      reviews: [makeReview()],
      synthesis: makeSynthesis("approve"),
    });

    expect(totalLLMCalls(ctx)).toBe(9);
  });
});

// -- modelsUsed --

describe("modelsUsed", () => {
  it("should return empty array when no rounds exist", () => {
    const ctx = createSharedContext("task", makeTeam());

    expect(modelsUsed(ctx)).toEqual([]);
  });

  it("should collect unique models across rounds", () => {
    let ctx = createSharedContext("task", makeTeam());
    ctx = addRound(
      ctx,
      makeRound(1, { synthesis: makeSynthesis("approve") }),
    );

    const models = modelsUsed(ctx);
    expect(models).toContain("openai/gpt-4.1"); // production
    expect(models).toContain("deepseek/deepseek-r1"); // reviewer 1
    expect(models).toContain("meta/llama-4-scout"); // reviewer 2
    expect(models).toContain("openai/o4-mini"); // synthesis
    expect(models).toHaveLength(4);
  });

  it("should deduplicate when same model used in multiple roles", () => {
    let ctx = createSharedContext("task", makeTeam());
    const sameModel = "openai/gpt-4.1";
    ctx = addRound(ctx, {
      number: 1,
      production: makeProduction(sameModel),
      reviews: [makeReview(sameModel)],
      synthesis: makeSynthesis("approve", sameModel),
    });

    expect(modelsUsed(ctx)).toEqual([sameModel]);
  });
});

// -- latestSynthesis --

describe("latestSynthesis", () => {
  it("should return undefined when no rounds exist", () => {
    const ctx = createSharedContext("task", makeTeam());

    expect(latestSynthesis(ctx)).toBeUndefined();
  });

  it("should return synthesis from the latest round", () => {
    let ctx = createSharedContext("task", makeTeam());
    const synth = makeSynthesis("approve");
    ctx = addRound(ctx, makeRound(1, { synthesis: synth }));

    expect(latestSynthesis(ctx)).toBe(synth);
  });
});

// -- State Transition --

describe("SharedContext lifecycle", () => {
  it("should transition from no-consensus to consensus across rounds", () => {
    let ctx = createSharedContext("TypeScript 렉서 구현", makeTeam());

    // Initial state
    expect(isConsensusReached(ctx)).toBe(false);
    expect(latestRound(ctx)).toBeUndefined();
    expect(totalLLMCalls(ctx)).toBe(0);
    expect(modelsUsed(ctx)).toEqual([]);

    // Round 1: continue
    ctx = addRound(
      ctx,
      makeRound(1, { synthesis: makeSynthesis("continue") }),
    );
    expect(isConsensusReached(ctx)).toBe(false);
    expect(latestRound(ctx)?.number).toBe(1);
    expect(totalLLMCalls(ctx)).toBe(4);
    expect(modelsUsed(ctx)).toHaveLength(4);

    // Round 2: approve
    ctx = addRound(
      ctx,
      makeRound(2, { synthesis: makeSynthesis("approve") }),
    );
    expect(isConsensusReached(ctx)).toBe(true);
    expect(latestRound(ctx)?.number).toBe(2);
    expect(totalLLMCalls(ctx)).toBe(8);
    expect(latestSynthesis(ctx)?.decision).toBe("approve");
  });
});
