/**
 * Unit tests for prompts.ts — Leaderless deliberation prompt builders.
 *
 * SUT: buildWorkerMessages, buildDebateWorkerMessages,
 *      assignWorkerRole, extractSummary
 */

import { describe, it, expect } from "bun:test";
import {
  buildWorkerMessages,
  buildDebateWorkerMessages,
  assignWorkerRole,
  extractSummary,
  extractDebateDigest,
} from "./prompts";
import type {
  SharedContext,
  Round,
  TeamComposition,
  TeamMember,
  WorkerResponse,
  DeliberationRole,
} from "./types";

// -- Fixtures --

function makeWorker(model: string): TeamMember {
  return { model, role: "worker" };
}

function makeTeam(): TeamComposition {
  return {
    workers: [makeWorker("worker/a"), makeWorker("worker/b")],
  };
}

function makeCtx(rounds: readonly Round[] = [], taskNature?: "artifact" | "critique"): SharedContext {
  return { task: "Write a sorting function", team: makeTeam(), rounds, ...(taskNature ? { taskNature } : {}) };
}

function makeResponse(model: string, content: string, role?: DeliberationRole, workerIndex?: number): WorkerResponse {
  return { model, content, ...(role ? { role } : {}), ...(workerIndex != null ? { workerIndex } : {}) };
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
      makeResponse("worker/a", `Response A round ${number}`, "advocate"),
      makeResponse("worker/b", `Response B round ${number}`, "critic"),
    ],
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

  it("should start user message with task section", () => {
    const ctx = makeCtx();
    const messages = buildWorkerMessages(ctx);
    expect(messages[1]!.content).toMatch(/^## Task\n/);
  });
});

// ================================================================
// buildDebateWorkerMessages
// ================================================================

describe("buildDebateWorkerMessages", () => {
  it("should include other workers' full responses (not just summary)", () => {
    const round1 = makeRound(1, {
      responses: [
        makeResponse("worker/a", "Round 1 answer A", "advocate", 0),
        makeResponse("worker/b", "Round 1 answer B", "critic", 1),
      ],
    });
    const ctx = makeCtx([round1]);

    const messages = buildDebateWorkerMessages(ctx, undefined, undefined, "worker/a", 0);
    const user = messages[1]!.content!;

    // Should see other worker's digest
    expect(user).toContain("Other Workers' Positions");
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
    });
    const r2 = makeRound(2, {
      responses: [makeResponse("worker/a", "R2-answer-A", "advocate")],
    });
    const ctx = makeCtx([r1, r2]);

    const messages = buildDebateWorkerMessages(ctx, undefined, undefined, "worker/b");
    const user = messages[1]!.content!;

    expect(user).toContain("R2-answer-A");
    expect(user).not.toContain("R1-answer-A");
  });

  it("should include debate role in system message", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildDebateWorkerMessages(ctx, undefined, undefined, undefined, 0);
    expect(messages[0]!.content).toContain("advocate debater");
  });

  it("should NOT contain Self-Doubt (replaced by <concerns>)", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildDebateWorkerMessages(ctx);
    expect(messages[0]!.content).not.toContain("Self-Doubt");
  });

  it("should include final round instruction on last round", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildDebateWorkerMessages(ctx, undefined, { current: 3, max: 3 });
    expect(messages[1]!.content!).toMatch(/final/i);
  });

  it("should use host instructions combined with debate context", () => {
    const ctx = makeCtx([makeRound(1)]);
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
    });
    const ctx = makeCtx([round1]);

    const messages = buildDebateWorkerMessages(ctx);
    expect(messages[1]!.content).not.toContain("Your Previous Response");
  });

  it("should instruct workers to rebut and refine positions", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildDebateWorkerMessages(ctx);
    const system = messages[0]!.content!;
    expect(system).toMatch(/rebut|refine|concede/i);
  });

  it("should skip output-structure for artifact tasks in debate mode", () => {
    const ctx = makeCtx([makeRound(1)], "artifact");
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
  it("should always return exactly 2 messages (system + user) for buildWorkerMessages", () => {
    const ctx0 = makeCtx();
    const ctx1 = makeCtx([makeRound(1)]);
    const ctx2 = makeCtx([makeRound(1), makeRound(2)]);

    for (const ctx of [ctx0, ctx1, ctx2]) {
      const worker = buildWorkerMessages(ctx);

      expect(worker).toHaveLength(2);
      expect(worker[0]!.role).toBe("system");
      expect(worker[1]!.role).toBe("user");
    }
  });

  it("should return identical messages for identical inputs (idempotent)", () => {
    const ctx = makeCtx([makeRound(1)]);

    const w1 = buildWorkerMessages(ctx, "inst", undefined, 0);
    const w2 = buildWorkerMessages(ctx, "inst", undefined, 0);

    expect(w1).toEqual(w2);
  });

  it("should handle empty responses array in a round", () => {
    const round: Round = { number: 1, responses: [] };
    const ctx = makeCtx([round]);

    const worker = buildWorkerMessages(ctx);

    expect(worker).toHaveLength(2);
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
// extractDebateDigest
// ================================================================

describe("extractDebateDigest", () => {
  it("should extract position and evidence tags", () => {
    const content = `<response>
  <position>Quicksort is optimal for this case</position>
  <evidence>O(n log n) average, in-place</evidence>
  <concerns>Worst case O(n²)</concerns>
</response>`;
    const digest = extractDebateDigest(content);
    expect(digest).toContain("<position>Quicksort is optimal for this case</position>");
    expect(digest).toContain("<evidence>O(n log n) average, in-place</evidence>");
    expect(digest).not.toContain("<concerns>");
  });

  it("should extract position only when evidence is absent", () => {
    const content = "<position>Use Redis</position>\nSome other text";
    const digest = extractDebateDigest(content);
    expect(digest).toBe("<position>Use Redis</position>");
  });

  it("should extract evidence only when position is absent", () => {
    const content = "Analysis:\n<evidence>Benchmark shows 3x speedup</evidence>\nConclusion";
    const digest = extractDebateDigest(content);
    expect(digest).toBe("<evidence>Benchmark shows 3x speedup</evidence>");
  });

  it("should fall back to first 3 lines when neither tag found", () => {
    const content = "line 1\nline 2\nline 3\nline 4\nline 5";
    expect(extractDebateDigest(content)).toBe("line 1\nline 2\nline 3");
  });

  it("should trim whitespace in extracted tags", () => {
    const content = "<position>  spaced  </position>\n<evidence>\n  indented\n</evidence>";
    const digest = extractDebateDigest(content);
    expect(digest).toContain("<position>spaced</position>");
    expect(digest).toContain("<evidence>indented</evidence>");
  });
});

describe("buildDebateWorkerMessages uses digest sharing", () => {
  it("should share digest instead of full content in debate round 2+", () => {
    const round1Responses = [
      {
        model: "a/m1", content: "<response>\n<position>Use A</position>\n<evidence>Fast</evidence>\n<concerns>Cost</concerns>\n</response>",
        role: "advocate" as const, workerIndex: 0,
      },
      {
        model: "b/m2", content: "<response>\n<position>Use B</position>\n<evidence>Cheap</evidence>\n<concerns>Slow</concerns>\n</response>",
        role: "critic" as const, workerIndex: 1,
      },
    ];
    const ctx: SharedContext = {
      task: "Pick the best DB",
      team: { workers: [makeWorker("a/m1"), makeWorker("b/m2")] },
      rounds: [{ number: 1, responses: round1Responses }],
    };
    const messages = buildDebateWorkerMessages(ctx, undefined, { current: 2, max: 3 }, "a/m1", 0);
    const userContent = messages[1]!.content!;
    // Should contain digest (position + evidence) not full content
    expect(userContent).toContain("<position>Use B</position>");
    expect(userContent).toContain("<evidence>Cheap</evidence>");
    // Should NOT contain concerns (not part of digest)
    expect(userContent).not.toContain("<concerns>Slow</concerns>");
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
});

// ================================================================
// Anti-sycophancy in debate prompts
// ================================================================

describe("anti-sycophancy in debate prompts", () => {
  it("should include anti-sycophancy rules in debate worker prompt", () => {
    const ctx = makeCtx([makeRound(1)]);
    const messages = buildDebateWorkerMessages(ctx);
    const system = messages[0]!.content!;
    expect(system).toContain("Do NOT agree merely to be polite");
    expect(system).toContain("Disagreement backed by evidence");
    expect(system).toContain("maintain it and explain why");
  });
});
