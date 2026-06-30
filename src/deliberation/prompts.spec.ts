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

  it("system wraps GLOBAL_DEPTH in <grounding>/<completion-check> XML blocks", () => {
    const sys = buildSharedConvergenceR1(makeCtx())[0]!.content!;
    expect(sys).toContain("<grounding>");
    expect(sys).toContain("<completion-check>");
    expect(sys).toContain("specific evidence");
    expect(sys).toContain("Reject a flawed premise");
    expect(sys).toContain("never force confidence");
    expect(sys).toContain("verify every major claim");
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

  it("should include other workers' confidence when present", () => {
    const responses: WorkerResponse[] = [
      { model: "w/b", content: "Use Redis", workerIndex: 1, confidence: "high" },
      { model: "w/c", content: "Use Postgres", workerIndex: 2, confidence: "low" },
    ];
    const user = buildSharedConvergenceR2(makeCtx(), responses, ownPrevious)[1]!.content!;
    expect(user).toContain("HIGH");
    expect(user).toContain("LOW");
    expect(user).toMatch(/confidence:\s*HIGH/i);
    expect(user).toMatch(/confidence:\s*LOW/i);
  });

  it("should NOT add confidence label when worker has no confidence marker", () => {
    const responses: WorkerResponse[] = [
      { model: "w/b", content: "Use Redis", workerIndex: 1 },
    ];
    const user = buildSharedConvergenceR2(makeCtx(), responses, ownPrevious)[1]!.content!;
    expect(user).not.toMatch(/their confidence:\s*(HIGH|MEDIUM|LOW)/i);
    expect(user).toContain("One analyst argues");
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

  it("shared R2 system contains structured GLOBAL_DEPTH + DEPTH_EXPLORE", () => {
    const sys = buildSharedConvergenceR2(makeCtx(), otherResponses, ownPrevious)[0]!.content!;
    expect(sys).toContain("<grounding>");
    expect(sys).toContain("<completion-check>");
    expect(sys).toContain("Reject a flawed premise");
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

  it("session-continuation dedup: omits host-instructions/CONFIDENCE/task already in message[1]", () => {
    // FollowUp is appended to existing history [system, R1-user, R1-assistant].
    // Re-emitting task/instructions/CONFIDENCE wastes tokens and dilutes attention.
    const msg = buildSharedConvergenceFollowUp(makeCtx(), [], "Focus on perf");
    expect(msg.content).not.toContain("<host-instructions>");
    expect(msg.content).not.toContain("HIGH:");
    expect(msg.content).not.toContain("<task>");
  });

  it("should include final round commitment (new signal not in history)", () => {
    const msg = buildSharedConvergenceFollowUp(makeCtx(), [], undefined, { current: 3, max: 3 });
    expect(msg.content).toMatch(/final round.*Commit/i);
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

  it("assigns workerIndex-keyed attack-angle (R1 diversity)", () => {
    const ctx = makeCtx();
    const r1w0 = buildAdversarialDebateR1(ctx, "inst", { current: 1, max: 3 }, 0)[1]!.content!;
    const r1w1 = buildAdversarialDebateR1(ctx, "inst", { current: 1, max: 3 }, 1)[1]!.content!;
    expect(r1w0).not.toEqual(r1w1);
    expect(r1w0).toContain("<attack-angle>");
    expect(r1w1).toContain("<attack-angle>");
  });

  it("attack-angle cycles through 5 distinct framings", () => {
    const ctx = makeCtx();
    const angles = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const user = buildAdversarialDebateR1(ctx, undefined, undefined, i)[1]!.content!;
      const m = user.match(/<attack-angle>(.*?)<\/attack-angle>/s);
      expect(m).not.toBeNull();
      angles.add(m![1]!);
    }
    expect(angles.size).toBe(5);
  });

  it("attack-angle omitted when workerIndex is undefined", () => {
    const user = buildAdversarialDebateR1(makeCtx())[1]!.content!;
    expect(user).not.toContain("<attack-angle>");
  });

  it("R1 user carries the lean (no-peer) <approach> block", () => {
    const user = buildAdversarialDebateR1(makeCtx(), undefined, undefined, 0)[1]!.content!;
    expect(user).toContain("<approach>");
    expect(user).toMatch(/Do not soften your criticism/i);
    // "substantive and falsifiable" removed: "substantive" is covered by the role
    // ("evidence-backed weaknesses") + the required evidence field, and "falsifiable" by the
    // required falsification field — introspection (3 heterogeneous workers) reported the clause
    // double-covered, with the falsification field the operative driver.
    // R1 has no peers/prior round: peer-relative directives must NOT appear here
    expect(user).not.toContain("another analyst");
    expect(user).not.toContain("reach consensus");
    expect(user).not.toMatch(/restate prior findings/i);
    // steelmanning is owned by the output-format steelman field, not duplicated in approach
    expect(user).not.toContain("Steelman each position");
  });

  it("R1 system carries evidence + output-format, task is last", () => {
    const msgs = buildAdversarialDebateR1(makeCtx(), undefined, undefined, 0);
    expect(msgs[0]!.content!).toContain("<output-format>");
    expect(msgs[1]!.content!).toMatch(/<task>Write a sorting function<\/task>$/);
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

  it("system states the adversarial stress-testing role", () => {
    const sys = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[0]!.content!;
    expect(sys).toContain("stress-testing a proposal");
    expect(sys).toContain("evidence-backed weaknesses");
  });

  it("system carries the output-format with severity tiers + confidence + steelman field", () => {
    const sys = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[0]!.content!;
    expect(sys).toContain("<output-format>");
    // verdict rendered as a literal, parseable template (lowercase severity, uppercase confidence)
    expect(sys).toContain("(critical | high | medium | low)");
    expect(sys).toContain("(HIGH | MEDIUM | LOW)");
    expect(sys).toContain("verdict: critical, HIGH");
    expect(sys).toContain("steelman:");
    expect(sys).toMatch(/Order findings by severity, most critical first/);
    // reason-before-verdict (de-commit-first) is enforced by FIELD ORDER, not a redundant prose clause:
    // the reasoning fields (weakness/evidence/falsification) precede verdict in the listed order.
    expect(sys.indexOf("evidence:")).toBeLessThan(sys.indexOf("verdict:"));
  });

  it("R2+ <approach> carries the peer-aware directives (no-soften, no-consensus, revise-on-own-evidence)", () => {
    const user = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toContain("<approach>");
    expect(user).toContain("do not agree merely to reach consensus");
    expect(user).toContain("Do not soften criticism");
    expect(user).toMatch(/never because another analyst sounded confident/);
  });

  it("falsification criterion lives in the system output-format", () => {
    const sys = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[0]!.content!;
    expect(sys).toMatch(/falsification|change your mind/i);
  });

  it("revise-on-record-evidence rule (anti-herding, but peer evidence counts) is re-injected in <approach>", () => {
    const user = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    // revision is allowed on evidence in the record (incl. a peer's concrete evidence), NOT only self-derived
    expect(user).toMatch(/Revise[^.]*evidence in the record/i);
    // anti-herding guard preserved: never revise merely because a peer sounded confident
    expect(user).toMatch(/never because another analyst sounded confident/i);
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

  it("should present peers in 3rd person with turn-local Analyst labels", () => {
    const user = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toMatch(/Analyst A argues/);
    expect(user).not.toContain("Worker ");
    expect(user).not.toContain("Model ");
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

  it("confidence taxonomy lives in the system block (defined once, not duplicated in approach)", () => {
    const msgs = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious);
    const sys = msgs[0]!.content!;
    const user = msgs[1]!.content!;
    // confidence is tied to the decisiveness of the finding's own falsification test (calibration,
    // not tier-amputation): cheap deterministic check → HIGH, load/probabilistic test → MEDIUM
    expect(sys).toMatch(/HIGH = one cheap deterministic check decides it/);
    expect(sys).toMatch(/needs a benchmark\/load test\/other contingent evidence/);
    // de-duplicated: the confidence-label reminder is no longer repeated in the user/approach block
    expect(user).not.toContain("Label each finding's confidence");
  });

  it("should place task at end", () => {
    const user = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toMatch(/<task>Write a sorting function<\/task>$/);
  });

  it("includes final-round consolidation closing ONLY on the final round", () => {
    const userFinal = buildAdversarialDebateR2(
      makeCtx(), otherResponses, ownPrevious, undefined, { current: 3, max: 3 },
    )[1]!.content!;
    expect(userFinal).toContain("<closing>");
    expect(userFinal).toContain("This is the final round");
    // closing precedes the task (task stays last)
    expect(userFinal.indexOf("<closing>")).toBeLessThan(userFinal.indexOf("<task>"));

    const userMid = buildAdversarialDebateR2(
      makeCtx(), otherResponses, ownPrevious, undefined, { current: 2, max: 3 },
    )[1]!.content!;
    expect(userMid).not.toContain("<closing>");

    const userNoRound = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(userNoRound).not.toContain("<closing>");

    // single-round debate (max=1): the max>1 guard suppresses the closing
    const userSingle = buildAdversarialDebateR2(
      makeCtx(), otherResponses, ownPrevious, undefined, { current: 1, max: 1 },
    )[1]!.content!;
    expect(userSingle).not.toContain("<closing>");
  });

  it("re-injects the workerIndex-keyed attack-angle in R2", () => {
    const a0 = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious, undefined, undefined, 0)[1]!.content!;
    const a1 = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious, undefined, undefined, 1)[1]!.content!;
    expect(a0).toContain("<attack-angle>");
    expect(a1).toContain("<attack-angle>");
    expect(a0).not.toEqual(a1); // distinct angle per worker
    const none = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(none).not.toContain("<attack-angle>");
  });

  it("formats a peer without confidence as a bare Analyst label (no confidence suffix)", () => {
    const noConf = [makeResponse("w/b", "Use mergesort", 1)]; // makeResponse sets no confidence
    const user = buildAdversarialDebateR2(makeCtx(), noConf, ownPrevious)[1]!.content!;
    expect(user).toMatch(/Analyst A argues:/);
    expect(user).not.toMatch(/Analyst A argues \(their confidence/);
  });

  it("adversarial system uses evidence/output blocks, not GLOBAL_DEPTH", () => {
    const sys = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[0]!.content!;
    expect(sys).toContain("<evidence-and-confidence>");
    expect(sys).toContain("<output-format>");
    expect(sys).toMatch(/never build on it or refuse/i);
    // adversarial no longer carries the shared GLOBAL_DEPTH/DEPTH_EXPLORE blocks
    expect(sys).not.toContain("<grounding>");
    expect(sys).not.toContain("<completion-check>");
  });

  it("evidence-discipline contract: no-lookup reframe + per-mode anti-fabrication self-checks", () => {
    const sys = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[0]!.content!;
    // reasoning is the default (removes the citation-first incentive that drove confabulation)
    expect(sys).toContain("No lookups");
    expect(sys).toMatch(/reasoning chains/i);
    // fabricated-incident guard — sources AND identifiers/quotes/numbers
    expect(sys).toMatch(/Never invent sources, identifiers, quotes, or numbers/i);
    // citation discipline: exact recall only
    expect(sys).toMatch(/exact recall only/i);
    // named uncertainty channels (existence/attribution/identifier/venue-year/wording/figure) force [unverified]
    expect(sys).toMatch(/attribution/i);
    expect(sys).toMatch(/venue\/year/i);
    // named-identifier (model slips a fake API mid-generation) → describe instead of name
    expect(sys).toMatch(/describe the capability without naming it/i);
    // paraphrase-as-quote guard
    expect(sys).toMatch(/drop quotes/i);
    // number-laundering guard: numbers get a direction/order-of-magnitude range, not a fabricated figure
    expect(sys).toMatch(/order-of-magnitude range for numbers/i);
    // single [unverified] convention, no competing tag
    expect(sys).toContain("[unverified]");
    expect(sys).not.toContain("[from-memory]");
    // pre-submit re-read audit
    expect(sys).toMatch(/Before submitting/i);
    // output-format evidence field allows reasoning chain as evidence (not citation-only)
    expect(sys).toMatch(/evidence:.*reasoning chain/i);
  });

  it("reasoning-depth levers: staged framing, reason-before-verdict order, pre-submit consistency, abstention", () => {
    const sys = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[0]!.content!;
    // D3 staged framing (depth without banned CoT)
    expect(sys).toMatch(/enumerate candidate failure modes/i);
    expect(sys).toMatch(/your own counter-attack defeats/i);
    // D2 de-commit-first: the merged verdict line comes AFTER the reasoning fields (weakness/evidence)
    expect(sys.indexOf("weakness:")).toBeLessThan(sys.indexOf("verdict:"));
    expect(sys.indexOf("evidence:")).toBeLessThan(sys.indexOf("verdict:"));
    // confidence calibrated by falsifier decisiveness (replaces self-assessed "deductively tight", which
    // measured ~65% inflated): contingent/load-dependent failures cap at MEDIUM
    expect(sys).toMatch(/it only bites under particular load\/timing\/config/i);
    // pre-submit check is internal-contradiction only. The CoVe cited-item re-verify clause was measured
    // ineffective even on a citation-prone task ([unverified] marks stayed 0 with and without it, version
    // fabrication unchanged) and removed — keep only the self-consistency fix.
    expect(sys).toMatch(/whose own text undercuts its label/i);
    expect(sys).not.toMatch(/re-verify each cited source/i);
  });

  it("approach re-injects a conditional substantive-critique rule (add if one survives, else say so — no quota)", () => {
    const user = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    expect(user).toMatch(/If a new substantive, falsifiable critique survives your counter-attack, add it/i);
    // anti-quota with a non-skippable fallback: if nothing new, engage the weakest peer finding (no free
    // exit, no filler). Folded into a finding's fields (closing-compatible) rather than a standalone
    // holds/refuted artifact, which contradicted the closing's "no separate per-peer sections" + the
    // output verdict schema (severity/confidence). Contradiction was benign in output (R2 n=6: 0 per-peer
    // sections) but removed for prompt consistency.
    expect(user).toMatch(/engage the weakest peer finding head-on within a finding/i);
  });

  it("webAccess swaps the no-lookup contract for a verify-with-tools contract", () => {
    const noLookup = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious, undefined, undefined, 0, false)[0]!.content!;
    const web = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious, undefined, undefined, 0, true)[0]!.content!;
    // no-lookup variant tells the worker it cannot look anything up
    expect(noLookup).toContain("No lookups");
    // web variant tells the worker to VERIFY with tools before asserting
    expect(web).toContain("You have web search and fetch tools");
    expect(web).toMatch(/VERIFY it/);
    expect(web).not.toContain("No lookups:");
    // anti-citation-theater: quotes only from fetched text, no fake "(verified)"
    expect(web).toContain("ANTI-FABRICATION");
    expect(web).toMatch(/quotation marks ONLY around words you copied/i);
    // role + output-format stay shared across both
    expect(web).toContain("stress-testing a proposal");
    expect(web).toContain("<output-format>");
    // R1 also honours webAccess
    const webR1 = buildAdversarialDebateR1(makeCtx(), undefined, undefined, 0, true)[0]!.content!;
    expect(webR1).toContain("You have web search and fetch tools");
  });

  it("adversarial system is static (cache-stable) regardless of instructions", () => {
    const a = buildAdversarialDebateR1(makeCtx(), "alpha")[0]!.content;
    const b = buildAdversarialDebateR1(makeCtx(), "beta")[0]!.content;
    expect(a).toBe(b);
  });

  it("should escape XML in other responses", () => {
    const responses = [makeResponse("w/b", "<script>alert(1)</script>", 1)];
    const user = buildAdversarialDebateR2(makeCtx(), responses, ownPrevious)[1]!.content!;
    expect(user).not.toContain("<script>");
    expect(user).toContain("&lt;script&gt;");
  });

  it("should include other workers' confidence when present (adversarial)", () => {
    const responses: WorkerResponse[] = [
      { model: "w/b", content: "Use Redis", workerIndex: 1, confidence: "high" },
      { model: "w/c", content: "Use Postgres", workerIndex: 2, confidence: "low" },
    ];
    const user = buildAdversarialDebateR2(makeCtx(), responses, ownPrevious)[1]!.content!;
    expect(user).toMatch(/confidence:\s*HIGH/i);
    expect(user).toMatch(/confidence:\s*LOW/i);
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

  it("should place positions-to-challenge before approach (Lost-in-the-Middle)", () => {
    const user = buildAdversarialDebateR2(makeCtx(), otherResponses, ownPrevious)[1]!.content!;
    const posIdx = user.indexOf("<positions-to-challenge>");
    const apprIdx = user.indexOf("<approach>");
    expect(posIdx).toBeLessThan(apprIdx);
  });

  it("cold-join transcript carries peer confidence labels", () => {
    const ctx = makeCtx([
      { number: 1, responses: [{ model: "w/b", content: "Use Redis", workerIndex: 1, confidence: "high" }] },
    ]);
    const user = buildAdversarialDebateR2(ctx, [], undefined)[1]!.content!;
    expect(user).toContain("<debate-so-far>");
    expect(user).toMatch(/confidence:\s*HIGH/i);
  });
});

describe("buildAdversarialDebateFollowUp", () => {
  it("should produce a single user message", () => {
    const msg = buildAdversarialDebateFollowUp(makeCtx(), []);
    expect(msg.role).toBe("user");
  });

  it("should use adversarial anti-conformity (peer-aware approach)", () => {
    const msg = buildAdversarialDebateFollowUp(makeCtx(), []);
    expect(msg.content).toContain("Do not soften criticism");
    expect(msg.content).toContain("do not agree merely to reach consensus");
  });

  it("should use positions-to-challenge tag", () => {
    const others = [makeResponse("w/b", "Redis", 1)];
    const msg = buildAdversarialDebateFollowUp(makeCtx(), others);
    expect(msg.content).toContain("<positions-to-challenge>");
    expect(msg.content).not.toContain("<other-positions>");
  });

  it("session-continuation dedup: omits host-instructions/CONFIDENCE/task already in message[1]", () => {
    const msg = buildAdversarialDebateFollowUp(makeCtx(), [], "Focus on security");
    expect(msg.content).not.toContain("<host-instructions>");
    expect(msg.content).not.toContain("HIGH:");
    expect(msg.content).not.toContain("<task>");
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

  it("should place positions-to-challenge before approach in FollowUp", () => {
    const others = [makeResponse("w/b", "Redis", 1)];
    const msg = buildAdversarialDebateFollowUp(makeCtx(), others);
    const posIdx = msg.content!.indexOf("<positions-to-challenge>");
    const apprIdx = msg.content!.indexOf("<approach>");
    expect(posIdx).toBeLessThan(apprIdx);
  });

  it("re-injects attack-angle and final-round closing when provided", () => {
    const others = [makeResponse("w/b", "Redis", 1)];
    const mid = buildAdversarialDebateFollowUp(makeCtx(), others, undefined, { current: 2, max: 3 }, 0);
    expect(mid.content).toContain("<attack-angle>");
    expect(mid.content).not.toContain("<closing>");
    const final = buildAdversarialDebateFollowUp(makeCtx(), others, undefined, { current: 3, max: 3 }, 0);
    expect(final.content).toContain("<closing>");
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

  it("preserves markdown body verbatim — no XML escape on code samples", () => {
    // Synthesis / original position may contain legitimate angle brackets
    // (TypeScript generics, HTML, comparison operators). Acceptance user
    // message is markdown, not XML, so these must round-trip without escape.
    const code = "Use Array<T> where T extends Comparable";
    const user = buildAcceptanceMessages(code, code, code)[1]!.content!;
    expect(user).toContain("Array<T>");
    expect(user).toContain("T extends Comparable");
    expect(user).not.toContain("Array&lt;T&gt;");
    expect(user).not.toContain("&lt;T&gt;");
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

    // shared_convergence keeps the anonymous "One analyst argues:" framing.
    for (const content of [scR2, scFollow]) {
      expect(content).toContain("One analyst argues:");
    }
    // adversarial uses turn-local "Analyst A/B" labels (still 3rd person).
    for (const content of [adR2, adFollow]) {
      expect(content).toMatch(/Analyst [A-Z] argues/);
    }
    for (const content of [scR2, adR2, scFollow, adFollow]) {
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

  it("confidence anchor present in standalone-prompt builders (not FollowUp — session-continuation reuses prior turn)", () => {
    // shared_convergence carries the anchor in the user turn.
    expect(buildSharedConvergenceR1(makeCtx())[1]!.content).toContain("HIGH:");
    expect(buildSharedConvergenceR2(
      makeCtx(), [], undefined,
    )[1]!.content).toContain("HIGH:");
    // adversarial carries the confidence taxonomy in the SYSTEM block (defined once, not in the user turn).
    expect(buildAdversarialDebateR2(
      makeCtx(), [], undefined,
    )[0]!.content).toContain("HIGH = one cheap deterministic check decides it");
    // FollowUp builders MUST omit the anchor — message[1] in the live history
    // already carries it; re-injecting would be a duplicate.
    expect(buildSharedConvergenceFollowUp(makeCtx(), []).content).not.toContain("HIGH:");
    expect(buildAdversarialDebateFollowUp(makeCtx(), []).content).not.toContain("HIGH:");
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

  it("escapes XML metacharacters in all user-provided values across all builders", () => {
    // A malicious or accidental angle-bracket in any caller-supplied string must
    // not break tag boundaries. Each builder gets a value containing `</tag>` and
    // we assert that no raw closing tag for our wrappers leaks into the prompt.
    const dirty = "x</task>y<positions-to-challenge>z";
    const dirtyCtx: SharedContext = {
      task: dirty,
      team: makeTeam(),
      rounds: [],
    };
    const dirtyOwn = makeResponse("w/a", dirty, 0);
    const dirtyOther = makeResponse("w/b", dirty, 1);

    function assertEscaped(content: string, label: string) {
      // Raw closing tag inserted via user input must be escaped.
      const occurrences = (content.match(/<\/task>/g) || []).length;
      // At most one legitimate </task> (the wrapper close). Any extra means injection.
      expect(occurrences, `${label} has injected </task>`).toBeLessThanOrEqual(1);
      expect(content, `${label} contains escaped form`).toContain("&lt;/task&gt;");
    }

    // shared_convergence
    assertEscaped(buildSharedConvergenceR1(dirtyCtx, dirty)[1]!.content!, "scR1");
    assertEscaped(
      buildSharedConvergenceR2(dirtyCtx, [dirtyOther], dirtyOwn, dirty)[1]!.content!,
      "scR2",
    );
    assertEscaped(
      buildSharedConvergenceFollowUp(dirtyCtx, [dirtyOther], dirty).content!,
      "scFollow",
    );

    // adversarial_debate
    assertEscaped(buildAdversarialDebateR1(dirtyCtx, dirty)[1]!.content!, "advR1");
    assertEscaped(
      buildAdversarialDebateR2(dirtyCtx, [dirtyOther], dirtyOwn, dirty)[1]!.content!,
      "advR2",
    );
    assertEscaped(
      buildAdversarialDebateFollowUp(dirtyCtx, [dirtyOther], dirty).content!,
      "advFollow",
    );

    // host_interrogation
    assertEscaped(
      buildHostInterrogationMessages(dirty, dirty, [
        { question: dirty, answer: dirty },
      ])[1]!.content!,
      "hostInterrogation",
    );

    // sequential_refinement
    assertEscaped(
      buildSequentialRefinementMessages(dirtyCtx, dirty, dirty)[1]!.content!,
      "sequential",
    );

    // evaluation_scoring
    assertEscaped(
      buildEvaluationScoringMessages(dirty, dirty, dirty, dirty)[1]!.content!,
      "evaluation",
    );

    // red_team
    assertEscaped(
      buildRedTeamGeneratorMessages(dirty, dirty, dirty)[1]!.content!,
      "redTeamGenerator",
    );
    assertEscaped(
      buildRedTeamAttackerMessages(dirty, [dirty, dirty], dirty)[1]!.content!,
      "redTeamAttacker",
    );
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
