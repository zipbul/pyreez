/**
 * Unit tests for prompts.ts — Diverge-Synth deliberation prompt builders.
 *
 * SUT: buildWorkerMessages, buildLeaderMessages
 */

import { describe, it, expect } from "bun:test";
import { buildWorkerMessages, buildLeaderMessages, buildDebateWorkerMessages } from "./prompts";
import type {
  SharedContext,
  Round,
  TeamComposition,
  TeamMember,
  WorkerResponse,
  Synthesis,
} from "./types";

// -- Fixtures --

function makeWorker(model: string): TeamMember {
  return { model, role: "worker" };
}

function makeLeader(model: string): TeamMember {
  return { model, role: "leader" };
}

function makeTeam(): TeamComposition {
  return {
    workers: [makeWorker("worker/a"), makeWorker("worker/b")],
    leader: makeLeader("leader/model"),
  };
}

function makeCtx(rounds: readonly Round[] = []): SharedContext {
  return { task: "Write a sorting function", team: makeTeam(), rounds };
}

function makeResponse(model: string, content: string): WorkerResponse {
  return { model, content };
}

function makeSynthesis(
  decision?: "continue" | "approve",
  content = "Synthesis content",
): Synthesis {
  return { model: "leader/model", content, decision };
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
      makeResponse("worker/a", `Response A round ${number}`),
      makeResponse("worker/b", `Response B round ${number}`),
    ],
    synthesis: options?.synthesis,
  };
}

// ================================================================
// buildWorkerMessages
// ================================================================

describe("buildWorkerMessages", () => {
  it("should return system + user for initial round with no history and no instructions", () => {
    // Arrange
    const ctx = makeCtx();

    // Act
    const messages = buildWorkerMessages(ctx);

    // Assert
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toBe("Respond to the following task.");
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toContain("Write a sorting function");
  });

  it("should use host-provided instructions as system message when given", () => {
    // Arrange
    const ctx = makeCtx();

    // Act
    const messages = buildWorkerMessages(ctx, "Use TypeScript strict mode");

    // Assert
    expect(messages[0]!.content).toBe("Use TypeScript strict mode");
  });

  it("should include previous round synthesis in user message when rounds exist", () => {
    // Arrange
    const round = makeRound(1, {
      synthesis: makeSynthesis("continue", "The best approach uses quicksort"),
    });
    const ctx = makeCtx([round]);

    // Act
    const messages = buildWorkerMessages(ctx);

    // Assert
    expect(messages[1]!.content).toContain("The best approach uses quicksort");
    expect(messages[1]!.content).toContain("Previous Round Result");
  });

  it("should omit instructions section when instructions is undefined", () => {
    // Arrange
    const ctx = makeCtx();

    // Act
    const messages = buildWorkerMessages(ctx, undefined);

    // Assert — system should fall back to default, NOT contain "Instructions" header
    expect(messages[0]!.content).toBe("Respond to the following task.");
    expect(messages[1]!.content).not.toContain("Instructions");
  });

  it("should omit instructions section when instructions is empty string", () => {
    // Arrange
    const ctx = makeCtx();

    // Act
    const messages = buildWorkerMessages(ctx, "");

    // Assert — empty string is falsy, so default is used
    expect(messages[0]!.content).toBe("Respond to the following task.");
    expect(messages[1]!.content).not.toContain("Instructions");
  });

  it("should include round budget when roundInfo is provided", () => {
    // Arrange
    const ctx = makeCtx();

    // Act
    const messages = buildWorkerMessages(ctx, undefined, {
      current: 2,
      max: 3,
    });
    const user = messages[1]!.content!;

    // Assert
    expect(user).toContain("Round 2");
    expect(user).toContain("3");
  });

  it("should include FINAL marker when current equals max", () => {
    // Arrange
    const ctx = makeCtx();

    // Act
    const messages = buildWorkerMessages(ctx, undefined, {
      current: 1,
      max: 1,
    });
    const user = messages[1]!.content!;

    // Assert
    expect(user).toMatch(/final/i);
  });

  it("should NOT include FINAL marker when current less than max", () => {
    // Arrange
    const ctx = makeCtx();

    // Act
    const messages = buildWorkerMessages(ctx, undefined, {
      current: 1,
      max: 3,
    });
    const user = messages[1]!.content!;

    // Assert
    expect(user).not.toMatch(/final/i);
  });

  it("should only see the PREVIOUS round synthesis, not full history (O(1) context)", () => {
    // Arrange — 2 rounds with different synthesis content
    const round1 = makeRound(1, {
      synthesis: makeSynthesis("continue", "Round 1 synthesis"),
    });
    const round2 = makeRound(2, {
      synthesis: makeSynthesis("continue", "Round 2 synthesis"),
    });
    const ctx = makeCtx([round1, round2]);

    // Act
    const messages = buildWorkerMessages(ctx);
    const user = messages[1]!.content!;

    // Assert — should see round 2 synthesis (last), NOT round 1
    expect(user).toContain("Round 2 synthesis");
    expect(user).not.toContain("Round 1 synthesis");
  });

  it("should not include synthesis section when previous round has no synthesis", () => {
    // Arrange — round with no synthesis
    const round = makeRound(1);
    const ctx = makeCtx([round]);

    // Act
    const messages = buildWorkerMessages(ctx);
    const user = messages[1]!.content!;

    // Assert
    expect(user).not.toContain("Previous Round Result");
  });

  it("should start user message with task section", () => {
    // Arrange
    const ctx = makeCtx();

    // Act
    const messages = buildWorkerMessages(ctx);

    // Assert
    expect(messages[1]!.content).toMatch(/^## Task\n/);
  });
});

// ================================================================
// buildLeaderMessages
// ================================================================

describe("buildLeaderMessages", () => {
  it("should return system + user for initial round with no worker responses", () => {
    // Arrange
    const ctx = makeCtx();

    // Act
    const messages = buildLeaderMessages(ctx);

    // Assert
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toBe(
      "You are given multiple responses to a task. Compare, evaluate, and produce the best final answer.",
    );
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toContain("Write a sorting function");
  });

  it("should include current round worker responses in user message", () => {
    // Arrange
    const round = makeRound(1, {
      responses: [
        makeResponse("worker/a", "Quicksort approach"),
        makeResponse("worker/b", "Merge sort approach"),
      ],
    });
    const ctx = makeCtx([round]);

    // Act
    const messages = buildLeaderMessages(ctx);
    const user = messages[1]!.content!;

    // Assert
    expect(user).toContain("Quicksort approach");
    expect(user).toContain("Merge sort approach");
    expect(user).toContain("worker/a");
    expect(user).toContain("worker/b");
    expect(user).toContain("Worker Responses");
  });

  it("should use host-provided instructions as system message when given", () => {
    // Arrange
    const ctx = makeCtx([makeRound(1)]);

    // Act
    const messages = buildLeaderMessages(ctx, "Be strict on security");

    // Assert
    expect(messages[0]!.content).toBe("Be strict on security");
  });

  it("should omit instructions section when instructions is undefined", () => {
    // Arrange
    const ctx = makeCtx([makeRound(1)]);

    // Act
    const messages = buildLeaderMessages(ctx, undefined);

    // Assert
    expect(messages[0]!.content).toBe(
      "You are given multiple responses to a task. Compare, evaluate, and produce the best final answer.",
    );
    expect(messages[1]!.content).not.toContain("Instructions");
  });

  it("should omit instructions section when instructions is empty string", () => {
    // Arrange
    const ctx = makeCtx([makeRound(1)]);

    // Act
    const messages = buildLeaderMessages(ctx, "");

    // Assert
    expect(messages[0]!.content).toBe(
      "You are given multiple responses to a task. Compare, evaluate, and produce the best final answer.",
    );
    expect(messages[1]!.content).not.toContain("Instructions");
  });

  it("should include round budget when roundInfo is provided", () => {
    // Arrange
    const ctx = makeCtx([makeRound(1)]);

    // Act
    const messages = buildLeaderMessages(ctx, undefined, {
      current: 2,
      max: 3,
    });
    const user = messages[1]!.content!;

    // Assert
    expect(user).toContain("Round 2");
    expect(user).toContain("3");
  });

  it("should include FINAL marker when current equals max", () => {
    // Arrange
    const ctx = makeCtx([makeRound(1)]);

    // Act
    const messages = buildLeaderMessages(ctx, undefined, {
      current: 3,
      max: 3,
    });
    const user = messages[1]!.content!;

    // Assert
    expect(user).toMatch(/final/i);
  });

  it("should NOT include FINAL marker when current less than max", () => {
    // Arrange
    const ctx = makeCtx([makeRound(1)]);

    // Act
    const messages = buildLeaderMessages(ctx, undefined, {
      current: 1,
      max: 3,
    });
    const user = messages[1]!.content!;

    // Assert
    expect(user).not.toMatch(/final/i);
  });

  it("should include both roundInfo and instructions when both provided", () => {
    // Arrange
    const ctx = makeCtx([makeRound(1)]);

    // Act
    const messages = buildLeaderMessages(ctx, "Be strict", {
      current: 2,
      max: 3,
    });
    const user = messages[1]!.content!;

    // Assert — instructions in system, round budget in user
    expect(messages[0]!.content).toBe("Be strict");
    expect(user).toContain("Round 2");
  });

  it("should show worker responses from the CURRENT (latest) round only", () => {
    // Arrange — 2 rounds, each with different responses
    const round1 = makeRound(1, {
      responses: [makeResponse("worker/a", "Round 1 answer")],
      synthesis: makeSynthesis("continue", "Round 1 synth"),
    });
    const round2 = makeRound(2, {
      responses: [makeResponse("worker/b", "Round 2 answer")],
    });
    const ctx = makeCtx([round1, round2]);

    // Act
    const messages = buildLeaderMessages(ctx);
    const user = messages[1]!.content!;

    // Assert — only round 2 responses visible
    expect(user).toContain("Round 2 answer");
    expect(user).not.toContain("Round 1 answer");
  });

  it("should start user message with task section", () => {
    // Arrange
    const ctx = makeCtx([makeRound(1)]);

    // Act
    const messages = buildLeaderMessages(ctx);

    // Assert
    expect(messages[1]!.content).toMatch(/^## Task\n/);
  });

  it("should inject JSON output format instruction when consensus is leader_decides", () => {
    const ctx: SharedContext = {
      task: "Test task",
      team: {
        workers: [{ model: "w1", role: "worker" }],
        leader: { model: "l1", role: "leader" },
      },
      rounds: [{
        number: 1,
        responses: [{ model: "w1", content: "response 1" }],
      }],
    };
    const messages = buildLeaderMessages(ctx, undefined, undefined, "leader_decides");
    const systemContent = messages.find(m => m.role === "system")!.content;
    expect(systemContent).toContain("JSON");
    expect(systemContent).toContain("decision");
    expect(systemContent).toContain("approve");
  });

  it("should NOT inject JSON format when consensus is undefined", () => {
    const ctx: SharedContext = {
      task: "Test task",
      team: {
        workers: [{ model: "w1", role: "worker" }],
        leader: { model: "l1", role: "leader" },
      },
      rounds: [{
        number: 1,
        responses: [{ model: "w1", content: "response 1" }],
      }],
    };
    const messages = buildLeaderMessages(ctx, undefined, undefined);
    const systemContent = messages.find(m => m.role === "system")!.content;
    expect(systemContent).not.toContain("approve");
  });

  it("should use moderator prompt for intermediate debate rounds", () => {
    const ctx: SharedContext = {
      task: "Test task",
      team: {
        workers: [{ model: "w1", role: "worker" }],
        leader: { model: "l1", role: "leader" },
      },
      rounds: [{
        number: 1,
        responses: [{ model: "w1", content: "response 1" }],
      }],
    };
    // Round 1 of 3 → intermediate round with debate protocol + consensus
    const messages = buildLeaderMessages(ctx, undefined, { current: 1, max: 3 }, "leader_decides", "debate");
    const systemContent = messages.find(m => m.role === "system")!.content;
    expect(systemContent).toContain("moderator");
    expect(systemContent).toContain("AGREEMENT");
    expect(systemContent).toContain("DISAGREEMENT");
    expect(systemContent).toContain("continue");
  });

  it("should use final synthesis prompt on the last round", () => {
    const ctx: SharedContext = {
      task: "Test task",
      team: {
        workers: [{ model: "w1", role: "worker" }],
        leader: { model: "l1", role: "leader" },
      },
      rounds: [{
        number: 1,
        responses: [{ model: "w1", content: "response 1" }],
      }],
    };
    // Round 3 of 3 → final round (even with debate protocol, final uses synthesis prompt)
    const messages = buildLeaderMessages(ctx, undefined, { current: 3, max: 3 }, "leader_decides", "debate");
    const systemContent = messages.find(m => m.role === "system")!.content;
    expect(systemContent).toContain("approve");
    expect(systemContent).not.toContain("moderator");
  });

  it("should skip JSON injection when host instructions already contain json+decision", () => {
    const ctx: SharedContext = {
      task: "Test task",
      team: {
        workers: [{ model: "w1", role: "worker" }],
        leader: { model: "l1", role: "leader" },
      },
      rounds: [{
        number: 1,
        responses: [{ model: "w1", content: "response 1" }],
      }],
    };
    const hostInstructions = 'Output a JSON object with "decision" field: approve or continue.';
    const messages = buildLeaderMessages(ctx, hostInstructions, undefined, "leader_decides");
    const systemContent = messages.find(m => m.role === "system")!.content;
    // Host already specified JSON+decision → should NOT double-inject
    expect(systemContent).toBe(hostInstructions);
  });
});

// ================================================================
// buildDebateWorkerMessages
// ================================================================

describe("buildDebateWorkerMessages", () => {
  it("should include only leader synthesis from previous round (not raw responses)", () => {
    const round1 = makeRound(1, {
      responses: [
        makeResponse("worker/a", "Round 1 answer A"),
        makeResponse("worker/b", "Round 1 answer B"),
      ],
      synthesis: makeSynthesis("continue", "Leader summary of disagreements"),
    });
    const ctx = makeCtx([round1]);

    const messages = buildDebateWorkerMessages(ctx);
    const user = messages[1]!.content!;

    // Should see leader synthesis (compressed context)
    expect(user).toContain("Leader summary of disagreements");
    expect(user).toContain("Previous Round Summary");
    // Should NOT see raw worker responses
    expect(user).not.toContain("Round 1 answer A");
    expect(user).not.toContain("Round 1 answer B");
  });

  it("should only see LAST round synthesis when multiple rounds exist (O(1) context)", () => {
    const r1 = makeRound(1, {
      synthesis: makeSynthesis("continue", "Synth-1: disagreement on X"),
    });
    const r2 = makeRound(2, {
      synthesis: makeSynthesis("continue", "Synth-2: converging on Y"),
    });
    const ctx = makeCtx([r1, r2]);

    const messages = buildDebateWorkerMessages(ctx);
    const user = messages[1]!.content!;

    // Should see ONLY last round synthesis
    expect(user).toContain("Synth-2: converging on Y");
    expect(user).not.toContain("Synth-1: disagreement on X");
  });

  it("should include debate context in system message", () => {
    const ctx = makeCtx([makeRound(1, { synthesis: makeSynthesis() })]);
    const messages = buildDebateWorkerMessages(ctx);
    expect(messages[0]!.content).toContain("debate");
  });

  it("should include final round instruction on last round", () => {
    const ctx = makeCtx([makeRound(1, { synthesis: makeSynthesis() })]);
    const messages = buildDebateWorkerMessages(ctx, undefined, { current: 3, max: 3 });
    const user = messages[1]!.content!;
    expect(user).toMatch(/final/i);
  });

  it("should use host instructions combined with debate context", () => {
    const ctx = makeCtx([makeRound(1, { synthesis: makeSynthesis() })]);
    const messages = buildDebateWorkerMessages(ctx, "Focus on performance");
    expect(messages[0]!.content).toContain("Focus on performance");
    expect(messages[0]!.content).toContain("debate");
  });

  it("should instruct workers to rebut and refine positions", () => {
    const ctx = makeCtx([makeRound(1, { synthesis: makeSynthesis("continue", "Disagreement: A vs B") })]);
    const messages = buildDebateWorkerMessages(ctx);
    const user = messages[1]!.content!;
    expect(user).toMatch(/rebut|refine|concede/i);
  });
});

// ================================================================
// Cross-function tests
// ================================================================

describe("cross-function", () => {
  it("should always return exactly 2 messages (system + user) for both functions", () => {
    // Arrange
    const ctx0 = makeCtx();
    const ctx1 = makeCtx([makeRound(1)]);
    const ctx2 = makeCtx([
      makeRound(1, { synthesis: makeSynthesis("continue") }),
      makeRound(2),
    ]);

    // Act & Assert
    for (const ctx of [ctx0, ctx1, ctx2]) {
      const worker = buildWorkerMessages(ctx);
      const leader = buildLeaderMessages(ctx);

      expect(worker).toHaveLength(2);
      expect(worker[0]!.role).toBe("system");
      expect(worker[1]!.role).toBe("user");

      expect(leader).toHaveLength(2);
      expect(leader[0]!.role).toBe("system");
      expect(leader[1]!.role).toBe("user");
    }
  });

  it("should return identical messages for identical inputs (idempotent)", () => {
    // Arrange
    const ctx = makeCtx([makeRound(1)]);

    // Act
    const w1 = buildWorkerMessages(ctx, "inst");
    const w2 = buildWorkerMessages(ctx, "inst");

    const l1 = buildLeaderMessages(ctx, "inst");
    const l2 = buildLeaderMessages(ctx, "inst");

    // Assert
    expect(w1).toEqual(w2);
    expect(l1).toEqual(l2);
  });

  it("should handle round with no synthesis gracefully in both functions", () => {
    // Arrange — round without synthesis
    const round: Round = {
      number: 1,
      responses: [makeResponse("worker/a", "partial content")],
    };
    const ctx = makeCtx([round]);

    // Act
    const worker = buildWorkerMessages(ctx);
    const leader = buildLeaderMessages(ctx);

    // Assert — no throw, correct length
    expect(worker).toHaveLength(2);
    expect(leader).toHaveLength(2);

    // Worker should NOT see synthesis (there is none)
    expect(worker[1]!.content).not.toContain("Previous Round Result");

    // Leader should see worker responses
    expect(leader[1]!.content).toContain("partial content");
  });

  it("should handle empty responses array in a round", () => {
    // Arrange
    const round: Round = { number: 1, responses: [] };
    const ctx = makeCtx([round]);

    // Act
    const worker = buildWorkerMessages(ctx);
    const leader = buildLeaderMessages(ctx);

    // Assert
    expect(worker).toHaveLength(2);
    expect(leader).toHaveLength(2);
    expect(leader[1]!.content).not.toContain("Worker Responses");
  });
});
