/**
 * Unit tests for prompts.ts — deliberation prompt builders (6 protocols).
 */

import { describe, it, expect } from "bun:test";
import {
  buildSharedConvergenceR1,
  buildSharedConvergenceR2,
  buildSharedConvergenceFollowUp,
  buildAdversarialDebateR1,
  buildAdversarialDebateR2,
  buildAdversarialDebateFollowUp,
  buildHostInterrogationMessages,
  buildSequentialRefinementMessages,
  buildEvaluationScoringMessages,
  buildRedTeamGeneratorMessages,
  buildRedTeamAttackerMessages,
  buildAcceptanceMessages,
  extractDebateDigest,
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
): SharedContext {
  return {
    task: "Write a sorting function",
    team: makeTeam(),
    rounds,
    ...(taskNature ? { taskNature } : {}),
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
// 1. Shared Convergence
// ================================================================

describe("buildSharedConvergenceR1", () => {
  it("should return system + user messages", () => {
    const msgs = buildSharedConvergenceR1(makeCtx());
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[1]!.role).toBe("user");
  });

  it("should include global depth in system", () => {
    const sys = buildSharedConvergenceR1(makeCtx())[0]!.content!;
    expect(sys).toContain("verify your key claims");
    expect(sys).toContain("Ground factual claims");
    expect(sys).toContain("reject it");
    expect(sys).toContain("Express uncertainty");
  });

  it("should include explore depth in system", () => {
    const sys = buildSharedConvergenceR1(makeCtx())[0]!.content!;
    expect(sys).toContain("multiple approaches");
    expect(sys).toContain("Discard the weakest");
    expect(sys).toContain("strongest argument against");
  });

  it("should include role tag in system", () => {
    const sys = buildSharedConvergenceR1(makeCtx())[0]!.content!;
    expect(sys).toContain("<role>");
    expect(sys).toContain("Think deeply");
  });

  it("should include confidence instructions in user message", () => {
    const user = buildSharedConvergenceR1(makeCtx())[1]!.content!;
    expect(user).toContain("HIGH:");
    expect(user).toContain("MEDIUM:");
    expect(user).toContain("LOW:");
  });

  it("should NOT include confidence markers in system message", () => {
    const sys = buildSharedConvergenceR1(makeCtx())[0]!.content!;
    expect(sys).not.toContain("HIGH:");
    expect(sys).not.toContain("MEDIUM:");
    expect(sys).not.toContain("LOW:");
  });

  it("should place task at end of user message", () => {
    const user = buildSharedConvergenceR1(makeCtx())[1]!.content!;
    expect(user).toMatch(/<task>Write a sorting function<\/task>$/);
  });

  it("should include host-instructions in user message when provided", () => {
    const user = buildSharedConvergenceR1(makeCtx(), "Use TypeScript")[1]!.content!;
    expect(user).toContain("<host-instructions>Use TypeScript</host-instructions>");
  });

  it("should NOT include host-instructions in system message", () => {
    const sys = buildSharedConvergenceR1(makeCtx(), "Use TypeScript")[0]!.content!;
    expect(sys).not.toContain("host-instructions");
  });

  it("should omit host-instructions when undefined", () => {
    const user = buildSharedConvergenceR1(makeCtx())[1]!.content!;
    expect(user).not.toContain("host-instructions");
  });

  it("should include diverge strategy on R1 of multi-round", () => {
    const user = buildSharedConvergenceR1(makeCtx(), undefined, { current: 1, max: 3 })[1]!.content!;
    expect(user).toContain("Explore broadly");
  });

  it("should NOT include diverge strategy on single-round", () => {
    const user = buildSharedConvergenceR1(makeCtx(), undefined, { current: 1, max: 1 })[1]!.content!;
    expect(user).not.toContain("Explore broadly");
  });

  it("should NOT include anti-conformity (no other responses in R1)", () => {
    const user = buildSharedConvergenceR1(makeCtx())[1]!.content!;
    expect(user).not.toContain("<constraints>");
    expect(user).not.toContain("conformity");
  });
});

describe("buildSharedConvergenceR2", () => {
  const otherResponses = [makeResponse("worker/b", "Use mergesort", 1)];
  const ownPrevious = makeResponse("worker/a", "Use quicksort", 0);

  it("should return system + user messages", () => {
    const msgs = buildSharedConvergenceR2(makeCtx(), otherResponses, ownPrevious);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[1]!.role).toBe("user");
  });

  it("should include anti-conformity constraints", () => {
    const user = buildSharedConvergenceR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toContain("<constraints>");
    expect(user).toContain("discrepancies");
    expect(user).toContain("Do not rely on conformity");
  });

  it("should use general anti-conformity, NOT adversarial", () => {
    const user = buildSharedConvergenceR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).not.toContain("steelman");
    expect(user).not.toContain("Do not agree to reach consensus");
  });

  it("should present other positions in 3rd person", () => {
    const user = buildSharedConvergenceR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toContain("One analyst argues:");
    expect(user).toContain("<other-positions>");
  });

  it("should include own previous response", () => {
    const user = buildSharedConvergenceR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toContain("<your-previous>");
    expect(user).toContain("Use quicksort");
  });

  it("should show full transcript as cold join when no ownPrevious", () => {
    const round1 = makeRound(1);
    const round2 = makeRound(2);
    const ctx = makeCtx([round1, round2]);
    const user = buildSharedConvergenceR2(ctx, otherResponses, undefined)[1]!.content!;

    expect(user).toContain("<debate-so-far>");
    expect(user).toContain("### Round 1");
    expect(user).toContain("### Round 2");
    expect(user).not.toContain("<your-previous>");
  });

  it("should NOT show debate-so-far when ownPrevious is provided", () => {
    const ctx = makeCtx([makeRound(1)]);
    const user = buildSharedConvergenceR2(ctx, otherResponses, ownPrevious)[1]!.content!;
    expect(user).not.toContain("<debate-so-far>");
  });

  it("should NOT show debate-so-far when no ownPrevious AND no rounds", () => {
    const ctx = makeCtx([]);
    const user = buildSharedConvergenceR2(ctx, otherResponses, undefined)[1]!.content!;
    expect(user).not.toContain("<debate-so-far>");
  });

  it("should include confidence instructions", () => {
    const user = buildSharedConvergenceR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toContain("HIGH:");
  });

  it("should include final round commitment", () => {
    const user = buildSharedConvergenceR2(
      makeCtx(), otherResponses, ownPrevious, undefined, { current: 3, max: 3 },
    )[1]!.content!;
    expect(user).toMatch(/final round.*Commit/i);
  });

  it("should NOT include final round commitment on non-final round", () => {
    const user = buildSharedConvergenceR2(
      makeCtx(), otherResponses, ownPrevious, undefined, { current: 2, max: 3 },
    )[1]!.content!;
    expect(user).not.toContain("final round");
  });

  it("should NOT include final round on single round", () => {
    const user = buildSharedConvergenceR2(
      makeCtx(), otherResponses, ownPrevious, undefined, { current: 1, max: 1 },
    )[1]!.content!;
    expect(user).not.toContain("final round");
  });

  it("should place task at end", () => {
    const user = buildSharedConvergenceR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toMatch(/<task>Write a sorting function<\/task>$/);
  });

  it("should escape XML in other responses", () => {
    const responses = [makeResponse("w/b", "Use <script> injection", 1)];
    const user = buildSharedConvergenceR2(makeCtx(), responses, ownPrevious)[1]!.content!;
    expect(user).not.toContain("<script>");
    expect(user).toContain("&lt;script&gt;");
  });

  it("should handle empty otherResponses", () => {
    const user = buildSharedConvergenceR2(makeCtx(), [], ownPrevious)[1]!.content!;
    expect(user).not.toContain("<other-positions>");
  });

  it("should handle 4+ other responses", () => {
    const responses = [
      makeResponse("w/a", "A resp", 0),
      makeResponse("w/b", "B resp", 1),
      makeResponse("w/c", "C resp", 2),
      makeResponse("w/d", "D resp", 3),
    ];
    const user = buildSharedConvergenceR2(makeCtx(), responses, undefined)[1]!.content!;
    expect((user.match(/One analyst argues/g) ?? []).length).toBe(4);
  });

  it("should include global and explore depth in system", () => {
    const sys = buildSharedConvergenceR2(makeCtx(), otherResponses, ownPrevious)[0]!.content!;
    expect(sys).toContain("reject it");
    expect(sys).toContain("multiple approaches");
  });

  it("should include analysis-lens in R2+ when workerIndex and multi-round", () => {
    const user = buildSharedConvergenceR2(
      makeCtx(), otherResponses, ownPrevious, undefined, { current: 2, max: 3 }, 0,
    )[1]!.content!;
    expect(user).toContain("<analysis-lens>");
    expect(user).toContain("Prioritize practical constraints");
  });

  it("should assign different lenses per workerIndex in R2+", () => {
    const u0 = buildSharedConvergenceR2(
      makeCtx(), otherResponses, ownPrevious, undefined, { current: 2, max: 3 }, 0,
    )[1]!.content!;
    const u1 = buildSharedConvergenceR2(
      makeCtx(), otherResponses, ownPrevious, undefined, { current: 2, max: 3 }, 1,
    )[1]!.content!;
    const lens0 = u0.match(/<analysis-lens>([\s\S]*?)<\/analysis-lens>/)?.[1];
    const lens1 = u1.match(/<analysis-lens>([\s\S]*?)<\/analysis-lens>/)?.[1];
    expect(lens0).not.toEqual(lens1);
  });

  it("should NOT include analysis-lens in R2+ for single-round", () => {
    const user = buildSharedConvergenceR2(
      makeCtx(), otherResponses, ownPrevious, undefined, { current: 1, max: 1 }, 0,
    )[1]!.content!;
    expect(user).not.toContain("<analysis-lens>");
  });

  it("should NOT include analysis-lens without workerIndex", () => {
    const user = buildSharedConvergenceR2(
      makeCtx(), otherResponses, ownPrevious, undefined, { current: 2, max: 3 },
    )[1]!.content!;
    expect(user).not.toContain("<analysis-lens>");
  });

  it("should place other-positions before constraints (Lost-in-the-Middle)", () => {
    const user = buildSharedConvergenceR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    const posIdx = user.indexOf("<other-positions>");
    const constIdx = user.indexOf("<constraints>");
    expect(posIdx).toBeLessThan(constIdx);
  });
});

describe("buildSharedConvergenceFollowUp", () => {
  it("should produce a single user message", () => {
    const msg = buildSharedConvergenceFollowUp(makeCtx(), []);
    expect(msg.role).toBe("user");
  });

  it("should include anti-conformity constraints", () => {
    const msg = buildSharedConvergenceFollowUp(makeCtx(), []);
    expect(msg.content).toContain("<constraints>");
    expect(msg.content).toContain("Do not rely on conformity");
  });

  it("should include other positions in 3rd person", () => {
    const others = [makeResponse("w/b", "Redis is better", 1)];
    const msg = buildSharedConvergenceFollowUp(makeCtx(), others);
    expect(msg.content).toContain("One analyst argues");
    expect(msg.content).toContain("Redis is better");
  });

  it("should include host-instructions when provided", () => {
    const msg = buildSharedConvergenceFollowUp(makeCtx(), [], "Focus on perf");
    expect(msg.content).toContain("<host-instructions>Focus on perf</host-instructions>");
  });

  it("should include confidence instructions", () => {
    const msg = buildSharedConvergenceFollowUp(makeCtx(), []);
    expect(msg.content).toContain("HIGH:");
  });

  it("should include final round commitment", () => {
    const msg = buildSharedConvergenceFollowUp(makeCtx(), [], undefined, { current: 3, max: 3 });
    expect(msg.content).toMatch(/final round.*Commit/i);
  });

  it("should place task at end", () => {
    const msg = buildSharedConvergenceFollowUp(makeCtx(), []);
    expect(msg.content).toMatch(/<task>Write a sorting function<\/task>$/);
  });

  it("should NOT include system prompt content", () => {
    const msg = buildSharedConvergenceFollowUp(makeCtx(), []);
    expect(msg.content).not.toContain("<role>");
    expect(msg.content).not.toContain("Think deeply");
  });

  it("should escape XML in other responses", () => {
    const others = [makeResponse("w/a", "Use <img> tag", 0)];
    const msg = buildSharedConvergenceFollowUp(makeCtx(), others);
    expect(msg.content).not.toContain("<img>");
    expect(msg.content).toContain("&lt;img&gt;");
  });

  it("should include analysis-lens in FollowUp when workerIndex and multi-round", () => {
    const msg = buildSharedConvergenceFollowUp(makeCtx(), [], undefined, { current: 2, max: 3 }, 0);
    expect(msg.content).toContain("<analysis-lens>");
    expect(msg.content).toContain("Prioritize practical constraints");
  });

  it("should NOT include analysis-lens in FollowUp without workerIndex", () => {
    const msg = buildSharedConvergenceFollowUp(makeCtx(), [], undefined, { current: 2, max: 3 });
    expect(msg.content).not.toContain("<analysis-lens>");
  });

  it("should place other-positions before constraints in FollowUp", () => {
    const others = [makeResponse("w/b", "Redis is better", 1)];
    const msg = buildSharedConvergenceFollowUp(makeCtx(), others);
    const posIdx = msg.content!.indexOf("<other-positions>");
    const constIdx = msg.content!.indexOf("<constraints>");
    expect(posIdx).toBeLessThan(constIdx);
  });
});

// ================================================================
// 2. Adversarial Debate
// ================================================================

describe("buildAdversarialDebateR1", () => {
  it("should NOT include assigned-stance (model heterogeneity provides diversity)", () => {
    const ctx = makeCtx();
    const r1 = buildAdversarialDebateR1(ctx, "inst", { current: 1, max: 3 }, 0);
    expect(r1[1]!.content!).not.toContain("<assigned-stance>");
  });

  it("should give identical prompts regardless of workerIndex", () => {
    const ctx = makeCtx();
    const r1w0 = buildAdversarialDebateR1(ctx, "inst", { current: 1, max: 3 }, 0);
    const r1w1 = buildAdversarialDebateR1(ctx, "inst", { current: 1, max: 3 }, 1);
    expect(r1w0[1]!.content!).toEqual(r1w1[1]!.content!);
  });
});

describe("buildAdversarialDebateR2", () => {
  const otherResponses = [makeResponse("worker/b", "Use mergesort", 1)];
  const ownPrevious = makeResponse("worker/a", "Use quicksort", 0);

  it("should return system + user messages", () => {
    const msgs = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[1]!.role).toBe("user");
  });

  it("should use adversarial system prompt (find weaknesses)", () => {
    const sys = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[0]!.content!;
    expect(sys).toContain("find weaknesses");
  });

  it("should use steelman-specific anti-conformity", () => {
    const user = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toContain("steelman");
    expect(user).toContain("Do not agree to reach consensus");
    expect(user).toContain("Do not soften criticism");
  });

  it("should NOT use general anti-conformity", () => {
    const user = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).not.toContain("Do not rely on conformity, consensus, or social pressure");
  });

  it("should use positions-to-challenge tag instead of other-positions", () => {
    const user = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toContain("<positions-to-challenge>");
    expect(user).not.toContain("<other-positions>");
  });

  it("should present in 3rd person", () => {
    const user = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toContain("One analyst argues:");
  });

  it("should include own previous response", () => {
    const user = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toContain("<your-previous>");
    expect(user).toContain("Use quicksort");
  });

  it("should show full transcript as cold join when no ownPrevious", () => {
    const ctx = makeCtx([makeRound(1), makeRound(2)]);
    const user = buildAdversarialDebateR2(ctx, otherResponses, undefined)[1]!.content!;
    expect(user).toContain("<debate-so-far>");
    expect(user).toContain("### Round 1");
    expect(user).toContain("### Round 2");
  });

  it("should include confidence instructions", () => {
    const user = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toContain("HIGH:");
  });

  it("should place task at end", () => {
    const user = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toMatch(/<task>Write a sorting function<\/task>$/);
  });

  it("should NOT include final round commitment (adversarial ignores roundInfo)", () => {
    // _roundInfo is unused in adversarial R2
    const user = buildAdversarialDebateR2(
      makeCtx(), otherResponses, ownPrevious, undefined, { current: 3, max: 3 },
    )[1]!.content!;
    expect(user).not.toContain("final round");
  });

  it("should include global and explore depth in system", () => {
    const sys = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[0]!.content!;
    expect(sys).toContain("reject it");
    expect(sys).toContain("multiple approaches");
  });

  it("should escape XML in other responses", () => {
    const responses = [makeResponse("w/b", "<script>alert(1)</script>", 1)];
    const user = buildAdversarialDebateR2(makeCtx(), responses, ownPrevious)[1]!.content!;
    expect(user).not.toContain("<script>");
    expect(user).toContain("&lt;script&gt;");
  });

  it("should handle empty otherResponses", () => {
    const user = buildAdversarialDebateR2(makeCtx(), [], ownPrevious)[1]!.content!;
    expect(user).not.toContain("<positions-to-challenge>");
  });

  it("should NOT include assigned-stance in R2+", () => {
    const user = buildAdversarialDebateR2(
      makeCtx(), otherResponses, ownPrevious, undefined, undefined, 0,
    )[1]!.content!;
    expect(user).not.toContain("<assigned-stance>");
  });

  it("should place positions-to-challenge before constraints (Lost-in-the-Middle)", () => {
    const user = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    const posIdx = user.indexOf("<positions-to-challenge>");
    const constIdx = user.indexOf("<constraints>");
    expect(posIdx).toBeLessThan(constIdx);
  });
});

describe("buildAdversarialDebateFollowUp", () => {
  it("should produce a single user message", () => {
    const msg = buildAdversarialDebateFollowUp(makeCtx(), []);
    expect(msg.role).toBe("user");
  });

  it("should use adversarial anti-conformity", () => {
    const msg = buildAdversarialDebateFollowUp(makeCtx(), []);
    expect(msg.content).toContain("steelman");
    expect(msg.content).toContain("Do not soften criticism");
  });

  it("should use positions-to-challenge tag", () => {
    const others = [makeResponse("w/b", "Redis", 1)];
    const msg = buildAdversarialDebateFollowUp(makeCtx(), others);
    expect(msg.content).toContain("<positions-to-challenge>");
    expect(msg.content).not.toContain("<other-positions>");
  });

  it("should include host-instructions when provided", () => {
    const msg = buildAdversarialDebateFollowUp(makeCtx(), [], "Focus on security");
    expect(msg.content).toContain("<host-instructions>Focus on security</host-instructions>");
  });

  it("should include confidence instructions", () => {
    const msg = buildAdversarialDebateFollowUp(makeCtx(), []);
    expect(msg.content).toContain("HIGH:");
  });

  it("should place task at end", () => {
    const msg = buildAdversarialDebateFollowUp(makeCtx(), []);
    expect(msg.content).toMatch(/<task>Write a sorting function<\/task>$/);
  });

  it("should NOT include system prompt content", () => {
    const msg = buildAdversarialDebateFollowUp(makeCtx(), []);
    expect(msg.content).not.toContain("<role>");
    expect(msg.content).not.toContain("find weaknesses");
  });

  it("should NOT include assigned-stance in FollowUp", () => {
    const msg = buildAdversarialDebateFollowUp(makeCtx(), [], undefined, undefined, 0);
    expect(msg.content).not.toContain("<assigned-stance>");
  });

  it("should place positions-to-challenge before constraints in FollowUp", () => {
    const others = [makeResponse("w/b", "Redis", 1)];
    const msg = buildAdversarialDebateFollowUp(makeCtx(), others);
    const posIdx = msg.content!.indexOf("<positions-to-challenge>");
    const constIdx = msg.content!.indexOf("<constraints>");
    expect(posIdx).toBeLessThan(constIdx);
  });
});

// ================================================================
// 3. Host Interrogation
// ================================================================

describe("buildHostInterrogationMessages", () => {
  it("should return system + user messages", () => {
    const msgs = buildHostInterrogationMessages("task", "question");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[1]!.role).toBe("user");
  });

  it("should include question in user message", () => {
    const user = buildHostInterrogationMessages("task", "Why Redis?")[1]!.content!;
    expect(user).toContain("<question>Why Redis?</question>");
  });

  it("should include task as context at end", () => {
    const user = buildHostInterrogationMessages("Pick a DB", "Why?")[1]!.content!;
    expect(user).toMatch(/<context>Pick a DB<\/context>$/);
  });

  it("should include constraints in system prompt", () => {
    const sys = buildHostInterrogationMessages("task", "q")[0]!.content!;
    expect(sys).toContain("<constraints>");
    expect(sys).toContain("Answer only what is asked");
    expect(sys).toContain("false premise");
  });

  it("should handle no previous exchanges", () => {
    const user = buildHostInterrogationMessages("task", "q")[1]!.content!;
    expect(user).not.toContain("<previous-exchange>");
  });

  it("should include previous exchanges when provided", () => {
    const exchanges = [
      { question: "Why Redis?", answer: "Because fast" },
      { question: "Cost?", answer: "Free" },
    ];
    const user = buildHostInterrogationMessages("task", "Next Q?", exchanges)[1]!.content!;
    expect(user).toContain("<previous-exchange>");
    expect(user).toContain("<question>Why Redis?</question>");
    expect(user).toContain("<your-answer>Because fast</your-answer>");
    expect(user).toContain("<question>Cost?</question>");
    expect(user).toContain("<your-answer>Free</your-answer>");
  });

  it("should place previous exchanges before current question", () => {
    const exchanges = [{ question: "First?", answer: "Yes" }];
    const user = buildHostInterrogationMessages("task", "Second?", exchanges)[1]!.content!;
    const prevIdx = user.indexOf("<previous-exchange>");
    const questionIdx = user.indexOf("<question>Second?</question>");
    expect(prevIdx).toBeLessThan(questionIdx);
  });

  it("should handle empty previous exchanges array", () => {
    const user = buildHostInterrogationMessages("task", "q", [])[1]!.content!;
    expect(user).not.toContain("<previous-exchange>");
  });
});

// ================================================================
// 4. Sequential Refinement
// ================================================================

describe("buildSequentialRefinementMessages", () => {
  it("should use R1-style prompt when no previous output (first worker)", () => {
    const msgs = buildSequentialRefinementMessages(makeCtx(), undefined);
    // Should delegate to buildSharedConvergenceR1
    const r1 = buildSharedConvergenceR1(makeCtx());
    expect(msgs).toEqual(r1);
  });

  it("should use R1-style with instructions when no previous output", () => {
    const msgs = buildSequentialRefinementMessages(makeCtx(), undefined, "Be concise");
    const r1 = buildSharedConvergenceR1(makeCtx(), "Be concise");
    expect(msgs).toEqual(r1);
  });

  it("should return system + user when previous output provided", () => {
    const msgs = buildSequentialRefinementMessages(makeCtx(), "Previous answer");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[1]!.role).toBe("user");
  });

  it("should include refinement-specific system prompt", () => {
    const sys = buildSequentialRefinementMessages(makeCtx(), "Prev")[0]!.content!;
    expect(sys).toContain("Improve the given work");
    expect(sys).toContain("Preserve what works");
    expect(sys).toContain("Do not rewrite from scratch");
  });

  it("should include previous output in user message", () => {
    const user = buildSequentialRefinementMessages(makeCtx(), "Previous work here")[1]!.content!;
    expect(user).toContain("<previous-version>");
    expect(user).toContain("Previous work here");
  });

  it("should include host-instructions when provided", () => {
    const user = buildSequentialRefinementMessages(makeCtx(), "Prev", "Focus on perf")[1]!.content!;
    expect(user).toContain("<host-instructions>Focus on perf</host-instructions>");
  });

  it("should place task at end", () => {
    const user = buildSequentialRefinementMessages(makeCtx(), "Prev")[1]!.content!;
    expect(user).toMatch(/<task>Write a sorting function<\/task>$/);
  });

  it("should include constraints about incremental improvement", () => {
    const sys = buildSequentialRefinementMessages(makeCtx(), "Prev")[0]!.content!;
    expect(sys).toContain("state what was wrong");
    expect(sys).toContain("leave it unchanged");
  });
});

// ================================================================
// 5. Evaluation Scoring
// ================================================================

describe("buildEvaluationScoringMessages", () => {
  it("should return system + user messages", () => {
    const msgs = buildEvaluationScoringMessages("task", "criteria", "subject");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[1]!.role).toBe("user");
  });

  it("should include evaluation-specific system prompt", () => {
    const sys = buildEvaluationScoringMessages("t", "c", "s")[0]!.content!;
    expect(sys).toContain("Evaluate independently");
    expect(sys).toContain("Do not invent additional criteria");
    expect(sys).toContain("Judge independently");
  });

  it("should include criteria in user message", () => {
    const user = buildEvaluationScoringMessages("t", "Speed and reliability", "s")[1]!.content!;
    expect(user).toContain("<evaluation-criteria>");
    expect(user).toContain("Speed and reliability");
  });

  it("should include subject in user message", () => {
    const user = buildEvaluationScoringMessages("t", "c", "My implementation")[1]!.content!;
    expect(user).toContain("<subject>");
    expect(user).toContain("My implementation");
  });

  it("should include host-instructions when provided", () => {
    const user = buildEvaluationScoringMessages("t", "c", "s", "Be strict")[1]!.content!;
    expect(user).toContain("<host-instructions>Be strict</host-instructions>");
  });

  it("should omit host-instructions when undefined", () => {
    const user = buildEvaluationScoringMessages("t", "c", "s")[1]!.content!;
    expect(user).not.toContain("host-instructions");
  });

  it("should place task at end", () => {
    const user = buildEvaluationScoringMessages("Eval task", "c", "s")[1]!.content!;
    expect(user).toMatch(/<task>Eval task<\/task>$/);
  });

  it("should include confidence markers instruction", () => {
    const sys = buildEvaluationScoringMessages("t", "c", "s")[0]!.content!;
    expect(sys).toContain("confidence");
    expect(sys).toContain("HIGH");
  });
});

// ================================================================
// 6. Red Team
// ================================================================

describe("buildRedTeamGeneratorMessages", () => {
  it("should return system + user messages", () => {
    const msgs = buildRedTeamGeneratorMessages("task");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[1]!.role).toBe("user");
  });

  it("should include generator-specific system prompt", () => {
    const sys = buildRedTeamGeneratorMessages("t")[0]!.content!;
    expect(sys).toContain("Produce the requested output");
    expect(sys).toContain("edge cases");
    expect(sys).toContain("adversarial inputs");
  });

  it("should place task at end", () => {
    const user = buildRedTeamGeneratorMessages("Gen task")[1]!.content!;
    expect(user).toMatch(/<task>Gen task<\/task>$/);
  });

  it("should include host-instructions when provided", () => {
    const user = buildRedTeamGeneratorMessages("t", "Make it robust")[1]!.content!;
    expect(user).toContain("<host-instructions>Make it robust</host-instructions>");
  });

  it("should omit host-instructions when undefined", () => {
    const user = buildRedTeamGeneratorMessages("t")[1]!.content!;
    expect(user).not.toContain("host-instructions");
  });

  it("should include previous attack results when provided", () => {
    const user = buildRedTeamGeneratorMessages("t", undefined, "Found SQL injection")[1]!.content!;
    expect(user).toContain("<attack-results>");
    expect(user).toContain("Found SQL injection");
  });

  it("should omit attack results when undefined", () => {
    const user = buildRedTeamGeneratorMessages("t")[1]!.content!;
    expect(user).not.toContain("<attack-results>");
  });

  it("should place attack results before task", () => {
    const user = buildRedTeamGeneratorMessages("t", undefined, "vuln found")[1]!.content!;
    const attackIdx = user.indexOf("<attack-results>");
    const taskIdx = user.indexOf("<task>");
    expect(attackIdx).toBeLessThan(taskIdx);
  });
});

describe("buildRedTeamAttackerMessages", () => {
  it("should return system + user messages", () => {
    const msgs = buildRedTeamAttackerMessages("task", ["output1"]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[1]!.role).toBe("user");
  });

  it("should include attacker-specific system prompt", () => {
    const sys = buildRedTeamAttackerMessages("t", ["o"])[0]!.content!;
    expect(sys).toContain("Find vulnerabilities");
    expect(sys).toContain("exploitable weaknesses");
    expect(sys).toContain("Rank findings by severity");
  });

  it("should include target outputs in user message", () => {
    const user = buildRedTeamAttackerMessages("t", ["output A", "output B"])[1]!.content!;
    expect(user).toContain("<target-output>");
    expect(user).toContain("output A");
    expect(user).toContain("output B");
    expect((user.match(/<target-output>/g) ?? []).length).toBe(2);
  });

  it("should include host-instructions when provided", () => {
    const user = buildRedTeamAttackerMessages("t", ["o"], "Focus on auth")[1]!.content!;
    expect(user).toContain("<host-instructions>Focus on auth</host-instructions>");
  });

  it("should place task at end", () => {
    const user = buildRedTeamAttackerMessages("Attack task", ["o"])[1]!.content!;
    expect(user).toMatch(/<task>Attack task<\/task>$/);
  });

  it("should include constraint about not fabricating vulnerabilities", () => {
    const sys = buildRedTeamAttackerMessages("t", ["o"])[0]!.content!;
    expect(sys).toContain("Do not fabricate vulnerabilities");
  });

  it("should handle single target output", () => {
    const user = buildRedTeamAttackerMessages("t", ["single"])[1]!.content!;
    expect((user.match(/<target-output>/g) ?? []).length).toBe(1);
    expect(user).toContain("single");
  });
});

// ================================================================
// Acceptance (unchanged)
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
});

// ================================================================
// extractDebateDigest
// ================================================================

describe("extractDebateDigest", () => {
  it("should extract position and evidence tags", () => {
    const content = `<position>Quicksort is optimal</position>\n<evidence>O(n log n) average</evidence>`;
    const digest = extractDebateDigest(content);
    expect(digest).toContain("Position: Quicksort is optimal");
    expect(digest).toContain("Evidence: O(n log n) average");
  });

  it("should extract alternatives tag", () => {
    const content = `<position>Redis</position>\n<evidence>Fast</evidence>\n<alternatives>Memcached</alternatives>`;
    const digest = extractDebateDigest(content);
    expect(digest).toContain("Alternatives: Memcached");
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

  it("should fall back to first 3 lines when last line is code block", () => {
    const content = "L1.\nL2.\nL3.\nL4.\n```code";
    const digest = extractDebateDigest(content);
    expect(digest).toBe("L1.\nL2.\nL3.");
  });

  it("should fall back to first 3 lines when last line is too short", () => {
    const content = "L1.\nL2.\nL3.\nL4.\nOk.";
    const digest = extractDebateDigest(content);
    expect(digest).toBe("L1.\nL2.\nL3.");
  });
});

// ================================================================
// Cross-protocol design principles
// ================================================================

describe("cross-protocol design principles", () => {
  it("task always at end of user message (Lost-in-the-Middle)", () => {
    // R1
    expect(buildSharedConvergenceR1(makeCtx())[1]!.content).toMatch(/<task>.*<\/task>$/);
    // R2
    expect(buildSharedConvergenceR2(
      makeCtx(), [makeResponse("w/b", "x", 1)], makeResponse("w/a", "y", 0),
    )[1]!.content).toMatch(/<task>.*<\/task>$/);
    // Interrogation
    expect(buildHostInterrogationMessages("t", "q")[1]!.content).toMatch(/<context>.*<\/context>$/);
    // Sequential
    expect(buildSequentialRefinementMessages(makeCtx(), "prev")[1]!.content).toMatch(/<task>.*<\/task>$/);
    // Evaluation
    expect(buildEvaluationScoringMessages("t", "c", "s")[1]!.content).toMatch(/<task>.*<\/task>$/);
    // Red team generator
    expect(buildRedTeamGeneratorMessages("t")[1]!.content).toMatch(/<task>.*<\/task>$/);
    // Red team attacker
    expect(buildRedTeamAttackerMessages("t", ["o"])[1]!.content).toMatch(/<task>.*<\/task>$/);
  });

  it("3rd person for other positions (sycophancy reduction)", () => {
    const others = [makeResponse("w/b", "Some position", 1)];
    const scR2 = buildSharedConvergenceR2(makeCtx(), others, undefined)[1]!.content!;
    const adR2 = buildAdversarialDebateR2(makeCtx(), others, undefined)[1]!.content!;
    const scFollow = buildSharedConvergenceFollowUp(makeCtx(), others).content;
    const adFollow = buildAdversarialDebateFollowUp(makeCtx(), others).content;

    for (const content of [scR2, adR2, scFollow, adFollow]) {
      expect(content).toContain("One analyst argues:");
      expect(content).not.toContain("Worker ");
      expect(content).not.toContain("Model ");
    }
  });

  it("XML tags for structure across all protocols", () => {
    const r1 = buildSharedConvergenceR1(makeCtx())[0]!.content!;
    expect(r1).toContain("<role>");

    const r2 = buildSharedConvergenceR2(
      makeCtx(), [makeResponse("w/b", "x", 1)], makeResponse("w/a", "y", 0),
    )[1]!.content!;
    expect(r2).toContain("<constraints>");
    expect(r2).toContain("<other-positions>");
    expect(r2).toContain("<your-previous>");
    expect(r2).toContain("<task>");

    const interr = buildHostInterrogationMessages("t", "q")[0]!.content!;
    expect(interr).toContain("<role>");
    expect(interr).toContain("<constraints>");
  });

  it("confidence instructions present in all deliberation builders", () => {
    // R1
    expect(buildSharedConvergenceR1(makeCtx())[1]!.content).toContain("HIGH:");
    // R2
    expect(buildSharedConvergenceR2(
      makeCtx(), [], undefined,
    )[1]!.content).toContain("HIGH:");
    // FollowUp
    expect(buildSharedConvergenceFollowUp(makeCtx(), []).content).toContain("HIGH:");
    // Adversarial R2
    expect(buildAdversarialDebateR2(
      makeCtx(), [], undefined,
    )[1]!.content).toContain("HIGH:");
    // Adversarial FollowUp
    expect(buildAdversarialDebateFollowUp(makeCtx(), []).content).toContain("HIGH:");
  });

  it("system = fixed (caching), user = variable", () => {
    // Same system for different instructions
    const sys1 = buildSharedConvergenceR1(makeCtx(), "inst1")[0]!.content!;
    const sys2 = buildSharedConvergenceR1(makeCtx(), "inst2")[0]!.content!;
    expect(sys1).toBe(sys2);

    // Different user for different instructions
    const user1 = buildSharedConvergenceR1(makeCtx(), "inst1")[1]!.content!;
    const user2 = buildSharedConvergenceR1(makeCtx(), "inst2")[1]!.content!;
    expect(user1).not.toBe(user2);
  });

  it("should be idempotent", () => {
    const ctx = makeCtx([makeRound(1)]);
    const others = [makeResponse("w/b", "x", 1)];
    const own = makeResponse("w/a", "y", 0);

    expect(buildSharedConvergenceR1(ctx, "inst")).toEqual(buildSharedConvergenceR1(ctx, "inst"));
    expect(buildSharedConvergenceR2(ctx, others, own, "inst")).toEqual(
      buildSharedConvergenceR2(ctx, others, own, "inst"),
    );
    expect(buildAdversarialDebateR2(ctx, others, own)).toEqual(
      buildAdversarialDebateR2(ctx, others, own),
    );
  });
});
