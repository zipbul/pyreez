/**
 * Unit tests for prompts.ts — deliberation prompt builders.
 */

import { describe, it, expect } from "bun:test";
import {
  buildWorkerMessages,
  buildDebateWorkerMessages,
  buildDebateFollowUp,
  buildAcceptanceMessages,
  extractDebateDigest,
  getDomainHint,
} from "./prompts";
import type {
  SharedContext,
  Round,
  TeamComposition,
  TeamMember,
  WorkerResponse,
} from "./types";

// -- Fixtures --

function makeWorker(model: string): TeamMember {
  return { model, role: "worker" };
}

function makeTeam(): TeamComposition {
  return { workers: [makeWorker("worker/a"), makeWorker("worker/b")] };
}

function makeCtx(
  rounds: readonly Round[] = [],
  taskNature?: "artifact" | "critique",
  domain?: string,
): SharedContext {
  return {
    task: "Write a sorting function",
    team: makeTeam(),
    rounds,
    ...(taskNature ? { taskNature } : {}),
    ...(domain ? { domain } : {}),
  };
}

function makeResponse(model: string, content: string, workerIndex = 0): WorkerResponse {
  return { model, content, workerIndex };
}

function makeRound(number: number, options?: { responses?: WorkerResponse[] }): Round {
  return {
    number,
    responses: options?.responses ?? [
      makeResponse("worker/a", `Response A round ${number}`, 0),
      makeResponse("worker/b", `Response B round ${number}`, 1),
    ],
  };
}

// ================================================================
// getDomainHint
// ================================================================

describe("getDomainHint", () => {
  it("should return hint for known domains", () => {
    expect(getDomainHint("CODING")).toContain("execution paths");
    expect(getDomainHint("IDEATION")).toContain("analogous cases");
    expect(getDomainHint("ARCHITECTURE")).toContain("scalability");
  });

  it("should return empty string for unknown domain", () => {
    expect(getDomainHint("UNKNOWN")).toBe("");
  });

  it("should return empty string when undefined", () => {
    expect(getDomainHint(undefined)).toBe("");
  });
});

// ================================================================
// buildWorkerMessages — all workers get identical prompts
// ================================================================

describe("buildWorkerMessages", () => {
  it("should return system + user with depth instructions", () => {
    const messages = buildWorkerMessages(makeCtx());
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("Think thoroughly");
    expect(messages[0]!.content).toContain("underlying principles");
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toContain("Write a sorting function");
  });

  it("should NOT contain roles, output-structure, or rules", () => {
    const sys = buildWorkerMessages(makeCtx())[0]!.content;
    expect(sys).not.toContain("advocate");
    expect(sys).not.toContain("critic");
    expect(sys).not.toContain("wildcard");
    expect(sys).not.toContain("<output-structure>");
    expect(sys).not.toContain("<rules>");
    expect(sys).not.toContain("200 characters");
    expect(sys).not.toContain("600 words");
  });

  it("should include depth techniques: self-questioning, verification, evidence grounding", () => {
    const sys = buildWorkerMessages(makeCtx())[0]!.content;
    expect(sys).toContain("strongest possible argument against");
    expect(sys).toContain("verify your key claims");
    expect(sys).toContain("Ground factual claims");
    expect(sys).toContain("speculative ideas, state the reasoning");
  });

  it("should include domain hint when domain is set", () => {
    const messages = buildWorkerMessages(makeCtx([], undefined, "CODING"));
    expect(messages[0]!.content).toContain("<domain>");
    expect(messages[0]!.content).toContain("execution paths");
  });

  it("should NOT include domain tag when domain is absent", () => {
    expect(buildWorkerMessages(makeCtx())[0]!.content).not.toContain("<domain>");
  });

  it("should include multi-perspective instruction", () => {
    const sys = buildWorkerMessages(makeCtx([], "critique"))[0]!.content;
    expect(sys).toContain("identify the different perspectives");
  });

  it("should produce identical prompts for different workerIndex values", () => {
    const ctx = makeCtx();
    const m0 = buildWorkerMessages(ctx, undefined, undefined, 0);
    const m1 = buildWorkerMessages(ctx, undefined, undefined, 1);
    const m2 = buildWorkerMessages(ctx, undefined, undefined, 2);
    expect(m0).toEqual(m1);
    expect(m1).toEqual(m2);
  });

  it("should include host instructions", () => {
    const sys = buildWorkerMessages(makeCtx(), "Use TypeScript strict mode")[0]!.content;
    expect(sys).toContain("Use TypeScript strict mode");
  });

  it("should include diverge strategy on R1 of multi-round", () => {
    const user = buildWorkerMessages(makeCtx(), undefined, { current: 1, max: 3 })[1]!.content!;
    expect(user).toContain("Explore broadly");
  });

  it("should NOT include diverge strategy on single-round", () => {
    const user = buildWorkerMessages(makeCtx(), undefined, { current: 1, max: 1 })[1]!.content!;
    expect(user).not.toContain("Explore broadly");
  });

  it("should include commit strategy on final round", () => {
    const user = buildWorkerMessages(makeCtx(), undefined, { current: 3, max: 3 })[1]!.content!;
    expect(user).toMatch(/final.*commit/i);
  });

  it("should place task at end of user message", () => {
    const user = buildWorkerMessages(makeCtx(), undefined, { current: 1, max: 3 })[1]!.content!;
    expect(user).toMatch(/## Task\nWrite a sorting function$/);
  });
});

// ================================================================
// buildDebateWorkerMessages — with cold join auto-detection
// ================================================================

describe("buildDebateWorkerMessages", () => {
  it("should present other workers in 3rd person", () => {
    const round1 = makeRound(1, {
      responses: [makeResponse("worker/a", "Answer A", 0), makeResponse("worker/b", "Answer B", 1)],
    });
    const ctx = makeCtx([round1]);
    const user = buildDebateWorkerMessages(ctx, undefined, undefined, 0)[1]!.content!;

    expect(user).toContain("One analyst argues");
    expect(user).not.toContain('role="');
  });

  it("should include own previous response when worker participated", () => {
    const round1 = makeRound(1, {
      responses: [makeResponse("worker/a", "My quicksort analysis", 0), makeResponse("worker/b", "My mergesort analysis", 1)],
    });
    const ctx = makeCtx([round1]);
    const user = buildDebateWorkerMessages(ctx, undefined, undefined, 0)[1]!.content!;

    expect(user).toContain("Your Previous Response");
    expect(user).toContain("My quicksort analysis");
  });

  it("should show full transcript as cold join when worker has no previous response", () => {
    const round1 = makeRound(1, {
      responses: [makeResponse("worker/a", "R1 Answer A", 0), makeResponse("worker/b", "R1 Answer B", 1)],
    });
    const round2 = makeRound(2, {
      responses: [makeResponse("worker/a", "R2 Answer A", 0), makeResponse("worker/b", "R2 Answer B", 1)],
    });
    const ctx = makeCtx([round1, round2]);

    // Worker index 5 never participated — cold join
    const user = buildDebateWorkerMessages(ctx, undefined, undefined, 5)[1]!.content!;

    expect(user).toContain("## Debate So Far");
    expect(user).toContain("### Round 1");
    expect(user).toContain("### Round 2");
    expect(user).not.toContain("Your Previous Response");
  });

  it("should include depth techniques in system prompt", () => {
    const sys = buildDebateWorkerMessages(makeCtx([makeRound(1)]))[0]!.content!;
    expect(sys).toContain("Think thoroughly");
    expect(sys).toContain("strongest possible argument against");
    expect(sys).toContain("verify your key claims");
  });

  it("should include compressed anti-sycophancy rules", () => {
    const sys = buildDebateWorkerMessages(makeCtx([makeRound(1)]))[0]!.content!;
    expect(sys).toContain("Respond to each analyst");
    expect(sys).toContain("position changed");
    expect(sys).not.toContain("Do NOT agree merely to be polite");
  });

  it("should include domain hint", () => {
    const sys = buildDebateWorkerMessages(makeCtx([makeRound(1)], undefined, "ARCHITECTURE"))[0]!.content!;
    expect(sys).toContain("scalability");
  });

  it("should include host instructions", () => {
    const sys = buildDebateWorkerMessages(makeCtx([makeRound(1)]), "Focus on performance")[0]!.content!;
    expect(sys).toContain("Focus on performance");
  });

  it("should include final round commitment", () => {
    const user = buildDebateWorkerMessages(makeCtx([makeRound(1)]), undefined, { current: 3, max: 3 })[1]!.content!;
    expect(user).toMatch(/final.*commit/i);
  });

  it("should place task at end of user message", () => {
    const user = buildDebateWorkerMessages(makeCtx([makeRound(1)]), undefined, undefined, 0)[1]!.content!;
    expect(user).toMatch(/## Task\nWrite a sorting function$/);
  });

  it("should handle 4+ workers", () => {
    const round1 = makeRound(1, {
      responses: [
        makeResponse("worker/a", "A response", 0),
        makeResponse("worker/b", "B response", 1),
        makeResponse("worker/c", "C response", 2),
        makeResponse("worker/d", "D response", 3),
      ],
    });
    const ctx = makeCtx([round1]);
    const user = buildDebateWorkerMessages(ctx, undefined, undefined, 0)[1]!.content!;

    expect(user).toContain("Your Previous Response");
    expect((user.match(/One analyst argues/g) ?? []).length).toBe(3);
  });

  it("should NOT contain output-structure", () => {
    const sys = buildDebateWorkerMessages(makeCtx([makeRound(1)]))[0]!.content!;
    expect(sys).not.toContain("<output-structure>");
    expect(sys).not.toContain("<position>");
  });

  it("should escape XML in worker responses", () => {
    const round1 = makeRound(1, {
      responses: [makeResponse("worker/a", "Use <script> for injection", 0)],
    });
    const ctx = makeCtx([round1]);
    // Worker index 1 sees worker 0's response
    const user = buildDebateWorkerMessages(ctx, undefined, undefined, 1)[1]!.content!;
    expect(user).not.toContain("<script>");
    expect(user).toContain("&lt;script&gt;");
  });
});

// ================================================================
// buildAcceptanceMessages
// ================================================================

// ================================================================
// buildDebateFollowUp — session continuation message
// ================================================================

describe("buildDebateFollowUp", () => {
  it("should produce a single user message with other positions", () => {
    const ctx = makeCtx([makeRound(1)]);
    const others = [makeResponse("worker/b", "I think Redis is better", 1)];
    const msg = buildDebateFollowUp(ctx, others);

    expect(msg.role).toBe("user");
    expect(msg.content).toContain("One analyst argues");
    expect(msg.content).toContain("Redis");
  });

  it("should include engagement + position change instruction", () => {
    const ctx = makeCtx([makeRound(1)]);
    const msg = buildDebateFollowUp(ctx, [makeResponse("w/b", "position", 1)]);
    expect(msg.content).toContain("Respond to each analyst");
    expect(msg.content).toContain("position changed");
  });

  it("should include final round commitment", () => {
    const ctx = makeCtx([makeRound(1)]);
    const msg = buildDebateFollowUp(ctx, [], { current: 3, max: 3 });
    expect(msg.content).toMatch(/final.*commit/i);
  });

  it("should place task at end", () => {
    const ctx = makeCtx([makeRound(1)]);
    const msg = buildDebateFollowUp(ctx, []);
    expect(msg.content!).toMatch(/## Task\nWrite a sorting function$/);
  });

  it("should NOT include system prompt or depth instructions", () => {
    const ctx = makeCtx([makeRound(1)], undefined, "CODING");
    const msg = buildDebateFollowUp(ctx, []);
    // Follow-up is just a user message — no system, no role, no domain tag
    expect(msg.content).not.toContain("<role>");
    expect(msg.content).not.toContain("<domain>");
    expect(msg.content).not.toContain("Think thoroughly");
  });

  it("should escape XML in other responses", () => {
    const ctx = makeCtx([makeRound(1)]);
    const others = [makeResponse("w/a", "Use <script> injection", 0)];
    const msg = buildDebateFollowUp(ctx, others);
    expect(msg.content).not.toContain("<script>");
    expect(msg.content).toContain("&lt;script&gt;");
  });
});

// ================================================================
// buildAcceptanceMessages
// ================================================================

describe("buildAcceptanceMessages", () => {
  it("should produce system + user pair", () => {
    const messages = buildAcceptanceMessages("Synth", "Pos", "Task");
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.role).toBe("user");
  });

  it("should keep acceptance XML output schema", () => {
    const sys = buildAcceptanceMessages("S", "P", "T")[0]!.content!;
    expect(sys).toContain("<acceptance>");
    expect(sys).toContain("<verdict>");
  });

  it("should include all content in user message", () => {
    const user = buildAcceptanceMessages("Host merged", "Use Redis", "Pick cache")[1]!.content!;
    expect(user).toContain("Pick cache");
    expect(user).toContain("Use Redis");
    expect(user).toContain("Host merged");
  });

  it("should place task at end", () => {
    const user = buildAcceptanceMessages("S", "P", "My task")[1]!.content!;
    expect(user).toMatch(/## Task\nMy task$/);
  });

  it("should NOT be over-prompting", () => {
    const sys = buildAcceptanceMessages("S", "P", "T")[0]!.content!;
    expect(sys).not.toContain("Actively search");
    expect(sys).not.toContain("ONLY if you genuinely");
  });
});

// ================================================================
// extractDebateDigest
// ================================================================

describe("extractDebateDigest", () => {
  it("should extract position and evidence tags (backward compat)", () => {
    const content = `<position>Quicksort is optimal</position>\n<evidence>O(n log n) average</evidence>\n<concerns>Worst case</concerns>`;
    const digest = extractDebateDigest(content);
    expect(digest).toContain("Position: Quicksort is optimal");
    expect(digest).toContain("Evidence: O(n log n) average");
    expect(digest).not.toContain("concerns");
  });

  it("should extract alternatives tag", () => {
    const content = `<position>Use Redis</position>\n<evidence>Fast</evidence>\n<alternatives>Use Memcached</alternatives>`;
    const digest = extractDebateDigest(content);
    expect(digest).toContain("Alternatives: Use Memcached");
  });

  it("should fall back to first 3 lines for short content", () => {
    expect(extractDebateDigest("line 1\nline 2\nline 3")).toBe("line 1\nline 2\nline 3");
  });

  it("should use last line as summary for long free-form content", () => {
    const content = "P1.\nP2.\nP3.\nP4.\nIn conclusion, Redis is the best choice.";
    expect(extractDebateDigest(content)).toContain("Redis is the best choice");
  });

  it("should trim whitespace in extracted tags", () => {
    const content = "<position>  spaced  </position>\n<evidence>\n  indented\n</evidence>";
    const digest = extractDebateDigest(content);
    expect(digest).toContain("Position: spaced");
    expect(digest).toContain("Evidence: indented");
  });
});

// ================================================================
// Cross-function
// ================================================================

describe("cross-function", () => {
  it("should always return 2 messages", () => {
    for (const ctx of [makeCtx(), makeCtx([makeRound(1)])]) {
      const msgs = buildWorkerMessages(ctx);
      expect(msgs).toHaveLength(2);
      expect(msgs[0]!.role).toBe("system");
      expect(msgs[1]!.role).toBe("user");
    }
  });

  it("should be idempotent", () => {
    const ctx = makeCtx([makeRound(1)]);
    expect(buildWorkerMessages(ctx, "inst")).toEqual(buildWorkerMessages(ctx, "inst"));
  });

  it("should handle empty responses", () => {
    expect(buildWorkerMessages(makeCtx([{ number: 1, responses: [] }]))).toHaveLength(2);
  });
});

// ================================================================
// Artifact prompts
// ================================================================

describe("artifact prompts", () => {
  it("should use artifact depth for artifact taskNature", () => {
    const sys = buildWorkerMessages(makeCtx([], "artifact"))[0]!.content;
    expect(sys).toContain("identify the different perspectives");
    expect(sys).toContain("task can be approached");
  });

  it("should use critique depth for critique taskNature", () => {
    const sys = buildWorkerMessages(makeCtx([], "critique"))[0]!.content;
    expect(sys).toContain("identify the different perspectives");
    expect(sys).toContain("problem can be analyzed");
  });
});

// ================================================================
// Full response sharing in debate (not digest)
// ================================================================

describe("debate full response sharing", () => {
  it("should share full response content in 3rd person format", () => {
    const responses = [
      { model: "a/m1", content: "Use A because it's fast and scalable. Cost is a concern.", workerIndex: 0 },
      { model: "b/m2", content: "Use B because it's cheap and reliable. Slow under load.", workerIndex: 1 },
    ];
    const ctx: SharedContext = {
      task: "Pick DB", team: { workers: [makeWorker("a/m1"), makeWorker("b/m2")] },
      rounds: [{ number: 1, responses }],
    };
    const user = buildDebateWorkerMessages(ctx, undefined, { current: 2, max: 3 }, 0)[1]!.content!;

    expect(user).toContain("One analyst argues");
    // Full content, not just digest
    expect(user).toContain("cheap and reliable");
    expect(user).toContain("Slow under load");
  });
});
