/**
 * Unit tests for prompts.ts — Diverge-Synth deliberation prompt builders.
 *
 * SUT: buildWorkerMessages, buildLeaderMessages, buildDebateWorkerMessages,
 *      assignWorkerRole, extractSummary
 */

import { describe, it, expect } from "bun:test";
import {
  buildWorkerMessages,
  buildLeaderMessages,
  buildDebateWorkerMessages,
  assignWorkerRole,
  extractSummary,
} from "./prompts";
import type {
  SharedContext,
  Round,
  TeamComposition,
  TeamMember,
  WorkerResponse,
  Synthesis,
  DeliberationRole,
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

function makeCtx(rounds: readonly Round[] = [], taskNature?: "artifact" | "critique"): SharedContext {
  return { task: "Write a sorting function", team: makeTeam(), rounds, ...(taskNature ? { taskNature } : {}) };
}

function makeResponse(model: string, content: string, role?: DeliberationRole, workerIndex?: number): WorkerResponse {
  return { model, content, ...(role ? { role } : {}), ...(workerIndex != null ? { workerIndex } : {}) };
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
      makeResponse("worker/a", `Response A round ${number}`, "advocate"),
      makeResponse("worker/b", `Response B round ${number}`, "critic"),
    ],
    synthesis: options?.synthesis,
  };
}

// ================================================================
// assignWorkerRole
// ================================================================

describe("assignWorkerRole", () => {
  it("should assign advocate to index 0", () => {
    expect(assignWorkerRole(0)).toBe("advocate");
  });

  it("should assign critic to index 1", () => {
    expect(assignWorkerRole(1)).toBe("critic");
  });

  it("should assign wildcard to index 2", () => {
    expect(assignWorkerRole(2)).toBe("wildcard");
  });

  it("should wrap around for index 3+", () => {
    expect(assignWorkerRole(3)).toBe("advocate");
    expect(assignWorkerRole(4)).toBe("critic");
    expect(assignWorkerRole(5)).toBe("wildcard");
  });
});

// ================================================================
// buildWorkerMessages
// ================================================================

describe("buildWorkerMessages", () => {
  it("should return system + user for initial round with advocate role (index 0)", () => {
    const ctx = makeCtx();
    const messages = buildWorkerMessages(ctx, undefined, undefined, 0);

    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("advocate analyst");
    expect(messages[0]!.content).toContain("<output-structure>");
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toContain("Write a sorting function");
  });

  it("should use critic role for index 1", () => {
    const ctx = makeCtx();
    const messages = buildWorkerMessages(ctx, undefined, undefined, 1);
    expect(messages[0]!.content).toContain("critic analyst");
  });

  it("should use wildcard role for index 2", () => {
    const ctx = makeCtx();
    const messages = buildWorkerMessages(ctx, undefined, undefined, 2);
    expect(messages[0]!.content).toContain("wildcard analyst");
  });

  it("should include host instructions with role-specific prompt", () => {
    const ctx = makeCtx();
    const messages = buildWorkerMessages(ctx, "Use TypeScript strict mode", undefined, 0);
    expect(messages[0]!.content).toContain("Use TypeScript strict mode");
    expect(messages[0]!.content).toContain("advocate analyst");
  });

  it("should include XML output structure in system message", () => {
    const ctx = makeCtx();
    const messages = buildWorkerMessages(ctx, undefined, undefined, 0);
    expect(messages[0]!.content).toContain("<position>");
    expect(messages[0]!.content).toContain("<evidence>");
    expect(messages[0]!.content).toContain("<concerns>");
    expect(messages[0]!.content).toContain("<certainty>");
  });

  it("should include previous round synthesis in user message when rounds exist", () => {
    const round = makeRound(1, {
      synthesis: makeSynthesis("continue", "The best approach uses quicksort"),
    });
    const ctx = makeCtx([round]);
    const messages = buildWorkerMessages(ctx);
    expect(messages[1]!.content).toContain("The best approach uses quicksort");
    expect(messages[1]!.content).toContain("Previous Round Result");
  });

  it("should default to advocate (index 0) when workerIndex is omitted", () => {
    const ctx = makeCtx();
    const messages = buildWorkerMessages(ctx);
    expect(messages[0]!.content).toContain("advocate analyst");
  });

  it("should include round budget when roundInfo is provided", () => {
    const ctx = makeCtx();
    const messages = buildWorkerMessages(ctx, undefined, { current: 2, max: 3 });
    const user = messages[1]!.content!;
    expect(user).toContain("Round 2");
    expect(user).toContain("3");
  });

  it("should include FINAL marker when current equals max", () => {
    const ctx = makeCtx();
    const messages = buildWorkerMessages(ctx, undefined, { current: 1, max: 1 });
    expect(messages[1]!.content!).toMatch(/final/i);
  });

  it("should NOT include FINAL marker when current less than max", () => {
    const ctx = makeCtx();
    const messages = buildWorkerMessages(ctx, undefined, { current: 1, max: 3 });
    expect(messages[1]!.content!).not.toMatch(/final/i);
  });

  it("should only see the PREVIOUS round synthesis, not full history (O(1) context)", () => {
    const round1 = makeRound(1, { synthesis: makeSynthesis("continue", "Round 1 synthesis") });
    const round2 = makeRound(2, { synthesis: makeSynthesis("continue", "Round 2 synthesis") });
    const ctx = makeCtx([round1, round2]);
    const messages = buildWorkerMessages(ctx);
    const user = messages[1]!.content!;
    expect(user).toContain("Round 2 synthesis");
    expect(user).not.toContain("Round 1 synthesis");
  });

  it("should not include synthesis section when previous round has no synthesis", () => {
    const round = makeRound(1);
    const ctx = makeCtx([round]);
    const messages = buildWorkerMessages(ctx);
    expect(messages[1]!.content).not.toContain("Previous Round Result");
  });

  it("should start user message with task section", () => {
    const ctx = makeCtx();
    const messages = buildWorkerMessages(ctx);
    expect(messages[1]!.content).toMatch(/^## Task\n/);
  });
});

// ================================================================
// buildLeaderMessages
// ================================================================

describe("buildLeaderMessages", () => {
  it("should return system + user with verification-first leader prompt", () => {
    const ctx = makeCtx();
    const messages = buildLeaderMessages(ctx);

    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("verification-first synthesizer");
    expect(messages[0]!.content).toContain("Verify first");
    expect(messages[0]!.content).toContain("Integrate all responses");
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toContain("Write a sorting function");
  });

  it("should include XML output structure tags in system message", () => {
    const ctx = makeCtx();
    const messages = buildLeaderMessages(ctx);
    const system = messages[0]!.content!;
    expect(system).toContain("<verification>");
    expect(system).toContain("<adopted>");
    expect(system).toContain("<novel>");
    expect(system).toContain("<result>");
  });

  it("should label worker responses by role in user message", () => {
    const round = makeRound(1, {
      responses: [
        makeResponse("worker/a", "Quicksort approach", "advocate"),
        makeResponse("worker/b", "Merge sort approach", "critic"),
      ],
    });
    const ctx = makeCtx([round]);
    const messages = buildLeaderMessages(ctx);
    const user = messages[1]!.content!;
    expect(user).toContain('role="advocate"');
    expect(user).toContain('role="critic"');
    expect(user).toContain("Quicksort approach");
    expect(user).toContain("Merge sort approach");
  });

  it("should use host-provided instructions with verification-first suffix", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx, "Be strict on security");
    expect(messages[0]!.content).toContain("Be strict on security");
    expect(messages[0]!.content).toContain("Verify first");
  });

  it("should fall back to default leader prompt when instructions is undefined", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx, undefined);
    expect(messages[0]!.content).toContain("verification-first synthesizer");
  });

  it("should fall back to default leader prompt when instructions is empty string", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx, "");
    expect(messages[0]!.content).toContain("verification-first synthesizer");
  });

  it("should include round budget when roundInfo is provided", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx, undefined, { current: 2, max: 3 });
    const user = messages[1]!.content!;
    expect(user).toContain("Round 2");
    expect(user).toContain("3");
  });

  it("should include FINAL marker when current equals max", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx, undefined, { current: 3, max: 3 });
    expect(messages[1]!.content!).toMatch(/final/i);
  });

  it("should NOT include FINAL marker when current less than max", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx, undefined, { current: 1, max: 3 });
    expect(messages[1]!.content!).not.toMatch(/final/i);
  });

  it("should show worker responses from the CURRENT (latest) round only", () => {
    const round1 = makeRound(1, {
      responses: [makeResponse("worker/a", "Round 1 answer")],
      synthesis: makeSynthesis("continue", "Round 1 synth"),
    });
    const round2 = makeRound(2, {
      responses: [makeResponse("worker/b", "Round 2 answer")],
    });
    const ctx = makeCtx([round1, round2]);
    const messages = buildLeaderMessages(ctx);
    const user = messages[1]!.content!;
    expect(user).toContain("Round 2 answer");
    expect(user).not.toContain("Round 1 answer");
  });

  it("should inject JSON output format instruction when consensus is leader_decides", () => {
    const ctx: SharedContext = {
      task: "Test task",
      team: {
        workers: [{ model: "w1", role: "worker" }],
        leader: { model: "l1", role: "leader" },
      },
      rounds: [{ number: 1, responses: [{ model: "w1", content: "response 1" }] }],
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
      rounds: [{ number: 1, responses: [{ model: "w1", content: "response 1" }] }],
    };
    const messages = buildLeaderMessages(ctx, undefined, undefined);
    const systemContent = messages.find(m => m.role === "system")!.content;
    expect(systemContent).not.toContain("approve");
  });

  it("should use intermediate leader prompt for intermediate debate rounds", () => {
    const ctx: SharedContext = {
      task: "Test task",
      team: {
        workers: [{ model: "w1", role: "worker" }],
        leader: { model: "l1", role: "leader" },
      },
      rounds: [{ number: 1, responses: [{ model: "w1", content: "response 1" }] }],
    };
    const messages = buildLeaderMessages(ctx, undefined, { current: 1, max: 3 }, "leader_decides", "debate");
    const systemContent = messages.find(m => m.role === "system")!.content;
    expect(systemContent).toContain("Intermediate synthesis lead");
    expect(systemContent).toContain("agreement");
    expect(systemContent).toContain("disagreement");
    expect(systemContent).toContain("gaps");
    expect(systemContent).toContain("continue");
  });

  it("should use final synthesis prompt on the last round", () => {
    const ctx: SharedContext = {
      task: "Test task",
      team: {
        workers: [{ model: "w1", role: "worker" }],
        leader: { model: "l1", role: "leader" },
      },
      rounds: [{ number: 1, responses: [{ model: "w1", content: "response 1" }] }],
    };
    const messages = buildLeaderMessages(ctx, undefined, { current: 3, max: 3 }, "leader_decides", "debate");
    const systemContent = messages.find(m => m.role === "system")!.content;
    expect(systemContent).toContain("approve");
    expect(systemContent).toContain("verification-first synthesizer");
    expect(systemContent).not.toContain("Intermediate synthesis lead");
  });

  it("should skip JSON injection when host instructions already contain json+decision", () => {
    const ctx: SharedContext = {
      task: "Test task",
      team: {
        workers: [{ model: "w1", role: "worker" }],
        leader: { model: "l1", role: "leader" },
      },
      rounds: [{ number: 1, responses: [{ model: "w1", content: "response 1" }] }],
    };
    const hostInstructions = 'Output a JSON object with "decision" field: approve or continue.';
    const messages = buildLeaderMessages(ctx, hostInstructions, undefined, "leader_decides");
    const systemContent = messages.find(m => m.role === "system")!.content;
    expect(systemContent).toContain(hostInstructions);
    expect(systemContent).toContain("Verify first");
  });

  it("should use intermediate leader prompt for debate rounds WITHOUT consensus mode", () => {
    const ctx: SharedContext = {
      task: "Test task",
      team: {
        workers: [{ model: "w1", role: "worker" }],
        leader: { model: "l1", role: "leader" },
      },
      rounds: [{ number: 1, responses: [{ model: "w1", content: "response 1" }] }],
    };
    const messages = buildLeaderMessages(ctx, undefined, { current: 1, max: 3 }, undefined, "debate");
    const systemContent = messages.find(m => m.role === "system")!.content;
    expect(systemContent).toContain("Intermediate synthesis lead");
    expect(systemContent).toContain("agreement");
    expect(systemContent).toContain("disagreement");
    expect(systemContent).not.toContain('"decision"');
  });

  it("should place verification before result in output structure", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx);
    const systemContent = messages.find(m => m.role === "system")!.content!;
    const verificationIdx = systemContent.indexOf("<verification>");
    const resultIdx = systemContent.indexOf("<result>");
    expect(verificationIdx).toBeGreaterThan(-1);
    expect(resultIdx).toBeGreaterThan(-1);
    expect(verificationIdx).toBeLessThan(resultIdx);
  });

  it("should start user message with task section", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx);
    expect(messages[1]!.content).toMatch(/^## Task\n/);
  });

  it("should NOT include model names in worker response tags (anti-sycophancy)", () => {
    const round = makeRound(1, {
      responses: [
        makeResponse("worker/a", "Response A", "advocate"),
        makeResponse("worker/b", "Response B", "critic"),
      ],
    });
    const ctx = makeCtx([round]);
    const messages = buildLeaderMessages(ctx);
    const user = messages[1]!.content!;
    expect(user).not.toContain("worker/a");
    expect(user).not.toContain("worker/b");
    expect(user).toContain('role="advocate"');
    expect(user).toContain('role="critic"');
  });
});

// ================================================================
// buildDebateWorkerMessages
// ================================================================

describe("buildDebateWorkerMessages", () => {
  it("should include other workers' full responses (not just leader summary)", () => {
    const round1 = makeRound(1, {
      responses: [
        makeResponse("worker/a", "Round 1 answer A", "advocate", 0),
        makeResponse("worker/b", "Round 1 answer B", "critic", 1),
      ],
      synthesis: makeSynthesis("continue", "Leader summary"),
    });
    const ctx = makeCtx([round1]);

    const messages = buildDebateWorkerMessages(ctx, undefined, undefined, "worker/a", 0);
    const user = messages[1]!.content!;

    // Should see other worker's full response
    expect(user).toContain("Round 1 answer B");
    expect(user).toContain("Other Workers' Responses");
    // Should NOT see own response in "Other Workers" (only in "Your Previous Response")
    expect(user).toContain("Your Previous Response");
    expect(user).toContain("Round 1 answer A");
  });

  it("should label other workers by role, not model name", () => {
    const round1 = makeRound(1, {
      responses: [
        makeResponse("worker/a", "Answer A", "advocate", 0),
        makeResponse("worker/b", "Answer B", "critic", 1),
        makeResponse("worker/c", "Answer C", "wildcard", 2),
      ],
      synthesis: makeSynthesis("continue", "Summary"),
    });
    const ctx = makeCtx([round1]);

    const messages = buildDebateWorkerMessages(ctx, undefined, undefined, "worker/a", 0);
    const user = messages[1]!.content!;

    expect(user).toContain('role="critic"');
    expect(user).toContain('role="wildcard"');
    // Worker/a is the current worker (index 0 = advocate) — should be in "Your Previous Response", not in others
    expect(user).not.toContain('role="advocate"');
  });

  it("should only see LAST round responses (not full history)", () => {
    const r1 = makeRound(1, {
      responses: [makeResponse("worker/a", "R1-answer-A", "advocate")],
      synthesis: makeSynthesis("continue", "Synth-1"),
    });
    const r2 = makeRound(2, {
      responses: [makeResponse("worker/a", "R2-answer-A", "advocate")],
      synthesis: makeSynthesis("continue", "Synth-2"),
    });
    const ctx = makeCtx([r1, r2]);

    const messages = buildDebateWorkerMessages(ctx, undefined, undefined, "worker/b");
    const user = messages[1]!.content!;

    expect(user).toContain("R2-answer-A");
    expect(user).not.toContain("R1-answer-A");
  });

  it("should include debate role in system message", () => {
    const ctx = makeCtx([makeRound(1, { synthesis: makeSynthesis() })]);
    const messages = buildDebateWorkerMessages(ctx, undefined, undefined, undefined, 0);
    expect(messages[0]!.content).toContain("advocate debater");
  });

  it("should NOT contain Self-Doubt (replaced by <concerns>)", () => {
    const ctx = makeCtx([makeRound(1, { synthesis: makeSynthesis() })]);
    const messages = buildDebateWorkerMessages(ctx);
    expect(messages[0]!.content).not.toContain("Self-Doubt");
  });

  it("should include final round instruction on last round", () => {
    const ctx = makeCtx([makeRound(1, { synthesis: makeSynthesis() })]);
    const messages = buildDebateWorkerMessages(ctx, undefined, { current: 3, max: 3 });
    expect(messages[1]!.content!).toMatch(/final/i);
  });

  it("should use host instructions combined with debate context", () => {
    const ctx = makeCtx([makeRound(1, { synthesis: makeSynthesis() })]);
    const messages = buildDebateWorkerMessages(ctx, "Focus on performance");
    expect(messages[0]!.content).toContain("Focus on performance");
    expect(messages[0]!.content).toContain("debater");
  });

  it("should include worker's own previous response when workerIndex is provided", () => {
    const round1 = makeRound(1, {
      responses: [
        makeResponse("worker/a", "My analysis of quicksort", "advocate", 0),
        makeResponse("worker/b", "My analysis of mergesort", "critic", 1),
      ],
      synthesis: makeSynthesis("continue", "Disagreement on sort choice"),
    });
    const ctx = makeCtx([round1]);

    const messages = buildDebateWorkerMessages(ctx, undefined, undefined, "worker/a", 0);
    const user = messages[1]!.content!;
    expect(user).toContain("Your Previous Response");
    expect(user).toContain("My analysis of quicksort");
  });

  it("should NOT include previous response section when workerIndex is not provided", () => {
    const round1 = makeRound(1, {
      responses: [makeResponse("worker/a", "My analysis", "advocate", 0)],
      synthesis: makeSynthesis("continue", "Summary"),
    });
    const ctx = makeCtx([round1]);

    const messages = buildDebateWorkerMessages(ctx);
    expect(messages[1]!.content).not.toContain("Your Previous Response");
  });

  it("should instruct workers to rebut and refine positions", () => {
    const ctx = makeCtx([makeRound(1, { synthesis: makeSynthesis("continue", "Disagreement: A vs B") })]);
    const messages = buildDebateWorkerMessages(ctx);
    const system = messages[0]!.content!;
    expect(system).toMatch(/rebut|refine|concede/i);
  });

  it("should skip output-structure for artifact tasks in debate mode", () => {
    const ctx = makeCtx([makeRound(1, { synthesis: makeSynthesis() })], "artifact");
    const messages = buildDebateWorkerMessages(ctx);
    expect(messages[0]!.content).not.toContain("<output-structure>");
  });

  it("should handle 4+ workers without role collision (index-based filtering)", () => {
    // 4 workers: index 0=advocate, 1=critic, 2=wildcard, 3=advocate (collision)
    const round1 = makeRound(1, {
      responses: [
        makeResponse("worker/a", "Advocate-0 response", "advocate", 0),
        makeResponse("worker/b", "Critic-1 response", "critic", 1),
        makeResponse("worker/c", "Wildcard-2 response", "wildcard", 2),
        makeResponse("worker/d", "Advocate-3 response", "advocate", 3),
      ],
      synthesis: makeSynthesis("continue", "Summary"),
    });
    const ctx = makeCtx([round1]);

    // Worker index 0 (advocate) should see index 3's response (also advocate) in Others
    const msgs0 = buildDebateWorkerMessages(ctx, undefined, undefined, "worker/a", 0);
    const user0 = msgs0[1]!.content!;
    expect(user0).toContain("Advocate-3 response");   // Other advocate visible
    expect(user0).toContain("Critic-1 response");
    expect(user0).toContain("Wildcard-2 response");
    expect(user0).toContain("Your Previous Response");
    expect(user0).toContain("Advocate-0 response");    // Own response in "Your Previous"

    // Worker index 3 (advocate) should see index 0's response (also advocate) in Others
    const msgs3 = buildDebateWorkerMessages(ctx, undefined, undefined, "worker/d", 3);
    const user3 = msgs3[1]!.content!;
    expect(user3).toContain("Advocate-0 response");   // Other advocate visible
    expect(user3).toContain("Your Previous Response");
    expect(user3).toContain("Advocate-3 response");    // Own response
  });
});

// ================================================================
// Cross-function tests
// ================================================================

describe("cross-function", () => {
  it("should always return exactly 2 messages (system + user) for all functions", () => {
    const ctx0 = makeCtx();
    const ctx1 = makeCtx([makeRound(1)]);
    const ctx2 = makeCtx([
      makeRound(1, { synthesis: makeSynthesis("continue") }),
      makeRound(2),
    ]);

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
    const ctx = makeCtx([makeRound(1)]);

    const w1 = buildWorkerMessages(ctx, "inst", undefined, 0);
    const w2 = buildWorkerMessages(ctx, "inst", undefined, 0);
    const l1 = buildLeaderMessages(ctx, "inst");
    const l2 = buildLeaderMessages(ctx, "inst");

    expect(w1).toEqual(w2);
    expect(l1).toEqual(l2);
  });

  it("should handle round with no synthesis gracefully in both functions", () => {
    const round: Round = {
      number: 1,
      responses: [makeResponse("worker/a", "partial content")],
    };
    const ctx = makeCtx([round]);

    const worker = buildWorkerMessages(ctx);
    const leader = buildLeaderMessages(ctx);

    expect(worker).toHaveLength(2);
    expect(leader).toHaveLength(2);
    expect(worker[1]!.content).not.toContain("Previous Round Result");
    expect(leader[1]!.content).toContain("partial content");
  });

  it("should handle empty responses array in a round", () => {
    const round: Round = { number: 1, responses: [] };
    const ctx = makeCtx([round]);

    const worker = buildWorkerMessages(ctx);
    const leader = buildLeaderMessages(ctx);

    expect(worker).toHaveLength(2);
    expect(leader).toHaveLength(2);
    expect(leader[1]!.content).not.toContain("Worker Responses");
  });
});

// ================================================================
// TaskNature-aware prompts
// ================================================================

describe("artifact worker prompts", () => {
  it("should use artifact role prompt when taskNature is artifact", () => {
    const ctx = makeCtx([], "artifact");
    const messages = buildWorkerMessages(ctx, undefined, undefined, 0);
    expect(messages[0]!.content).toContain("advocate implementer");
    expect(messages[0]!.content).not.toContain("advocate analyst");
    expect(messages[0]!.content).toContain("<artifact>");
  });

  it("should include host instructions with artifact role prompt", () => {
    const ctx = makeCtx([], "artifact");
    const messages = buildWorkerMessages(ctx, "Use TypeScript", undefined, 0);
    expect(messages[0]!.content).toContain("Use TypeScript");
    expect(messages[0]!.content).toContain("advocate implementer");
  });

  it("should use critique (default) prompt when taskNature is critique", () => {
    const ctx = makeCtx([], "critique");
    const messages = buildWorkerMessages(ctx, undefined, undefined, 0);
    expect(messages[0]!.content).toContain("advocate analyst");
    expect(messages[0]!.content).toContain("<position>");
  });
});

describe("artifact leader prompts", () => {
  it("should use artifact leader prompt when taskNature is artifact", () => {
    const round = makeRound(1);
    const ctx = makeCtx([round], "artifact");
    const messages = buildLeaderMessages(ctx);
    expect(messages[0]!.content).toContain("synthesis lead");
    expect(messages[0]!.content).toContain("DO NOT write per-worker analysis");
    expect(messages[0]!.content).not.toContain("verification-first synthesizer");
  });

  it("should include worker summary manifest for artifact tasks", () => {
    const round = makeRound(1, {
      responses: [
        makeResponse("worker/a", "<summary>\nAPPROACH: quicksort\nTRADEOFF: memory\nASSUMPTION: fits in RAM\n</summary>\ncode here"),
        makeResponse("worker/b", "No summary tag, just code"),
      ],
    });
    const ctx = makeCtx([round], "artifact");
    const messages = buildLeaderMessages(ctx);
    const user = messages[1]!.content!;
    expect(user).toContain("WORKER SUMMARY MANIFEST");
    expect(user).toContain("APPROACH: quicksort");
  });

  it("should NOT include summary manifest for critique tasks", () => {
    const round = makeRound(1);
    const ctx = makeCtx([round], "critique");
    const messages = buildLeaderMessages(ctx);
    expect(messages[1]!.content).not.toContain("WORKER SUMMARY MANIFEST");
  });
});

// ================================================================
// extractSummary
// ================================================================

describe("extractSummary", () => {
  it("should extract content from summary tags", () => {
    const content = "<summary>\nAPPROACH: quicksort\nTRADEOFF: memory\nASSUMPTION: fits\n</summary>\ncode";
    expect(extractSummary(content)).toBe("APPROACH: quicksort\nTRADEOFF: memory\nASSUMPTION: fits");
  });

  it("should fall back to first 3 lines when no summary tags", () => {
    const content = "line 1\nline 2\nline 3\nline 4\nline 5";
    expect(extractSummary(content)).toBe("line 1\nline 2\nline 3");
  });
});

// ================================================================
// Certainty / Confidence expression
// ================================================================

describe("certainty and confidence expression", () => {
  it("should include <certainty> with structured markers in critique worker prompt", () => {
    const ctx = makeCtx([], "critique");
    const messages = buildWorkerMessages(ctx);
    expect(messages[0]!.content).toContain("<certainty>");
    expect(messages[0]!.content).toContain("<verifiable_claims>");
    expect(messages[0]!.content).toContain("<assumptions>");
    expect(messages[0]!.content).toContain("<uncertainty>");
  });

  it("should include <confidence> justification (no numeric score) in artifact worker prompt", () => {
    const ctx = makeCtx([], "artifact");
    const messages = buildWorkerMessages(ctx);
    expect(messages[0]!.content).toContain("<confidence>");
    // No numeric 0-10 scale
    expect(messages[0]!.content).not.toContain("[0-10]");
    expect(messages[0]!.content).toContain("Justify your approach");
  });

  it("should include CoVe verification instructions in critique leader prompt", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx);
    expect(messages[0]!.content).toContain("<verification>");
    expect(messages[0]!.content).toContain("CONFIRMED");
    expect(messages[0]!.content).toContain("REFUTED");
    expect(messages[0]!.content).toContain("UNVERIFIABLE");
    // No CONFIDENCE weighting
    expect(messages[0]!.content).not.toContain("CONFIDENCE scores");
  });

  it("should not reference CONFIDENCE scores in artifact leader prompt", () => {
    const ctx = makeCtx([makeRound(1)], "artifact");
    const messages = buildLeaderMessages(ctx);
    expect(messages[0]!.content).not.toContain("CONFIDENCE scores");
    expect(messages[0]!.content).toContain("approach justification");
  });

  it("should include cross-check instruction in critique leader", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildLeaderMessages(ctx);
    expect(messages[0]!.content).toContain("Cross-check");
    expect(messages[0]!.content).toContain("consensus ≠ correctness");
  });
});

// ================================================================
// Anti-sycophancy in debate prompts
// ================================================================

describe("anti-sycophancy in debate prompts", () => {
  it("should include anti-sycophancy rules in debate worker prompt", () => {
    const ctx = makeCtx([makeRound(1, { synthesis: makeSynthesis() })]);
    const messages = buildDebateWorkerMessages(ctx);
    const system = messages[0]!.content!;
    expect(system).toContain("Do NOT agree merely to be polite");
    expect(system).toContain("Disagreement backed by evidence");
    expect(system).toContain("maintain it and explain why");
  });
});
