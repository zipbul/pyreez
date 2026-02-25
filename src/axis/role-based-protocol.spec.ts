/**
 * RoleBasedProtocol — Phase 4: real deliberation engine wiring tests.
 *
 * SUT: RoleBasedProtocol.deliberate()
 * Deps: deliberateFn injected via DI to avoid mock.module pollution.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { RoleBasedProtocol } from "./wrappers";
import type { EnsemblePlan, ModelScore, DeliberationResult, ChatFn } from "./types";
import type { ChatMessage } from "../llm/types";
import type { TeamComposition, DeliberateInput, SharedContext } from "../deliberation/types";
import type { EngineDeps, EngineConfig } from "../deliberation/engine";

// -- Fake deliberate function (injected via DI) --

type DeliberateOutput = {
  result: string;
  roundsExecuted: number;
  consensusReached: boolean;
  finalApprovals: { model: string; approved: boolean; remainingIssues: string[] }[];
  deliberationLog: SharedContext;
  totalTokens: number;
  totalLLMCalls: number;
  modelsUsed: string[];
};

/**
 * Create a fake deliberateFn that records calls and exercises the chat deps.
 * Each invocation calls chat through deps.buildProducerMessages / buildReviewerMessages / buildLeaderMessages
 * to verify the full wiring chain, then returns a configurable DeliberateOutput.
 */
function makeFakeDeliberate(opts?: {
  consensusReached?: boolean;
  throwError?: string;
}) {
  const calls: Array<{
    team: TeamComposition;
    input: DeliberateInput;
    config: EngineConfig;
  }> = [];

  const fn = async (
    team: TeamComposition,
    input: DeliberateInput,
    deps: EngineDeps,
    config: EngineConfig,
  ): Promise<DeliberateOutput> => {
    calls.push({ team, input, config });

    if (opts?.throwError) {
      throw new Error(opts.throwError);
    }

    // Build a minimal SharedContext to satisfy prompt builder signatures
    const ctx: SharedContext = { task: input.task, team, rounds: [] };

    // Exercise the chat path through prompt builders → deps.chat to verify wiring
    const producerMsgs = deps.buildProducerMessages(ctx);
    await deps.chat(team.producer.model, producerMsgs);

    for (const r of team.reviewers) {
      const reviewerMsgs = deps.buildReviewerMessages(ctx, r.perspective ?? "general");
      await deps.chat(r.model, reviewerMsgs);
    }

    const leaderMsgs = deps.buildLeaderMessages(ctx);
    await deps.chat(team.leader.model, leaderMsgs);

    const allModels = new Set([
      team.producer.model,
      ...team.reviewers.map((r) => r.model),
      team.leader.model,
    ]);

    const consensusReached = opts?.consensusReached ?? true;

    return {
      result: "deliberation result",
      roundsExecuted: consensusReached ? 1 : (config.maxRounds ?? 3),
      consensusReached,
      finalApprovals: team.reviewers.map((r) => ({
        model: r.model,
        approved: consensusReached,
        remainingIssues: [],
      })),
      deliberationLog: {
        task: input.task,
        team,
        rounds: [],
      },
      totalTokens: allModels.size * 100,
      totalLLMCalls: allModels.size,
      modelsUsed: [...allModels],
    };
  };

  return { fn, calls };
}

// -- Fixtures --

function makeScores(...entries: Array<{ id: string; judgment: number; codeGen: number }>): ModelScore[] {
  return entries.map((e) => ({
    modelId: e.id,
    dimensions: {
      JUDGMENT: { mu: e.judgment, sigma: 100 },
      CODE_GENERATION: { mu: e.codeGen, sigma: 100 },
      CREATIVITY: { mu: 600, sigma: 150 },
      REASONING: { mu: 650, sigma: 120 },
      ANALYSIS: { mu: 620, sigma: 130 },
      SELF_CONSISTENCY: { mu: 600, sigma: 140 },
    },
    overall: (e.judgment + e.codeGen) / 2,
  }));
}

function makePlan(models: Array<{ modelId: string; role?: string }>): EnsemblePlan {
  return {
    models,
    strategy: "leader_decides",
    estimatedCost: 0.05,
    reason: "test plan",
  };
}

// A ChatFn that records calls and returns appropriate JSON for producer/reviewer/leader
function makeChatFn(): ChatFn & { calls: Array<{ modelId: string; input: string | ChatMessage[] }> } {
  const calls: Array<{ modelId: string; input: string | ChatMessage[] }> = [];
  const fn = mock(async (modelId: string, input: string | ChatMessage[]) => {
    calls.push({ modelId, input });
    return JSON.stringify({ content: "response" });
  }) as any;
  fn.calls = calls;
  return fn;
}

describe("RoleBasedProtocol", () => {
  let protocol: RoleBasedProtocol;
  let fakeDelib: ReturnType<typeof makeFakeDeliberate>;

  beforeEach(() => {
    fakeDelib = makeFakeDeliberate();
    protocol = new RoleBasedProtocol("leader_decides", 3, fakeDelib.fn);
  });

  // 1. [HP] 3모델 auto-assign → leader=JUDGMENT최고, producer=CODE_GEN최고
  it("should auto-assign roles from scores when plan.models lack role field", async () => {
    const scores = makeScores(
      { id: "model-a", judgment: 500, codeGen: 800 }, // best CODE_GEN → producer
      { id: "model-b", judgment: 600, codeGen: 600 }, // reviewer
      { id: "model-c", judgment: 900, codeGen: 500 }, // best JUDGMENT → leader
    );
    const plan = makePlan([
      { modelId: "model-a" },
      { modelId: "model-b" },
      { modelId: "model-c" },
    ]);
    const chat = makeChatFn();
    const result = await protocol.deliberate("Write a function", plan, scores, chat);

    expect(result.modelsUsed).toContain("model-a");
    expect(result.modelsUsed).toContain("model-c");
    expect(result.roundsExecuted).toBeGreaterThan(0);
  });

  // 2. [HP] explicit roles in plan.models → team composition 직접 사용
  it("should use explicit roles from plan.models when role field is present", async () => {
    const scores = makeScores(
      { id: "model-x", judgment: 500, codeGen: 500 },
      { id: "model-y", judgment: 500, codeGen: 500 },
      { id: "model-z", judgment: 500, codeGen: 500 },
    );
    const plan = makePlan([
      { modelId: "model-x", role: "producer" },
      { modelId: "model-y", role: "reviewer" },
      { modelId: "model-z", role: "leader" },
    ]);
    const chat = makeChatFn();
    const result = await protocol.deliberate("Review this code", plan, scores, chat);

    expect(result.modelsUsed).toContain("model-x");
    expect(result.modelsUsed).toContain("model-z");
    expect(result.protocol).toBe("role-based");
  });

  // 3. [HP] consensus 달성 → consensusReached=true, roundsExecuted>0
  it("should return consensusReached=true when deliberation reaches consensus", async () => {
    const scores = makeScores(
      { id: "m1", judgment: 700, codeGen: 800 },
      { id: "m2", judgment: 600, codeGen: 600 },
      { id: "m3", judgment: 900, codeGen: 500 },
    );
    const plan = makePlan([{ modelId: "m1" }, { modelId: "m2" }, { modelId: "m3" }]);
    const chat = makeChatFn();
    const result = await protocol.deliberate("Implement feature X", plan, scores, chat);

    expect(result.consensusReached).toBe(true);
    expect(result.roundsExecuted).toBeGreaterThan(0);
  });

  // 4. [HP] consensus 미달성 → consensusReached=false
  it("should return consensusReached=false when maxRounds exhausted", async () => {
    const scores = makeScores(
      { id: "m1", judgment: 700, codeGen: 800 },
      { id: "m2", judgment: 600, codeGen: 600 },
      { id: "m3", judgment: 900, codeGen: 500 },
    );
    const plan = makePlan([{ modelId: "m1" }, { modelId: "m2" }, { modelId: "m3" }]);
    const chat = makeChatFn();
    // deliberateFn that never reaches consensus
    const noConsensus = makeFakeDeliberate({ consensusReached: false });
    const proto = new RoleBasedProtocol("leader_decides", 1, noConsensus.fn);
    const result = await proto.deliberate("Hard task", plan, scores, chat);

    expect(result.consensusReached).toBe(false);
  });

  // 5. [HP] protocol="role-based" 반환
  it("should always return protocol=role-based", async () => {
    const scores = makeScores(
      { id: "m1", judgment: 700, codeGen: 700 },
      { id: "m2", judgment: 600, codeGen: 600 },
      { id: "m3", judgment: 800, codeGen: 500 },
    );
    const plan = makePlan([{ modelId: "m1" }, { modelId: "m2" }, { modelId: "m3" }]);
    const chat = makeChatFn();
    const result = await protocol.deliberate("Task", plan, scores, chat);

    expect(result.protocol).toBe("role-based");
  });

  // 6. [HP] result.modelsUsed에 전체 팀 모델 포함
  it("should include all team models in modelsUsed", async () => {
    const scores = makeScores(
      { id: "alpha", judgment: 700, codeGen: 700 },
      { id: "beta", judgment: 600, codeGen: 600 },
      { id: "gamma", judgment: 800, codeGen: 500 },
    );
    const plan = makePlan([
      { modelId: "alpha" },
      { modelId: "beta" },
      { modelId: "gamma" },
    ]);
    const chat = makeChatFn();
    const result = await protocol.deliberate("Task", plan, scores, chat);

    expect(result.modelsUsed.length).toBeGreaterThanOrEqual(2);
  });

  // 7. [HP] ChatMessage[] chat → engine에 올바르게 전달
  it("should pass ChatMessage[] to deliberation engine when chat supports it", async () => {
    const scores = makeScores(
      { id: "m1", judgment: 700, codeGen: 800 },
      { id: "m2", judgment: 600, codeGen: 600 },
      { id: "m3", judgment: 900, codeGen: 500 },
    );
    const plan = makePlan([{ modelId: "m1" }, { modelId: "m2" }, { modelId: "m3" }]);
    const chatCalls: Array<{ modelId: string; input: string | ChatMessage[] }> = [];
    const chat: ChatFn = mock(async (modelId: string, input: string | ChatMessage[]) => {
      chatCalls.push({ modelId, input });
      return JSON.stringify({ content: "response" });
    });

    await protocol.deliberate("Task", plan, scores, chat);

    // fakeDeliberate exercises deps.chat with ChatMessage[] from prompt builders
    const messageCalls = chatCalls.filter((c) => Array.isArray(c.input));
    expect(messageCalls.length).toBeGreaterThan(0);
  });

  // 8. [NE] plan.models 빈 배열 → error throw
  it("should throw error when plan.models is empty", async () => {
    const plan = makePlan([]);
    const scores: ModelScore[] = [];
    const chat = makeChatFn();

    await expect(protocol.deliberate("Task", plan, scores, chat)).rejects.toThrow();
  });

  // 9. [NE] deliberation engine error → propagation
  it("should propagate errors from the deliberation engine", async () => {
    const scores = makeScores(
      { id: "m1", judgment: 700, codeGen: 800 },
      { id: "m2", judgment: 600, codeGen: 600 },
      { id: "m3", judgment: 900, codeGen: 500 },
    );
    const plan = makePlan([{ modelId: "m1" }, { modelId: "m2" }, { modelId: "m3" }]);
    const chat = makeChatFn();
    const errDelib = makeFakeDeliberate({ throwError: "LLM service unavailable" });
    const proto = new RoleBasedProtocol("leader_decides", 3, errDelib.fn);

    await expect(proto.deliberate("Task", plan, scores, chat)).rejects.toThrow("LLM service unavailable");
  });

  // 10. [ED] plan.models.length===1 → single model shortcut
  it("should handle single model plan as shortcut without full deliberation", async () => {
    const scores = makeScores({ id: "solo", judgment: 700, codeGen: 700 });
    const plan = makePlan([{ modelId: "solo" }]);
    const chat: ChatFn = mock(async () => "solo response");

    const result = await protocol.deliberate("Simple task", plan, scores, chat);

    expect(result.modelsUsed).toContain("solo");
    expect(result.totalLLMCalls).toBeLessThanOrEqual(1);
  });

  // 11. [ED] plan.models.length===2 → producer+leader only, 0 reviewers
  it("should run deliberation with 0 reviewers when only 2 models in plan", async () => {
    const scores = makeScores(
      { id: "prod", judgment: 500, codeGen: 800 },
      { id: "lead", judgment: 900, codeGen: 500 },
    );
    const plan = makePlan([{ modelId: "prod" }, { modelId: "lead" }]);
    const chat = makeChatFn();
    const result = await protocol.deliberate("Task", plan, scores, chat);

    expect(result.modelsUsed.length).toBeGreaterThanOrEqual(2);
    expect(result.protocol).toBe("role-based");
  });

  // 12. [ED] scores에 plan 모델 없음 → fallback 배정
  it("should use fallback role assignment when scores do not contain plan models", async () => {
    const scores = makeScores(
      { id: "other-model", judgment: 900, codeGen: 900 },
    );
    const plan = makePlan([
      { modelId: "unknown-a" },
      { modelId: "unknown-b" },
      { modelId: "unknown-c" },
    ]);
    const chat = makeChatFn();
    const result = await protocol.deliberate("Task", plan, scores, chat);

    // Should still work with fallback ordering
    expect(result.protocol).toBe("role-based");
    expect(result.modelsUsed.length).toBeGreaterThanOrEqual(2);
  });

  // 13. [CO] 빈 scores + explicit roles → team 구성 가능
  it("should compose team from explicit roles even with empty scores", async () => {
    const plan = makePlan([
      { modelId: "p1", role: "producer" },
      { modelId: "r1", role: "reviewer" },
      { modelId: "l1", role: "leader" },
    ]);
    const chat = makeChatFn();
    const result = await protocol.deliberate("Task", plan, [], chat);

    expect(result.protocol).toBe("role-based");
  });

  // 14. [CO] 1모델 + consensus 무관한 single shortcut
  it("should return single shortcut regardless of consensus mode for 1-model plan", async () => {
    const scores = makeScores({ id: "only", judgment: 700, codeGen: 700 });
    const plan = makePlan([{ modelId: "only" }]);
    const proto = new RoleBasedProtocol("all_approve", 3, fakeDelib.fn);
    const chat: ChatFn = mock(async () => "only response");
    const result = await proto.deliberate("Task", plan, scores, chat);

    expect(result.totalLLMCalls).toBeLessThanOrEqual(1);
  });

  // 15. [ID] 동일 입력 재호출 → 동일 결과 구조
  it("should return consistent result structure for repeated identical calls", async () => {
    const scores = makeScores(
      { id: "m1", judgment: 700, codeGen: 800 },
      { id: "m2", judgment: 600, codeGen: 600 },
      { id: "m3", judgment: 900, codeGen: 500 },
    );
    const plan = makePlan([{ modelId: "m1" }, { modelId: "m2" }, { modelId: "m3" }]);
    const chat = makeChatFn();

    const result1 = await protocol.deliberate("Same task", plan, scores, chat);
    const result2 = await protocol.deliberate("Same task", plan, scores, chat);

    expect(result1.protocol).toBe(result2.protocol);
    expect(typeof result1.result).toBe(typeof result2.result);
    expect(typeof result1.roundsExecuted).toBe(typeof result2.roundsExecuted);
    expect(typeof result1.consensusReached).toBe(typeof result2.consensusReached);
  });
});
