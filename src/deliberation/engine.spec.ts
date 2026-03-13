/**
 * Unit tests for engine.ts — Diverge-Synth Deliberation Engine.
 */

import { describe, it, expect, mock } from "bun:test";
import {
  parseSynthesis,
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
    buildLeaderMessages: mock((_ctx: any, _instructions?: any, _roundInfo?: any) => [
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

  // -- stripDeliberationBlock tests (via parseSynthesis) --

  it("should strip <deliberation> block from plain text response", () => {
    const response = "<deliberation>\nMerge worker A quicksort with worker B error handling\n</deliberation>\n\nfunction sort(arr) { return arr.sort(); }";
    const result = parseSynthesis("leader/model", response);
    expect(result.content).toBe("function sort(arr) { return arr.sort(); }");
    expect(result.content).not.toContain("<deliberation>");
  });

  it("should strip multiple <deliberation> blocks", () => {
    const response = "<deliberation>block1</deliberation>\ncode here\n<deliberation>block2</deliberation>\nmore code";
    const result = parseSynthesis("leader/model", response);
    expect(result.content).not.toContain("<deliberation>");
    expect(result.content).toContain("code here");
    expect(result.content).toContain("more code");
  });

  it("should strip <deliberation> block from JSON result field in consensus mode", () => {
    const json = JSON.stringify({
      result: "<deliberation>internal reasoning</deliberation>\nfinal answer",
      decision: "approve",
    });
    const result = parseSynthesis("leader/model", json, "leader_decides");
    expect(result.content).toBe("final answer");
    expect(result.decision).toBe("approve");
  });

  it("should return content unchanged when no <deliberation> block present", () => {
    const response = "Just a normal response with no blocks.";
    const result = parseSynthesis("leader/model", response);
    expect(result.content).toBe("Just a normal response with no blocks.");
  });
});

// =============================================================================
// executeRound
// =============================================================================

describe("executeRound", () => {
  it("should execute a successful round with 2 workers and a leader, assigning roles", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    let callIndex = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        callIndex++;
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent(`worker-response-${callIndex}`), 10, 20);
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
    expect(round.responses[0]!.role).toBe("advocate");
    expect(round.responses[1]!.model).toBe("worker/model-1");
    expect(round.responses[1]!.role).toBe("critic");
    expect(round.synthesis).toBeDefined();
    expect(round.synthesis!.model).toBe("leader/model");
    expect(round.synthesis!.content).toBe("leader-synthesis");

    // Token accumulation: 2 workers (10+10=20 input, 20+20=40 output) + leader (15 input, 25 output)
    expect(tokens.input).toBe(35);
    expect(tokens.output).toBe(65);

    // buildWorkerMessages called per-worker (not shared)
    expect(deps.buildWorkerMessages).toHaveBeenCalledTimes(2);
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
          return chatResult(validWorkerContent("worker-1-ok"), 10, 20);
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
    expect(round.responses[0]!.role).toBe("critic");
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
          return chatResult(validWorkerContent("worker-ok"), 10, 20);
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
          return chatResult(validWorkerContent("w"), 100, 200);
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
          return chatResult(validWorkerContent("worker-ok"));
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
          return chatResult(validWorkerContent("worker-ok"));
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
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-response"), 10, 20);
        }
        return chatResult("final-synthesis", 15, 25);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.result).toBe("final-synthesis");
    expect(output.roundsExecuted).toBe(1);
    expect(output.consensusReached).toBeNull(); // no consensus mode = null
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
          return chatResult(validWorkerContent("worker"), 5, 10);
        }
        roundCount++;
        return chatResult(`synthesis-round-${roundCount}`, 8, 12);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.roundsExecuted).toBe(3);
    expect(output.consensusReached).toBeNull(); // no consensus mode = null
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
          return chatResult(validWorkerContent("worker"), 5, 10);
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
          return chatResult(validWorkerContent("worker"), 5, 10);
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
          return chatResult(validWorkerContent("w"), 100, 200);
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
          return chatResult(validWorkerContent("worker-response"), 5, 10);
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
          return chatResult(validWorkerContent("worker"));
        }
        return chatResult("default-config-result");
      }),
    });

    const output = await deliberate(team, input, deps); // no config

    expect(output.roundsExecuted).toBe(1);
    expect(output.consensusReached).toBeNull(); // default config has no consensus mode
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
          return chatResult(validWorkerContent("replacement-ok"), 10, 20);
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
          return chatResult(validWorkerContent("worker-ok"), 10, 20);
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
          return chatResult(validWorkerContent("ok"), 10, 20);
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
      chat: mock(async () => chatResult(validWorkerContent("ok"), 10, 20)),
    });

    const output = await deliberate(team, input, deps, config);

    expect(output.rounds).toBeDefined();
    expect(output.rounds![0]!.failedWorkers).toBeUndefined();
  });
});

// =============================================================================
// Leader truncation (always throws, regardless of taskNature)
// =============================================================================

describe("leader truncation", () => {
  it("should throw RoundExecutionError when leader is truncated (no taskNature)", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-output"));
        }
        return { content: "partial...", inputTokens: 10, outputTokens: 20, truncated: true };
      }),
    });

    await expect(deliberate(team, input, deps, config)).rejects.toThrow(
      /truncated/i,
    );
  });

  it("should throw RoundExecutionError when critique leader is truncated", async () => {
    const team = makeTeam(2);
    const input = makeInput({ taskNature: "critique" });
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-output"));
        }
        return { content: "partial analysis", inputTokens: 10, outputTokens: 20, truncated: true };
      }),
    });

    await expect(deliberate(team, input, deps, config)).rejects.toThrow(
      /truncated/i,
    );
  });

  it("should throw RoundExecutionError when artifact leader is truncated", async () => {
    const team = makeTeam(2);
    const input = makeInput({ taskNature: "artifact" });
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-output"));
        }
        return { content: "partial code...", inputTokens: 10, outputTokens: 20, truncated: true };
      }),
    });

    await expect(deliberate(team, input, deps, config)).rejects.toThrow(
      /truncated/i,
    );
  });

  it("should not throw when leader is not truncated", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-output"));
        }
        return chatResult("complete synthesis");
      }),
    });

    const output = await deliberate(team, input, deps, config);
    expect(output.result).toBe("complete synthesis");
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
        if (model.startsWith("worker/")) return chatResult(validWorkerContent("ok"), 10, 20);
        return chatResult("synthesis", 15, 25);
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
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) return chatResult(exactContent, 10, 20);
        return chatResult("synthesis", 15, 25);
      }),
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
        if (model.startsWith("worker/")) return chatResult(validWorkerContent("ok"), 10, 20);
        return chatResult("synthesis", 15, 25);
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
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) return chatResult("too short", 10, 20);
        return chatResult("synthesis", 15, 25);
      }),
    });

    await expect(deliberate(team, input, deps, config)).rejects.toThrow(
      /degenerate responses/,
    );
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
          return chatResult(validWorkerContent("leader-independent-opinion"), 12, 18);
        }
        if (model === "leader/model") {
          // Second call: leader as synthesizer
          return chatResult("leader-synthesis", 15, 25);
        }
        return chatResult(validWorkerContent(`${model}-response`), 10, 20);
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
          return chatResult(validWorkerContent("leader-opinion"), 10, 20);
        }
        return chatResult(validWorkerContent("worker-response"), 10, 20);
      }),
      buildLeaderMessages: mock((ctx: any) => {
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
        return chatResult(validWorkerContent("response"), 10, 20);
      }),
    });

    const output = await deliberate(team, input, deps, config);

    // Leader called only once (synthesis)
    expect(calledModels.filter((m) => m === "leader/model")).toHaveLength(1);
    // 2 workers + 1 leader synthesis = 3 total
    expect(output.totalLLMCalls).toBe(3);
  });

  it("should default to leaderContributes=false when config is undefined", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    // No config — uses DEFAULT_CONFIG which has leaderContributes: false

    const calledModels: string[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        calledModels.push(model);
        return chatResult(validWorkerContent("response"), 10, 20);
      }),
    });

    await deliberate(team, input, deps);

    // Leader should be called once (synthesis only, not as worker)
    expect(calledModels.filter((m) => m === "leader/model")).toHaveLength(1);
  });

  it("should NOT include leader in diverge when leaderContributes is omitted (undefined)", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    // Explicit config with leaderContributes omitted (undefined, not false)
    const config: EngineConfig = { maxRounds: 1 };

    const calledModels: string[] = [];
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        calledModels.push(model);
        return chatResult(validWorkerContent("response"), 10, 20);
      }),
    });

    await deliberate(team, input, deps, config);

    // leaderContributes undefined → treated as false → leader called once (synthesis only)
    expect(calledModels.filter((m) => m === "leader/model")).toHaveLength(1);
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
        return chatResult(validWorkerContent("worker-ok"), 10, 20);
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
          return chatResult(validWorkerContent("worker-debate"), 5, 10);
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
      buildDebateWorkerMessages: mock((_ctx: any, _instructions?: any, _roundInfo?: any, _model?: any, _idx?: any) => [
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
          return chatResult(validWorkerContent(`response-from-${model}`), 10, 20);
        }
        return chatResult("synthesis", 15, 25);
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
          return chatResult(validWorkerContent("worker-opinion"), 5, 10);
        }
        leaderCalls++;
        // Leader tries to "approve" on every round
        return chatResult(
          JSON.stringify({ result: `synth-${leaderCalls}`, decision: "approve" }),
          8, 12,
        );
      }),
      buildDebateWorkerMessages: mock((_ctx: any, _instructions?: any, _roundInfo?: any, _model?: any, _idx?: any) => [
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
    const error = new RoundExecutionError("leader", "leader/model", "string cause");

    expect(error.role).toBe("leader");
    expect(error.message).toContain("string cause");
  });
});

// =============================================================================
// GenerationParams forwarding
// =============================================================================

describe("GenerationParams forwarding", () => {
  it("should pass workerGenParams and leaderGenParams to chat calls", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({
      workerGenParams: { temperature: 1.0, max_tokens: 2048, top_p: 0.9 },
      leaderGenParams: { temperature: 0.7, max_tokens: 4096 },
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

    // Leader call should have leaderGenParams
    const leaderCall = chatCalls.find((c) => c.model === "leader/model");
    expect(leaderCall).toBeDefined();
    expect(leaderCall!.params).toEqual({ temperature: 0.7, max_tokens: 4096 });
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

    // Both calls should have undefined params
    for (const call of chatCalls) {
      expect(call.params).toBeUndefined();
    }
  });

  it("should throw RoundExecutionError when leader response is truncated", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-output"));
        }
        return { content: "partial code...", inputTokens: 10, outputTokens: 20, truncated: true };
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    await expect(executeRound(ctx, 1, deps, config, input)).rejects.toThrow(
      /truncated.*max_tokens/i,
    );
  });

  it("should not throw when leader response is not truncated", async () => {
    const team = makeTeam(2);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-output"));
        }
        return chatResult("complete leader response");
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    const result = await executeRound(ctx, 1, deps, config, input);
    expect(result.round.synthesis?.content).toBe("complete leader response");
  });

  it("should validate structure and retry once when tags missing", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const tags = ["verification", "result"];
    const config = makeConfig({ structuralTags: tags });

    let leaderCallCount = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-output"));
        }
        leaderCallCount++;
        if (leaderCallCount === 1) {
          // First attempt: missing tags
          return chatResult("no tags here");
        }
        // Retry: valid structure
        return chatResult("<verification>ok</verification><result>done</result>");
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    const result = await executeRound(ctx, 1, deps, config, input);
    expect(leaderCallCount).toBe(2);
    expect(result.round.synthesis?.content).toBe("<verification>ok</verification><result>done</result>");
  });

  it("should throw when structural retry also fails", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ structuralTags: ["verification", "result"] });

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-output"));
        }
        // Both attempts: missing tags
        return chatResult("still no tags");
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    await expect(executeRound(ctx, 1, deps, config, input)).rejects.toThrow(
      /missing required sections/i,
    );
  });

  it("should skip structural validation when structuralTags is undefined", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig(); // no structuralTags

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-output"));
        }
        return chatResult("no tags needed");
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    const result = await executeRound(ctx, 1, deps, config, input);
    expect(result.round.synthesis?.content).toBe("no tags needed");
    // Only worker + leader call, no retry
    expect(deps.chat).toHaveBeenCalledTimes(2);
  });

  it("should skip structural validation on debate intermediate round", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({
      maxRounds: 3,
      protocol: "debate",
      structuralTags: ["verification", "result"],
    });

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-output"));
        }
        // No structural tags — should be fine for intermediate rounds
        return chatResult("intermediate synthesis without tags");
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    // Round 1 of 3 = intermediate → skip validation
    const result = await executeRound(ctx, 1, deps, config, input);
    expect(result.round.synthesis?.content).toBe("intermediate synthesis without tags");
    expect(deps.chat).toHaveBeenCalledTimes(2); // no retry
  });

  it("should validate structure on debate round with approve decision (early consensus = final output)", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({
      maxRounds: 3,
      protocol: "debate",
      consensus: "leader_decides",
      structuralTags: ["verification", "result"],
    });

    let leaderCalls = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-output"));
        }
        leaderCalls++;
        if (leaderCalls === 1) {
          // Round 1: continue (intermediate → no structural validation)
          return chatResult(JSON.stringify({ result: "no tags round 1", decision: "continue" }));
        }
        // Round 2: approve with missing tags → structural validation should apply → retry → throw
        return chatResult(JSON.stringify({ result: "no tags approved", decision: "approve" }));
      }),
      buildDebateWorkerMessages: mock((_ctx: any, _inst?: any, _ri?: any, _model?: any, _idx?: any) => [
        { role: "user" as const, content: "debate" },
      ]),
    });

    // deliberate level: round 2 of 3 with approve = final output → structural validation applies
    await expect(deliberate(team, input, deps, config)).rejects.toThrow(
      /missing required sections/i,
    );
  });

  it("should accumulate retry tokens when structural retry succeeds", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ structuralTags: ["result"] });

    let leaderCallCount = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-output"), 10, 20);
        }
        leaderCallCount++;
        if (leaderCallCount === 1) {
          return chatResult("no tags", 100, 200);
        }
        return chatResult("<result>retried</result>", 150, 300);
      }),
    });

    const { createSharedContext } = await import("./shared-context");
    const ctx = createSharedContext(input.task, team);

    const result = await executeRound(ctx, 1, deps, config, input);
    // Worker(10,20) + first leader(100,200) + retry leader(150,300)
    expect(result.tokens.input).toBe(260);
    expect(result.tokens.output).toBe(520);
  });

  it("should throw RoundExecutionError when structural retry encounters a network error", async () => {
    const team = makeTeam(1);
    const input = makeInput();
    const config = makeConfig({ structuralTags: ["result"] });

    let leaderCallCount = 0;
    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-output"));
        }
        leaderCallCount++;
        if (leaderCallCount === 1) {
          return chatResult("no tags"); // triggers retry
        }
        throw new Error("network timeout on retry");
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
      expect(re.message).toContain("network timeout on retry");
    }
  });

  it("should assign 3 distinct roles (advocate/critic/wildcard) when team has 3 workers", async () => {
    const team = makeTeam(3);
    const input = makeInput();
    const config = makeConfig();

    const deps = makeDeps({
      chat: mock(async (model: string) => {
        if (model.startsWith("worker/")) {
          return chatResult(validWorkerContent("worker-response"));
        }
        return chatResult("leader-synthesis");
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
