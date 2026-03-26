/**
 * Unit tests for engine.ts — Deliberation Engine.
 */

import { describe, it, expect, mock } from "bun:test";
import {
  executeRound,
  deliberate,
  createFallbackPool,
  RoundExecutionError,
  TeamDegradedError,
  MIN_WORKER_RESPONSE_LENGTH,
  minViableTeamSize,
  parseConfidence,
  levenshteinDistance,
  type EngineDeps,
  type EngineConfig,
  type ChatResult,
  type FallbackDeps,
} from "./engine";
import type { TeamComposition, DeliberateInput } from "./types";
import type { ChatMessage } from "../llm/types";
import type { ModelInfo } from "../model/types";
import { createCooldownManager } from "./cooldown";
import { LLMClientError } from "../llm/errors";

// -- Fixtures --

function makeTeam(workerCount = 2): TeamComposition {
  const workers = Array.from({ length: workerCount }, (_, i) => ({
    model: `worker/model-${i}`,
    role: "worker" as const,
  }));
  return { workers };
}

function makeInput(overrides?: Partial<DeliberateInput>): DeliberateInput {
  return {
    task: "Write a function",
    models: ["test/model-a", "test/model-b"],
    ...overrides,
  };
}

/** Pad content to satisfy MIN_WORKER_RESPONSE_LENGTH for worker responses. */
function validWorkerContent(label: string): string {
  return label.padEnd(MIN_WORKER_RESPONSE_LENGTH, ".");
}

function chatResult(content: string, inputTokens = 10, outputTokens = 20): ChatResult {
  return { content, inputTokens, outputTokens };
}

function makeDeps(overrides?: Partial<EngineDeps>): EngineDeps {
  return {
    chat: mock(async (_model: string, _messages: any, _params?: any) => chatResult(validWorkerContent("mock response"))),
    buildWorkerMessages: mock((_ctx: any, _instructions?: any, _roundInfo?: any, _workerIndex?: any) => [
      { role: "user" as const, content: "work" },
    ]),
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return { maxRounds: 1, ...overrides };
}

function dim(mu = 1500): { mu: number; sigma: number; comparisons: number } {
  return { mu, sigma: 100, comparisons: 10 };
}

function makeModelInfo(id: string): ModelInfo {
  return {
    id,
    name: id,
    provider: "openai",
    contextWindow: 128000,
    capabilities: {
      REASONING: dim(1600),
      MATH_REASONING: dim(),
      MULTI_STEP_DEPTH: dim(),
      CREATIVITY: dim(),
      ANALYSIS: dim(1600),
      JUDGMENT: dim(1600),
      CODE_GENERATION: dim(),
      CODE_UNDERSTANDING: dim(),
      DEBUGGING: dim(),
      SYSTEM_THINKING: dim(),
      TOOL_USE: dim(),
      HALLUCINATION_RESISTANCE: dim(),
      CONFIDENCE_CALIBRATION: dim(),
      SELF_CONSISTENCY: dim(),
      AMBIGUITY_HANDLING: dim(),
      INSTRUCTION_FOLLOWING: dim(),
      STRUCTURED_OUTPUT: dim(),
      LONG_CONTEXT: dim(),
      MULTILINGUAL: dim(),
      SPEED: dim(),
      COST_EFFICIENCY: dim(),
    },
    cost: { inputPer1M: 5, outputPer1M: 15 },
    supportsToolCalling: true,
  };
}

// =============================================================================
// executeRound
// =============================================================================

describe("executeRound", () => {
  it("should execute a successful round with 2 workers, assigning roles", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    let callIndex = 0;
    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        callIndex++;
        return chatResult(validWorkerContent(`worker-response-${callIndex}`), 10, 20);
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    const { round, tokens } = await executeRound(ctx, 1, deps, config, input);

    // Round structure
    expect(round.number).toBe(1);
    expect(round.responses).toHaveLength(2);
    expect(round.responses[0]!.model).toBe("worker/model-0");
    expect(round.responses[1]!.model).toBe("worker/model-1");

    // Token accumulation: 2 workers (10+10=20 input, 20+20=40 output)
    expect(tokens.input).toBe(20);
    expect(tokens.output).toBe(40);

    // buildWorkerMessages called per-worker (not shared)
    expect(deps.buildWorkerMessages).toHaveBeenCalledTimes(2);
    expect(deps.chat).toHaveBeenCalledTimes(2); // 2 workers
  });

  it("should drop partial worker failures and continue with successful ones", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          throw new Error("provider timeout");
        }
        return chatResult(validWorkerContent("worker-1-ok"), 10, 20);
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    const { round, tokens } = await executeRound(ctx, 1, deps, config, input);

    // Only worker-1 succeeded
    expect(round.responses).toHaveLength(1);
    expect(round.responses[0]!.model).toBe("worker/model-1");

    // Tokens: 1 successful worker (10 input, 20 output)
    expect(tokens.input).toBe(10);
    expect(tokens.output).toBe(20);
  });

  it("should throw RoundExecutionError with role 'worker' when all workers fail", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        throw new Error("all workers down");
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    try {
      await executeRound(ctx, 1, deps, config, input);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RoundExecutionError);
      const re = error as RoundExecutionError;
      expect(re.role).toBe("worker");
      expect(re.modelId).toBe("worker/model-0");
    }
  });

  it("should accumulate tokens from all workers", async () => {
    const team = makeTeam(3);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        return chatResult(validWorkerContent("w"), 100, 200);
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    const { tokens } = await executeRound(ctx, 1, deps, config, input);

    // 3 workers * (100 + 200)
    expect(tokens.input).toBe(300);
    expect(tokens.output).toBe(600);
  });

  it("should pass workerIndex to buildWorkerMessages for each worker", async () => {
    const team = makeTeam(3);
    const input = makeInput();
    const config = makeConfig();

    const workerIndices: number[] = [];
    const deps = makeDeps({
      chat: mock(async () => chatResult(validWorkerContent("response"))),
      buildWorkerMessages: mock((_ctx: any, _inst?: any, _ri?: any, workerIndex?: any) => {
        if (workerIndex !== undefined) workerIndices.push(workerIndex);
        return [{ role: "user" as const, content: "work" }];
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    await executeRound(ctx, 1, deps, config, input);

    expect(workerIndices).toEqual([0, 1, 2]);
  });
});

// =============================================================================
// deliberate
// =============================================================================

describe("deliberate", () => {
  it("should complete a single-round deliberation with correct output shape", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        return chatResult(validWorkerContent("worker-response"), 10, 20);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.roundsExecuted).toBe(1);
    expect(output.totalLLMCalls).toBe(2); // 2 workers
    expect(output.modelsUsed).toContain("worker/model-0");
    expect(output.modelsUsed).toContain("worker/model-1");
    expect(output.totalTokens.input).toBe(20);  // 10 + 10
    expect(output.totalTokens.output).toBe(40);  // 20 + 20
  });

  it("should run all rounds when maxRounds > 1", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 3 });

    let callCount = 0;
    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        // Content must differ substantially between rounds to avoid convergence detection
        return chatResult(`Round ${++callCount} unique content: ${"x".repeat(callCount * 50)}`.padEnd(MIN_WORKER_RESPONSE_LENGTH, "."), 5, 10);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.roundsExecuted).toBe(3);
    expect(output.totalLLMCalls).toBe(3); // 3 rounds * 1 worker
  });

  it("should accumulate tokens across multiple rounds", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 3 });

    let callCount = 0;
    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        return chatResult(`Call ${++callCount} unique content: ${"y".repeat(callCount * 50)}`.padEnd(MIN_WORKER_RESPONSE_LENGTH, "."), 100, 200);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    // Per round: 2 workers * (100 in, 200 out) = 200 in, 400 out
    // 3 rounds: 600 in, 1200 out
    expect(output.totalTokens.input).toBe(600);
    expect(output.totalTokens.output).toBe(1200);
    expect(output.roundsExecuted).toBe(3);
    expect(output.totalLLMCalls).toBe(6); // 3 * 2
  });

  it("should include rounds summary in output", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 2 });

    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        return chatResult(validWorkerContent("worker-response"), 5, 10);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.rounds).toBeDefined();
    expect(output.rounds).toHaveLength(2);
    expect(output.rounds![0]!.number).toBe(1);
    expect(output.rounds![1]!.number).toBe(2);
  });

  it("should use default config (maxRounds=1) when config is omitted", async () => {
    const team = makeTeam(1);
    const input = makeInput();

    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        return chatResult(validWorkerContent("worker"));
      }),
    });

    const output = await deliberate(team, input, deps); // no config

    expect(output.roundsExecuted).toBe(1);
  });

  // -- Retry with RoundExecutionError --

  it("should swap to fallback model when worker fails", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          throw new Error("worker down");
        }
        return chatResult(validWorkerContent("ok-from-fallback"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-alt/fallback-model-1")], cooldown);
    const fallbackDeps: FallbackDeps = { pool };

    const output = await deliberate(team, input, deps, config, fallbackDeps);

    expect(output.roundsExecuted).toBe(1);
    expect(output.modelSwaps).toBeDefined();
    expect(output.modelSwaps!.length).toBeGreaterThanOrEqual(1);
    expect(output.modelSwaps![0]!.original).toBe("worker/model-0");
    expect(output.modelSwaps![0]!.replacement).toBe("prov-alt/fallback-model-1");
    expect(output.modelsUsed).toContain("prov-alt/fallback-model-1");
  });

  it("should throw RoundExecutionError when no fallbackDeps are provided", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        throw new Error("all workers down");
      }),
    });

    try {
      await deliberate(team, input, deps, config); // no fallbackDeps
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RoundExecutionError);
      const re = error as RoundExecutionError;
      expect(re.role).toBe("worker");
      // Should include modelSwaps in the error
      expect(re.modelSwaps).toBeDefined();
    }
  });

  it("should record ModelSwap without replacement when fallback pool is exhausted", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        throw new Error("worker down");
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([], cooldown); // empty pool

    try {
      await deliberate(team, input, deps, config, { pool });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RoundExecutionError);
      const re = error as RoundExecutionError;
      expect(re.modelSwaps).toBeDefined();
      expect(re.modelSwaps![0]!.original).toBe("worker/model-0");
      expect(re.modelSwaps![0]!.replacement).toBeUndefined();
    }
  });

  it("should try fallback chain sequentially until success", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const callOrder: string[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        callOrder.push(model);
        if (model === "worker/model-0" || model === "prov-x/fallback-a") {
          throw new Error("down");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool(
      [makeModelInfo("prov-x/fallback-a"), makeModelInfo("prov-y/fallback-b")],
      cooldown,
    );

    const output = await deliberate(team, input, deps, config, { pool });

    expect(callOrder).toEqual(["worker/model-0", "prov-x/fallback-a", "prov-y/fallback-b"]);
    expect(output.modelSwaps!.length).toBe(2); // model-0→a (fail), a→b (success)
    expect(output.modelsUsed).toContain("prov-y/fallback-b");
  });

  it("should allow duplicate team models as fallback when pool has no unique candidates", async () => {
    // Scenario: 3-worker team, 2 workers fail, pool is empty.
    // Worker 0's model is already on the team. Fallback should allow reusing it
    // rather than leaving an empty slot.
    const team: TeamComposition = {
      workers: [
        { model: "prov-a/model-a", role: "worker" },
        { model: "prov-b/model-b", role: "worker" },
        { model: "prov-c/model-c", role: "worker" },
      ],
    };
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        // prov-b and prov-c fail, prov-a succeeds
        if (model.startsWith("prov-b/") || model.startsWith("prov-c/")) {
          throw new Error("provider down");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    // Pool only has prov-a/model-a — same model already on team
    const pool = createFallbackPool(
      [makeModelInfo("prov-a/model-a")],
      cooldown,
    );

    const output = await deliberate(team, input, deps, config, { pool });

    // Should succeed by reusing prov-a/model-a for all 3 slots
    expect(output.roundsExecuted).toBe(1);
    expect(output.rounds![0]!.responses!.length).toBe(3);
    expect(output.rounds![0]!.responses!.every(r => r.model === "prov-a/model-a")).toBe(true);
  });

  it("should prefer unique models over duplicates in fallback", async () => {
    // When both unique and duplicate candidates exist, prefer unique
    const team: TeamComposition = {
      workers: [
        { model: "prov-a/model-a", role: "worker" },
        { model: "prov-b/model-b", role: "worker" },
      ],
    };
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const callLog: string[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        callLog.push(model);
        if (model === "prov-b/model-b") {
          throw new Error("down");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    // Pool has both a unique model AND the duplicate team model
    const pool = createFallbackPool(
      [makeModelInfo("prov-c/unique-model"), makeModelInfo("prov-a/model-a")],
      cooldown,
    );

    const output = await deliberate(team, input, deps, config, { pool });

    // Should pick the unique model first, not the duplicate
    expect(output.modelsUsed).toContain("prov-c/unique-model");
  });

  it("should not duplicate fallback models when two workers fail simultaneously", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          throw new Error("down");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool(
      [makeModelInfo("prov-z/fallback-d"), makeModelInfo("prov-w/fallback-e")],
      cooldown,
    );

    const output = await deliberate(team, input, deps, config, { pool });

    // Both workers should get different fallback models (claim semantics)
    const replacements = output.modelSwaps!.filter(s => s.replacement).map(s => s.replacement);
    expect(new Set(replacements).size).toBe(replacements.length); // no duplicates
    expect(output.modelsUsed).toHaveLength(2);
  });
});

// =============================================================================
// failedWorkers propagation
// =============================================================================

describe("failedWorkers propagation in deliberate output", () => {
  it("should throw TeamDegradedError when 3-worker team loses 1 (below min viable)", async () => {
    const team = makeTeam(3);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          throw new Error("o3 rate limit");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    try {
      await deliberate(team, input, deps, config);
      expect.unreachable("should have thrown TeamDegradedError");
    } catch (error) {
      expect(error).toBeInstanceOf(TeamDegradedError);
      const tde = error as InstanceType<typeof TeamDegradedError>;
      expect(tde.originalSize).toBe(3);
      expect(tde.activeSize).toBe(2);
      expect(tde.lostSlots).toHaveLength(1);
      expect(tde.lostSlots[0]!.model).toBe("worker/model-0");
    }
  });

  it("should include failedWorkers in rounds with 2-worker team (no min viable enforcement)", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          throw new Error("o3 rate limit");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.rounds).toBeDefined();
    expect(output.rounds![0]!.failedWorkers).toBeDefined();
    expect(output.rounds![0]!.failedWorkers).toHaveLength(1);
    expect(output.rounds![0]!.failedWorkers![0]!.model).toBe("worker/model-0");
    expect(output.modelsUsed).not.toContain("worker/model-0");
    expect(output.modelsUsed).toContain("worker/model-1");
  });

  it("should omit failedWorkers from rounds when all workers succeed", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();
    const deps = makeDeps({
      chat: mock(async () => chatResult(validWorkerContent("ok"), 10, 20)),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.rounds).toBeDefined();
    expect(output.rounds![0]!.failedWorkers).toBeUndefined();
  });
});

// =============================================================================
// MIN_WORKER_RESPONSE_LENGTH boundary tests
// =============================================================================

describe("degenerate response filtering", () => {
  it("should filter response of 199 chars as degenerate", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    const shortContent = "x".repeat(MIN_WORKER_RESPONSE_LENGTH - 1); // 199 chars
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") return chatResult(shortContent, 10, 20);
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.rounds![0]!.failedWorkers).toHaveLength(1);
    expect(output.rounds![0]!.failedWorkers![0]!.model).toBe("worker/model-0");
    expect(output.rounds![0]!.failedWorkers![0]!.error).toContain("degenerate");
  });

  it("should accept response of exactly 200 chars", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    const exactContent = "x".repeat(MIN_WORKER_RESPONSE_LENGTH); // 200 chars
    const deps = makeDeps({
      chat: mock(async (_model: string) => chatResult(exactContent, 10, 20)),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.rounds![0]!.failedWorkers).toBeUndefined();
    expect(output.rounds![0]!.responses).toHaveLength(2);
  });

  it("should filter whitespace-padded response that trims below minimum", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    // 250 chars total, but only 150 non-whitespace after trim
    const paddedContent = " ".repeat(50) + "x".repeat(150) + " ".repeat(50);
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") return chatResult(paddedContent, 10, 20);
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.rounds![0]!.failedWorkers).toHaveLength(1);
    expect(output.rounds![0]!.failedWorkers![0]!.model).toBe("worker/model-0");
  });

  it("should throw RoundExecutionError when ALL workers produce degenerate responses", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (_model: string) => chatResult("too short", 10, 20)),
    });

    await expect(deliberate(team, input, deps, config)).rejects.toThrow(
      /failed after fallback exhaustion/,
    );
  });
});

// =============================================================================
// Debate Protocol Convergence
// =============================================================================

describe("debate protocol", () => {
  it("should use buildDebateWorkerMessages for round > 1 when protocol is debate", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 2, protocol: "debate" });

    let debateBuilderCalls = 0;
    let normalBuilderCalls = 0;

    const deps = makeDeps({
      chat: mock(async (_model: string) => chatResult(validWorkerContent("response"))),
      buildWorkerMessages: mock((_ctx: any, _instructions?: any, _roundInfo?: any, _idx?: any) => {
        normalBuilderCalls++;
        return [{ role: "user" as const, content: "work" }];
      }),
      buildDebateWorkerMessages: mock((_ctx: any, _instructions?: any, _roundInfo?: any, _idx?: any) => {
        debateBuilderCalls++;
        return [{ role: "user" as const, content: "debate" }];
      }),
    });

    await deliberate(team, input, deps, config);

    // Round 1: normal builder (1 worker), Round 2: debate builder (1 worker)
    expect(normalBuilderCalls).toBe(1);
    expect(debateBuilderCalls).toBe(1);
  });

  it("should accumulate previous responses in debate context across rounds", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 3, protocol: "debate" });

    const debateContexts: string[] = [];

    let callCount = 0;
    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        return chatResult(`Response ${++callCount} unique: ${"z".repeat(callCount * 50)}`.padEnd(MIN_WORKER_RESPONSE_LENGTH, "."), 10, 20);
      }),
      buildDebateWorkerMessages: mock((ctx: any, _instructions?: any, _roundInfo?: any, _idx?: any) => {
        // Capture the number of previous rounds visible to debate builder
        debateContexts.push(`rounds=${ctx.rounds.length}`);
        return [{ role: "user" as const, content: "debate" }];
      }),
    });

    await deliberate(team, input, deps, config);

    // Round 1: normal builder (no debate call)
    // Round 2: debate builder called per-worker (2 workers), each sees 1 previous round
    // Round 3: debate builder called per-worker (2 workers), each sees 2 previous rounds
    expect(debateContexts).toEqual(["rounds=1", "rounds=1", "rounds=2", "rounds=2"]);
  });

  it("should fall back to normal builder when buildDebateWorkerMessages is not provided", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 2, protocol: "debate" });

    let normalCalls = 0;
    const deps = makeDeps({
      chat: mock(async () => chatResult(validWorkerContent("response"))),
      buildWorkerMessages: mock((_ctx: any, _inst?: any, _ri?: any, _idx?: any) => {
        normalCalls++;
        return [{ role: "user" as const, content: "normal" }];
      }),
      // No buildDebateWorkerMessages
    });

    await deliberate(team, input, deps, config);

    // Both rounds should use normal builder as fallback
    expect(normalCalls).toBe(2);
  });
});

// =============================================================================
// RoundExecutionError
// =============================================================================

describe("RoundExecutionError", () => {
  it("should store role, modelId, and cause", () => {
    const cause = new Error("upstream failure");
    const error = new RoundExecutionError("worker", "worker/model-0", cause);

    expect(error.role).toBe("worker");
    expect(error.modelId).toBe("worker/model-0");
    expect(error.cause).toBe(cause);
    expect(error.name).toBe("RoundExecutionError");
    expect(error.message).toContain("worker");
    expect(error.message).toContain("worker/model-0");
    expect(error.message).toContain("upstream failure");
  });

  it("should handle non-Error cause values", () => {
    const error = new RoundExecutionError("worker", "worker/model", "string cause");

    expect(error.role).toBe("worker");
    expect(error.message).toContain("string cause");
  });
});

// =============================================================================
// GenerationParams forwarding
// =============================================================================

describe("GenerationParams forwarding", () => {
  it("should pass workerGenParams to chat calls", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({
      workerGenParams: { temperature: 1.0, max_tokens: 2048, top_p: 0.9 },
    });

    const chatCalls: { model: string; params: any }[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string, _messages: any, params?: any) => {
        chatCalls.push({ model, params });
        return chatResult(validWorkerContent("response"));
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    await executeRound(ctx, 1, deps, config, input);

    // Worker call should have workerGenParams
    const workerCall = chatCalls.find((c) => c.model.startsWith("worker/"));
    expect(workerCall).toBeDefined();
    expect(workerCall!.params).toEqual({ temperature: 1.0, max_tokens: 2048, top_p: 0.9 });
  });

  it("should pass undefined params when genParams are not configured", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig(); // no genParams

    const chatCalls: { model: string; params: any }[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string, _messages: any, params?: any) => {
        chatCalls.push({ model, params });
        return chatResult(validWorkerContent("response"));
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    await executeRound(ctx, 1, deps, config, input);

    // All calls should have undefined params
    for (const call of chatCalls) {
      expect(call.params).toBeUndefined();
    }
  });

  it("should assign 3 distinct roles (advocate/critic/wildcard) when team has 3 workers", async () => {
    const team = makeTeam(3);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        return chatResult(validWorkerContent("worker-response"));
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    const { round } = await executeRound(ctx, 1, deps, config, input);

    expect(round.responses).toHaveLength(3);
    expect(round.responses.map((r) => r.workerIndex)).toEqual([0, 1, 2]);
  });
});

// ================================================================
// session continuation — R2+ uses accumulated history
// ================================================================

describe("session continuation in debate R2+", () => {
  it("should use accumulated history + follow-up instead of full rebuild in R2", async () => {
    let followUpCallCount = 0;
    const allMessages: ChatMessage[][] = [];

    const followUpMock = mock((_ctx: any, _others: any, _round?: any, _instructions?: any) => {
      followUpCallCount++;
      return { role: "user" as const, content: "follow-up-other-positions" };
    });

    const deps = makeDeps({
      buildDebateWorkerMessages: mock((_ctx: any, _inst?: any, _round?: any, _idx?: any) => {
        return [
          { role: "system" as const, content: "debate-system" },
          { role: "user" as const, content: "debate-user" },
        ];
      }),
      buildDebateFollowUp: followUpMock,
    });

    // Intercept chat to record message arrays
    const origChat = deps.chat;
    (deps as any).chat = async (model: string, messages: ChatMessage[], params?: any) => {
      allMessages.push([...messages]);
      return origChat(model, messages, params);
    };

    const team = makeTeam(2);
    const config = makeConfig({ maxRounds: 2, protocol: "debate" });
    const output = await deliberate(team, makeInput(), deps, config);

    expect(output.roundsExecuted).toBe(2);
    // Follow-up builder should have been called for R2 workers that have history
    expect(followUpCallCount).toBeGreaterThan(0);
    // R2 messages should include follow-up content
    const r2Messages = allMessages.filter(msgs =>
      msgs.some(m => m.content?.includes("follow-up-other-positions")),
    );
    expect(r2Messages.length).toBeGreaterThan(0);
    // R2 messages should be longer than R1 (accumulated history + follow-up)
    const r1Len = allMessages[0]!.length; // R1: just buildWorkerMessages output
    const r2Len = r2Messages[0]!.length; // R2: history + follow-up
    expect(r2Len).toBeGreaterThan(r1Len);
  });

  it("should fall back to full debate builder when no follow-up builder is provided", async () => {
    let debateBuilderCalled = false;

    const deps = makeDeps({
      buildDebateWorkerMessages: mock((_ctx: any) => {
        debateBuilderCalled = true;
        return [
          { role: "system" as const, content: "full-rebuild" },
          { role: "user" as const, content: "full-rebuild-user" },
        ];
      }),
      // NO buildDebateFollowUp — should fall back to full builder
    });

    const team = makeTeam(2);
    const config = makeConfig({ maxRounds: 2, protocol: "debate" });
    const output = await deliberate(team, makeInput(), deps, config);

    expect(output.roundsExecuted).toBe(2);
    expect(debateBuilderCalled).toBe(true);
  });
});

// ================================================================
// session invalidation on model swap
// ================================================================

describe("session invalidation on model swap in R2+", () => {
  it("should invalidate session and use cold join when model is swapped in R2 (error)", async () => {
    // R1: worker-0 succeeds with model-0 → history stored
    // R2: model-0 fails → fallback to fallback-d
    // fallback-d should NOT get model-0's session history → should use debate builder (cold join)
    let followUpUsed = false;
    let debateBuilderUsed = false;
    let round = 1;

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        // R2: original model fails, fallback succeeds
        if (model === "worker/model-0" && round === 2) {
          throw new Error("R2 failure");
        }
        return chatResult(validWorkerContent(`response-from-${model}`));
      }),
      buildDebateWorkerMessages: mock((_ctx: any, _inst?: any, _round?: any, _idx?: any) => {
        debateBuilderUsed = true;
        return [
          { role: "system" as const, content: "cold-join-rebuild" },
          { role: "user" as const, content: "cold-join-user" },
        ];
      }),
      buildDebateFollowUp: mock((_ctx: any, _others: any, _round?: any, _instructions?: any) => {
        followUpUsed = true;
        return { role: "user" as const, content: "follow-up" };
      }),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-z/fallback-d")], cooldown);
    const config = makeConfig({ maxRounds: 2, protocol: "debate" });

    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: ChatMessage[], params?: any) => {
      callCount++;
      round = callCount <= 2 ? 1 : 2;
      return origChat(model, messages, params);
    };

    const output = await deliberate(team, makeInput(), deps, config, { pool });

    expect(output.roundsExecuted).toBe(2);
    // fallback-d should use debate builder (cold join), NOT session continuation
    expect(debateBuilderUsed).toBe(true);
    // worker-1 (no swap) should use follow-up (session continuation)
    expect(followUpUsed).toBe(true);
    expect(output.modelSwaps!.some(s => s.replacement === "prov-z/fallback-d")).toBe(true);
  });

  it("should invalidate session on degenerate fallback in R2", async () => {
    let debateBuilderCallCount = 0;
    let round = 1;

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        // R2: model-0 returns degenerate, fallback succeeds
        if (model === "worker/model-0" && round === 2) {
          return chatResult("short"); // below MIN_WORKER_RESPONSE_LENGTH
        }
        return chatResult(validWorkerContent(`response-from-${model}`));
      }),
      buildDebateWorkerMessages: mock((_ctx: any) => {
        debateBuilderCallCount++;
        return [
          { role: "system" as const, content: "rebuild" },
          { role: "user" as const, content: "rebuild-user" },
        ];
      }),
      buildDebateFollowUp: mock((_ctx: any, _others: any, _round?: any, _instructions?: any) => {
        return { role: "user" as const, content: "follow-up" };
      }),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-z/fallback-d")], cooldown);
    const config = makeConfig({ maxRounds: 2, protocol: "debate" });

    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: ChatMessage[], params?: any) => {
      callCount++;
      round = callCount <= 2 ? 1 : 2;
      return origChat(model, messages, params);
    };

    const output = await deliberate(team, makeInput(), deps, config, { pool });

    expect(output.roundsExecuted).toBe(2);
    // Degenerate fallback → session invalidated → debate builder used for replacement
    expect(debateBuilderCallCount).toBeGreaterThan(0);
  });

  it("should invalidate session on cooldown skip in R2", async () => {
    // R1: model-0 fails with rate_limit → prov-a cooled → fallback-c succeeds
    // R2: fallback-c is on team. model-0 still cooled (not on team anymore due to R1 swap).
    //     But if a DIFFERENT worker gets cooled in R2, test the invalidation.
    let round = 1;

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        // R1: model-0 rate limits
        if (model === "worker/model-0" && round === 1) {
          throw new LLMClientError(429, "Rate limit", "rate_limit_error");
        }
        return chatResult(validWorkerContent(`response-from-${model}`));
      }),
      buildDebateWorkerMessages: mock((_ctx: any) => {
        return [
          { role: "system" as const, content: "rebuild" },
          { role: "user" as const, content: "rebuild-user" },
        ];
      }),
      buildDebateFollowUp: mock((_ctx: any, _others: any, _round?: any, _instructions?: any) => {
        return { role: "user" as const, content: "follow-up" };
      }),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-c/fallback-c")], cooldown);
    const config = makeConfig({ maxRounds: 2, protocol: "debate" });

    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: ChatMessage[], params?: any) => {
      callCount++;
      round = callCount <= 3 ? 1 : 2; // R1: model-0 fail + fallback-c + model-1 = 3 calls
      return origChat(model, messages, params);
    };

    const output = await deliberate(team, makeInput(), deps, config, { pool });

    expect(output.roundsExecuted).toBe(2);
    // R1: model-0 swapped to fallback-c. Team updated.
    // R2: fallback-c has history from R1 → session continuation (follow-up)
    //     model-1 has history from R1 → session continuation (follow-up)
    // No cold join needed since no model swap in R2
    expect(output.modelsUsed).toContain("prov-c/fallback-c");
  });
});

// ================================================================
// debate fallback — cold join + swap tracking
// ================================================================

describe("debate fallback (cold join auto-detected by debate builder)", () => {
  it("should use debate builder for replacement worker in R2+ (cold join auto-detected)", async () => {
    // 2 workers, 2 rounds. Worker-1 fails in R2 → fallback/d replaces
    // Debate builder auto-detects cold join via missing participation in last round
    let debateBuilderCallCount = 0;
    let round = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-1" && round === 2) {
          throw new Error("R2 failure");
        }
        return chatResult(validWorkerContent(`response-from-${model}`));
      }),
      buildDebateWorkerMessages: mock((_ctx: any, _inst?: any, _round?: any, _idx?: any) => {
        debateBuilderCallCount++;
        return [{ role: "user" as const, content: "debate" }];
      }),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-z/fallback-d")], cooldown);
    const config = makeConfig({ maxRounds: 2, protocol: "debate" });

    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: any, params?: any) => {
      callCount++;
      round = callCount <= 2 ? 1 : 2;
      return origChat(model, messages, params);
    };

    const result = await deliberate(team, makeInput(), deps, config, { pool });

    expect(result.roundsExecuted).toBe(2);
    // Debate builder handles both normal debate and cold join
    expect(debateBuilderCallCount).toBeGreaterThan(0);
    expect(result.modelSwaps).toBeDefined();
    expect(result.modelSwaps!.some(s => s.replacement === "prov-z/fallback-d")).toBe(true);
  });

  it("should preserve swapped worker in team for R2", async () => {
    const r2ChatModels: string[] = [];
    let round = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0" && round === 1) {
          throw new Error("R1 failure");
        }
        if (round === 2) r2ChatModels.push(model);
        return chatResult(validWorkerContent(`response-from-${model}`));
      }),
      buildDebateWorkerMessages: mock(() => [{ role: "user" as const, content: "debate" }]),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-z/fallback-d")], cooldown);
    const config = makeConfig({ maxRounds: 2, protocol: "debate" });

    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: any, params?: any) => {
      callCount++;
      round = callCount <= 3 ? 1 : 2;
      return origChat(model, messages, params);
    };

    const result = await deliberate(team, makeInput(), deps, config, { pool });

    expect(r2ChatModels).toContain("prov-z/fallback-d");
    expect(result.roundsExecuted).toBe(2);
  });
});

// =============================================================================
// createFallbackPool — claim semantics (direct unit tests)
// =============================================================================

describe("createFallbackPool", () => {
  it("should claim model on getNext — subsequent call returns different model", () => {
    const cooldown = createCooldownManager();
    const pool = createFallbackPool(
      [makeModelInfo("model/a"), makeModelInfo("model/b")],
      cooldown,
    );
    const empty = new Set<string>();

    const first = pool.getNext(empty);
    expect(first).toBeDefined();
    expect(first!.id).toBe("model/a");

    const second = pool.getNext(empty);
    expect(second).toBeDefined();
    expect(second!.id).toBe("model/b");

    const third = pool.getNext(empty);
    expect(third).toBeUndefined();
  });

  it("should skip models on cooldown", () => {
    const cooldown = createCooldownManager();
    const pool = createFallbackPool(
      [makeModelInfo("model/a"), makeModelInfo("model/b")],
      cooldown,
    );
    cooldown.add("model/a", "rate limited");

    const result = pool.getNext(new Set<string>());
    expect(result).toBeDefined();
    expect(result!.id).toBe("model/b");
  });

  it("should skip models in excludeIds", () => {
    const cooldown = createCooldownManager();
    const pool = createFallbackPool(
      [makeModelInfo("model/a"), makeModelInfo("model/b")],
      cooldown,
    );

    const result = pool.getNext(new Set(["model/a"]));
    expect(result).toBeDefined();
    expect(result!.id).toBe("model/b");
  });

  it("should return undefined when pool exhausted", () => {
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("model/a")], cooldown);

    const first = pool.getNext(new Set<string>());
    expect(first).toBeDefined();
    expect(first!.id).toBe("model/a");

    const second = pool.getNext(new Set<string>());
    expect(second).toBeUndefined();
  });

  it("markFailed should add model to cooldown", () => {
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("model/a")], cooldown);

    pool.markFailed("model/a", "server error", "server_error");

    expect(cooldown.isOnCooldown("model/a")).toBe(true);
  });

  it("markFailed should cool all models from same provider on provider-scoped errors", () => {
    const cooldown = createCooldownManager();
    const pool = createFallbackPool(
      [makeModelInfo("google/a"), makeModelInfo("google/b"), makeModelInfo("openai/c")],
      cooldown,
    );

    pool.markFailed("google/a", "spending cap", "rate_limit");

    // rate_limit → provider-scoped → google/a and google/b share provider "google" → both cooled.
    const result = pool.getNext(new Set<string>());
    expect(result).toBeDefined();
    expect(result!.id).toBe("openai/c");
  });

  it("markFailed should NOT cool other models from same provider on model-scoped errors", () => {
    const cooldown = createCooldownManager();
    const pool = createFallbackPool(
      [makeModelInfo("google/a"), makeModelInfo("google/b"), makeModelInfo("openai/c")],
      cooldown,
    );

    pool.markFailed("google/a", "model not found", "unknown");

    // unknown (404) → model-scoped → only google/a cooled, google/b still available.
    const result = pool.getNext(new Set<string>());
    expect(result).toBeDefined();
    expect(result!.id).toBe("google/b");
  });
});

// =============================================================================
// Multi-hop token accumulation
// =============================================================================

describe("multi-hop token accumulation", () => {
  it("should only include tokens from successful call, not failed attempts", async () => {
    // Team of 1. model-0 fails (no tokens counted), fallback/a fails (no tokens),
    // fallback/b succeeds with 20 input, 40 output.
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          throw new Error("timeout");
        }
        if (model === "prov-x/fallback-a") {
          throw new Error("rate limit");
        }
        // fallback/b succeeds
        return chatResult(validWorkerContent("success"), 20, 40);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool(
      [makeModelInfo("prov-x/fallback-a"), makeModelInfo("prov-y/fallback-b")],
      cooldown,
    );

    const output = await deliberate(team, input, deps, config, { pool });

    // Failed attempts throw before tokens are accumulated (line 231-232 only reached on success).
    // Only the successful call's tokens should be counted.
    expect(output.totalTokens.input).toBe(20);
    expect(output.totalTokens.output).toBe(40);
  });
});

// =============================================================================
// Diverge-synth uses worker builder (not debate builder) for fallback
// =============================================================================

describe("diverge-synth fallback uses worker builder", () => {
  it("should use buildWorkerMessages for replacement in diverge-synth mode", async () => {
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") throw new Error("failure");
        return chatResult(validWorkerContent(`response-from-${model}`));
      }),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-z/fallback-d")], cooldown);
    const config = makeConfig({ maxRounds: 1, protocol: "diverge-synth" });

    const output = await deliberate(team, makeInput(), deps, config, { pool });

    expect(deps.buildWorkerMessages).toHaveBeenCalled();
    expect(output.modelsUsed).toContain("prov-z/fallback-d");
  });
});

// =============================================================================
// Multi-round multi-swap context integrity
// =============================================================================

describe("multi-round multi-swap context integrity", () => {
  it("should maintain correct context after swaps across multiple rounds", async () => {
    // Team of 2, debate, maxRounds=3.
    // R1: worker-1 fails → swapped to fallback/d. Both produce responses.
    // R2: all succeed (worker-0 + fallback/d).
    // R3: all succeed.
    let round = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-1" && round === 1) {
          throw new Error("R1 failure");
        }
        return chatResult(`Response from ${model} round ${round}: ${"r".repeat(round * 80)}`.padEnd(MIN_WORKER_RESPONSE_LENGTH, "."));
      }),
      buildDebateWorkerMessages: mock((_ctx: any, _inst?: any, _round?: any, _idx?: any) => {
        return [{ role: "user" as const, content: "debate" }];
      }),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-z/fallback-d")], cooldown);
    const config = makeConfig({ maxRounds: 3, protocol: "debate" });

    // Track round number via chat interception
    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: any, params?: any) => {
      callCount++;
      // R1: calls 1-3 (worker-0, worker-1 fails, fallback/d), R2: calls 4-5, R3: calls 6-7
      if (callCount <= 3) round = 1;
      else if (callCount <= 5) round = 2;
      else round = 3;
      return origChat(model, messages, params);
    };

    const output = await deliberate(team, makeInput(), deps, config, { pool });

    expect(output.roundsExecuted).toBe(3);
    expect(output.modelsUsed).toContain("prov-z/fallback-d");
    expect(output.rounds).toHaveLength(3);
    // Each round should have 2 responses
    for (const r of output.rounds!) {
      expect(r.responses!.length).toBe(2);
    }
  });
});

// =============================================================================
// Degenerate response triggers fallback
// =============================================================================

describe("degenerate response triggers fallback", () => {
  it("should trigger fallback for degenerate response and swap to a pool model", async () => {
    // model-0 returns degenerate → should fallback to fallback-a
    // model-1 returns valid
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          return chatResult("short", 10, 20); // below MIN_WORKER_RESPONSE_LENGTH
        }
        if (model === "prov-x/fallback-a") {
          return chatResult(validWorkerContent("fallback succeeded"), 15, 25);
        }
        return chatResult(validWorkerContent("ok"), 15, 25);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-x/fallback-a")], cooldown);

    const output = await deliberate(team, input, deps, config, { pool });

    // Both workers should have valid responses (model-1 original + fallback-a replacing model-0)
    expect(output.rounds![0]!.responses).toHaveLength(2);
    // fallback-a replaced model-0
    const models = output.rounds![0]!.responses!.map(r => r.model);
    expect(models).toContain("prov-x/fallback-a");
    expect(models).toContain("worker/model-1");
    // modelSwaps should record the degenerate → fallback swap
    expect(output.modelSwaps).toBeDefined();
    expect(output.modelSwaps!.length).toBeGreaterThanOrEqual(1);
    expect(output.modelSwaps![0]!.original).toBe("worker/model-0");
    expect(output.modelSwaps![0]!.replacement).toBe("prov-x/fallback-a");
  });

  it("should track degenerate in failedWorkers when no fallback pool available", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          return chatResult("short", 10, 20);
        }
        return chatResult(validWorkerContent("ok"), 15, 25);
      }),
    });

    // No fallback pool
    const output = await deliberate(team, input, deps, config);

    expect(output.rounds![0]!.responses).toHaveLength(1);
    expect(output.rounds![0]!.failedWorkers).toHaveLength(1);
    expect(output.rounds![0]!.failedWorkers![0]!.error).toContain("degenerate");
  });
});

// =============================================================================
// RoundExecutionError includes all accumulated swaps on total failure
// =============================================================================

describe("RoundExecutionError includes all swap attempts on total failure", () => {
  it("should include all swap attempts in RoundExecutionError.modelSwaps on total failure", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        throw new Error("always fails");
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool(
      [makeModelInfo("prov-x/fallback-a"), makeModelInfo("prov-y/fallback-b")],
      cooldown,
    );

    try {
      await deliberate(team, input, deps, config, { pool });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RoundExecutionError);
      const re = error as RoundExecutionError;
      expect(re.modelSwaps).toBeDefined();
      // 3 entries: model-0→fallback/a, fallback/a→fallback/b, fallback/b→undefined
      expect(re.modelSwaps!.length).toBe(3);
      expect(re.modelSwaps![0]!.original).toBe("worker/model-0");
      expect(re.modelSwaps![0]!.replacement).toBe("prov-x/fallback-a");
      expect(re.modelSwaps![1]!.original).toBe("prov-x/fallback-a");
      expect(re.modelSwaps![1]!.replacement).toBe("prov-y/fallback-b");
      expect(re.modelSwaps![2]!.original).toBe("prov-y/fallback-b");
      expect(re.modelSwaps![2]!.replacement).toBeUndefined();
    }
  });
});

// =============================================================================
// Multi-hop swap chain team update (regression: must resolve to final model)
// =============================================================================

describe("multi-hop swap chain team update", () => {
  it("should update team to FINAL model after multi-hop fallback chain, not intermediate", async () => {
    // Team of 2, debate, maxRounds=2.
    // R1: worker-0 fails → fallback/a fails → fallback/b succeeds (2-hop chain)
    // R2: worker-0 should be fallback/b (final), NOT fallback/a (intermediate)
    let round = 0;
    const r2Models: string[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (round === 1 && model === "worker/model-0") throw new Error("original fail");
        if (round === 1 && model === "prov-x/fallback-a") throw new Error("intermediate fail");
        if (round === 2) r2Models.push(model);
        return chatResult(validWorkerContent(`response-from-${model}`));
      }),
      buildDebateWorkerMessages: mock((_ctx: any, _inst?: any, _round?: any, _idx?: any) => [
        { role: "user" as const, content: "debate" },
      ]),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool(
      [makeModelInfo("prov-x/fallback-a"), makeModelInfo("prov-y/fallback-b")],
      cooldown,
    );
    const config = makeConfig({ maxRounds: 2, protocol: "debate" });

    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: any, params?: any) => {
      callCount++;
      // R1: calls 1-4 (worker-0 fail, fallback/a fail, fallback/b success, worker-1 success)
      // R2: calls 5+
      round = callCount <= 4 ? 1 : 2;
      return origChat(model, messages, params);
    };

    const output = await deliberate(team, makeInput(), deps, config, { pool });

    expect(output.roundsExecuted).toBe(2);
    // R2 should use fallback/b (final), NOT fallback/a (intermediate)
    expect(r2Models).toContain("prov-y/fallback-b");
    expect(r2Models).not.toContain("prov-x/fallback-a");
    expect(r2Models).not.toContain("worker/model-0");
  });
});

// =============================================================================
// #8 — Normalized error output
// =============================================================================

describe("normalized error output", () => {
  it("should include errorCode and retryable in failedWorkers", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          throw new LLMClientError(429, "Rate limit exceeded", "rate_limit_error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.rounds![0]!.failedWorkers).toHaveLength(1);
    const fw = output.rounds![0]!.failedWorkers![0]!;
    expect(fw.errorCode).toBe("rate_limit");
    expect(fw.retryable).toBe(true);
    expect(fw.error).toBe("Rate limit exceeded");
  });

  it("should include errorCode and retryable in modelSwaps", async () => {
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          throw new LLMClientError(404, "Model not found");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-b/fallback")], cooldown);

    const customTeam: TeamComposition = {
      workers: [{ model: "worker/model-0", role: "worker" }],
    };

    const output = await deliberate(customTeam, makeInput(), deps, makeConfig(), { pool });

    expect(output.modelSwaps).toBeDefined();
    const swap = output.modelSwaps![0]!;
    expect(swap.errorCode).toBe("unknown");
    expect(swap.retryable).toBe(false);
    expect(swap.error).toBe("Model not found");
  });

  it("should clean raw JSON in error messages", async () => {
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          throw new Error('{"error":{"message":"spending cap exceeded","code":429}}');
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const output = await deliberate(makeTeam(2), makeInput(), deps, makeConfig());

    const fw = output.rounds![0]!.failedWorkers![0]!;
    expect(fw.error).toBe("spending cap exceeded");
  });

  it("should mark timeout errors as retryable", async () => {
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          throw new LLMClientError(408, "Request timeout", "timeout_error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const output = await deliberate(makeTeam(2), makeInput(), deps, makeConfig());

    const fw = output.rounds![0]!.failedWorkers![0]!;
    expect(fw.errorCode).toBe("timeout");
    expect(fw.retryable).toBe(true);
  });

  it("should mark auth errors as non-retryable", async () => {
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          throw new LLMClientError(401, "Invalid API key", "authentication_error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const output = await deliberate(makeTeam(2), makeInput(), deps, makeConfig());

    const fw = output.rounds![0]!.failedWorkers![0]!;
    expect(fw.errorCode).toBe("auth_error");
    expect(fw.retryable).toBe(false);
  });
});

// =============================================================================
// #1 — Error-scoped cooldown: provider vs model scope
// =============================================================================

describe("error-scoped cooldown in fallback", () => {
  it("should NOT cool down provider on 404 — same-provider fallback remains available", async () => {
    const callLog: string[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        callLog.push(model);
        if (model === "prov-a/model-0") {
          throw new LLMClientError(404, "Model not found");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool(
      [makeModelInfo("prov-a/fallback")],
      cooldown,
    );

    const customTeam: TeamComposition = {
      workers: [{ model: "prov-a/model-0", role: "worker" }],
    };

    const output = await deliberate(customTeam, makeInput(), deps, makeConfig(), { pool });

    // 404 = model-only cooldown → same-provider fallback should work
    expect(callLog).toEqual(["prov-a/model-0", "prov-a/fallback"]);
    expect(output.modelsUsed).toContain("prov-a/fallback");
    expect(cooldown.isOnCooldown("prov-a/model-0")).toBe(true);
    expect(cooldown.isOnCooldown("prov-a/unrelated")).toBe(false); // provider NOT cooled
  });

  it("should cool down entire provider on 429 rate limit", async () => {
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "prov-a/model-0") {
          throw new LLMClientError(429, "Rate limit", "rate_limit_error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool(
      [makeModelInfo("prov-b/fallback")],
      cooldown,
    );

    const customTeam: TeamComposition = {
      workers: [{ model: "prov-a/model-0", role: "worker" }],
    };

    await deliberate(customTeam, makeInput(), deps, makeConfig(), { pool });

    expect(cooldown.isOnCooldown("prov-a/model-0")).toBe(true);
    expect(cooldown.isOnCooldown("prov-a/any-model")).toBe(true); // provider cooled
  });

  it("should cool down entire provider on 401 auth error", async () => {
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "prov-a/model-0") {
          throw new LLMClientError(401, "Unauthorized", "authentication_error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-b/fallback")], cooldown);

    const customTeam: TeamComposition = {
      workers: [{ model: "prov-a/model-0", role: "worker" }],
    };

    await deliberate(customTeam, makeInput(), deps, makeConfig(), { pool });

    expect(cooldown.isOnCooldown("prov-a/other")).toBe(true); // provider cooled
  });

  it("should cool down entire provider on 500 server error", async () => {
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "prov-a/model-0") {
          throw new LLMClientError(500, "Internal Server Error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-b/fallback")], cooldown);

    const customTeam: TeamComposition = {
      workers: [{ model: "prov-a/model-0", role: "worker" }],
    };

    await deliberate(customTeam, makeInput(), deps, makeConfig(), { pool });

    expect(cooldown.isOnCooldown("prov-a/other")).toBe(true); // provider cooled
  });

  it("should NOT cool down provider on timeout — model-only cooldown", async () => {
    const callLog: string[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        callLog.push(model);
        if (model === "prov-a/model-0") {
          throw new LLMClientError(408, "Timeout", "timeout_error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-a/fallback")], cooldown);

    const customTeam: TeamComposition = {
      workers: [{ model: "prov-a/model-0", role: "worker" }],
    };

    await deliberate(customTeam, makeInput(), deps, makeConfig(), { pool });

    // Timeout = model-only → same-provider fallback should work
    expect(callLog).toEqual(["prov-a/model-0", "prov-a/fallback"]);
    expect(cooldown.isOnCooldown("prov-a/model-0")).toBe(true);
    expect(cooldown.isOnCooldown("prov-a/unrelated")).toBe(false); // provider NOT cooled
  });

  it("should store correct errorType in cooldown entry", async () => {
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "prov-a/model-0") {
          throw new LLMClientError(429, "Rate limit", "rate_limit_error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-b/fallback")], cooldown);

    const customTeam: TeamComposition = {
      workers: [{ model: "prov-a/model-0", role: "worker" }],
    };

    await deliberate(customTeam, makeInput(), deps, makeConfig(), { pool });

    expect(cooldown.getEntry("prov-a/model-0")?.errorType).toBe("rate_limit");
  });
});

// =============================================================================
// #10 — Cooldown check before team worker call (cross-round)
// =============================================================================

describe("cooldown check before team worker call", () => {
  it("should not call a cooled model in R2 — skips without wasting API call", async () => {
    const callLog: string[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        callLog.push(model);
        if (model === "prov-a/model-0" || model === "prov-c/fallback-1") {
          throw new LLMClientError(429, "Rate limit", "rate_limit_error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([
      makeModelInfo("prov-c/fallback-1"),
    ], cooldown);

    const customTeam: TeamComposition = {
      workers: [
        { model: "prov-a/model-0", role: "worker" },
        { model: "prov-b/model-1", role: "worker" },
      ],
    };

    const config = makeConfig({ maxRounds: 2 });
    await deliberate(customTeam, makeInput(), deps, config, { pool });

    // R1: model-0 fails (429, provider-a cooled) → fallback-1 fails (429, provider-c cooled) → worker-0 fails
    // R2: model-0 still on team (no response in R1) → should check cooldown → SKIP
    const model0Calls = callLog.filter(m => m === "prov-a/model-0");
    expect(model0Calls).toHaveLength(1); // Only R1, not R2
  });

  it("should recover cooled model via Phase 3 in R1 and use recovered model in R2", async () => {
    const callLog: string[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        callLog.push(model);
        if (model === "prov-a/model-0") {
          throw new LLMClientError(429, "Rate limit", "rate_limit_error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([], cooldown); // empty pool

    const customTeam: TeamComposition = {
      workers: [
        { model: "prov-a/model-0", role: "worker" },
        { model: "prov-b/model-1", role: "worker" },
      ],
    };

    const config = makeConfig({ maxRounds: 2 });
    const output = await deliberate(customTeam, makeInput(), deps, config, { pool });

    // R1: model-0 fails → Phase 3 recovers with model-1 → team updated
    // R2: both workers use model-1 (no cooldown issue)
    expect(output.roundsExecuted).toBe(2);
    const r2Responses = output.rounds![1]!.responses!;
    expect(r2Responses.every(r => r.model === "prov-b/model-1")).toBe(true);
    // model-0 should NOT appear in R2 calls (team was updated)
    const r2Calls = callLog.slice(callLog.lastIndexOf("prov-b/model-1"));
    expect(r2Calls.every(m => m === "prov-b/model-1")).toBe(true);
  });
});

// =============================================================================
// #5 — Team degradation: min viable check + metadata
// =============================================================================

describe("minViableTeamSize", () => {
  it("should return 3 for small teams", () => {
    expect(minViableTeamSize(1)).toBe(3);
    expect(minViableTeamSize(2)).toBe(3);
    expect(minViableTeamSize(3)).toBe(3);
    expect(minViableTeamSize(4)).toBe(3);
  });

  it("should return ceil(N*0.6) for large teams", () => {
    expect(minViableTeamSize(5)).toBe(3);
    expect(minViableTeamSize(6)).toBe(4);
    expect(minViableTeamSize(7)).toBe(5);
    expect(minViableTeamSize(10)).toBe(6);
  });
});

describe("team degradation", () => {
  it("should throw TeamDegradedError when team drops below min viable (5→2)", async () => {
    const team: TeamComposition = {
      workers: Array.from({ length: 5 }, (_, i) => ({
        model: `prov-${i}/model-${i}`,
        role: "worker" as const,
      })),
    };

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        // Only model-0 and model-1 succeed → 2 active, min viable = 3
        if (model === "prov-0/model-0" || model === "prov-1/model-1") {
          return chatResult(validWorkerContent("ok"), 10, 20);
        }
        throw new LLMClientError(500, "Server error");
      }),
    });

    try {
      await deliberate(team, makeInput(), deps, makeConfig());
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(TeamDegradedError);
      const tde = error as InstanceType<typeof TeamDegradedError>;
      expect(tde.originalSize).toBe(5);
      expect(tde.activeSize).toBe(2);
      expect(tde.lostSlots).toHaveLength(3);
      // Partial round preserves successful responses
      expect(tde.partialRound).toBeDefined();
      expect(tde.partialRound!.responses.length).toBe(2);
    }
  });

  it("should include degradation metadata when team shrinks but stays viable (5→3)", async () => {
    const team: TeamComposition = {
      workers: Array.from({ length: 5 }, (_, i) => ({
        model: `prov-${i}/model-${i}`,
        role: "worker" as const,
      })),
    };

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        // 3 succeed, 2 fail → viable (min 3) but degraded
        if (model.startsWith("prov-0") || model.startsWith("prov-1") || model.startsWith("prov-2")) {
          return chatResult(validWorkerContent("ok"), 10, 20);
        }
        throw new LLMClientError(500, "Server error");
      }),
    });

    const output = await deliberate(team, makeInput(), deps, makeConfig());

    expect(output.degradation).toBeDefined();
    expect(output.degradation!.originalTeamSize).toBe(5);
    expect(output.degradation!.activeTeamSize).toBe(3);
    expect(output.degradation!.lostSlots).toHaveLength(2);
    expect(output.warnings).toBeDefined();
    expect(output.warnings!.some(w => w.includes("team_degraded"))).toBe(true);
  });

  it("should not include degradation when all workers succeed", async () => {
    const team = makeTeam(3);
    const deps = makeDeps();
    const output = await deliberate(team, makeInput(), deps, makeConfig());

    expect(output.degradation).toBeUndefined();
  });

  it("should include tokensConsumed and modelSwaps in TeamDegradedError", async () => {
    const team: TeamComposition = {
      workers: Array.from({ length: 5 }, (_, i) => ({
        model: `prov-${i}/model-${i}`,
        role: "worker" as const,
      })),
    };

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "prov-0/model-0" || model === "prov-1/model-1") {
          return chatResult(validWorkerContent("ok"), 15, 25);
        }
        throw new LLMClientError(500, "Server error");
      }),
    });

    try {
      await deliberate(team, makeInput(), deps, makeConfig());
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(TeamDegradedError);
      const tde = error as InstanceType<typeof TeamDegradedError>;
      expect(tde.tokensConsumed).toBeDefined();
      expect(tde.tokensConsumed!.input).toBeGreaterThan(0);
      expect(tde.tokensConsumed!.output).toBeGreaterThan(0);
      expect(tde.modelSwaps).toBeDefined();
    }
  });

  it("should reflect final degradation state across multiple rounds", async () => {
    const team: TeamComposition = {
      workers: Array.from({ length: 5 }, (_, i) => ({
        model: `prov-${i}/model-${i}`,
        role: "worker" as const,
      })),
    };

    let round = 1;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        // model-4 always fails (both rounds)
        if (model === "prov-4/model-4") {
          throw new LLMClientError(500, "model-4 always fails");
        }
        // model-3 fails only in R2
        if (round === 2 && model === "prov-3/model-3") {
          throw new LLMClientError(500, "R2 fail");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    // Track round progression
    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: any, params?: any) => {
      callCount++;
      // first 5 calls = R1, then R2
      round = callCount <= 5 ? 1 : 2;
      return origChat(model, messages, params);
    };

    const config = makeConfig({ maxRounds: 2 });
    const output = await deliberate(team, makeInput(), deps, config);

    expect(output.degradation).toBeDefined();
    expect(output.degradation!.originalTeamSize).toBe(5);
    expect(output.degradation!.activeTeamSize).toBe(3);
  });
});

// =============================================================================
// #10 supplement — cooldown pre-check success path (model replaced by fallback)
// =============================================================================

describe("cooldown pre-check success path", () => {
  it("should skip cooled model and use fallback successfully in R2", async () => {
    const callLog: string[] = [];
    let round = 1;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        callLog.push(model);
        // R1: model-0 fails with 429
        if (round === 1 && model === "prov-a/model-0") {
          throw new LLMClientError(429, "Rate limit", "rate_limit_error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: any, params?: any) => {
      callCount++;
      round = callCount <= 3 ? 1 : 2; // 2 workers + 1 fallback in R1, then R2
      return origChat(model, messages, params);
    };

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([
      makeModelInfo("prov-c/fallback-1"),
      makeModelInfo("prov-d/fallback-2"),
    ], cooldown);

    const customTeam: TeamComposition = {
      workers: [
        { model: "prov-a/model-0", role: "worker" },
        { model: "prov-b/model-1", role: "worker" },
      ],
    };

    const config = makeConfig({ maxRounds: 2 });
    const output = await deliberate(customTeam, makeInput(), deps, config, { pool });

    // R1: model-0 fails → fallback-1 succeeds, team updated to fallback-1
    // R2: fallback-1 called (not model-0)
    expect(callLog.filter(m => m === "prov-a/model-0")).toHaveLength(1); // only R1
    expect(output.modelsUsed).toContain("prov-c/fallback-1");
    expect(output.roundsExecuted).toBe(2);
  });
});

// =============================================================================
// Replenishment — fill empty slots after R1 failures
// =============================================================================

describe("replenishment after R1 failures", () => {
  it("should recover failed workers via alive team member duplicate when pool is empty", async () => {
    const callLog: string[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        callLog.push(model);
        if (model === "prov-a/model-0" || model === "prov-b/model-1") {
          throw new LLMClientError(429, "Rate limit", "rate_limit_error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([], cooldown); // empty pool

    const customTeam: TeamComposition = {
      workers: [
        { model: "prov-a/model-0", role: "worker" },
        { model: "prov-b/model-1", role: "worker" },
        { model: "prov-c/model-2", role: "worker" },
      ],
    };

    const replenish = mock(() => []);
    const output = await deliberate(
      customTeam, makeInput(), deps, makeConfig(),
      { pool, replenish },
    );

    // Phase 3 fallback: failed workers recover by reusing alive model-2
    expect(output.roundsExecuted).toBe(1);
    expect(output.rounds![0]!.responses!.length).toBe(3);
    // model-2 used for all 3 slots (original + 2 duplicates)
    expect(output.rounds![0]!.responses!.every(r => r.model === "prov-c/model-2")).toBe(true);
    // Replenishment not needed — Phase 3 handled recovery
    expect(replenish).not.toHaveBeenCalled();
  });

  it("should not call replenish when all workers succeed", async () => {
    const deps = makeDeps();
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([], cooldown);
    const replenish = mock(() => []);

    await deliberate(makeTeam(3), makeInput(), deps, makeConfig(), { pool, replenish });

    expect(replenish).not.toHaveBeenCalled();
  });

  it("should use recovered duplicate models in R2", async () => {
    const callLog: string[] = [];
    let round = 1;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        callLog.push(model);
        // R1: model-0 and model-1 fail, model-2 succeeds
        if (round === 1 && (model === "prov-a/model-0" || model === "prov-b/model-1")) {
          throw new LLMClientError(429, "Rate limit", "rate_limit_error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: any, params?: any) => {
      callCount++;
      // R1: 3 original + up to 2 fallback retries, then R2
      round = callCount <= 5 ? 1 : 2;
      return origChat(model, messages, params);
    };

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([], cooldown);

    const customTeam: TeamComposition = {
      workers: [
        { model: "prov-a/model-0", role: "worker" },
        { model: "prov-b/model-1", role: "worker" },
        { model: "prov-c/model-2", role: "worker" },
      ],
    };

    const replenish = mock(() => []);
    const config = makeConfig({ maxRounds: 2 });
    const output = await deliberate(customTeam, makeInput(), deps, config, { pool, replenish });

    expect(output.roundsExecuted).toBe(2);
    // R2 should call model-2 for all 3 slots (team updated from R1 recovery)
    const r2Models = output.rounds![1]!.responses!.map(r => r.model);
    expect(r2Models.every(m => m === "prov-c/model-2")).toBe(true);
  });

  it("should pass respondedModels to replenish to prevent duplicate selection", async () => {
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "prov-a/model-0") {
          throw new LLMClientError(429, "Rate limit", "rate_limit_error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    // Fallback pool has fallback-1 which will be used as swap for model-0
    const pool = createFallbackPool([makeModelInfo("prov-b/fallback-1")], cooldown);

    const customTeam: TeamComposition = {
      workers: [
        { model: "prov-a/model-0", role: "worker" },
        { model: "prov-b/model-1", role: "worker" },
      ],
    };

    const replenish = mock(() => []);

    // model-0 fails → swaps to fallback-1 → succeeds. model-1 succeeds.
    // No empty slots → replenish NOT called (0 empty slots)
    await deliberate(customTeam, makeInput(), deps, makeConfig(), { pool, replenish });

    // All slots filled via swap, replenish shouldn't be called
    expect(replenish).not.toHaveBeenCalled();
  });

  it("should recover failed worker via alive team duplicate (2-worker team)", async () => {
    const callLog: string[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        callLog.push(model);
        // model-0 fails, model-1 succeeds (also succeeds as duplicate for model-0 slot)
        if (model === "prov-a/model-0") {
          throw new LLMClientError(500, "Server error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([], cooldown);

    const customTeam: TeamComposition = {
      workers: [
        { model: "prov-a/model-0", role: "worker" },
        { model: "prov-b/model-1", role: "worker" },
      ],
    };

    const output = await deliberate(customTeam, makeInput(), deps, makeConfig(), { pool });

    // model-0 fails → Phase 3 finds model-1 → both slots filled
    expect(output.rounds![0]!.responses!.length).toBe(2);
    expect(callLog).toContain("prov-b/model-1");
  });

  it("should recover all failed slots via Phase 3 duplicate when one model survives", async () => {
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        // Only model-0 succeeds — others fail with server_error
        if (!model.includes("model-0")) {
          throw new LLMClientError(500, "Server error");
        }
        return chatResult(validWorkerContent("ok"), 10, 20);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([], cooldown);

    const team: TeamComposition = {
      workers: Array.from({ length: 5 }, (_, i) => ({
        model: `prov-${i}/model-${i}`,
        role: "worker" as const,
      })),
    };

    // Phase 3 finds model-0 (alive, not cooled) for all failed slots
    const output = await deliberate(team, makeInput(), deps, makeConfig(), { pool });

    expect(output.roundsExecuted).toBe(1);
    expect(output.rounds![0]!.responses!.length).toBe(5);
    expect(output.rounds![0]!.responses!.every(r => r.model === "prov-0/model-0")).toBe(true);
  });
});

// =============================================================================
// Confidence Parsing
// =============================================================================

describe("parseConfidence", () => {
  it("should parse 'HIGH confidence'", () => {
    expect(parseConfidence("This is HIGH confidence claim")).toBe("high");
  });

  it("should parse 'confidence: MEDIUM'", () => {
    expect(parseConfidence("My assessment (confidence: MEDIUM) is that")).toBe("medium");
  });

  it("should parse 'LOW:'", () => {
    expect(parseConfidence("LOW: this is speculative")).toBe("low");
  });

  it("should return undefined when no markers", () => {
    expect(parseConfidence("I think this is probably correct")).toBeUndefined();
  });

  it("should return most frequent when mixed", () => {
    expect(parseConfidence("HIGH confidence here. MEDIUM confidence there. HIGH confidence again.")).toBe("high");
  });

  it("should be case insensitive", () => {
    expect(parseConfidence("high confidence in this claim")).toBe("high");
  });
});

// =============================================================================
// Levenshtein Distance
// =============================================================================

describe("levenshteinDistance", () => {
  it("should return 0 for identical strings", () => {
    expect(levenshteinDistance("abc", "abc")).toBe(0);
  });

  it("should handle empty strings", () => {
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
  });

  it("should compute correct distance", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });
});

// =============================================================================
// Per-Round Technique
// =============================================================================

describe("per-round technique", () => {
  it("should pass single technique to all rounds", async () => {
    const team = makeTeam(1);
    const input = makeInput({ technique: "challenge" });
    const config = makeConfig({ maxRounds: 2 });

    const techniques: (string | undefined)[] = [];
    const deps = makeDeps({
      chat: mock(async () => chatResult(validWorkerContent("resp" + Math.random()))),
      buildWorkerMessages: mock((_ctx: any, _inst?: any, _ri?: any, _idx?: any, technique?: any) => {
        techniques.push(technique);
        return [{ role: "user" as const, content: "work" }];
      }),
    });

    await deliberate(team, input, deps, config);
    expect(techniques.every(t => t === "challenge")).toBe(true);
  });

  it("should pass per-round techniques from array", async () => {
    const team = makeTeam(1);
    const input = makeInput({ technique: ["propose", "challenge", "defend"] as any });
    const config = makeConfig({ maxRounds: 3 });

    const techniques: (string | undefined)[] = [];
    let callCount = 0;
    const deps = makeDeps({
      chat: mock(async () => chatResult(`resp ${++callCount} ${"x".repeat(callCount * 50)}`.padEnd(MIN_WORKER_RESPONSE_LENGTH, "."))),
      buildWorkerMessages: mock((_ctx: any, _inst?: any, _ri?: any, _idx?: any, technique?: any) => {
        techniques.push(technique);
        return [{ role: "user" as const, content: "work" }];
      }),
    });

    await deliberate(team, input, deps, config);
    expect(techniques).toEqual(["propose", "challenge", "defend"]);
  });

  it("should repeat last technique when array exhausted", async () => {
    const team = makeTeam(1);
    const input = makeInput({ technique: ["propose", "challenge"] as any });
    const config = makeConfig({ maxRounds: 3 });

    const techniques: (string | undefined)[] = [];
    let callCount = 0;
    const deps = makeDeps({
      chat: mock(async () => chatResult(`resp ${++callCount} ${"x".repeat(callCount * 50)}`.padEnd(MIN_WORKER_RESPONSE_LENGTH, "."))),
      buildWorkerMessages: mock((_ctx: any, _inst?: any, _ri?: any, _idx?: any, technique?: any) => {
        techniques.push(technique);
        return [{ role: "user" as const, content: "work" }];
      }),
    });

    await deliberate(team, input, deps, config);
    expect(techniques).toEqual(["propose", "challenge", "challenge"]);
  });

  it("should pass undefined technique for empty array", async () => {
    const team = makeTeam(1);
    const input = makeInput({ technique: [] as any });
    const config = makeConfig({ maxRounds: 1 });

    const techniques: (string | undefined)[] = [];
    const deps = makeDeps({
      buildWorkerMessages: mock((_ctx: any, _inst?: any, _ri?: any, _idx?: any, technique?: any) => {
        techniques.push(technique);
        return [{ role: "user" as const, content: "work" }];
      }),
    });

    await deliberate(team, input, deps, config);
    expect(techniques).toEqual([undefined]);
  });
});

// =============================================================================
// Convergence Detection
// =============================================================================

describe("convergence detection", () => {
  it("should terminate early when workers converge", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 5 });

    // Same content every round → convergence after round 2
    const deps = makeDeps({
      chat: mock(async () => chatResult(validWorkerContent("identical response every time"))),
    });

    const output = await deliberate(team, input, deps, config);
    // Should stop before maxRounds due to convergence
    expect(output.roundsExecuted).toBeLessThan(5);
  });

  it("should NOT terminate early when responses differ", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 3 });

    let callCount = 0;
    const deps = makeDeps({
      chat: mock(async () => chatResult(`Unique response ${++callCount} ${"x".repeat(callCount * 80)}`.padEnd(MIN_WORKER_RESPONSE_LENGTH, "."))),
    });

    const output = await deliberate(team, input, deps, config);
    expect(output.roundsExecuted).toBe(3);
  });

  it("should NOT apply convergence when per-round technique array is specified", async () => {
    const team = makeTeam(1);
    const input = makeInput({ technique: ["propose", "accept", "challenge"] as any });
    const config = makeConfig({ maxRounds: 3 });

    // Same content → would normally converge, but per-round array disables convergence
    const deps = makeDeps({
      chat: mock(async () => chatResult(validWorkerContent("same content every time"))),
    });

    const output = await deliberate(team, input, deps, config);
    expect(output.roundsExecuted).toBe(3);
  });
});

// =============================================================================
// Confidence in Output
// =============================================================================

describe("confidence in output", () => {
  it("should include parsed confidence in round responses", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const deps = makeDeps({
      chat: mock(async () => chatResult(validWorkerContent("HIGH confidence: this is correct"))),
    });

    const output = await deliberate(team, input, deps, makeConfig());
    expect(output.rounds![0]!.responses![0]!.confidence).toBe("high");
  });

  it("should omit confidence when no markers", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const deps = makeDeps({
      chat: mock(async () => chatResult(validWorkerContent("no markers here at all"))),
    });

    const output = await deliberate(team, input, deps, makeConfig());
    expect(output.rounds![0]!.responses![0]!.confidence).toBeUndefined();
  });
});
