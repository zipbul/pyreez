/**
 * Unit tests for engine.ts — Deliberation Engine.
 */

import { describe, it, expect, mock } from "bun:test";
import {
  executeRound,
  deliberate,
  createFallbackPool,
  RoundExecutionError,
  MIN_WORKER_RESPONSE_LENGTH,
  type EngineDeps,
  type EngineConfig,
  type ChatResult,
  type FallbackDeps,
} from "./engine";
import type { TeamComposition, DeliberateInput } from "./types";
import type { ModelInfo } from "../model/types";
import { createCooldownManager } from "./cooldown";

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
    expect(round.responses[0]!.role).toBe("advocate");
    expect(round.responses[1]!.model).toBe("worker/model-1");
    expect(round.responses[1]!.role).toBe("critic");

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
    expect(round.responses[0]!.role).toBe("critic");

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

    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        return chatResult(validWorkerContent("worker"), 5, 10);
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

    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        return chatResult(validWorkerContent("w"), 100, 200);
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
  it("should include failedWorkers in rounds when a worker fails partially", async () => {
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

    const output = await deliberate(team, input, deps, config);

    // Verify the output includes failedWorkers info
    expect(output.rounds).toBeDefined();
    expect(output.rounds).toHaveLength(1);
    expect(output.rounds![0]!.failedWorkers).toBeDefined();
    expect(output.rounds![0]!.failedWorkers).toHaveLength(1);
    expect(output.rounds![0]!.failedWorkers![0]!.model).toBe("worker/model-0");
    expect(output.rounds![0]!.failedWorkers![0]!.error).toContain("o3 rate limit");

    // modelsUsed should NOT include the failed worker
    expect(output.modelsUsed).not.toContain("worker/model-0");
    expect(output.modelsUsed).toContain("worker/model-1");
    expect(output.modelsUsed).toContain("worker/model-2");
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

    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        return chatResult(validWorkerContent(`response`), 10, 20);
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
    const roles = round.responses.map((r) => r.role);
    expect(roles).toEqual(["advocate", "critic", "wildcard"]);
    expect(new Set(roles).size).toBe(3); // all distinct
  });
});

// ================================================================
// debate fallback — cold join + swap tracking
// ================================================================

describe("debate fallback with cold join", () => {
  it("should use cold join messages for replacement worker in debate R2+", async () => {
    // 2 workers, 2 rounds. Worker-1 fails in R2 → fallback/d replaces via cold join
    let coldJoinCalled = false;
    let round = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-1" && round === 2) {
          throw new Error("R2 failure");
        }
        return chatResult(validWorkerContent(`response-from-${model}`));
      }),
      buildDebateWorkerMessages: mock((_ctx: any, _inst?: any, _round?: any, _idx?: any) => {
        return [{ role: "user" as const, content: "debate" }];
      }),
      buildColdJoinMessages: mock((_ctx: any, _inst?: any, _round?: any, _idx?: any) => {
        coldJoinCalled = true;
        return [{ role: "user" as const, content: "cold-join" }];
      }),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-z/fallback-d")], cooldown);
    const config = makeConfig({ maxRounds: 2, protocol: "debate" });

    // Track round number by intercepting chat
    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: any, params?: any) => {
      callCount++;
      // R1: calls 1-2, R2: calls 3-4
      round = callCount <= 2 ? 1 : 2;
      return origChat(model, messages, params);
    };

    const result = await deliberate(team, makeInput(), deps, config, { pool });

    expect(result.roundsExecuted).toBe(2);
    expect(coldJoinCalled).toBe(true);
    expect(result.modelSwaps).toBeDefined();
    expect(result.modelSwaps!.some(s => s.replacement === "prov-z/fallback-d")).toBe(true);
  });

  it("should preserve swapped worker's response for next round debate context", async () => {
    // Worker-0 fails in R1 → swapped to fallback/d
    // R2: fallback/d should use buildDebateWorkerMessages (not cold join — already has R1 response)
    let debateBuilderCallCount = 0;
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
      round = callCount <= 3 ? 1 : 2; // R1: up to 3 calls (worker-0 fail, fallback-d, worker-1), R2: rest
      return origChat(model, messages, params);
    };

    const result = await deliberate(team, makeInput(), deps, config, { pool });

    // fallback/d should be called in R2 via chat (proving it's a team member)
    expect(r2ChatModels).toContain("prov-z/fallback-d");
    // buildDebateWorkerMessages was called (R2 uses debate builder)
    expect(debateBuilderCallCount).toBeGreaterThan(0);
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

    pool.markFailed("model/a", "server error");

    expect(cooldown.isOnCooldown("model/a")).toBe(true);
  });

  it("markFailed should cool all models from same provider", () => {
    const cooldown = createCooldownManager();
    const pool = createFallbackPool(
      [makeModelInfo("google/a"), makeModelInfo("google/b"), makeModelInfo("openai/c")],
      cooldown,
    );

    pool.markFailed("google/a", "spending cap");

    // markFailed always propagates to provider level.
    // google/a and google/b share provider "google" → both cooled.
    const result = pool.getNext(new Set<string>());
    expect(result).toBeDefined();
    expect(result!.id).toBe("openai/c");
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
// Cold join NOT applied in diverge-synth
// =============================================================================

describe("cold join not applied in diverge-synth", () => {
  it("should NOT use cold join messages for replacement in diverge-synth mode", async () => {
    // Team of 2, diverge-synth (default), maxRounds=1. Worker-0 fails, pool has fallback/d.
    let coldJoinCalled = false;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          throw new Error("failure");
        }
        return chatResult(validWorkerContent(`response-from-${model}`));
      }),
      buildColdJoinMessages: mock((_ctx: any, _inst?: any, _round?: any, _idx?: any) => {
        coldJoinCalled = true;
        return [{ role: "user" as const, content: "cold-join" }];
      }),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-z/fallback-d")], cooldown);
    const config = makeConfig({ maxRounds: 1, protocol: "diverge-synth" });

    const output = await deliberate(team, makeInput(), deps, config, { pool });

    expect(coldJoinCalled).toBe(false);
    expect(deps.buildWorkerMessages).toHaveBeenCalled();
    expect(output.modelsUsed).toContain("prov-z/fallback-d");
  });
});

// =============================================================================
// Cold join NOT applied when buildColdJoinMessages is undefined
// =============================================================================

describe("cold join fallback to debate builder when buildColdJoinMessages is undefined", () => {
  it("should fall back to buildDebateWorkerMessages when buildColdJoinMessages is not provided in debate swap", async () => {
    // Team of 2, debate, maxRounds=2. Worker-0 fails in R2.
    // Deps has buildDebateWorkerMessages but NOT buildColdJoinMessages.
    let debateBuilderCallCount = 0;
    let round = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0" && round === 2) {
          throw new Error("R2 failure");
        }
        return chatResult(validWorkerContent(`response-from-${model}`));
      }),
      buildDebateWorkerMessages: mock((_ctx: any, _inst?: any, _round?: any, _idx?: any) => {
        debateBuilderCallCount++;
        return [{ role: "user" as const, content: "debate" }];
      }),
      // buildColdJoinMessages is NOT provided
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-z/fallback-d")], cooldown);
    const config = makeConfig({ maxRounds: 2, protocol: "debate" });

    // Track round number via chat interception
    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: any, params?: any) => {
      callCount++;
      // R1: calls 1-2, R2: calls 3+
      round = callCount <= 2 ? 1 : 2;
      return origChat(model, messages, params);
    };

    const output = await deliberate(team, makeInput(), deps, config, { pool });

    expect(output.roundsExecuted).toBe(2);
    // buildDebateWorkerMessages should be called for the fallback worker in R2
    // R2 has 2 workers using debate builder, plus fallback/d replaces worker-0
    expect(debateBuilderCallCount).toBeGreaterThanOrEqual(1);
    expect(output.modelSwaps).toBeDefined();
    expect(output.modelSwaps!.some(s => s.replacement === "prov-z/fallback-d")).toBe(true);
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
        return chatResult(validWorkerContent(`response-from-${model}-r${round}`));
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

describe("degenerate response is quality issue, not error", () => {
  it("should NOT trigger fallback for degenerate response — track in failedWorkers, no swap", async () => {
    // 2 workers: model-0 returns degenerate, model-1 returns valid.
    // model-0 should NOT be swapped — just tracked as failedWorker.
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          return chatResult("short", 10, 20); // below MIN_WORKER_RESPONSE_LENGTH
        }
        return chatResult(validWorkerContent("ok"), 15, 25);
      }),
    });

    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-x/fallback-a")], cooldown);

    const output = await deliberate(team, input, deps, config, { pool });

    // model-1 succeeded normally
    expect(output.rounds![0]!.responses).toHaveLength(1);
    expect(output.rounds![0]!.responses![0]!.model).toBe("worker/model-1");
    // model-0 degenerate → failedWorker, NOT swapped
    expect(output.rounds![0]!.failedWorkers).toHaveLength(1);
    expect(output.rounds![0]!.failedWorkers![0]!.error).toContain("degenerate");
    // No modelSwaps — degenerate is not a swap trigger
    expect(output.modelSwaps).toBeUndefined();
    // model-0 NOT on cooldown (quality issue, not error)
    expect(cooldown.isOnCooldown("worker/model-0")).toBe(false);
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
