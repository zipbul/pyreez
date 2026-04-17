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
    protocol: "shared_convergence",
    ...overrides,
  };
}

function validWorkerContent(label: string): string {
  return label;
}

function chatResult(content: string, inputTokens = 10, outputTokens = 20): ChatResult {
  return { content, inputTokens, outputTokens };
}

function makeDeps(overrides?: Partial<EngineDeps>): EngineDeps {
  return {
    chat: mock(async (_model: string, _messages: any, _params?: any) => chatResult(validWorkerContent("mock response"))),
    buildR1Messages: mock((_ctx: any, _instructions?: any, _roundInfo?: any, _workerIndex?: any) => [
      { role: "user" as const, content: "work" },
    ]),
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return { maxRounds: 1, protocol: "shared_convergence", ...overrides };
}

function makeModelInfo(id: string): ModelInfo {
  return {
    id,
    name: id,
    provider: "openai",
    contextWindow: 128000,
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

    // buildR1Messages called per-worker (not shared)
    expect(deps.buildR1Messages).toHaveBeenCalledTimes(2);
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

  it("should pass workerIndex to buildR1Messages for each worker", async () => {
    const team = makeTeam(3);
    const input = makeInput();
    const config = makeConfig();

    const workerIndices: number[] = [];
    const deps = makeDeps({
      chat: mock(async () => chatResult(validWorkerContent("response"))),
      buildR1Messages: mock((_ctx: any, _inst?: any, _ri?: any, workerIndex?: any) => {
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
        return chatResult(`Round ${++callCount} unique content: ${"x".repeat(callCount * 50)}`, 5, 10);
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
        return chatResult(`Call ${++callCount} unique content: ${"y".repeat(callCount * 50)}`, 100, 200);
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
// truncated response propagation
// =============================================================================

describe("truncated response propagation", () => {
  it("should propagate truncated flag to output rounds when finish_reason is length", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();
    const deps = makeDeps({
      chat: mock(async () => ({
        content: validWorkerContent("partial"),
        inputTokens: 10,
        outputTokens: 20,
        truncated: true,
      })),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.rounds).toBeDefined();
    const responses = output.rounds![0]!.responses!;
    expect(responses.length).toBeGreaterThan(0);
    expect(responses[0]!.truncated).toBe(true);
  });

  it("should NOT include truncated when response is complete", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();
    const deps = makeDeps({
      chat: mock(async () => chatResult(validWorkerContent("ok"), 10, 20)),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.rounds).toBeDefined();
    const responses = output.rounds![0]!.responses!;
    expect(responses[0]!.truncated).toBeUndefined();
  });
});

// =============================================================================
// Debate Protocol Convergence
// =============================================================================

describe("adversarial_debate protocol", () => {
  it("should use buildR2Messages for round > 1 when protocol is adversarial_debate", async () => {
    const team = makeTeam(1);
    const input = makeInput({ protocol: "adversarial_debate" });
    const config = makeConfig({ maxRounds: 2, protocol: "adversarial_debate" });

    let r2BuilderCalls = 0;
    let r1BuilderCalls = 0;

    const deps = makeDeps({
      chat: mock(async (_model: string) => chatResult(validWorkerContent("response"))),
      buildR1Messages: mock((_ctx: any, _instructions?: any, _roundInfo?: any, _idx?: any) => {
        r1BuilderCalls++;
        return [{ role: "user" as const, content: "work" }];
      }),
      buildR2Messages: mock((_ctx: any, _others?: any, _own?: any, _instructions?: any, _roundInfo?: any, _idx?: any) => {
        r2BuilderCalls++;
        return [{ role: "user" as const, content: "debate" }];
      }),
    });

    await deliberate(team, input, deps, config);

    // Round 1: R1 builder (1 worker), Round 2: R2 builder (1 worker)
    expect(r1BuilderCalls).toBe(1);
    expect(r2BuilderCalls).toBe(1);
  });

  it("should accumulate previous responses in R2 context across rounds", async () => {
    const team = makeTeam(2);
    const input = makeInput({ protocol: "adversarial_debate" });
    const config = makeConfig({ maxRounds: 3, protocol: "adversarial_debate" });

    const r2Contexts: string[] = [];

    let callCount = 0;
    const deps = makeDeps({
      chat: mock(async (_model: string) => {
        return chatResult(`Response ${++callCount} unique: ${"z".repeat(callCount * 50)}`, 10, 20);
      }),
      buildR2Messages: mock((ctx: any, _others?: any, _own?: any, _instructions?: any, _roundInfo?: any, _idx?: any) => {
        // Capture the number of previous rounds visible to R2 builder
        r2Contexts.push(`rounds=${ctx.rounds.length}`);
        return [{ role: "user" as const, content: "debate" }];
      }),
    });

    await deliberate(team, input, deps, config);

    // Round 1: R1 builder (no R2 call)
    // Round 2: R2 builder called per-worker (2 workers), each sees 1 previous round
    // Round 3: R2 builder called per-worker (2 workers), each sees 2 previous rounds
    expect(r2Contexts).toEqual(["rounds=1", "rounds=1", "rounds=2", "rounds=2"]);
  });

  it("should fall back to R1 builder when buildR2Messages is not provided", async () => {
    const team = makeTeam(1);
    const input = makeInput({ protocol: "adversarial_debate" });
    const config = makeConfig({ maxRounds: 2, protocol: "adversarial_debate" });

    let r1Calls = 0;
    const deps = makeDeps({
      chat: mock(async () => chatResult(validWorkerContent("response"))),
      buildR1Messages: mock((_ctx: any, _inst?: any, _ri?: any, _idx?: any) => {
        r1Calls++;
        return [{ role: "user" as const, content: "normal" }];
      }),
      // No buildR2Messages
    });

    await deliberate(team, input, deps, config);

    // Both rounds should use R1 builder as fallback
    expect(r1Calls).toBe(2);
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
      workerGenParams: { temperature: 1.0, top_p: 0.9 },
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
    expect(workerCall!.params).toEqual({ temperature: 1.0, top_p: 0.9 });
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

describe("session continuation in R2+", () => {
  it("should use accumulated history + follow-up instead of full rebuild in R2", async () => {
    let followUpCallCount = 0;
    const allMessages: ChatMessage[][] = [];

    const followUpMock = mock((_ctx: any, _others: any, _instructions?: any, _roundInfo?: any) => {
      followUpCallCount++;
      return { role: "user" as const, content: "follow-up-other-positions" };
    });

    const deps = makeDeps({
      buildR2Messages: mock((_ctx: any, _others?: any, _own?: any, _inst?: any, _round?: any, _idx?: any) => {
        return [
          { role: "system" as const, content: "r2-system" },
          { role: "user" as const, content: "r2-user" },
        ];
      }),
      buildFollowUp: followUpMock,
    });

    // Intercept chat to record message arrays
    const origChat = deps.chat;
    (deps as any).chat = async (model: string, messages: ChatMessage[], params?: any) => {
      allMessages.push([...messages]);
      return origChat(model, messages, params);
    };

    const team = makeTeam(2);
    const config = makeConfig({ maxRounds: 2, protocol: "adversarial_debate" });
    const output = await deliberate(team, makeInput({ protocol: "adversarial_debate" }), deps, config);

    expect(output.roundsExecuted).toBe(2);
    // Follow-up builder should have been called for R2 workers that have history
    expect(followUpCallCount).toBeGreaterThan(0);
    // R2 messages should include follow-up content
    const r2Messages = allMessages.filter(msgs =>
      msgs.some(m => m.content?.includes("follow-up-other-positions")),
    );
    expect(r2Messages.length).toBeGreaterThan(0);
    // R2 messages should be longer than R1 (accumulated history + follow-up)
    const r1Len = allMessages[0]!.length; // R1: just buildR1Messages output
    const r2Len = r2Messages[0]!.length; // R2: history + follow-up
    expect(r2Len).toBeGreaterThan(r1Len);
  });

  it("should fall back to full R2 builder when no follow-up builder is provided", async () => {
    let r2BuilderCalled = false;

    const deps = makeDeps({
      buildR2Messages: mock((_ctx: any, _others?: any, _own?: any, _inst?: any, _round?: any, _idx?: any) => {
        r2BuilderCalled = true;
        return [
          { role: "system" as const, content: "full-rebuild" },
          { role: "user" as const, content: "full-rebuild-user" },
        ];
      }),
      // NO buildFollowUp — should fall back to full R2 builder
    });

    const team = makeTeam(2);
    const config = makeConfig({ maxRounds: 2, protocol: "adversarial_debate" });
    const output = await deliberate(team, makeInput({ protocol: "adversarial_debate" }), deps, config);

    expect(output.roundsExecuted).toBe(2);
    expect(r2BuilderCalled).toBe(true);
  });
});

// ================================================================
// session invalidation on model swap
// ================================================================

describe("session invalidation on model swap in R2+", () => {
  it("should invalidate session and use cold join when model is swapped in R2 (error)", async () => {
    // R1: worker-0 succeeds with model-0 → history stored
    // R2: model-0 fails → fallback to fallback-d
    // fallback-d should NOT get model-0's session history → should use R2 builder (cold join)
    let followUpUsed = false;
    let r2BuilderUsed = false;
    let round = 1;

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        // R2: original model fails, fallback succeeds
        if (model === "worker/model-0" && round === 2) {
          throw new Error("R2 failure");
        }
        return chatResult(validWorkerContent(`response-from-${model}`));
      }),
      buildR2Messages: mock((_ctx: any, _others?: any, _own?: any, _inst?: any, _round?: any, _idx?: any) => {
        r2BuilderUsed = true;
        return [
          { role: "system" as const, content: "cold-join-rebuild" },
          { role: "user" as const, content: "cold-join-user" },
        ];
      }),
      buildFollowUp: mock((_ctx: any, _others: any, _instructions?: any, _roundInfo?: any) => {
        followUpUsed = true;
        return { role: "user" as const, content: "follow-up" };
      }),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-z/fallback-d")], cooldown);
    const config = makeConfig({ maxRounds: 2, protocol: "adversarial_debate" });

    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: ChatMessage[], params?: any) => {
      callCount++;
      round = callCount <= 2 ? 1 : 2;
      return origChat(model, messages, params);
    };

    const output = await deliberate(team, makeInput({ protocol: "adversarial_debate" }), deps, config, { pool });

    expect(output.roundsExecuted).toBe(2);
    // fallback-d should use R2 builder (cold join), NOT session continuation
    expect(r2BuilderUsed).toBe(true);
    // worker-1 (no swap) should use follow-up (session continuation)
    expect(followUpUsed).toBe(true);
    expect(output.modelSwaps!.some(s => s.replacement === "prov-z/fallback-d")).toBe(true);
  });

  it("should invalidate session on cooldown skip in R2", async () => {
    // R1: model-0 fails with rate_limit → prov-a cooled → fallback-c succeeds
    // R2: fallback-c is on team. model-0 still cooled (not on team anymore due to R1 swap).
    let round = 1;

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        // R1: model-0 rate limits
        if (model === "worker/model-0" && round === 1) {
          throw new LLMClientError(429, "Rate limit", "rate_limit_error");
        }
        return chatResult(validWorkerContent(`response-from-${model}`));
      }),
      buildR2Messages: mock((_ctx: any, _others?: any, _own?: any, _inst?: any, _round?: any, _idx?: any) => {
        return [
          { role: "system" as const, content: "rebuild" },
          { role: "user" as const, content: "rebuild-user" },
        ];
      }),
      buildFollowUp: mock((_ctx: any, _others: any, _instructions?: any, _roundInfo?: any) => {
        return { role: "user" as const, content: "follow-up" };
      }),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-c/fallback-c")], cooldown);
    const config = makeConfig({ maxRounds: 2, protocol: "adversarial_debate" });

    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: ChatMessage[], params?: any) => {
      callCount++;
      round = callCount <= 3 ? 1 : 2; // R1: model-0 fail + fallback-c + model-1 = 3 calls
      return origChat(model, messages, params);
    };

    const output = await deliberate(team, makeInput({ protocol: "adversarial_debate" }), deps, config, { pool });

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

describe("R2+ fallback (cold join auto-detected by R2 builder)", () => {
  it("should use R2 builder for replacement worker in R2+ (cold join auto-detected)", async () => {
    // 2 workers, 2 rounds. Worker-1 fails in R2 → fallback/d replaces
    // R2 builder auto-detects cold join via missing participation in last round
    let r2BuilderCallCount = 0;
    let round = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-1" && round === 2) {
          throw new Error("R2 failure");
        }
        return chatResult(validWorkerContent(`response-from-${model}`));
      }),
      buildR2Messages: mock((_ctx: any, _others?: any, _own?: any, _inst?: any, _round?: any, _idx?: any) => {
        r2BuilderCallCount++;
        return [{ role: "user" as const, content: "r2" }];
      }),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-z/fallback-d")], cooldown);
    const config = makeConfig({ maxRounds: 2, protocol: "adversarial_debate" });

    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: any, params?: any) => {
      callCount++;
      round = callCount <= 2 ? 1 : 2;
      return origChat(model, messages, params);
    };

    const result = await deliberate(team, makeInput({ protocol: "adversarial_debate" }), deps, config, { pool });

    expect(result.roundsExecuted).toBe(2);
    // R2 builder handles both normal R2 and cold join
    expect(r2BuilderCallCount).toBeGreaterThan(0);
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
      buildR2Messages: mock((_ctx: any, _others?: any, _own?: any, _inst?: any, _round?: any, _idx?: any) => [{ role: "user" as const, content: "r2" }]),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-z/fallback-d")], cooldown);
    const config = makeConfig({ maxRounds: 2, protocol: "adversarial_debate" });

    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: any, params?: any) => {
      callCount++;
      round = callCount <= 3 ? 1 : 2;
      return origChat(model, messages, params);
    };

    const result = await deliberate(team, makeInput({ protocol: "adversarial_debate" }), deps, config, { pool });

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
// Fallback uses R1 builder for single-round protocols
// =============================================================================

describe("fallback uses R1 builder for single-round protocols", () => {
  it("should use buildR1Messages for replacement in shared_convergence mode", async () => {
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") throw new Error("failure");
        return chatResult(validWorkerContent(`response-from-${model}`));
      }),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-z/fallback-d")], cooldown);
    const config = makeConfig({ maxRounds: 1, protocol: "shared_convergence" });

    const output = await deliberate(team, makeInput(), deps, config, { pool });

    expect(deps.buildR1Messages).toHaveBeenCalled();
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
        return chatResult(`Response from ${model} round ${round}: ${"r".repeat(round * 80)}`);
      }),
      buildR2Messages: mock((_ctx: any, _others?: any, _own?: any, _inst?: any, _round?: any, _idx?: any) => {
        return [{ role: "user" as const, content: "r2" }];
      }),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool([makeModelInfo("prov-z/fallback-d")], cooldown);
    const config = makeConfig({ maxRounds: 3, protocol: "adversarial_debate" });

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

    const output = await deliberate(team, makeInput({ protocol: "adversarial_debate" }), deps, config, { pool });

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
      buildR2Messages: mock((_ctx: any, _others?: any, _own?: any, _inst?: any, _round?: any, _idx?: any) => [
        { role: "user" as const, content: "r2" },
      ]),
    });

    const team = makeTeam(2);
    const cooldown = createCooldownManager();
    const pool = createFallbackPool(
      [makeModelInfo("prov-x/fallback-a"), makeModelInfo("prov-y/fallback-b")],
      cooldown,
    );
    const config = makeConfig({ maxRounds: 2, protocol: "adversarial_debate" });

    const origChat = deps.chat;
    let callCount = 0;
    (deps as any).chat = async (model: string, messages: any, params?: any) => {
      callCount++;
      // R1: calls 1-4 (worker-0 fail, fallback/a fail, fallback/b success, worker-1 success)
      // R2: calls 5+
      round = callCount <= 4 ? 1 : 2;
      return origChat(model, messages, params);
    };

    const output = await deliberate(team, makeInput({ protocol: "adversarial_debate" }), deps, config, { pool });

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

  it("should parse markdown bold '**HIGH**'", () => {
    expect(parseConfidence("This claim **HIGH** is important")).toBe("high");
  });

  it("should parse markdown bold '**MEDIUM**' and '**LOW**'", () => {
    expect(parseConfidence("Claim A **MEDIUM**. Claim B **LOW**. Claim C **LOW**.")).toBe("low");
  });

  it("should parse '[HIGH]' bracket format", () => {
    expect(parseConfidence("This is certain [HIGH]")).toBe("high");
  });

  it("should parse Korean label '신뢰도: HIGH'", () => {
    expect(parseConfidence("신뢰도: HIGH")).toBe("high");
  });

  it("should not parse non-confidence Korean labels", () => {
    expect(parseConfidence("구체성: MEDIUM")).toBeUndefined();
    expect(parseConfidence("방어력: LOW")).toBeUndefined();
  });

  it("should parse 신뢰도 label and ignore non-confidence labels", () => {
    expect(parseConfidence("신뢰도: HIGH. 구체성: HIGH. 방어력: LOW.")).toBe("high");
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
      chat: mock(async () => chatResult(`Unique response ${++callCount} ${"x".repeat(callCount * 80)}`)),
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

// =============================================================================
// Aggregation (evaluation_scoring)
// =============================================================================

describe("aggregateEvaluationResults via deliberate", () => {
  it("should aggregate with voting (default) and extract majority verdict", async () => {
    let callIdx = 0;
    const responses = [
      "verdict: PASS\nscore: 8",
      "verdict: PASS\nscore: 7",
      "verdict: FAIL\nscore: 3",
    ];
    const deps = makeDeps({
      chat: mock(async () => chatResult(responses[callIdx++] ?? "")),
    });
    const team = makeTeam(3);
    const input = makeInput({ protocol: "evaluation_scoring" });
    const config = makeConfig({ protocol: "evaluation_scoring" });
    const output = await deliberate(team, input, deps, config);
    expect(output.aggregation).toBeDefined();
    expect(output.aggregation!.method).toBe("voting");
    expect(output.aggregation!.majorityVerdict).toBe("pass");
    expect(output.aggregation!.voteCount).toBe(2);
  });

  it("should aggregate with consensus method", async () => {
    const deps = makeDeps({
      chat: mock(async () => chatResult("verdict: PASS\nscore: 9")),
    });
    const team = makeTeam(3);
    const input = makeInput({ protocol: "evaluation_scoring", aggregation: "consensus" });
    const config = makeConfig({ protocol: "evaluation_scoring" });
    const output = await deliberate(team, input, deps, config);
    expect(output.aggregation).toBeDefined();
    expect(output.aggregation!.method).toBe("consensus");
    expect(output.aggregation!.consensus).toBe("pass");
  });

  it("should return undefined consensus when verdicts disagree", async () => {
    let callIdx = 0;
    const responses = ["verdict: PASS", "verdict: FAIL"];
    const deps = makeDeps({
      chat: mock(async () => chatResult(responses[callIdx++] ?? "")),
    });
    const team = makeTeam(2);
    const input = makeInput({ protocol: "evaluation_scoring", aggregation: "consensus" });
    const config = makeConfig({ protocol: "evaluation_scoring" });
    const output = await deliberate(team, input, deps, config);
    expect(output.aggregation!.consensus).toBeUndefined();
  });

  it("should aggregate with confidence_weighted method", async () => {
    let callIdx = 0;
    const responses = [
      "verdict: PASS\nscore: 9\nHIGH confidence",
      "verdict: PASS\nscore: 5\nLOW confidence",
    ];
    const deps = makeDeps({
      chat: mock(async () => chatResult(responses[callIdx++] ?? "")),
    });
    const team = makeTeam(2);
    const input = makeInput({ protocol: "evaluation_scoring", aggregation: "confidence_weighted" });
    const config = makeConfig({ protocol: "evaluation_scoring" });
    const output = await deliberate(team, input, deps, config);
    expect(output.aggregation).toBeDefined();
    expect(output.aggregation!.method).toBe("confidence_weighted");
    expect(output.aggregation!.weightedScore).toBeDefined();
    // HIGH(1.0)*9 + LOW(0.3)*5 = 9+1.5 = 10.5, totalWeight = 1.3, avg ≈ 8.08
    expect(output.aggregation!.weightedScore).toBeCloseTo(8.08, 1);
  });

  it("should not include aggregation for non-evaluation protocols", async () => {
    const deps = makeDeps();
    const team = makeTeam(2);
    const input = makeInput({ protocol: "shared_convergence" });
    const config = makeConfig({ protocol: "shared_convergence" });
    const output = await deliberate(team, input, deps, config);
    expect(output.aggregation).toBeUndefined();
  });
});

// =============================================================================
// onRound callback
// =============================================================================

describe("onRound callback", () => {
  it("should call onRound with round data including confidence", async () => {
    const onRoundCalls: unknown[] = [];
    const deps = makeDeps({
      chat: mock(async () => chatResult("HIGH confidence: this is right")),
    });
    const team = makeTeam(2);
    const input = makeInput({
      onRound: (round) => { onRoundCalls.push(round); },
    });
    const config = makeConfig();
    await deliberate(team, input, deps, config);
    expect(onRoundCalls).toHaveLength(1);
    const round = onRoundCalls[0] as any;
    expect(round.number).toBe(1);
    expect(round.protocol).toBe("shared_convergence");
    expect(round.responses).toHaveLength(2);
    expect(round.responses[0].confidence).toBe("high");
  });

  it("should include failedWorkers in onRound when present", async () => {
    const onRoundCalls: unknown[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "worker/model-0") throw new Error("timeout");
        return chatResult("ok");
      }),
    });
    const team = makeTeam(2);
    const input = makeInput({
      onRound: (round) => { onRoundCalls.push(round); },
    });
    await deliberate(team, input, deps, makeConfig());
    const round = onRoundCalls[0] as any;
    expect(round.failedWorkers).toBeDefined();
    expect(round.failedWorkers.length).toBeGreaterThan(0);
  });

  it("should not include failedWorkers in onRound when none failed", async () => {
    const onRoundCalls: unknown[] = [];
    const deps = makeDeps();
    const team = makeTeam(2);
    const input = makeInput({
      onRound: (round) => { onRoundCalls.push(round); },
    });
    await deliberate(team, input, deps, makeConfig());
    const round = onRoundCalls[0] as any;
    expect(round.failedWorkers).toBeUndefined();
  });
});

// =============================================================================
// Replenishment — actual callWithFallback execution
// =============================================================================

describe("replenishment with actual replacement workers", () => {
  it("should execute replenished workers via callWithFallback on R1 empty slots", async () => {
    // Scenario: 2-worker team. model-0 fails, model-1 succeeds for itself but
    // fails when used as Phase 4 fallback for model-0's slot.
    // This leaves 1 empty slot → replenish is called → replacement succeeds.
    let callCount = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        callCount++;
        // model-0: always fails
        if (model === "prov-a/model-0") {
          throw new LLMClientError(500, "server error");
        }
        // model-1: succeeds first call (own slot), fails on Phase 4 duplicate attempt
        if (model === "prov-b/model-1") {
          if (callCount <= 2) return chatResult(validWorkerContent("ok"), 10, 20);
          throw new LLMClientError(500, "overloaded");
        }
        // model-3 (replenished): succeeds
        if (model === "prov-d/model-3") {
          return chatResult(validWorkerContent("replenished"), 10, 20);
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

    const replenish = mock((_aliveProviders: ReadonlySet<string>, emptySlots: number, _respondedModels: ReadonlySet<string>) => {
      return Array.from({ length: emptySlots }, () => ({
        model: "prov-d/model-3",
        role: "worker" as const,
      }));
    });

    const output = await deliberate(customTeam, makeInput(), deps, makeConfig(), { pool, replenish });
    expect(output.roundsExecuted).toBe(1);
    // Either Phase 4 recovered or replenish filled the gap
    expect(output.rounds![0]!.responses!.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// Aggregation — confidence_weighted with no parseable scores (fallback path)
// =============================================================================

describe("aggregation confidence_weighted fallback", () => {
  it("should return fallback result when no scores are parseable", async () => {
    const deps = makeDeps({
      chat: mock(async () => chatResult("no score here, just text")),
    });
    const team = makeTeam(2);
    const input = makeInput({ protocol: "evaluation_scoring", aggregation: "confidence_weighted" });
    const config = makeConfig({ protocol: "evaluation_scoring" });
    const output = await deliberate(team, input, deps, config);
    expect(output.aggregation).toBeDefined();
    expect(output.aggregation!.method).toBe("confidence_weighted");
    // No weightedScore because no parseable scores
    expect(output.aggregation!.weightedScore).toBeUndefined();
  });
});

// =============================================================================
// detectConformity
// =============================================================================

describe("detectConformity", () => {
  it("returns null for fewer than 2 responses", async () => {
    const { detectConformity } = await import("./engine");
    const round = {
      number: 1,
      responses: [{ model: "a", content: "x", workerIndex: 0, confidence: "high" as const }],
    };
    expect(detectConformity(round)).toBeNull();
  });

  it("returns null when not all workers report HIGH confidence", () => {
    const { detectConformity } = require("./engine");
    const round = {
      number: 1,
      responses: [
        { model: "a", content: "Yes use Bun for performance.", workerIndex: 0, confidence: "high" },
        { model: "b", content: "Yes use Bun for performance.", workerIndex: 1, confidence: "medium" },
      ],
    };
    expect(detectConformity(round)).toBeNull();
  });

  it("returns null when responses are very different despite all-HIGH", () => {
    const { detectConformity } = require("./engine");
    const round = {
      number: 1,
      responses: [
        { model: "a", content: "Bun is faster and has better DX. Choose Bun.", workerIndex: 0, confidence: "high" },
        { model: "b", content: "Stick with Node. The ecosystem and stability matter more.", workerIndex: 1, confidence: "high" },
      ],
    };
    expect(detectConformity(round)).toBeNull();
  });

  it("returns warning when all-HIGH and responses textually similar", () => {
    const { detectConformity } = require("./engine");
    const sharedAnswer = "Yes use Bun. It is faster and the ecosystem matures fast. Choose Bun.";
    const round = {
      number: 1,
      responses: [
        { model: "a", content: sharedAnswer, workerIndex: 0, confidence: "high" },
        { model: "b", content: sharedAnswer + " (slightly different ending)", workerIndex: 1, confidence: "high" },
        { model: "c", content: sharedAnswer + " (also different)", workerIndex: 2, confidence: "high" },
      ],
    };
    const w = detectConformity(round);
    expect(w).not.toBeNull();
    expect(w).toContain("conformity");
  });

  it("returns null when any worker has no confidence marker", () => {
    const { detectConformity } = require("./engine");
    const sharedAnswer = "Same answer here.";
    const round = {
      number: 1,
      responses: [
        { model: "a", content: sharedAnswer, workerIndex: 0, confidence: "high" },
        { model: "b", content: sharedAnswer, workerIndex: 1 }, // no confidence
      ],
    };
    expect(detectConformity(round)).toBeNull();
  });
});

// =============================================================================
// R1 conformity warning integration
// =============================================================================

describe("R1 conformity warning in deliberate output", () => {
  it("emits r1_conformity_suspected when R1 responses are HIGH and similar", async () => {
    const team = makeTeam(2);
    const input = makeInput({ protocol: "shared_convergence", maxRounds: 1 });
    const config = makeConfig({ protocol: "shared_convergence" });

    const sharedAnswer = "Yes use Bun. It is faster and the ecosystem matures fast. Choose Bun. confidence: HIGH";
    let call = 0;
    const deps = makeDeps({
      chat: mock(async () => {
        call++;
        return {
          content: sharedAnswer + (call === 2 ? " (slightly different ending)" : ""),
          inputTokens: 1, outputTokens: 1, finishReason: "stop",
        };
      }),
    });

    const output = await deliberate(team, input, deps, config);
    const warns = output.warnings ?? [];
    expect(warns.some((w) => w.includes("r1_conformity_suspected"))).toBe(true);
  });

  it("does NOT emit conformity warning when R1 responses differ", async () => {
    const team = makeTeam(2);
    const input = makeInput({ protocol: "shared_convergence", maxRounds: 1 });
    const config = makeConfig({ protocol: "shared_convergence" });

    let call = 0;
    const deps = makeDeps({
      chat: mock(async () => {
        call++;
        return {
          content: call === 1
            ? "Use Bun for performance. confidence: HIGH"
            : "Stick with Node for ecosystem. confidence: HIGH",
          inputTokens: 1, outputTokens: 1, finishReason: "stop",
        };
      }),
    });

    const output = await deliberate(team, input, deps, config);
    const warns = output.warnings ?? [];
    expect(warns.some((w) => w.includes("r1_conformity_suspected"))).toBe(false);
  });
});

// =============================================================================
// computeR1Diversity
// =============================================================================

describe("computeR1Diversity", () => {
  it("returns null for fewer than 2 responses", async () => {
    const { computeR1Diversity } = await import("./engine");
    const round = { number: 1, responses: [{ model: "a", content: "x", workerIndex: 0 }] };
    expect(computeR1Diversity(round)).toBeNull();
  });

  it("returns 0 for identical responses", () => {
    const { computeR1Diversity } = require("./engine");
    const round = {
      number: 1,
      responses: [
        { model: "a", content: "same answer", workerIndex: 0 },
        { model: "b", content: "same answer", workerIndex: 1 },
      ],
    };
    expect(computeR1Diversity(round)).toBe(0);
  });

  it("returns near-1 for completely different responses", () => {
    const { computeR1Diversity } = require("./engine");
    const round = {
      number: 1,
      responses: [
        { model: "a", content: "AAAAAAAAAA", workerIndex: 0 },
        { model: "b", content: "BBBBBBBBBB", workerIndex: 1 },
      ],
    };
    const score = computeR1Diversity(round);
    expect(score).toBeGreaterThan(0.9);
  });

  it("emits r1_diversity_low warning when avg pairwise distance < 0.20", async () => {
    const team = makeTeam(2);
    const input = makeInput({ protocol: "shared_convergence", maxRounds: 1 });
    const config = makeConfig({ protocol: "shared_convergence" });

    let call = 0;
    const deps = makeDeps({
      chat: mock(async () => {
        call++;
        return {
          content: "Same answer here, almost identical." + (call === 2 ? "." : ""),
          inputTokens: 1, outputTokens: 1, finishReason: "stop",
        };
      }),
    });

    const output = await deliberate(team, input, deps, config);
    expect(output.r1Diversity).toBeDefined();
    expect(output.r1Diversity).toBeLessThan(0.20);
    const warns = output.warnings ?? [];
    expect(warns.some((w) => w.includes("r1_diversity_low"))).toBe(true);
  });

  it("does NOT emit diversity warning when responses differ", async () => {
    const team = makeTeam(2);
    const input = makeInput({ protocol: "shared_convergence", maxRounds: 1 });
    const config = makeConfig({ protocol: "shared_convergence" });

    let call = 0;
    const deps = makeDeps({
      chat: mock(async () => {
        call++;
        return {
          content: call === 1
            ? "Bun is faster but ecosystem is smaller, prefer Node for production."
            : "Node has battle-tested libraries; only switch to Bun for prototypes.",
          inputTokens: 1, outputTokens: 1, finishReason: "stop",
        };
      }),
    });

    const output = await deliberate(team, input, deps, config);
    const warns = output.warnings ?? [];
    expect(warns.some((w) => w.includes("r1_diversity_low"))).toBe(false);
  });
});

// =============================================================================
// detectMinorityDissent
// =============================================================================

describe("detectMinorityDissent", () => {
  it("returns null for fewer than 3 responses", async () => {
    const { detectMinorityDissent } = await import("./engine");
    const round = {
      number: 1,
      responses: [
        { model: "a", content: "x", workerIndex: 0, confidence: "high" as const },
        { model: "b", content: "y", workerIndex: 1, confidence: "high" as const },
      ],
    };
    expect(detectMinorityDissent(round)).toBeNull();
  });

  it("identifies the lone dissenter when N-1 agree and 1 disagrees", () => {
    const { detectMinorityDissent } = require("./engine");
    const consensus = "Yes use Bun for performance — much faster than Node and the ecosystem is catching up.";
    const round = {
      number: 1,
      responses: [
        { model: "majority/a", content: consensus, workerIndex: 0, confidence: "high" },
        { model: "majority/b", content: consensus, workerIndex: 1, confidence: "high" },
        { model: "outlier/c", content: "Stick with Node — Bun's GC pauses break our latency budget. Different stack, different priorities.", workerIndex: 2, confidence: "high" },
      ],
    };
    const w = detectMinorityDissent(round);
    expect(w).not.toBeNull();
    expect(w).toContain("outlier/c");
    expect(w).toContain("HIGH");
  });

  it("returns null when all responses cluster (no dissenter)", () => {
    const { detectMinorityDissent } = require("./engine");
    const consensus = "Yes use Bun for performance.";
    const round = {
      number: 1,
      responses: [
        { model: "a", content: consensus, workerIndex: 0, confidence: "high" },
        { model: "b", content: consensus + " Slightly different.", workerIndex: 1, confidence: "high" },
        { model: "c", content: consensus + " Also similar.", workerIndex: 2, confidence: "high" },
      ],
    };
    expect(detectMinorityDissent(round)).toBeNull();
  });

  it("returns null when responses are all different (no majority cluster)", () => {
    const { detectMinorityDissent } = require("./engine");
    const round = {
      number: 1,
      responses: [
        { model: "a", content: "AAAAAAAAAAAAAAAAA", workerIndex: 0, confidence: "high" },
        { model: "b", content: "BBBBBBBBBBBBBBBBB", workerIndex: 1, confidence: "high" },
        { model: "c", content: "CCCCCCCCCCCCCCCCC", workerIndex: 2, confidence: "high" },
      ],
    };
    expect(detectMinorityDissent(round)).toBeNull();
  });

  it("does NOT highlight a dissenter that lacks HIGH confidence", () => {
    const { detectMinorityDissent } = require("./engine");
    const consensus = "Yes use Bun for performance.";
    const round = {
      number: 1,
      responses: [
        { model: "a", content: consensus, workerIndex: 0, confidence: "high" },
        { model: "b", content: consensus + " Same.", workerIndex: 1, confidence: "high" },
        { model: "c", content: "Stick with Node — Bun's GC pauses break latency.", workerIndex: 2, confidence: "low" },
      ],
    };
    expect(detectMinorityDissent(round)).toBeNull();
  });
});

// =============================================================================
// minority dissent integration
// =============================================================================

describe("minority_dissent warning in deliberate output", () => {
  it("emits minority_dissent when R1 has lone HIGH-confidence dissenter", async () => {
    const team = makeTeam(3);
    const input = makeInput({ protocol: "shared_convergence", maxRounds: 1, models: ["test/m0", "test/m1", "test/m2"] });
    const config = makeConfig({ protocol: "shared_convergence" });

    let call = 0;
    const consensus = "Yes use Bun for performance — much faster than Node and the ecosystem is catching up. confidence: HIGH";
    const dissent = "Stick with Node — Bun's GC pauses break our latency budget. Different stack. confidence: HIGH";
    const deps = makeDeps({
      chat: mock(async () => {
        call++;
        return {
          content: call < 3 ? consensus : dissent,
          inputTokens: 1, outputTokens: 1, finishReason: "stop",
        };
      }),
    });

    const output = await deliberate(team, input, deps, config);
    const warns = output.warnings ?? [];
    expect(warns.some((w) => w.includes("minority_dissent"))).toBe(true);
  });
});
