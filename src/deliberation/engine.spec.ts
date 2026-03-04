/**
 * Unit tests for engine.ts — Diverge-Synth Deliberation Engine.
 */

import { describe, it, expect, mock } from "bun:test";
import {
  parseSynthesis,
  executeRound,
  deliberate,
  RoundExecutionError,
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
  return {
    workers,
    leader: { model: "leader/model", role: "leader" as const },
  };
}

function makeInput(overrides?: Partial<DeliberateInput>): DeliberateInput {
  return {
    task: "Write a function",
    ...overrides,
  };
}

function chatResult(content: string, inputTokens = 10, outputTokens = 20): ChatResult {
  return { content, inputTokens, outputTokens };
}

function makeDeps(overrides?: Partial<EngineDeps>): EngineDeps {
  return {
    chat: mock(async () => chatResult("mock response")),
    buildWorkerMessages: mock((_ctx, _instructions?, _roundInfo?) => [
      { role: "user" as const, content: "work" },
    ]),
    buildLeaderMessages: mock((_ctx, _instructions?, _roundInfo?) => [
      { role: "user" as const, content: "lead" },
    ]),
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return { maxRounds: 1, leaderContributes: false, ...overrides };
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
// parseSynthesis
// =============================================================================

describe("parseSynthesis", () => {
  it("should return plain text content when consensus mode is not set", () => {
    const result = parseSynthesis("leader/model", "Some plain text response");

    expect(result).toEqual({ content: "Some plain text response" });
    expect(result.decision).toBeUndefined();
  });

  it("should return plain text content without parsing JSON when consensus is undefined", () => {
    const json = JSON.stringify({ result: "parsed", decision: "approve" });
    const result = parseSynthesis("leader/model", json);

    // Without consensus, JSON is treated as raw text — no parsing
    expect(result).toEqual({ content: json });
    expect(result.decision).toBeUndefined();
  });

  it("should parse JSON with decision field when consensus mode is set", () => {
    const json = JSON.stringify({ result: "synthesized answer", decision: "approve" });
    const result = parseSynthesis("leader/model", json, "leader_decides");

    expect(result.content).toBe("synthesized answer");
    expect(result.decision).toBe("approve");
  });

  it("should parse JSON with continue decision when consensus mode is set", () => {
    const json = JSON.stringify({ result: "needs more work", decision: "continue" });
    const result = parseSynthesis("leader/model", json, "leader_decides");

    expect(result.content).toBe("needs more work");
    expect(result.decision).toBe("continue");
  });

  it("should extract content field when result field is absent", () => {
    const json = JSON.stringify({ content: "from content field", decision: "approve" });
    const result = parseSynthesis("leader/model", json, "leader_decides");

    expect(result.content).toBe("from content field");
    expect(result.decision).toBe("approve");
  });

  it("should return parsed JSON without decision when decision field is missing", () => {
    const json = JSON.stringify({ result: "no decision here" });
    const result = parseSynthesis("leader/model", json, "leader_decides");

    expect(result.content).toBe("no decision here");
    expect(result.decision).toBeUndefined();
  });

  it("should ignore invalid decision values and return undefined decision", () => {
    const json = JSON.stringify({ result: "answer", decision: "escalate" });
    const result = parseSynthesis("leader/model", json, "leader_decides");

    expect(result.content).toBe("answer");
    expect(result.decision).toBeUndefined();
  });

  it("should fall back to raw text when JSON is invalid in consensus mode", () => {
    const text = "This is not valid JSON {{{";
    const result = parseSynthesis("leader/model", text, "leader_decides");

    expect(result.content).toBe(text);
    expect(result.decision).toBeUndefined();
  });

  it("should unwrap markdown-wrapped JSON code blocks", () => {
    const inner = JSON.stringify({ result: "unwrapped", decision: "approve" });
    const wrapped = "```json\n" + inner + "\n```";
    const result = parseSynthesis("leader/model", wrapped, "leader_decides");

    expect(result.content).toBe("unwrapped");
    expect(result.decision).toBe("approve");
  });

  it("should unwrap generic markdown code blocks without json tag", () => {
    const inner = JSON.stringify({ result: "generic block", decision: "continue" });
    const wrapped = "```\n" + inner + "\n```";
    const result = parseSynthesis("leader/model", wrapped, "leader_decides");

    expect(result.content).toBe("generic block");
    expect(result.decision).toBe("continue");
  });

  it("should handle case-insensitive JSON wrapping", () => {
    const response = '```JSON\n{"result":"test","decision":"approve"}\n```';
    const { content, decision } = parseSynthesis("m1", response, "leader_decides");
    expect(content).toBe("test");
    expect(decision).toBe("approve");
  });

  it("should fall back to raw response when JSON has no result or content field", () => {
    const json = JSON.stringify({ decision: "approve", other: "data" });
    const raw = json;
    const result = parseSynthesis("leader/model", raw, "leader_decides");

    // Falls back to raw response since neither result nor content exists
    expect(result.content).toBe(raw);
    expect(result.decision).toBe("approve");
  });
});

// =============================================================================
// executeRound
// =============================================================================

describe("executeRound", () => {
  it("should execute a successful round with 2 workers and a leader", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    let callIndex = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        callIndex++;
        if (model.startsWith("worker/")) {
          return chatResult(`worker-response-${callIndex}`, 10, 20);
        }
        return chatResult("leader-synthesis", 15, 25);
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
    expect(round.synthesis).toBeDefined();
    expect(round.synthesis!.model).toBe("leader/model");
    expect(round.synthesis!.content).toBe("leader-synthesis");

    // Token accumulation: 2 workers (10+10=20 input, 20+20=40 output) + leader (15 input, 25 output)
    expect(tokens.input).toBe(35);
    expect(tokens.output).toBe(65);

    // buildWorkerMessages called once (shared messages), chat called for each worker + leader
    expect(deps.buildWorkerMessages).toHaveBeenCalledTimes(1);
    expect(deps.buildLeaderMessages).toHaveBeenCalledTimes(1);
    expect(deps.chat).toHaveBeenCalledTimes(3); // 2 workers + 1 leader
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
        if (model === "worker/model-1") {
          return chatResult("worker-1-ok", 10, 20);
        }
        return chatResult("leader-synthesis", 15, 25);
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    const { round, tokens } = await executeRound(ctx, 1, deps, config, input);

    // Only worker-1 succeeded
    expect(round.responses).toHaveLength(1);
    expect(round.responses[0]!.model).toBe("worker/model-1");
    expect(round.synthesis!.content).toBe("leader-synthesis");

    // Tokens: 1 successful worker (10 input, 20 output) + leader (15 input, 25 output)
    expect(tokens.input).toBe(25);
    expect(tokens.output).toBe(45);
  });

  it("should throw RoundExecutionError with role 'worker' when all workers fail", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          throw new Error("all workers down");
        }
        return chatResult("unreachable");
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

  it("should throw RoundExecutionError with role 'leader' when leader call fails", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult("worker-ok", 10, 20);
        }
        throw new Error("leader exploded");
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
      expect(re.role).toBe("leader");
      expect(re.modelId).toBe("leader/model");
    }
  });

  it("should accumulate tokens from all workers and the leader", async () => {
    const team = makeTeam(3);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult("w", 100, 200);
        }
        return chatResult("leader", 50, 75);
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    const { tokens } = await executeRound(ctx, 1, deps, config, input);

    // 3 workers * (100 + 200) + leader (50 + 75)
    expect(tokens.input).toBe(350);
    expect(tokens.output).toBe(675);
  });

  it("should pass consensus config to parseSynthesis when consensus is set", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ consensus: "leader_decides" });

    const leaderJson = JSON.stringify({ result: "done", decision: "approve" });
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult("worker-ok");
        }
        return chatResult(leaderJson);
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    const { round } = await executeRound(ctx, 1, deps, config, input);

    expect(round.synthesis!.content).toBe("done");
    expect(round.synthesis!.decision).toBe("approve");
  });

  it("should not include decision in synthesis when consensus is not set", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig(); // no consensus

    const leaderJson = JSON.stringify({ result: "done", decision: "approve" });
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult("worker-ok");
        }
        return chatResult(leaderJson);
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    const { round } = await executeRound(ctx, 1, deps, config, input);

    // Without consensus mode, parseSynthesis returns raw text, no decision
    expect(round.synthesis!.content).toBe(leaderJson);
    expect(round.synthesis!.decision).toBeUndefined();
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
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult("worker-response", 10, 20);
        }
        return chatResult("final-synthesis", 15, 25);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.result).toBe("final-synthesis");
    expect(output.roundsExecuted).toBe(1);
    expect(output.consensusReached).toBe(true); // no consensus mode = always true
    expect(output.totalLLMCalls).toBe(3); // 2 workers + 1 leader
    expect(output.modelsUsed).toContain("worker/model-0");
    expect(output.modelsUsed).toContain("worker/model-1");
    expect(output.modelsUsed).toContain("leader/model");
    expect(output.totalTokens.input).toBe(35);  // 10 + 10 + 15
    expect(output.totalTokens.output).toBe(65);  // 20 + 20 + 25
  });

  it("should run all rounds when no consensus mode is set", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 3 });

    let roundCount = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult("worker", 5, 10);
        }
        roundCount++;
        return chatResult(`synthesis-round-${roundCount}`, 8, 12);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.roundsExecuted).toBe(3);
    expect(output.consensusReached).toBe(true); // no consensus = always true after all rounds
    expect(output.result).toBe("synthesis-round-3"); // last round's synthesis
    expect(output.totalLLMCalls).toBe(6); // 3 rounds * (1 worker + 1 leader)
  });

  it("should stop early when leader approves in consensus mode", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 5, consensus: "leader_decides" });

    let roundCount = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult("worker", 5, 10);
        }
        roundCount++;
        // Approve on round 2
        if (roundCount === 2) {
          return chatResult(
            JSON.stringify({ result: "approved-answer", decision: "approve" }),
            8, 12,
          );
        }
        return chatResult(
          JSON.stringify({ result: "not yet", decision: "continue" }),
          8, 12,
        );
      }),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.roundsExecuted).toBe(2); // stopped at round 2, not 5
    expect(output.consensusReached).toBe(true);
    expect(output.result).toBe("approved-answer");
  });

  it("should report consensusReached=false when consensus mode is set but leader never approves", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 2, consensus: "leader_decides" });

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult("worker", 5, 10);
        }
        return chatResult(
          JSON.stringify({ result: "still thinking", decision: "continue" }),
          8, 12,
        );
      }),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.roundsExecuted).toBe(2);
    expect(output.consensusReached).toBe(false);
    expect(output.result).toBe("still thinking");
  });

  it("should accumulate tokens across multiple rounds", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 3 });

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult("w", 100, 200);
        }
        return chatResult("leader", 50, 75);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    // Per round: 2 workers * (100 in, 200 out) + 1 leader * (50 in, 75 out) = 250 in, 475 out
    // 3 rounds: 750 in, 1425 out
    expect(output.totalTokens.input).toBe(750);
    expect(output.totalTokens.output).toBe(1425);
    expect(output.roundsExecuted).toBe(3);
    expect(output.totalLLMCalls).toBe(9); // 3 * (2 + 1)
  });

  it("should include rounds summary in output", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 2 });

    let roundCount = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult("worker-response", 5, 10);
        }
        roundCount++;
        return chatResult(`synthesis-${roundCount}`, 8, 12);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.rounds).toBeDefined();
    expect(output.rounds).toHaveLength(2);
    expect(output.rounds![0]!.number).toBe(1);
    expect(output.rounds![0]!.synthesis).toBe("synthesis-1");
    expect(output.rounds![1]!.number).toBe(2);
    expect(output.rounds![1]!.synthesis).toBe("synthesis-2");
  });

  it("should use default config (maxRounds=1, no consensus) when config is omitted", async () => {
    const team = makeTeam(1);
    const input = makeInput();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult("worker");
        }
        return chatResult("default-config-result");
      }),
    });

    const output = await deliberate(team, input, deps); // no config

    expect(output.roundsExecuted).toBe(1);
    expect(output.consensusReached).toBe(true);
    expect(output.result).toBe("default-config-result");
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
          return chatResult("replacement-ok", 10, 20);
        }
        // leader
        return chatResult("leader-ok", 15, 25);
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
    expect(output.result).toBe("leader-ok");
    expect(cooldown.isOnCooldown("worker/model-0")).toBe(true);
  });

  it("should retry with a replacement leader when a leader RoundExecutionError occurs", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult("worker-ok", 10, 20);
        }
        if (model === "leader/model") {
          throw new Error("leader down");
        }
        // replacement leader
        return chatResult("replacement-leader-ok", 15, 25);
      }),
    });

    const cooldown = createCooldownManager();
    const retryDeps: RetryDeps = {
      cooldown,
      getModels: () => [makeModelInfo("replacement/leader-1")],
      maxRetries: 1,
    };

    const output = await deliberate(team, input, deps, config, retryDeps);

    expect(output.roundsExecuted).toBe(1);
    expect(output.result).toBe("replacement-leader-ok");
    expect(cooldown.isOnCooldown("leader/model")).toBe(true);
  });

  it("should rethrow RoundExecutionError when no retryDeps are provided", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 1 });

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          throw new Error("all workers down");
        }
        return chatResult("unreachable");
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
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          throw new Error("worker down");
        }
        return chatResult("unreachable");
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
        if (model.startsWith("worker/")) {
          return chatResult("ok", 10, 20);
        }
        return chatResult("synthesis", 15, 25);
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
      chat: mock(async () => chatResult("ok", 10, 20)),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.rounds).toBeDefined();
    expect(output.rounds![0]!.failedWorkers).toBeUndefined();
  });
});

// =============================================================================
// leaderContributes — leader participates in diverge phase
// =============================================================================

describe("leaderContributes", () => {
  it("should include leader's independent response in worker phase when enabled", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ leaderContributes: true });

    const calledModels: string[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        calledModels.push(model);
        if (model === "leader/model" && calledModels.filter((m) => m === "leader/model").length === 1) {
          // First call: leader as worker
          return chatResult("leader-independent-opinion", 12, 18);
        }
        if (model === "leader/model") {
          // Second call: leader as synthesizer
          return chatResult("leader-synthesis", 15, 25);
        }
        return chatResult(`${model}-response`, 10, 20);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    // Leader called twice: once as worker, once as synthesizer
    expect(calledModels.filter((m) => m === "leader/model")).toHaveLength(2);
    // Total participants in diverge: 2 workers + 1 leader = 3
    // Plus 1 leader synthesis = 4 total LLM calls
    expect(output.totalLLMCalls).toBe(4);
    // Leader appears in modelsUsed (from its worker response)
    expect(output.modelsUsed).toContain("leader/model");
  });

  it("should have leader see its own response during synthesis", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ leaderContributes: true });

    let synthesisMsgCount = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "leader/model") {
          return chatResult("leader-opinion", 10, 20);
        }
        return chatResult("worker-response", 10, 20);
      }),
      buildLeaderMessages: mock((ctx) => {
        // Leader should see responses from both worker AND itself
        const lastRound = ctx.rounds[ctx.rounds.length - 1];
        if (lastRound) {
          synthesisMsgCount = lastRound.responses.length;
        }
        return [{ role: "user" as const, content: "synthesize" }];
      }),
    });

    await deliberate(team, input, deps, config);

    // 1 worker + 1 leader (as worker) = 2 responses visible to leader during synthesis
    expect(synthesisMsgCount).toBe(2);
  });

  it("should NOT include leader in diverge phase when leaderContributes is false", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ leaderContributes: false });

    const calledModels: string[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        calledModels.push(model);
        return chatResult("response", 10, 20);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    // Leader called only once (synthesis)
    expect(calledModels.filter((m) => m === "leader/model")).toHaveLength(1);
    // 2 workers + 1 leader synthesis = 3 total
    expect(output.totalLLMCalls).toBe(3);
  });

  it("should default to leaderContributes=true when config is undefined", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    // No config — uses DEFAULT_CONFIG which has leaderContributes: true

    const calledModels: string[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        calledModels.push(model);
        return chatResult("response", 10, 20);
      }),
    });

    await deliberate(team, input, deps);

    // Leader should be called twice (worker + synthesis)
    expect(calledModels.filter((m) => m === "leader/model")).toHaveLength(2);
  });

  it("should track leader failure in failedWorkers when it fails during diverge", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ leaderContributes: true });

    let leaderCallCount = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model === "leader/model") {
          leaderCallCount++;
          if (leaderCallCount === 1) {
            // Leader fails as worker
            throw new Error("leader worker phase timeout");
          }
          // Leader succeeds as synthesizer
          return chatResult("synthesis", 15, 25);
        }
        return chatResult("worker-ok", 10, 20);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    // Leader failed in worker phase should appear in failedWorkers
    expect(output.rounds![0]!.failedWorkers).toHaveLength(1);
    expect(output.rounds![0]!.failedWorkers![0]!.model).toBe("leader/model");
    expect(output.rounds![0]!.failedWorkers![0]!.error).toContain("leader worker phase timeout");
    // But synthesis still succeeded
    expect(output.result).toBe("synthesis");
  });
});

// =============================================================================
// Debate Protocol Convergence (Risk 3)
// =============================================================================

describe("debate protocol", () => {
  it("should use buildDebateWorkerMessages for round > 1 when protocol is debate", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 2, protocol: "debate" });

    let debateBuilderCalls = 0;
    let normalBuilderCalls = 0;

    const deps = makeDeps({
      chat: mock(async (_model: string) => chatResult("response")),
      buildWorkerMessages: mock((_ctx, _instructions?, _roundInfo?) => {
        normalBuilderCalls++;
        return [{ role: "user" as const, content: "work" }];
      }),
      buildDebateWorkerMessages: mock((_ctx, _instructions?, _roundInfo?) => {
        debateBuilderCalls++;
        return [{ role: "user" as const, content: "debate" }];
      }),
    });

    await deliberate(team, input, deps, config);

    // Round 1: normal builder, Round 2: debate builder
    expect(normalBuilderCalls).toBe(1);
    expect(debateBuilderCalls).toBe(1);
  });

  it("should stop early when leader approves in debate consensus mode", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({
      maxRounds: 5,
      protocol: "debate",
      consensus: "leader_decides",
    });

    let roundCount = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult("worker-debate", 5, 10);
        }
        roundCount++;
        if (roundCount === 2) {
          return chatResult(
            JSON.stringify({ result: "debate-approved", decision: "approve" }),
            8, 12,
          );
        }
        return chatResult(
          JSON.stringify({ result: "debating...", decision: "continue" }),
          8, 12,
        );
      }),
      buildDebateWorkerMessages: mock((_ctx, _instructions?, _roundInfo?) => [
        { role: "user" as const, content: "debate round" },
      ]),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.roundsExecuted).toBe(2);
    expect(output.consensusReached).toBe(true);
    expect(output.result).toBe("debate-approved");
  });

  it("should accumulate previous responses in debate context across rounds", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 3, protocol: "debate" });

    const debateContexts: string[] = [];

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(`response-from-${model}`, 10, 20);
        }
        return chatResult("synthesis", 15, 25);
      }),
      buildDebateWorkerMessages: mock((ctx, _instructions?, _roundInfo?) => {
        // Capture the number of previous rounds visible to debate builder
        debateContexts.push(`rounds=${ctx.rounds.length}`);
        return [{ role: "user" as const, content: "debate" }];
      }),
    });

    await deliberate(team, input, deps, config);

    // Round 1: normal builder (no debate call)
    // Round 2: debate builder sees 1 previous round
    // Round 3: debate builder sees 2 previous rounds
    expect(debateContexts).toEqual(["rounds=1", "rounds=2"]);
  });

  it("should force continue on round 1 of multi-round debate (no premature consensus)", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({
      maxRounds: 3,
      protocol: "debate",
      consensus: "leader_decides",
    });

    let leaderCalls = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult("worker-opinion", 5, 10);
        }
        leaderCalls++;
        // Leader tries to "approve" on every round
        return chatResult(
          JSON.stringify({ result: `synth-${leaderCalls}`, decision: "approve" }),
          8, 12,
        );
      }),
      buildDebateWorkerMessages: mock((_ctx, _instructions?, _roundInfo?) => [
        { role: "user" as const, content: "debate round" },
      ]),
    });

    const output = await deliberate(team, input, deps, config);

    // Round 1 "approve" forced to "continue", Round 2 "approve" is accepted
    expect(output.roundsExecuted).toBe(2);
    expect(output.consensusReached).toBe(true);
    expect(output.result).toBe("synth-2");
  });

  it("should fall back to normal builder when buildDebateWorkerMessages is not provided", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ maxRounds: 2, protocol: "debate" });

    let normalCalls = 0;
    const deps = makeDeps({
      chat: mock(async () => chatResult("response")),
      buildWorkerMessages: mock(() => {
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
    const error = new RoundExecutionError("leader", "leader/model", "string cause");

    expect(error.role).toBe("leader");
    expect(error.message).toContain("string cause");
  });
});
