/**
 * Integration test — Scoring flow: deliberate through the full stack, including the post-run
 * scoring hook.
 *
 * SUT boundary (real implementations):
 *   deliberation/wire.ts (createChatAdapter + createDeliberateFn) + engine.ts + team-composer.ts
 *   + prompts.ts + shared-context.ts + quality/scoring/* (classify, rubric, panel, hook) +
 *   model/ratings/* (recordObservation, effectivePosterior via loadRatings/saveRatings) — the same
 *   stack cli.ts wires in production.
 *
 * Outside SUT (test-doubled):
 *   raw chat function (worker turns + classifier + judge panel calls, distinguished by the hoisted
 *   system prompt) and FileIO (in-memory, so ratings.json/ratings-log.jsonl round-trip for real).
 */

import { describe, expect, it, mock } from "bun:test";
import { createChatAdapter, createDeliberateFn } from "../../src/deliberation/wire";
import type { ChatCompletionRequest, ChatCompletionResponse } from "../../src/llm/types";
import type { ModelInfo } from "../../src/model/types";
import type { FileIO } from "../../src/report/types";
import { RATINGS_LOG_PATH, RATINGS_PATH } from "../../src/quality/scoring";

const MODEL_A: ModelInfo = { id: "openai/gpt-4.1", provider: "openai" };
const MODEL_B: ModelInfo = { id: "xai/grok-4", provider: "xai" };
const FIXTURE_MODELS = [MODEL_A, MODEL_B];

function fixtureRegistry() {
  return {
    getAvailable: () => [...FIXTURE_MODELS],
    getById: (id: string) => FIXTURE_MODELS.find((m) => m.id === id),
  };
}

/** Worker turns get a plain reply; classifier/judge calls are distinguished by their system prompt. */
function fakeRawChat(): (req: ChatCompletionRequest) => Promise<ChatCompletionResponse> {
  return async (req) => {
    const system = req.system ?? "";
    if (system.includes("Classify the task")) {
      return { content: '{"domain": "software", "subtopic": "smoke-test"}' };
    }
    if (system.includes("independent judges")) {
      return {
        content:
          '{"A": {"accuracy": 90, "depth": 85, "grounding": 88}, "B": {"accuracy": 70, "depth": 65, "grounding": 60}}',
      };
    }
    return { content: `ok from ${req.model}` };
  };
}

function makeFakeFileIO(): FileIO {
  const files = new Map<string, string>();
  return {
    appendFile: mock(async (path: string, data: string) => {
      files.set(path, (files.get(path) ?? "") + data);
    }),
    readFile: mock(async (path: string) => {
      const v = files.get(path);
      if (v === undefined) throw new Error(`ENOENT: ${path}`);
      return v;
    }),
    writeFile: mock(async (path: string, data: string) => {
      files.set(path, data);
    }),
    mkdir: mock(async () => {}),
    glob: mock(async () => []),
    rename: mock(async (from: string, to: string) => {
      const v = files.get(from);
      if (v !== undefined) {
        files.set(to, v);
        files.delete(from);
      }
    }),
  };
}

async function readRatings(fileIO: FileIO): Promise<any> {
  return JSON.parse(await fileIO.readFile(RATINGS_PATH));
}

async function readLogLines(fileIO: FileIO): Promise<any[]> {
  try {
    const raw = await fileIO.readFile(RATINGS_LOG_PATH);
    return raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

describe("Scoring flow — deliberate through the full stack", () => {
  it("scores a shared_convergence R1 into ratings.json and appends one raw-log line", async () => {
    const fileIO = makeFakeFileIO();
    const chatAdapter = createChatAdapter(fakeRawChat());
    const deliberateFn = createDeliberateFn({
      registry: fixtureRegistry(),
      chat: (model, messages, params) => chatAdapter(model, messages, params),
      scoring: { fileIO, enabled: true },
    });

    await deliberateFn({
      task: "write a hello world function",
      models: [MODEL_A.id, MODEL_B.id],
      protocol: "shared_convergence",
      maxRounds: 1,
    });

    const ratings = await readRatings(fileIO);
    const keys = Object.keys(ratings.cells);
    expect(keys.some((k) => k.includes(MODEL_A.id) && k.includes("software/smoke-test"))).toBe(true);
    expect(keys.some((k) => k.includes(MODEL_B.id) && k.includes("software/smoke-test"))).toBe(true);

    const lines = await readLogLines(fileIO);
    expect(lines).toHaveLength(1);
    expect(lines[0].topicPath).toBe("software/smoke-test");
    expect(lines[0].topicSource).toBe("classified");
    expect(lines[0].workers).toHaveLength(2);
  });

  it("uses the host-authored topic path and skips the classify call", async () => {
    const fileIO = makeFakeFileIO();
    const rawChat = mock(fakeRawChat());
    const chatAdapter = createChatAdapter(rawChat);
    const deliberateFn = createDeliberateFn({
      registry: fixtureRegistry(),
      chat: (model, messages, params) => chatAdapter(model, messages, params),
      scoring: { fileIO, enabled: true },
    });

    await deliberateFn({
      task: "write a hello world function",
      models: [MODEL_A.id, MODEL_B.id],
      protocol: "shared_convergence",
      maxRounds: 1,
      topicPath: ["test", "smoke"],
    });

    const classifyCalls = rawChat.mock.calls.filter((c) => (c[0] as ChatCompletionRequest).system?.includes("Classify the task"));
    expect(classifyCalls).toHaveLength(0);

    const lines = await readLogLines(fileIO);
    expect(lines[0].topicPath).toBe("test/smoke");
    expect(lines[0].topicSource).toBe("host");
  });

  it("writes nothing when scoring is disabled (--no-scoring)", async () => {
    const fileIO = makeFakeFileIO();
    const chatAdapter = createChatAdapter(fakeRawChat());
    const deliberateFn = createDeliberateFn({
      registry: fixtureRegistry(),
      chat: (model, messages, params) => chatAdapter(model, messages, params),
      scoring: { fileIO, enabled: false },
    });

    await deliberateFn({
      task: "write a hello world function",
      models: [MODEL_A.id, MODEL_B.id],
      protocol: "shared_convergence",
      maxRounds: 1,
    });

    expect(fileIO.writeFile).not.toHaveBeenCalled();
    expect(fileIO.appendFile).not.toHaveBeenCalled();
  });

  it("skips evaluation_scoring by default (protocol gate) but scores it with --score-eval", async () => {
    const fileIOOff = makeFakeFileIO();
    const chatAdapterOff = createChatAdapter(fakeRawChat());
    const deliberateFnOff = createDeliberateFn({
      registry: fixtureRegistry(),
      chat: (model, messages, params) => chatAdapterOff(model, messages, params),
      scoring: { fileIO: fileIOOff, enabled: true }, // no scoreEvalEnabled -> default off
    });
    await deliberateFnOff({
      task: "evaluate this code",
      models: [MODEL_A.id, MODEL_B.id],
      protocol: "evaluation_scoring",
      maxRounds: 1,
    });
    expect(fileIOOff.writeFile).not.toHaveBeenCalled();
    const linesOff = await readLogLines(fileIOOff);
    expect(linesOff[0].skipReason).toBe("protocol");

    const fileIOOn = makeFakeFileIO();
    const chatAdapterOn = createChatAdapter(fakeRawChat());
    const deliberateFnOn = createDeliberateFn({
      registry: fixtureRegistry(),
      chat: (model, messages, params) => chatAdapterOn(model, messages, params),
      scoring: { fileIO: fileIOOn, enabled: true, scoreEvalEnabled: true },
    });
    await deliberateFnOn({
      task: "evaluate this code",
      models: [MODEL_A.id, MODEL_B.id],
      protocol: "evaluation_scoring",
      maxRounds: 1,
    });
    const linesOn = await readLogLines(fileIOOn);
    expect(linesOn[0].skipReason).toBeUndefined();
    expect(linesOn[0].workers.length).toBeGreaterThan(0);
  });
});
