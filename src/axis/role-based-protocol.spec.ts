/**
 * DivergeSynthProtocol — Diverge-Synth deliberation wiring tests.
 *
 * SUT: DivergeSynthProtocol.deliberate()
 * Deps: deliberateFn injected via DI to avoid mock.module pollution.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { DivergeSynthProtocol } from "./wrappers";
import type { EnsemblePlan, ModelScore, ChatFn, ChatResult } from "./types";
import type { ChatMessage } from "../llm/types";
import type {
  TeamComposition,
  DeliberateInput,
  SharedContext,
  DeliberateOutput,
  TokenUsage,
} from "../deliberation/types";
import type { EngineDeps, EngineConfig } from "../deliberation/engine";

// -- Fake deliberate function (injected via DI) --

type FakeDeliberateOutput = {
  result: string;
  roundsExecuted: number;
  consensusReached: boolean;
  totalTokens: { input: number; output: number };
  totalLLMCalls: number;
  modelsUsed: string[];
};

/**
 * Create a fake deliberateFn that records calls and exercises the chat deps.
 * Each invocation calls chat through deps.buildWorkerMessages / buildLeaderMessages
 * to verify the full wiring chain, then returns a configurable DeliberateOutput.
 */
function makeFakeDeliberate(opts?: {
  consensusReached?: boolean;
  throwError?: string;
}) {
  const calls: Array<{
    team: TeamComposition;
    input: DeliberateInput;
    config?: EngineConfig;
  }> = [];

  const fn = async (
    team: TeamComposition,
    input: DeliberateInput,
    deps: EngineDeps,
    config?: EngineConfig,
  ): Promise<FakeDeliberateOutput> => {
    calls.push({ team, input, config });

    if (opts?.throwError) {
      throw new Error(opts.throwError);
    }

    // Build a minimal SharedContext to satisfy prompt builder signatures
    const ctx: SharedContext = { task: input.task, team, rounds: [] };

    // Exercise the chat path through prompt builders → deps.chat to verify wiring
    for (const w of team.workers) {
      const workerMsgs = deps.buildWorkerMessages(ctx);
      await deps.chat(w.model, workerMsgs);
    }

    const leaderMsgs = deps.buildLeaderMessages(ctx);
    await deps.chat(team.leader.model, leaderMsgs);

    const allModels = new Set([
      ...team.workers.map((w) => w.model),
      team.leader.model,
    ]);

    const consensusReached = opts?.consensusReached ?? true;

    return {
      result: "deliberation result",
      roundsExecuted: consensusReached ? 1 : (config?.maxRounds ?? 3),
      consensusReached,
      totalTokens: { input: allModels.size * 50, output: allModels.size * 50 },
      totalLLMCalls: allModels.size,
      modelsUsed: [...allModels],
    };
  };

  return { fn, calls };
}

// -- Fixtures --

function makeScores(
  ...entries: Array<{ id: string; judgment: number; codeGen: number }>
): ModelScore[] {
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

function makePlan(
  models: Array<{ modelId: string; role?: string }>,
): EnsemblePlan {
  return {
    models,
    strategy: "leader_decides",
    estimatedCost: 0.05,
    reason: "test plan",
  };
}

/** A ChatFn that records calls and returns ChatResult. */
function makeChatFn(): ChatFn & {
  calls: Array<{ modelId: string; input: string | ChatMessage[] }>;
} {
  const calls: Array<{ modelId: string; input: string | ChatMessage[] }> = [];
  const fn = mock(async (modelId: string, input: string | ChatMessage[]) => {
    calls.push({ modelId, input });
    return { content: "response", inputTokens: 10, outputTokens: 20 };
  }) as any;
  fn.calls = calls;
  return fn;
}

describe("DivergeSynthProtocol", () => {
  let protocol: DivergeSynthProtocol;
  let fakeDelib: ReturnType<typeof makeFakeDeliberate>;

  beforeEach(() => {
    fakeDelib = makeFakeDeliberate();
    protocol = new DivergeSynthProtocol("leader_decides", 3, fakeDelib.fn);
  });

  // 1. Auto-assign roles from scores (leader=JUDGMENT highest, rest=workers)
  it("should auto-assign roles from scores when plan.models lack role field", async () => {
    const scores = makeScores(
      { id: "model-a", judgment: 500, codeGen: 800 },
      { id: "model-b", judgment: 600, codeGen: 600 },
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

  // 2. Explicit roles from plan.models (worker/leader)
  it("should use explicit roles from plan.models when role field is present", async () => {
    const scores = makeScores(
      { id: "model-x", judgment: 500, codeGen: 500 },
      { id: "model-y", judgment: 500, codeGen: 500 },
      { id: "model-z", judgment: 500, codeGen: 500 },
    );
    const plan = makePlan([
      { modelId: "model-x", role: "worker" },
      { modelId: "model-y", role: "worker" },
      { modelId: "model-z", role: "leader" },
    ]);
    const chat = makeChatFn();

    const result = await protocol.deliberate("Review this code", plan, scores, chat);

    expect(result.modelsUsed).toContain("model-x");
    expect(result.modelsUsed).toContain("model-z");
    expect(result.protocol).toBe("diverge-synth");
  });

  // 3. Consensus reached
  it("should return consensusReached=true when deliberation reaches consensus", async () => {
    const scores = makeScores(
      { id: "m1", judgment: 700, codeGen: 800 },
      { id: "m2", judgment: 600, codeGen: 600 },
      { id: "m3", judgment: 900, codeGen: 500 },
    );
    const plan = makePlan([
      { modelId: "m1" },
      { modelId: "m2" },
      { modelId: "m3" },
    ]);
    const chat = makeChatFn();

    const result = await protocol.deliberate("Implement feature X", plan, scores, chat);

    expect(result.consensusReached).toBe(true);
    expect(result.roundsExecuted).toBeGreaterThan(0);
  });

  // 4. Consensus not reached (maxRounds exhausted)
  it("should return consensusReached=false when maxRounds exhausted", async () => {
    const scores = makeScores(
      { id: "m1", judgment: 700, codeGen: 800 },
      { id: "m2", judgment: 600, codeGen: 600 },
      { id: "m3", judgment: 900, codeGen: 500 },
    );
    const plan = makePlan([
      { modelId: "m1" },
      { modelId: "m2" },
      { modelId: "m3" },
    ]);
    const chat = makeChatFn();
    const noConsensus = makeFakeDeliberate({ consensusReached: false });
    const proto = new DivergeSynthProtocol("leader_decides", 1, noConsensus.fn);

    const result = await proto.deliberate("Hard task", plan, scores, chat);

    expect(result.consensusReached).toBe(false);
  });

  // 5. protocol="diverge-synth"
  it("should always return protocol=diverge-synth", async () => {
    const scores = makeScores(
      { id: "m1", judgment: 700, codeGen: 700 },
      { id: "m2", judgment: 600, codeGen: 600 },
      { id: "m3", judgment: 800, codeGen: 500 },
    );
    const plan = makePlan([
      { modelId: "m1" },
      { modelId: "m2" },
      { modelId: "m3" },
    ]);
    const chat = makeChatFn();

    const result = await protocol.deliberate("Task", plan, scores, chat);

    expect(result.protocol).toBe("diverge-synth");
  });

  // 6. modelsUsed includes all team models
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

    expect(result.modelsUsed).toContain("alpha");
    expect(result.modelsUsed).toContain("beta");
    expect(result.modelsUsed).toContain("gamma");
    expect(result.modelsUsed.length).toBe(3);
  });

  // 7. ChatMessage[] passed to engine
  it("should pass ChatMessage[] to deliberation engine when chat supports it", async () => {
    const scores = makeScores(
      { id: "m1", judgment: 700, codeGen: 800 },
      { id: "m2", judgment: 600, codeGen: 600 },
      { id: "m3", judgment: 900, codeGen: 500 },
    );
    const plan = makePlan([
      { modelId: "m1" },
      { modelId: "m2" },
      { modelId: "m3" },
    ]);
    const chatCalls: Array<{ modelId: string; input: string | ChatMessage[] }> = [];
    const chat: ChatFn = mock(
      async (modelId: string, input: string | ChatMessage[]) => {
        chatCalls.push({ modelId, input });
        return { content: "response", inputTokens: 10, outputTokens: 20 };
      },
    );

    await protocol.deliberate("Task", plan, scores, chat);

    // fakeDeliberate exercises deps.chat with ChatMessage[] from prompt builders
    const messageCalls = chatCalls.filter((c) => Array.isArray(c.input));
    expect(messageCalls.length).toBeGreaterThan(0);
  });

  // 8. Empty plan.models throws
  it("should throw error when plan.models is empty", async () => {
    const plan = makePlan([]);
    const scores: ModelScore[] = [];
    const chat = makeChatFn();

    await expect(
      protocol.deliberate("Task", plan, scores, chat),
    ).rejects.toThrow();
  });

  // 9. Error propagation
  it("should propagate errors from the deliberation engine", async () => {
    const scores = makeScores(
      { id: "m1", judgment: 700, codeGen: 800 },
      { id: "m2", judgment: 600, codeGen: 600 },
      { id: "m3", judgment: 900, codeGen: 500 },
    );
    const plan = makePlan([
      { modelId: "m1" },
      { modelId: "m2" },
      { modelId: "m3" },
    ]);
    const chat = makeChatFn();
    const errDelib = makeFakeDeliberate({ throwError: "LLM service unavailable" });
    const proto = new DivergeSynthProtocol("leader_decides", 3, errDelib.fn);

    await expect(
      proto.deliberate("Task", plan, scores, chat),
    ).rejects.toThrow("LLM service unavailable");
  });

  // 10. Single model runs through deliberation (engine handles single-model shortcut)
  it("should run single model through deliberation protocol", async () => {
    const scores = makeScores({ id: "solo", judgment: 700, codeGen: 700 });
    const plan = makePlan([{ modelId: "solo" }]);
    const chat = makeChatFn();

    const result = await protocol.deliberate("Simple task", plan, scores, chat);

    expect(result.modelsUsed).toContain("solo");
    expect(result.protocol).toBe("diverge-synth");
    // Deliberation was invoked (not bypassed)
    expect(fakeDelib.calls.length).toBeGreaterThan(0);
  });

  // 11. 2 models (1 worker + 1 leader)
  it("should run deliberation with 1 worker + 1 leader when 2 models in plan", async () => {
    const scores = makeScores(
      { id: "worker-m", judgment: 500, codeGen: 800 },
      { id: "leader-m", judgment: 900, codeGen: 500 },
    );
    const plan = makePlan([{ modelId: "worker-m" }, { modelId: "leader-m" }]);
    const chat = makeChatFn();

    const result = await protocol.deliberate("Task", plan, scores, chat);

    expect(result.modelsUsed.length).toBe(2);
    expect(result.protocol).toBe("diverge-synth");
  });

  // 12. Scores missing plan models → fallback
  it("should use fallback role assignment when scores do not contain plan models", async () => {
    const scores = makeScores({
      id: "other-model",
      judgment: 900,
      codeGen: 900,
    });
    const plan = makePlan([
      { modelId: "unknown-a" },
      { modelId: "unknown-b" },
      { modelId: "unknown-c" },
    ]);
    const chat = makeChatFn();

    const result = await protocol.deliberate("Task", plan, scores, chat);

    expect(result.protocol).toBe("diverge-synth");
    expect(result.modelsUsed.length).toBeGreaterThanOrEqual(2);
  });

  // 13. Empty scores + explicit roles
  it("should compose team from explicit roles even with empty scores", async () => {
    const plan = makePlan([
      { modelId: "w1", role: "worker" },
      { modelId: "w2", role: "worker" },
      { modelId: "l1", role: "leader" },
    ]);
    const chat = makeChatFn();

    const result = await protocol.deliberate("Task", plan, [], chat);

    expect(result.protocol).toBe("diverge-synth");
  });

  // 14. Single model goes through deliberation (Engine handles single-model shortcut)
  it("should run deliberation even for 1-model plan", async () => {
    const scores = makeScores({ id: "only", judgment: 700, codeGen: 700 });
    const plan = makePlan([{ modelId: "only" }]);
    const proto = new DivergeSynthProtocol("leader_decides", 3, fakeDelib.fn);
    const chat = makeChatFn();

    const result = await proto.deliberate("Task", plan, scores, chat);

    expect(result.protocol).toBe("diverge-synth");
    // Single model acts as both worker and leader
    expect(fakeDelib.calls.length).toBe(1);
  });

  // 15. Idempotent results
  it("should return consistent result structure for repeated identical calls", async () => {
    const scores = makeScores(
      { id: "m1", judgment: 700, codeGen: 800 },
      { id: "m2", judgment: 600, codeGen: 600 },
      { id: "m3", judgment: 900, codeGen: 500 },
    );
    const plan = makePlan([
      { modelId: "m1" },
      { modelId: "m2" },
      { modelId: "m3" },
    ]);
    const chat = makeChatFn();

    const result1 = await protocol.deliberate("Same task", plan, scores, chat);
    const result2 = await protocol.deliberate("Same task", plan, scores, chat);

    expect(result1.protocol).toBe(result2.protocol);
    expect(typeof result1.result).toBe(typeof result2.result);
    expect(typeof result1.roundsExecuted).toBe(typeof result2.roundsExecuted);
    expect(typeof result1.consensusReached).toBe(typeof result2.consensusReached);
  });
});
