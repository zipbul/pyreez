/**
 * Unit tests for engine.ts — Leaderless Deliberation Engine.
 */

import { describe, it, expect, mock } from "bun:test";
import {
  executeRound,
  deliberate,
  RoundExecutionError,
  MIN_WORKER_RESPONSE_LENGTH,
  type EngineDeps,
  type EngineConfig,
  type ChatResult,
  type RetryDeps,
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

  it("should retry with a replacement worker when a worker RoundExecutionError occurs", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") {
          throw new Error("worker down");
        }
        if (model.startsWith("replacement/")) {
          return chatResult(validWorkerContent("replacement-ok"), 10, 20);
        }
        return chatResult("unreachable");
      }),
    });

    const cooldown = createCooldownManager();
    const retryDeps: RetryDeps = {
      cooldown,
      getModels: () => [makeModelInfo("replacement/worker-1")],
      maxRetries: 1,
    };

    const output = await deliberate(team, input, deps, config, retryDeps);

    expect(output.roundsExecuted).toBe(1);
    expect(cooldown.isOnCooldown("worker/model-0")).toBe(true);
  });

  it("should rethrow RoundExecutionError when no retryDeps are provided", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        throw new Error("all workers down");
      }),
    });

    try {
      await deliberate(team, input, deps, config); // no retryDeps
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RoundExecutionError);
      const re = error as RoundExecutionError;
      expect(re.role).toBe("worker");
    }
  });

  it("should rethrow when retry fails to find a replacement model", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        throw new Error("worker down");
      }),
    });

    const cooldown = createCooldownManager();
    const retryDeps: RetryDeps = {
      cooldown,
      getModels: () => [], // no replacement models available
      maxRetries: 1,
    };

    try {
      await deliberate(team, input, deps, config, retryDeps);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RoundExecutionError);
    }
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
      /degenerate responses/,
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
      buildDebateWorkerMessages: mock((_ctx: any, _instructions?: any, _roundInfo?: any, _model?: any, _idx?: any) => {
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
      buildDebateWorkerMessages: mock((ctx: any, _instructions?: any, _roundInfo?: any, _model?: any, _idx?: any) => {
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
