/**
 * Unit tests for prompts.ts — Deliberation prompt builders.
 */

import { describe, it, expect } from "bun:test";
import {
  buildProducerMessages,
  buildReviewerMessages,
  buildLeaderMessages,
} from "./prompts";
import type { SharedContext, Round, TeamComposition } from "./types";

// -- Fixtures --

function makeTeam(): TeamComposition {
  return {
    producer: { model: "producer/model", role: "producer" },
    reviewers: [
      { model: "reviewer/a", role: "reviewer", perspective: "코드 품질" },
      { model: "reviewer/b", role: "reviewer", perspective: "보안" },
    ],
    leader: { model: "leader/model", role: "leader" },
  };
}

function makeCtx(rounds: readonly Round[] = []): SharedContext {
  return { task: "Write a sorting function", team: makeTeam(), rounds };
}

function makeRound(number: number, overrides?: Partial<Round>): Round {
  return {
    number,
    production: {
      model: "producer/model",
      content: `Production content round ${number}`,
      revisionNotes: number > 1 ? "Revised based on feedback" : undefined,
    },
    reviews: [
      {
        model: "reviewer/a",
        perspective: "코드 품질",
        issues: [{ severity: "minor", description: "Use const instead of let" }],
        approval: number > 1,
        reasoning: "Code quality review",
      },
      {
        model: "reviewer/b",
        perspective: "보안",
        issues: [],
        approval: true,
        reasoning: "No security issues found",
      },
    ],
    synthesis: {
      model: "leader/model",
      consensusStatus: number > 1 ? "reached" : "progressing",
      keyAgreements: ["Basic structure is correct"],
      keyDisagreements: number === 1 ? ["Naming conventions"] : [],
      actionItems: number === 1 ? ["Rename variables"] : [],
      decision: number > 1 ? "approve" : "continue",
    },
    ...overrides,
  };
}

// ================================================================
// buildProducerMessages
// ================================================================

describe("buildProducerMessages", () => {
  it("should return system + user messages for initial round (no history, no instructions)", () => {
    const ctx = makeCtx();
    const messages = buildProducerMessages(ctx);

    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toContain("Write a sorting function");
  });

  it("should include instructions in user message when provided", () => {
    const ctx = makeCtx();
    const messages = buildProducerMessages(ctx, "Use TypeScript strict mode");

    expect(messages[1]!.content).toContain("Use TypeScript strict mode");
  });

  it("should include prior round history when ctx has rounds", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildProducerMessages(ctx);

    expect(messages[1]!.content).toContain("Production content round 1");
    expect(messages[1]!.content).toContain("Use const instead of let");
  });

  it("should include synthesis actionItems in history context", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildProducerMessages(ctx);

    expect(messages[1]!.content).toContain("Rename variables");
  });

  it("should omit instructions section when instructions is undefined", () => {
    const ctx = makeCtx();
    const messages = buildProducerMessages(ctx, undefined);
    const userContent = messages[1]!.content!;

    // Should NOT contain an instructions header/section
    expect(userContent).not.toContain("Instructions");
  });

  it("should omit instructions section when instructions is empty string", () => {
    const ctx = makeCtx();
    const messages = buildProducerMessages(ctx, "");
    const userContent = messages[1]!.content!;

    expect(userContent).not.toContain("Instructions");
  });

  it("should produce valid messages when ctx has 0 rounds", () => {
    const ctx = makeCtx([]);
    const messages = buildProducerMessages(ctx);

    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("task");
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toContain(ctx.task);
  });

  it("should serialize multiple rounds of history", () => {
    const ctx = makeCtx([makeRound(1), makeRound(2)]);
    const messages = buildProducerMessages(ctx);
    const userContent = messages[1]!.content!;

    expect(userContent).toContain("Production content round 1");
    expect(userContent).toContain("Production content round 2");
  });

  it("should place system message first and user message second", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildProducerMessages(ctx, "instructions");

    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.role).toBe("user");
  });
});

// ================================================================
// buildReviewerMessages
// ================================================================

describe("buildReviewerMessages", () => {
  it("should return system + user messages with perspective in system", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildReviewerMessages(ctx, "코드 품질");

    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("코드 품질");
  });

  it("should include current production in user message", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildReviewerMessages(ctx, "보안");

    expect(messages[1]!.content).toContain("Production content round 1");
  });

  it("should include prior round history when ctx has rounds", () => {
    const round1 = makeRound(1);
    const round2: Round = {
      number: 2,
      production: {
        model: "producer/model",
        content: "Revised production",
      },
      reviews: [],
    };
    const ctx = makeCtx([round1, round2]);
    const messages = buildReviewerMessages(ctx, "코드 품질");

    // Should see round 1 history
    expect(messages[1]!.content).toContain("Production content round 1");
    // Should see current (round 2) production
    expect(messages[1]!.content).toContain("Revised production");
  });

  it("should include other reviewers' feedback in context (cross-review)", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildReviewerMessages(ctx, "보안");
    const userContent = messages[1]!.content!;

    // Reviewer B (보안) should see Reviewer A's (코드 품질) feedback
    expect(userContent).toContain("코드 품질");
    expect(userContent).toContain("Use const instead of let");
  });

  it("should produce valid messages when ctx has 0 rounds (no production yet)", () => {
    const ctx = makeCtx([]);
    const messages = buildReviewerMessages(ctx, "코드 품질");

    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("코드 품질");
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toContain(ctx.task);
  });

  it("should handle single reviewer perspective", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildReviewerMessages(ctx, "성능");

    expect(messages[0]!.content).toContain("성능");
    expect(messages).toHaveLength(2);
  });

  it("should serialize reviews from multiple prior rounds", () => {
    const ctx = makeCtx([makeRound(1), makeRound(2)]);
    const messages = buildReviewerMessages(ctx, "코드 품질");
    const userContent = messages[1]!.content!;

    // Should see both rounds' production
    expect(userContent).toContain("Production content round 1");
    expect(userContent).toContain("Production content round 2");
  });

  it("should list rounds in chronological order in history", () => {
    const ctx = makeCtx([makeRound(1), makeRound(2)]);
    const messages = buildReviewerMessages(ctx, "코드 품질");
    const userContent = messages[1]!.content!;

    const round1Pos = userContent.indexOf("Production content round 1");
    const round2Pos = userContent.indexOf("Production content round 2");
    expect(round1Pos).toBeLessThan(round2Pos);
  });
});

// ================================================================
// buildLeaderMessages
// ================================================================

describe("buildLeaderMessages", () => {
  it("should return system + user messages for initial round", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx);

    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.role).toBe("user");
  });

  it("should include current round's production + reviews in context", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx);
    const userContent = messages[1]!.content!;

    expect(userContent).toContain("Production content round 1");
    expect(userContent).toContain("Use const instead of let");
    expect(userContent).toContain("No security issues found");
  });

  it("should include instructions when provided", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx, "Be strict on security");

    expect(messages[1]!.content).toContain("Be strict on security");
  });

  it("should include prior round history", () => {
    const ctx = makeCtx([makeRound(1), makeRound(2)]);
    const messages = buildLeaderMessages(ctx);
    const userContent = messages[1]!.content!;

    expect(userContent).toContain("Production content round 1");
    expect(userContent).toContain("Production content round 2");
  });

  it("should omit instructions section when undefined", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx, undefined);

    expect(messages[1]!.content).not.toContain("Instructions");
  });

  it("should omit instructions section when empty string", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx, "");

    expect(messages[1]!.content).not.toContain("Instructions");
  });

  it("should produce valid messages for first round with minimal context", () => {
    const round: Round = {
      number: 1,
      production: { model: "p/m", content: "Hello" },
      reviews: [],
    };
    const ctx = makeCtx([round]);
    const messages = buildLeaderMessages(ctx);

    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("Leader");
    expect(messages[1]!.content).toContain("Hello");
  });

  it("should place system message first and user message second", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx, "instructions");

    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.role).toBe("user");
  });
});

// ================================================================
// Cross-function tests
// ================================================================

describe("cross-function", () => {
  it("should specify JSON output format in all system messages", () => {
    const ctx = makeCtx([makeRound(1)]);

    const producer = buildProducerMessages(ctx);
    const reviewer = buildReviewerMessages(ctx, "코드 품질");
    const leader = buildLeaderMessages(ctx);

    expect(producer[0]!.content).toContain("JSON");
    expect(reviewer[0]!.content).toContain("JSON");
    expect(leader[0]!.content).toContain("JSON");
  });

  it("should return identical messages for identical inputs for all 3 functions", () => {
    const ctx = makeCtx([makeRound(1)]);

    const p1 = buildProducerMessages(ctx, "inst");
    const p2 = buildProducerMessages(ctx, "inst");
    expect(p1).toEqual(p2);

    const r1 = buildReviewerMessages(ctx, "코드 품질");
    const r2 = buildReviewerMessages(ctx, "코드 품질");
    expect(r1).toEqual(r2);

    const l1 = buildLeaderMessages(ctx, "inst");
    const l2 = buildLeaderMessages(ctx, "inst");
    expect(l1).toEqual(l2);
  });

  it("should always return exactly 2 messages (system + user) for each function", () => {
    const ctx0 = makeCtx();
    const ctx1 = makeCtx([makeRound(1)]);
    const ctx2 = makeCtx([makeRound(1), makeRound(2)]);

    for (const ctx of [ctx0, ctx1, ctx2]) {
      const producer = buildProducerMessages(ctx);
      const reviewer = buildReviewerMessages(ctx, "p");
      const leader = buildLeaderMessages(ctx);
      expect(producer).toHaveLength(2);
      expect(producer[0]!.role).toBe("system");
      expect(producer[1]!.role).toBe("user");
      expect(reviewer).toHaveLength(2);
      expect(reviewer[0]!.role).toBe("system");
      expect(reviewer[1]!.role).toBe("user");
      expect(leader).toHaveLength(2);
      expect(leader[0]!.role).toBe("system");
      expect(leader[1]!.role).toBe("user");
    }
  });

  it("should handle round with no synthesis (partial round in context)", () => {
    const partialRound: Round = {
      number: 1,
      production: { model: "p/m", content: "partial content" },
      reviews: [
        {
          model: "r/m",
          perspective: "p",
          issues: [],
          approval: true,
          reasoning: "ok",
        },
      ],
      // no synthesis
    };
    const ctx = makeCtx([partialRound]);

    // All 3 functions should handle it without throwing
    const producer = buildProducerMessages(ctx);
    const reviewer = buildReviewerMessages(ctx, "코드 품질");
    const leader = buildLeaderMessages(ctx);

    expect(producer).toHaveLength(2);
    expect(reviewer).toHaveLength(2);
    expect(leader).toHaveLength(2);

    // partial content should be present in history
    expect(producer[1]!.content).toContain("partial content");
    expect(reviewer[1]!.content).toContain("partial content");
    expect(leader[1]!.content).toContain("partial content");
  });

  // -- ED: production undefined in round --

  it("should skip production section when round has no production", () => {
    // Arrange — round with production omitted (undefined)
    const roundNoProduction: Round = {
      number: 1,
      reviews: [
        {
          model: "reviewer/a",
          perspective: "코드 품질",
          issues: [],
          approval: true,
          reasoning: "ok",
        },
      ],
      synthesis: {
        model: "leader/model",
        consensusStatus: "progressing",
        keyAgreements: [],
        keyDisagreements: [],
        actionItems: [],
        decision: "continue",
      },
    };
    const ctx = makeCtx([roundNoProduction]);

    // Act
    const messages = buildProducerMessages(ctx);

    // Assert — no Production heading in serialized round
    expect(messages[1]!.content).toContain("Round 1");
    expect(messages[1]!.content).not.toContain("**Production**");
  });
});
