/**
 * Unit tests for engine.ts — Deliberation Engine.
 */

import { describe, it, expect, mock } from "bun:test";
import {
  parseProduction,
  parseReview,
  parseSynthesis,
  executeRound,
  deliberate,
  type EngineDeps,
  type EngineConfig,
} from "./engine";
import type { ChatMessage } from "../llm/types";
import type { TeamComposition, DeliberateInput } from "./types";

// -- Fixtures --

function makeTeam(reviewerCount = 2): TeamComposition {
  const reviewers = Array.from({ length: reviewerCount }, (_, i) => ({
    model: `reviewer/model-${i}`,
    role: "reviewer" as const,
    perspective: `perspective-${i}`,
  }));
  return {
    producer: { model: "producer/model", role: "producer" },
    reviewers,
    leader: { model: "leader/model", role: "leader" },
  };
}

function makeInput(overrides?: Partial<DeliberateInput>): DeliberateInput {
  return {
    task: "Write a function",
    perspectives: ["코드 품질", "보안"],
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<EngineDeps>): EngineDeps {
  return {
    chat: mock(async () => "mock response"),
    buildProducerMessages: mock((_ctx, _instructions?) => [
      { role: "user" as const, content: "produce" },
    ]),
    buildReviewerMessages: mock((_ctx, _perspective) => [
      { role: "user" as const, content: "review" },
    ]),
    buildLeaderMessages: mock((_ctx, _instructions?) => [
      { role: "user" as const, content: "lead" },
    ]),
    ...overrides,
  };
}

/** Create a chat mock that returns different responses per call index. */
function chatSequence(responses: (string | Error)[]): EngineDeps["chat"] {
  let callIndex = 0;
  return mock(async (_model: string, _messages: ChatMessage[]) => {
    const response = responses[callIndex++];
    if (response instanceof Error) throw response;
    return response ?? "";
  });
}

/** Standard JSON production response. */
const PRODUCTION_JSON = JSON.stringify({
  content: "function add(a, b) { return a + b; }",
  revisionNotes: "Initial implementation",
});

/** Standard JSON review response (approve). */
const REVIEW_APPROVE_JSON = JSON.stringify({
  issues: [],
  approval: true,
  reasoning: "Code looks good",
});

/** Standard JSON review response (reject). */
const REVIEW_REJECT_JSON = JSON.stringify({
  issues: [
    { severity: "major", description: "Missing error handling" },
  ],
  approval: false,
  reasoning: "Needs error handling",
});

/** Standard JSON synthesis response (approve). */
const SYNTHESIS_APPROVE_JSON = JSON.stringify({
  consensusStatus: "reached",
  keyAgreements: ["Function is correct"],
  keyDisagreements: [],
  actionItems: [],
  decision: "approve",
});

/** Standard JSON synthesis response (continue). */
const SYNTHESIS_CONTINUE_JSON = JSON.stringify({
  consensusStatus: "progressing",
  keyAgreements: ["Basic structure ok"],
  keyDisagreements: ["Error handling needed"],
  actionItems: ["Add try-catch"],
  decision: "continue",
});

/** Standard JSON synthesis response (escalate). */
const SYNTHESIS_ESCALATE_JSON = JSON.stringify({
  consensusStatus: "stalled",
  keyAgreements: [],
  keyDisagreements: ["Fundamental design disagreement"],
  actionItems: [],
  decision: "escalate",
});

// ================================================================
// parseProduction
// ================================================================

describe("parseProduction", () => {
  it("should parse valid JSON with content field", () => {
    const result = parseProduction(
      "producer/model",
      JSON.stringify({ content: "hello world" }),
    );
    expect(result.model).toBe("producer/model");
    expect(result.content).toBe("hello world");
    expect(result.revisionNotes).toBeUndefined();
  });

  it("should parse JSON with content and revisionNotes", () => {
    const result = parseProduction("producer/model", PRODUCTION_JSON);
    expect(result.model).toBe("producer/model");
    expect(result.content).toBe("function add(a, b) { return a + b; }");
    expect(result.revisionNotes).toBe("Initial implementation");
  });

  it("should fallback to raw text when JSON parse fails", () => {
    const result = parseProduction("producer/model", "Just plain text output");
    expect(result.model).toBe("producer/model");
    expect(result.content).toBe("Just plain text output");
    expect(result.revisionNotes).toBeUndefined();
  });
});

// ================================================================
// parseReview
// ================================================================

describe("parseReview", () => {
  it("should parse valid JSON review with approval true", () => {
    const result = parseReview("reviewer/a", "코드 품질", REVIEW_APPROVE_JSON);
    expect(result.model).toBe("reviewer/a");
    expect(result.perspective).toBe("코드 품질");
    expect(result.approval).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.reasoning).toBe("Code looks good");
  });

  it("should parse valid JSON review with approval false and issues", () => {
    const result = parseReview("reviewer/b", "보안", REVIEW_REJECT_JSON);
    expect(result.model).toBe("reviewer/b");
    expect(result.approval).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.severity).toBe("major");
    expect(result.reasoning).toBe("Needs error handling");
  });

  it("should fallback to default review when JSON parse fails", () => {
    const result = parseReview("reviewer/a", "코드 품질", "Not JSON at all");
    expect(result.model).toBe("reviewer/a");
    expect(result.perspective).toBe("코드 품질");
    expect(result.approval).toBe(false);
    expect(result.issues).toHaveLength(0);
    expect(result.reasoning).toBe("Not JSON at all");
  });
});

// ================================================================
// parseSynthesis
// ================================================================

describe("parseSynthesis", () => {
  it("should parse JSON synthesis with decision approve", () => {
    const result = parseSynthesis("leader/model", SYNTHESIS_APPROVE_JSON);
    expect(result.model).toBe("leader/model");
    expect(result.decision).toBe("approve");
    expect(result.consensusStatus).toBe("reached");
    expect(result.keyAgreements).toEqual(["Function is correct"]);
  });

  it("should parse JSON synthesis with decision continue", () => {
    const result = parseSynthesis("leader/model", SYNTHESIS_CONTINUE_JSON);
    expect(result.decision).toBe("continue");
    expect(result.consensusStatus).toBe("progressing");
    expect(result.actionItems).toEqual(["Add try-catch"]);
  });

  it("should parse JSON synthesis with decision escalate", () => {
    const result = parseSynthesis("leader/model", SYNTHESIS_ESCALATE_JSON);
    expect(result.decision).toBe("escalate");
    expect(result.consensusStatus).toBe("stalled");
  });

  it("should fallback when JSON has no decision field", () => {
    const result = parseSynthesis(
      "leader/model",
      JSON.stringify({ consensusStatus: "progressing" }),
    );
    expect(result.decision).toBe("continue");
    expect(result.consensusStatus).toBe("progressing");
  });
});

// ================================================================
// executeRound
// ================================================================

describe("executeRound", () => {
  it("should execute full round with producer, reviewers, and leader", async () => {
    const team = makeTeam(2);
    const chat = chatSequence([
      PRODUCTION_JSON,     // producer
      REVIEW_APPROVE_JSON, // reviewer 0
      REVIEW_REJECT_JSON,  // reviewer 1
      SYNTHESIS_APPROVE_JSON, // leader
    ]);
    const deps = makeDeps({ chat });
    const input = makeInput();

    const round = await executeRound(
      { task: input.task, team, rounds: [] },
      1,
      deps,
      { maxRounds: 3, consensus: "leader_decides" },
      input,
    );

    expect(round.number).toBe(1);
    expect(round.production).toBeDefined();
    expect(round.production!.content).toBe("function add(a, b) { return a + b; }");
    expect(round.reviews).toHaveLength(2);
    expect(round.reviews[0]!.approval).toBe(true);
    expect(round.reviews[1]!.approval).toBe(false);
    expect(round.synthesis).toBeDefined();
    expect(round.synthesis!.decision).toBe("approve");
  });

  it("should propagate error when producer chat throws", async () => {
    const chat = chatSequence([new Error("producer failed")]);
    const deps = makeDeps({ chat });
    const team = makeTeam(2);
    const input = makeInput();

    await expect(
      executeRound(
        { task: input.task, team, rounds: [] },
        1,
        deps,
        { maxRounds: 3, consensus: "leader_decides" },
        input,
      ),
    ).rejects.toThrow("producer failed");
  });

  it("should handle partial reviewer failure via allSettled", async () => {
    const chat = chatSequence([
      PRODUCTION_JSON,          // producer
      REVIEW_APPROVE_JSON,      // reviewer 0 success
      new Error("reviewer 1 down"), // reviewer 1 fail
      SYNTHESIS_CONTINUE_JSON,  // leader
    ]);
    const deps = makeDeps({ chat });
    const team = makeTeam(2);
    const input = makeInput();

    const round = await executeRound(
      { task: input.task, team, rounds: [] },
      1,
      deps,
      { maxRounds: 3, consensus: "leader_decides" },
      input,
    );

    expect(round.reviews).toHaveLength(2);
    expect(round.reviews[0]!.approval).toBe(true);
    // Failed reviewer gets fallback review
    expect(round.reviews[1]!.approval).toBe(false);
    expect(round.reviews[1]!.reasoning).toContain("error");
  });

  it("should handle all reviewer failures with fallback reviews", async () => {
    const chat = chatSequence([
      PRODUCTION_JSON,
      new Error("rev0 down"),
      new Error("rev1 down"),
      SYNTHESIS_CONTINUE_JSON,
    ]);
    const deps = makeDeps({ chat });
    const team = makeTeam(2);
    const input = makeInput();

    const round = await executeRound(
      { task: input.task, team, rounds: [] },
      1,
      deps,
      { maxRounds: 3, consensus: "leader_decides" },
      input,
    );

    expect(round.reviews).toHaveLength(2);
    expect(round.reviews.every((r) => r.approval === false)).toBe(true);
  });

  it("should propagate error when leader chat throws", async () => {
    const chat = chatSequence([
      PRODUCTION_JSON,
      REVIEW_APPROVE_JSON,
      REVIEW_APPROVE_JSON,
      new Error("leader failed"),
    ]);
    const deps = makeDeps({ chat });
    const team = makeTeam(2);
    const input = makeInput();

    await expect(
      executeRound(
        { task: input.task, team, rounds: [] },
        1,
        deps,
        { maxRounds: 3, consensus: "leader_decides" },
        input,
      ),
    ).rejects.toThrow("leader failed");
  });

  it("should call producer then reviewers then leader in order", async () => {
    const callOrder: string[] = [];
    const chat = mock(async (model: string, _msgs: ChatMessage[]) => {
      callOrder.push(model);
      if (model.startsWith("producer")) return PRODUCTION_JSON;
      if (model.startsWith("reviewer")) return REVIEW_APPROVE_JSON;
      return SYNTHESIS_APPROVE_JSON;
    });
    const deps = makeDeps({ chat });
    const team = makeTeam(2);
    const input = makeInput();

    await executeRound(
      { task: input.task, team, rounds: [] },
      1,
      deps,
      { maxRounds: 3, consensus: "leader_decides" },
      input,
    );

    // Producer first
    expect(callOrder[0]).toBe("producer/model");
    // Reviewers next (could be in any order due to parallel, but before leader)
    expect(callOrder.slice(1, 3).sort()).toEqual([
      "reviewer/model-0",
      "reviewer/model-1",
    ]);
    // Leader last
    expect(callOrder[3]).toBe("leader/model");
  });
});

// ================================================================
// deliberate — consensus modes
// ================================================================

describe("deliberate", () => {
  describe("consensus modes", () => {
    it("should reach consensus in round 1 with leader_decides", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_APPROVE_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps, {
        maxRounds: 3,
        consensus: "leader_decides",
      });

      expect(result.consensusReached).toBe(true);
      expect(result.roundsExecuted).toBe(1);
    });

    it("should reach consensus in round 2 after continue", async () => {
      const chat = chatSequence([
        // Round 1
        PRODUCTION_JSON,
        REVIEW_REJECT_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_CONTINUE_JSON,
        // Round 2
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_APPROVE_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps, {
        maxRounds: 3,
        consensus: "leader_decides",
      });

      expect(result.consensusReached).toBe(true);
      expect(result.roundsExecuted).toBe(2);
    });

    it("should reach consensus with all_approve when all reviewers approve", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_APPROVE_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps, {
        maxRounds: 3,
        consensus: "all_approve",
      });

      expect(result.consensusReached).toBe(true);
      expect(result.roundsExecuted).toBe(1);
    });

    it("should reach consensus with majority when over half approve", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(3);
      const input = makeInput({
        perspectives: ["코드 품질", "보안", "성능"],
      });

      const result = await deliberate(team, input, deps, {
        maxRounds: 3,
        consensus: "majority",
      });

      expect(result.consensusReached).toBe(true);
      expect(result.roundsExecuted).toBe(1);
    });

    it("should not reach consensus with majority when exactly 50% approve", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_CONTINUE_JSON,
        // Round 2 — same result
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_CONTINUE_JSON,
        // Round 3 — same
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_CONTINUE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps, {
        maxRounds: 3,
        consensus: "majority",
      });

      expect(result.consensusReached).toBe(false);
    });

    it("should reach consensus with leader_decides even when reviewers reject", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_REJECT_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps, {
        maxRounds: 3,
        consensus: "leader_decides",
      });

      expect(result.consensusReached).toBe(true);
    });

    it("should not reach all_approve when reviewer rejects", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_APPROVE_JSON,
        // Round 2 — same
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_APPROVE_JSON,
        // Round 3
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps, {
        maxRounds: 3,
        consensus: "all_approve",
      });

      expect(result.consensusReached).toBe(false);
    });
  });

  // ================================================================
  // deliberate — escalate
  // ================================================================

  describe("escalate", () => {
    it("should stop immediately when leader escalates", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_REJECT_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_ESCALATE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps, {
        maxRounds: 3,
        consensus: "leader_decides",
      });

      expect(result.consensusReached).toBe(false);
      expect(result.roundsExecuted).toBe(1);
    });

    it("should stop on escalate even in all_approve mode", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_APPROVE_JSON,
        SYNTHESIS_ESCALATE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps, {
        maxRounds: 3,
        consensus: "all_approve",
      });

      expect(result.consensusReached).toBe(false);
      expect(result.roundsExecuted).toBe(1);
    });

    it("should escalate on first round with maxRounds=1", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_REJECT_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_ESCALATE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps, {
        maxRounds: 1,
        consensus: "leader_decides",
      });

      expect(result.consensusReached).toBe(false);
      expect(result.roundsExecuted).toBe(1);
    });
  });

  // ================================================================
  // deliberate — max rounds
  // ================================================================

  describe("max rounds", () => {
    it("should return consensusReached=false when maxRounds reached", async () => {
      const chat = chatSequence([
        // Round 1
        PRODUCTION_JSON,
        REVIEW_REJECT_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_CONTINUE_JSON,
        // Round 2
        PRODUCTION_JSON,
        REVIEW_REJECT_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_CONTINUE_JSON,
        // Round 3
        PRODUCTION_JSON,
        REVIEW_REJECT_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_CONTINUE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps, {
        maxRounds: 3,
        consensus: "leader_decides",
      });

      expect(result.consensusReached).toBe(false);
      expect(result.roundsExecuted).toBe(3);
    });

    it("should execute 1 round when maxRounds=1 and consensus", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_APPROVE_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps, {
        maxRounds: 1,
        consensus: "leader_decides",
      });

      expect(result.consensusReached).toBe(true);
      expect(result.roundsExecuted).toBe(1);
    });

    it("should execute 0 rounds when maxRounds=0", async () => {
      const deps = makeDeps();
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps, {
        maxRounds: 0,
        consensus: "leader_decides",
      });

      expect(result.consensusReached).toBe(false);
      expect(result.roundsExecuted).toBe(0);
      expect(result.totalLLMCalls).toBe(0);
    });

    it("should use default config when not provided", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_APPROVE_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      // No config = default (maxRounds=3, leader_decides)
      const result = await deliberate(team, input, deps);

      expect(result.consensusReached).toBe(true);
      expect(result.roundsExecuted).toBe(1);
    });
  });

  // ================================================================
  // deliberate — output assembly
  // ================================================================

  describe("output assembly", () => {
    it("should return correct result from last production content", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_APPROVE_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps);

      expect(result.result).toBe("function add(a, b) { return a + b; }");
    });

    it("should compute totalLLMCalls correctly", async () => {
      const chat = chatSequence([
        // Round 1: 1 producer + 2 reviewers + 1 leader = 4
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_APPROVE_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps);

      expect(result.totalLLMCalls).toBe(4);
    });

    it("should collect modelsUsed correctly", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_APPROVE_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps);

      expect(result.modelsUsed).toContain("producer/model");
      expect(result.modelsUsed).toContain("reviewer/model-0");
      expect(result.modelsUsed).toContain("reviewer/model-1");
      expect(result.modelsUsed).toContain("leader/model");
    });

    it("should include finalApprovals from last round", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps);

      expect(result.finalApprovals).toHaveLength(2);
      expect(result.finalApprovals[0]!.approved).toBe(true);
      expect(result.finalApprovals[0]!.remainingIssues).toHaveLength(0);
      expect(result.finalApprovals[1]!.approved).toBe(false);
      expect(result.finalApprovals[1]!.remainingIssues.length).toBeGreaterThan(0);
    });

    it("should include full SharedContext in deliberationLog", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_APPROVE_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps);

      expect(result.deliberationLog.task).toBe("Write a function");
      expect(result.deliberationLog.team).toEqual(team);
      expect(result.deliberationLog.rounds).toHaveLength(1);
    });
  });

  // ================================================================
  // deliberate — instructions
  // ================================================================

  describe("instructions", () => {
    it("should pass producerInstructions to prompt builder", async () => {
      const buildProducerMessages = mock((_ctx: any, instructions?: string) => {
        expect(instructions).toBe("Use TypeScript");
        return [{ role: "user" as const, content: "produce" }];
      });
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_APPROVE_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat, buildProducerMessages });
      const team = makeTeam(2);
      const input = makeInput({ producerInstructions: "Use TypeScript" });

      await deliberate(team, input, deps);

      expect(buildProducerMessages).toHaveBeenCalled();
    });

    it("should pass leaderInstructions to prompt builder", async () => {
      const buildLeaderMessages = mock((_ctx: any, instructions?: string) => {
        expect(instructions).toBe("Be strict");
        return [{ role: "user" as const, content: "lead" }];
      });
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_APPROVE_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat, buildLeaderMessages });
      const team = makeTeam(2);
      const input = makeInput({ leaderInstructions: "Be strict" });

      await deliberate(team, input, deps);

      expect(buildLeaderMessages).toHaveBeenCalled();
    });
  });

  // ================================================================
  // deliberate — edge cases
  // ================================================================

  describe("edge cases", () => {
    it("should work with minimum team of 1 reviewer", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(1);
      const input = makeInput({ perspectives: ["코드 품질"] });

      const result = await deliberate(team, input, deps, {
        maxRounds: 3,
        consensus: "leader_decides",
      });

      expect(result.consensusReached).toBe(true);
      expect(result.totalLLMCalls).toBe(3);
    });

    it("should handle JSON wrapped in markdown code blocks", () => {
      const wrapped = '```json\n{"content": "wrapped code"}\n```';
      const result = parseProduction("producer/model", wrapped);
      expect(result.content).toBe("wrapped code");
    });

    it("should handle empty string chat response gracefully", () => {
      const prod = parseProduction("producer/model", "");
      expect(prod.content).toBe("");

      const rev = parseReview("reviewer/model", "perspective", "");
      expect(rev.approval).toBe(false);
      expect(rev.reasoning).toBe("");

      const synth = parseSynthesis("leader/model", "");
      expect(synth.decision).toBe("continue");
    });

    it("should handle chat response of empty JSON object", () => {
      const prod = parseProduction("producer/model", "{}");
      expect(prod.content).toBe("");

      const rev = parseReview("reviewer/model", "p", "{}");
      expect(rev.approval).toBe(false);

      const synth = parseSynthesis("leader/model", "{}");
      expect(synth.decision).toBe("continue");
    });
  });

  // ================================================================
  // deliberate — idempotency + ordering
  // ================================================================

  describe("idempotency", () => {
    it("should produce identical output for identical mock setup", async () => {
      const makeChat = () =>
        chatSequence([
          PRODUCTION_JSON,
          REVIEW_APPROVE_JSON,
          REVIEW_APPROVE_JSON,
          SYNTHESIS_APPROVE_JSON,
        ]);
      const team = makeTeam(2);
      const input = makeInput();

      const result1 = await deliberate(team, input, makeDeps({ chat: makeChat() }));
      const result2 = await deliberate(team, input, makeDeps({ chat: makeChat() }));

      expect(result1.result).toBe(result2.result);
      expect(result1.roundsExecuted).toBe(result2.roundsExecuted);
      expect(result1.consensusReached).toBe(result2.consensusReached);
      expect(result1.totalLLMCalls).toBe(result2.totalLLMCalls);
    });
  });

  describe("ordering", () => {
    it("should preserve reviewer order matching perspectives order", async () => {
      const chat = chatSequence([
        PRODUCTION_JSON,
        REVIEW_APPROVE_JSON,
        REVIEW_REJECT_JSON,
        SYNTHESIS_APPROVE_JSON,
      ]);
      const deps = makeDeps({ chat });
      const team = makeTeam(2);
      const input = makeInput();

      const result = await deliberate(team, input, deps);

      // Reviewer order should match team composition order
      expect(result.finalApprovals[0]!.model).toBe("reviewer/model-0");
      expect(result.finalApprovals[1]!.model).toBe("reviewer/model-1");
    });
  });
});
