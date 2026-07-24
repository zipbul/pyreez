/**
 * Integration test — Deliberation flow: handleDeliberate through the full stack.
 *
 * SUT boundary (real implementations):
 *   handlers.ts (handleDeliberate) + deliberation/wire.ts (createChatAdapter + createDeliberateFn)
 *   + engine.ts + team-composer.ts + prompts.ts + shared-context.ts — the same stack cli.ts wires
 *   in production.
 *
 * Outside SUT (test-doubled):
 *   raw chat function — the provider-facing (request) => ChatCompletionResponse call, equivalent
 *   to `(req) => providerRegistry.chat(req)` in cli.ts. createChatAdapter (real) wraps it, so
 *   assertions on the raw request (e.g. webAccess) exercise the actual adapter translation.
 */

import { describe, it, expect, mock } from "bun:test";
import { handleDeliberate } from "../../src/handlers";
import type { HandlersConfig } from "../../src/handlers";
import { createChatAdapter, createDeliberateFn } from "../../src/deliberation/wire";
import type { ChatCompletionRequest, ChatCompletionResponse } from "../../src/llm/types";
import type { ModelInfo } from "../../src/model/types";
import { NoModelsAvailableError } from "../../src/deliberation/team-composer";
import { TeamDegradedError } from "../../src/deliberation/engine";

// ============================================================
// Fixtures — 3 providers x 1 model each
// ============================================================

const MODEL_A: ModelInfo = {
  id: "openai/gpt-4.1",
  name: "GPT-4.1",
  provider: "openai",
  contextWindow: 128000,
  cost: { inputPer1M: 2, outputPer1M: 8 },
  supportsToolCalling: true,
};

const MODEL_B: ModelInfo = {
  id: "google/gemini-pro",
  name: "Gemini Pro",
  provider: "google",
  contextWindow: 512000,
  cost: { inputPer1M: 0.5, outputPer1M: 1 },
  supportsToolCalling: true,
};

const MODEL_C: ModelInfo = {
  id: "xai/grok-4",
  name: "Grok 4",
  provider: "xai",
  contextWindow: 128000,
  cost: { inputPer1M: 2, outputPer1M: 6 },
  supportsToolCalling: true,
};

const FIXTURE_MODELS = [MODEL_A, MODEL_B, MODEL_C];
const FIXTURE_MODEL_IDS = FIXTURE_MODELS.map((m) => m.id);

function fixtureRegistry() {
  return {
    getAll: () => [...FIXTURE_MODELS],
    getAvailable: () => [...FIXTURE_MODELS],
    getById: (id: string) => FIXTURE_MODELS.find((m) => m.id === id),
  };
}

// ============================================================
// Raw chat completion helper — the test-doubled boundary
// ============================================================

function completion(content: string, input = 10, output = 10): ChatCompletionResponse {
  return {
    id: "cmpl-test",
    object: "chat.completion",
    created: Date.now(),
    model: "test",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
  };
}

/**
 * Latest user-turn content. In session-continuation mode (R2+ follow-up), `req.messages` replays
 * the whole history — [user(R1), assistant(R1), user(follow-up), ...] — so the FIRST user message
 * is the stale R1 turn; the LAST one is this call's actual new content.
 */
function userMsgOf(req: ChatCompletionRequest): string {
  const userMsgs = req.messages.filter((m) => m.role === "user");
  return String(userMsgs[userMsgs.length - 1]?.content ?? "");
}

/**
 * Wire a handleDeliberate config the same way cli.ts wires production:
 * raw chat (test-doubled) -> createChatAdapter (real) -> createDeliberateFn (real).
 */
function buildConfig(
  rawChat: (req: ChatCompletionRequest) => Promise<ChatCompletionResponse>,
): HandlersConfig {
  const chatAdapter = createChatAdapter(rawChat);
  const deliberateFn = createDeliberateFn({
    registry: fixtureRegistry(),
    chat: (model, messages, params) => chatAdapter(model, messages, params),
  });
  return { deliberateFn };
}

describe("Deliberation flow — handleDeliberate through the full stack", () => {
  // ----------------------------------------------------------
  // Basic round mechanics
  // ----------------------------------------------------------
  describe("basic round mechanics", () => {
    it("completes a single round", async () => {
      const rawChat = mock(async (_req: ChatCompletionRequest) => completion("Worker response content"));
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Write a Hello World function",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "shared_convergence",
        max_rounds: 1,
      });

      expect(result.error).toBeUndefined();
      const data = result.data as any;
      expect(data.roundsExecuted).toBe(1);
      expect(data.modelsUsed.length).toBeGreaterThanOrEqual(1);
    });

    it("completes multiple rounds up to maxRounds", async () => {
      let callNum = 0;
      const rawChat = mock(async (_req: ChatCompletionRequest) =>
        completion(`Worker response ${++callNum} ${"x".repeat(callNum * 40)}`),
      );
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Implement error handler",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "shared_convergence",
        max_rounds: 3,
      });

      expect(result.error).toBeUndefined();
      expect((result.data as any).roundsExecuted).toBe(3);
    });

    it("accumulates tokens and LLM call counts across rounds", async () => {
      let callNum = 0;
      const rawChat = mock(async (_req: ChatCompletionRequest) =>
        completion(`Worker response ${++callNum} ${"t".repeat(callNum * 40)}`, 30, 60),
      );
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Token accumulation test",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "shared_convergence",
        max_rounds: 3,
      });

      const data = result.data as any;
      expect(data.roundsExecuted).toBe(3);
      expect(data.totalTokens.input).toBeGreaterThan(50);
      expect(data.totalTokens.output).toBeGreaterThan(50);
      expect(data.totalLLMCalls).toBeGreaterThanOrEqual(data.roundsExecuted * 2);
    });

    it("produces independent results on consecutive calls", async () => {
      let globalCallCount = 0;
      const rawChat = mock(async (_req: ChatCompletionRequest) => {
        globalCallCount++;
        return completion(`Worker-${globalCallCount}`);
      });
      const config = buildConfig(rawChat);

      const result1 = await handleDeliberate(config, {
        task: "Call 1", models: [...FIXTURE_MODEL_IDS], protocol: "shared_convergence", max_rounds: 1,
      });
      const result2 = await handleDeliberate(config, {
        task: "Call 2", models: [...FIXTURE_MODEL_IDS], protocol: "shared_convergence", max_rounds: 1,
      });

      expect((result1.data as any).roundsExecuted).toBe(1);
      expect((result2.data as any).roundsExecuted).toBe(1);
    });

    it("threads workerInstructions into the worker user message", async () => {
      const capturedUserMessages: string[] = [];
      const rawChat = mock(async (req: ChatCompletionRequest) => {
        capturedUserMessages.push(userMsgOf(req));
        return completion("Worker output");
      });
      const config = buildConfig(rawChat);

      await handleDeliberate(config, {
        task: "Instruction test",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "shared_convergence",
        worker_instructions: "Use TypeScript strictly",
      });

      const workerMsgs = capturedUserMessages.filter((msg) => msg.includes("Use TypeScript strictly"));
      expect(workerMsgs.length).toBeGreaterThanOrEqual(1);
    });

    it("still completes when one worker's chat call fails (partial failure)", async () => {
      let callCount = 0;
      const rawChat = mock(async (_req: ChatCompletionRequest) => {
        callCount++;
        if (callCount === 1) throw new Error("Network timeout");
        return completion("Surviving worker response");
      });
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Partial failure test",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "shared_convergence",
      });

      expect(result.error).toBeUndefined();
      expect((result.data as any).roundsExecuted).toBeGreaterThanOrEqual(1);
    });

    it("rejects an empty task before ever reaching the engine (boundary)", async () => {
      const rawChat = mock(async () => completion("unreachable"));
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "shared_convergence",
      });

      expect(result.error).toContain("task is required");
      expect(rawChat).not.toHaveBeenCalled();
    });

    it("populates every DeliberateOutput field plus handler-added fields", async () => {
      const rawChat = mock(async (_req: ChatCompletionRequest) => completion("Worker output", 30, 60));
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Output field test",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "shared_convergence",
        max_rounds: 1,
      });

      expect(result.error).toBeUndefined();
      const data = result.data as any;
      expect(data.roundsExecuted).toBe(1);
      expect(data.totalTokens.input).toBeGreaterThan(0);
      expect(data.totalTokens.output).toBeGreaterThan(0);
      expect(data.totalLLMCalls).toBeGreaterThanOrEqual(2);
      expect(data.modelsUsed.length).toBeGreaterThanOrEqual(1);
      for (const modelId of data.modelsUsed) {
        expect(typeof modelId).toBe("string");
        expect(modelId).toMatch(/\w+\/\w+/);
      }
      expect(data.next_required_action).toBeDefined();
      expect(data.synthesis_checklist).toBeDefined();
    });
  });

  // ----------------------------------------------------------
  // Protocol smoke: every protocol completes end to end via handleDeliberate
  // ----------------------------------------------------------
  describe("protocol smoke", () => {
    const PROTOCOL_ARGS: Record<string, Record<string, unknown>> = {
      shared_convergence: {},
      adversarial_debate: {},
      host_interrogation: { questions: ["Q1?", "Q2?", "Q3?"] },
      sequential_refinement: {},
      evaluation_scoring: { criteria: "correctness", subject: "code" },
      red_team: {},
    };

    for (const protocol of Object.keys(PROTOCOL_ARGS)) {
      it(`completes ${protocol} end to end`, async () => {
        const rawChat = mock(async (_req: ChatCompletionRequest) => completion("Worker response content"));
        const config = buildConfig(rawChat);

        const result = await handleDeliberate(config, {
          task: "Deliberation smoke test",
          models: [...FIXTURE_MODEL_IDS],
          protocol,
          max_rounds: 1,
          ...PROTOCOL_ARGS[protocol],
        });

        expect(result.error).toBeUndefined();
        const data = result.data as any;
        expect(data.protocol).toBe(protocol);
        expect(data.next_required_action).toBeDefined();
        expect(data.synthesis_checklist).toBeDefined();
      });
    }
  });

  // ----------------------------------------------------------
  // sequential_refinement — A→B→C chain
  // ----------------------------------------------------------
  describe("sequential_refinement", () => {
    it("chains workers in order, each seeing the previous output via <previous-version>", async () => {
      const callOrder: string[] = [];
      const rawChat = mock(async (req: ChatCompletionRequest) => {
        callOrder.push(req.model);
        if (callOrder.length > 1) {
          expect(userMsgOf(req)).toContain("<previous-version>");
        }
        return completion(`Output from ${req.model}`);
      });
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Refactor this function",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "sequential_refinement",
        max_rounds: 1,
      });

      const data = result.data as any;
      expect(data.roundsExecuted).toBe(1);
      expect(data.protocol).toBe("sequential_refinement");
      expect(callOrder.length).toBe(3);
    });
  });

  // ----------------------------------------------------------
  // host_interrogation — per-worker questions + dropped-question warning
  // ----------------------------------------------------------
  describe("host_interrogation", () => {
    it("distributes a different question to each worker", async () => {
      const receivedQuestions: string[] = [];
      const rawChat = mock(async (req: ChatCompletionRequest) => {
        const qMatch = userMsgOf(req).match(/<question>(.*?)<\/question>/);
        if (qMatch) receivedQuestions.push(qMatch[1]!);
        return completion("Answer to the question");
      });
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Analyze system bottlenecks",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "host_interrogation",
        max_rounds: 1,
        questions: ["DB bottleneck?", "Network latency?", "Memory pressure?"],
      });

      const data = result.data as any;
      expect(data.roundsExecuted).toBe(1);
      expect(data.protocol).toBe("host_interrogation");
      expect(receivedQuestions).toContain("DB bottleneck?");
      expect(receivedQuestions).toContain("Network latency?");
      expect(receivedQuestions).toContain("Memory pressure?");
    });

    it("warns questions_dropped when questions exceed worker slots", async () => {
      const rawChat = mock(async (_req: ChatCompletionRequest) => completion("Answer"));
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Interrogate the workers",
        models: [...FIXTURE_MODEL_IDS], // 3 workers
        protocol: "host_interrogation",
        questions: ["Q1?", "Q2?", "Q3?", "Q4?", "Q5?"], // 5 questions — 2 have no worker slot
      });

      expect(result.error).toBeUndefined();
      const data = result.data as any;
      expect(data.warnings).toBeDefined();
      expect(data.warnings.some((w: string) => w.includes("questions_dropped"))).toBe(true);
    });

    it("does not warn questions_dropped when questions fit exactly within workers (boundary)", async () => {
      const rawChat = mock(async (_req: ChatCompletionRequest) => completion("Answer"));
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Interrogate the workers",
        models: [...FIXTURE_MODEL_IDS], // 3 workers
        protocol: "host_interrogation",
        questions: ["Q1?", "Q2?", "Q3?"], // exactly 3 — boundary, none dropped
      });

      expect(result.error).toBeUndefined();
      const data = result.data as any;
      expect((data.warnings ?? []).some((w: string) => w.includes("questions_dropped"))).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // evaluation_scoring — independent scoring + aggregation
  // ----------------------------------------------------------
  describe("evaluation_scoring", () => {
    it("returns aggregation with the requested method", async () => {
      const rawChat = mock(async (req: ChatCompletionRequest) => {
        expect(userMsgOf(req)).toContain("<evaluation-criteria>");
        expect(userMsgOf(req)).toContain("<subject>");
        return completion("score: 7\nverdict: Solid implementation\nconfidence: high");
      });
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Evaluate this function",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "evaluation_scoring",
        criteria: "correctness, readability",
        subject: "function add(a, b) { return a + b; }",
        aggregation: "confidence_weighted",
      });

      expect(result.error).toBeUndefined();
      const data = result.data as any;
      expect(data.protocol).toBe("evaluation_scoring");
      expect(data.aggregation).toBeDefined();
      expect(data.aggregation.method).toBe("confidence_weighted");
      expect(data.aggregation.results.length).toBeGreaterThanOrEqual(1);
    });

    it("defaults aggregation method to voting when not requested", async () => {
      const rawChat = mock(async (_req: ChatCompletionRequest) =>
        completion("score: 6\nverdict: Acceptable\nconfidence: medium"),
      );
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Evaluate this function",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "evaluation_scoring",
        criteria: "correctness",
        subject: "function noop() {}",
      });

      expect(result.error).toBeUndefined();
      expect((result.data as any).aggregation.method).toBe("voting");
    });
  });

  // ----------------------------------------------------------
  // adversarial_debate — R2 challenge structure (peer positions, R1 never has this)
  // ----------------------------------------------------------
  describe("adversarial_debate", () => {
    it("shows R2 workers labeled peer positions to challenge (not present in R1)", async () => {
      let callNum = 0;
      const r1UserMessages: string[] = [];
      const r2UserMessages: string[] = [];
      const rawChat = mock(async (req: ChatCompletionRequest) => {
        callNum++;
        (callNum <= 3 ? r1UserMessages : r2UserMessages).push(userMsgOf(req));
        return completion(`Response call ${callNum} ${"x".repeat(callNum * 40)}`);
      });
      const config = buildConfig(rawChat);

      await handleDeliberate(config, {
        task: "Compare Kafka vs RabbitMQ",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "adversarial_debate",
        max_rounds: 2,
      });

      // R1: no peer positions yet (workers respond independently first).
      expect(r1UserMessages.some((m) => m.includes("<positions-to-challenge>"))).toBe(false);
      // R2: every worker sees labeled peer positions to challenge.
      expect(r2UserMessages.length).toBeGreaterThan(0);
      expect(r2UserMessages.every((m) => m.includes("<positions-to-challenge>"))).toBe(true);
      expect(r2UserMessages.some((m) => /Analyst [A-Z] argues/.test(m))).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // shared_convergence — sparse sharing (R2 workers don't see all positions)
  // ----------------------------------------------------------
  describe("shared_convergence", () => {
    it("applies sparse sharing in R2 (not full mesh)", async () => {
      let round = 0;
      const r2AnalystCounts: number[] = [];
      const rawChat = mock(async (req: ChatCompletionRequest) => {
        round++;
        if (round > 3) { // R2
          const analystCount = (userMsgOf(req).match(/One analyst argues/g) ?? []).length;
          r2AnalystCounts.push(analystCount);
        }
        return completion(`Position ${round}: unique content ${"y".repeat(round * 50)}`);
      });
      const config = buildConfig(rawChat);

      await handleDeliberate(config, {
        task: "Architecture decision",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "shared_convergence",
        max_rounds: 2,
      });

      // With 3 workers and groupSize=2, each worker should see at most 2 others.
      expect(r2AnalystCounts.length).toBeGreaterThan(0);
      for (const count of r2AnalystCounts) {
        expect(count).toBeLessThanOrEqual(2);
      }
    });
  });

  // ----------------------------------------------------------
  // red_team — generator round then attacker round, numbered target-output handoff
  // ----------------------------------------------------------
  describe("red_team", () => {
    it("runs the generator round before the attacker round, handing numbered target-output to the attacker", async () => {
      const generatorCalls: ChatCompletionRequest[] = [];
      const attackerCalls: ChatCompletionRequest[] = [];
      let generatorCallCount = 0;
      const rawChat = mock(async (req: ChatCompletionRequest) => {
        const isAttacker = (req.system ?? "").includes("Find vulnerabilities");
        if (isAttacker) {
          attackerCalls.push(req);
          return completion("Found SQL injection vulnerability");
        }
        generatorCalls.push(req);
        generatorCallCount++;
        // Distinct content per generator so each numbered target-output tag is independently verifiable.
        return completion(`Secure login implementation v${generatorCallCount}`);
      });
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Build authentication system",
        models: [...FIXTURE_MODEL_IDS], // 3 workers -> ceil(3/2)=2 generators, 1 attacker
        protocol: "red_team",
        max_rounds: 2,
      });

      expect(result.error).toBeUndefined();
      const data = result.data as any;
      expect(data.protocol).toBe("red_team");
      expect(data.roundsExecuted).toBe(2);

      // Round 1 (generate): only the 2 generators respond, attacker is skipped (not failed)
      expect(data.rounds[0].responses.length).toBe(2);
      expect(data.rounds[0].failedWorkers).toBeUndefined();
      // Round 2 (attack): only the 1 attacker responds, generators are skipped
      expect(data.rounds[1].responses.length).toBe(1);
      expect(data.rounds[1].failedWorkers).toBeUndefined();

      expect(generatorCalls.length).toBe(2);
      expect(attackerCalls.length).toBe(1);

      // The attacker's request carries both generators' round-1 outputs as target-output. With 2+
      // targets each gets a numbered id and a <targets-note> instructs per-target attribution.
      const attackerUserMsg = userMsgOf(attackerCalls[0]!);
      expect(attackerUserMsg).toContain('<target-output id="1">');
      expect(attackerUserMsg).toContain('<target-output id="2">');
      expect(attackerUserMsg).toContain("Secure login implementation v1");
      expect(attackerUserMsg).toContain("Secure login implementation v2");
      expect(attackerUserMsg).toContain("<targets-note>");
    });
  });

  // ----------------------------------------------------------
  // webAccess tri-state — preserved end to end into the raw chat request
  // ----------------------------------------------------------
  describe("webAccess tri-state propagation", () => {
    it("forwards web_access: true to the raw chat request", async () => {
      const seen: (boolean | undefined)[] = [];
      const rawChat = mock(async (req: ChatCompletionRequest) => {
        seen.push(req.webAccess);
        return completion("Worker response");
      });
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Web access true",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "shared_convergence",
        max_rounds: 1,
        web_access: true,
      });

      expect(result.error).toBeUndefined();
      expect(seen.length).toBeGreaterThan(0);
      for (const v of seen) expect(v).toBe(true);
    });

    it("forwards web_access: false to the raw chat request", async () => {
      const seen: (boolean | undefined)[] = [];
      const rawChat = mock(async (req: ChatCompletionRequest) => {
        seen.push(req.webAccess);
        return completion("Worker response");
      });
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Web access false",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "shared_convergence",
        max_rounds: 1,
        web_access: false,
      });

      expect(result.error).toBeUndefined();
      expect(seen.length).toBeGreaterThan(0);
      for (const v of seen) expect(v).toBe(false);
    });

    it("omits webAccess from the raw chat request when web_access is unspecified", async () => {
      const seen: (boolean | undefined)[] = [];
      const rawChat = mock(async (req: ChatCompletionRequest) => {
        seen.push(req.webAccess);
        return completion("Worker response");
      });
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "Web access unspecified",
        models: [...FIXTURE_MODEL_IDS],
        protocol: "shared_convergence",
        max_rounds: 1,
        // web_access intentionally omitted — must stay undefined (provider default), not forced false
      });

      expect(result.error).toBeUndefined();
      expect(seen.length).toBeGreaterThan(0);
      for (const v of seen) expect(v).toBeUndefined();
    });
  });

  // ----------------------------------------------------------
  // Input validation and error mapping
  // ----------------------------------------------------------
  describe("input validation and error mapping", () => {
    it("rejects an empty models array (boundary)", async () => {
      const rawChat = mock(async () => completion("unreachable"));
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, { task: "t", models: [], protocol: "shared_convergence" });

      expect(result.error).toBe("Error: models is required (min 1)");
      expect(rawChat).not.toHaveBeenCalled();
    });

    it("errors when deliberateFn is not configured", async () => {
      const result = await handleDeliberate({}, { task: "t", models: ["m/a"], protocol: "shared_convergence" });
      expect(result.error).toBe("Error: deliberation not available");
    });

    it("requires --questions for host_interrogation", async () => {
      const rawChat = mock(async () => completion("unreachable"));
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "t", models: [...FIXTURE_MODEL_IDS], protocol: "host_interrogation",
        // questions intentionally omitted
      });

      expect(result.error).toBe("Error: --questions is required for host_interrogation protocol");
      expect(rawChat).not.toHaveBeenCalled();
    });

    it("requires --criteria for evaluation_scoring", async () => {
      const rawChat = mock(async () => completion("unreachable"));
      const config = buildConfig(rawChat);

      const result = await handleDeliberate(config, {
        task: "t", models: [...FIXTURE_MODEL_IDS], protocol: "evaluation_scoring",
        // criteria intentionally omitted
      });

      expect(result.error).toBe("Error: --criteria is required for evaluation_scoring protocol");
      expect(rawChat).not.toHaveBeenCalled();
    });

    it("maps a NoModelsAvailableError thrown by deliberateFn into a structured error", async () => {
      const config: HandlersConfig = {
        deliberateFn: async () => { throw new NoModelsAvailableError("no providers configured", ["check auth"]); },
      };

      const result = await handleDeliberate(config, { task: "t", models: ["m/a"], protocol: "shared_convergence" });

      expect(result.error).toBeDefined();
      const parsed = JSON.parse(result.error!);
      expect(parsed.error).toBe("no providers configured");
      expect(parsed.code).toBe("NO_MODELS_AVAILABLE");
      expect(parsed.remediation).toEqual(["check auth"]);
    });

    it("maps a TeamDegradedError thrown by deliberateFn into a structured error", async () => {
      const config: HandlersConfig = {
        deliberateFn: async () => {
          throw new TeamDegradedError(3, 1, [{ model: "m/a", reason: "timeout" }], { input: 10, output: 20 });
        },
      };

      const result = await handleDeliberate(config, { task: "t", models: ["m/a"], protocol: "shared_convergence" });

      expect(result.error).toBeDefined();
      const parsed = JSON.parse(result.error!);
      expect(parsed.lostSlots).toEqual([{ model: "m/a", reason: "timeout" }]);
      expect(parsed.tokensConsumed).toEqual({ input: 10, output: 20 });
    });

    it("sanitizes an overly long generic error message with a trailing ellipsis", async () => {
      const longMessage = "x".repeat(600);
      const config: HandlersConfig = { deliberateFn: async () => { throw new Error(longMessage); } };

      const result = await handleDeliberate(config, { task: "t", models: ["m/a"], protocol: "shared_convergence" });

      expect(result.error).toBeDefined();
      expect(result.error!.length).toBeLessThan(600);
      expect(result.error!.endsWith("…")).toBe(true);
    });

    it("redacts path-like substrings (3+ segments) from a generic error message", async () => {
      const config: HandlersConfig = {
        deliberateFn: async () => { throw new Error("failed to read /home/user/project/config.json"); },
      };

      const result = await handleDeliberate(config, { task: "t", models: ["m/a"], protocol: "shared_convergence" });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("[path]");
      expect(result.error).not.toContain("/home/user/project");
    });

    it("returns an error (masking a successful result) when runLogger.log throws synchronously", async () => {
      const rawChat = mock(async () => completion("Worker response"));
      const chatAdapter = createChatAdapter(rawChat);
      const deliberateFn = createDeliberateFn({ registry: fixtureRegistry(), chat: (m, msgs, p) => chatAdapter(m, msgs, p) });
      // Throws only on the first call (logRun's success-path log, inside its try). If it also
      // threw on the catch block's own log-the-failure call, that second throw would be unhandled
      // (out of scope here — not what this test targets), so it succeeds from the 2nd call on.
      let logCallCount = 0;
      const config: HandlersConfig = {
        deliberateFn,
        runLogger: {
          log: () => {
            logCallCount++;
            if (logCallCount === 1) throw new Error("disk full");
            return Promise.resolve();
          },
          query: async () => [],
        },
      };

      const result = await handleDeliberate(config, {
        task: "t", models: [...FIXTURE_MODEL_IDS], protocol: "shared_convergence", max_rounds: 1,
      });

      // The successful deliberation result is masked by logRun's own catch when its fire-and-forget
      // runLogger.log() call throws synchronously instead of returning a rejected promise.
      expect(result.error).toContain("disk full");
      expect(result.data).toBeUndefined();
    });
  });
});
