/**
 * Unit tests for scoreDeliberation — the scoring orchestrator.
 * Best-effort by contract: every branch below must resolve without throwing.
 */

import { describe, it, expect, mock } from "bun:test";
import type { DeliberateInput, DeliberateOutput } from "../../deliberation/types";
import type { FileIO } from "../../report/types";
import { RATINGS_LOG_PATH, RATINGS_PATH } from "./constants";
import { ScoringSkipReason } from "./enums";
import { scoreDeliberation } from "./hook";
import type { RunScoringRecord, ScoringDeps } from "./interfaces";

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

function readJson(fileIO: FileIO, path: string): Promise<any> {
  return (fileIO.readFile(path) as Promise<string>).then((raw) => JSON.parse(raw));
}

async function logLines(fileIO: FileIO): Promise<RunScoringRecord[]> {
  try {
    const raw = await fileIO.readFile(RATINGS_LOG_PATH);
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

const INPUT: DeliberateInput = {
  task: "diagnose this rash",
  models: ["model/a", "model/b"],
  protocol: "shared_convergence",
};

function outputWithResponses(
  overrides?: Partial<DeliberateOutput>,
): DeliberateOutput {
  return {
    roundsExecuted: 1,
    totalLLMCalls: 2,
    modelsUsed: ["model/a", "model/b"],
    protocol: "shared_convergence",
    rounds: [
      {
        number: 1,
        protocol: "shared_convergence",
        responses: [
          { model: "model/a", content: "answer A", workerIndex: 0 },
          { model: "model/b", content: "answer B", workerIndex: 1 },
        ],
      },
    ],
    ...overrides,
  };
}

/** judge/classify chat: judge calls score every presented answer highly; classify returns a fixed topic. */
function fakeDeps(overrides?: Partial<ScoringDeps>): ScoringDeps {
  const chat = mock(async (_model: string, messages: any[]) => {
    const system = String(messages[0]?.content ?? "");
    if (system.includes("Classify the task")) {
      return { content: '{"domain": "medicine", "subtopic": "rash"}' };
    }
    return { content: '{"A": {"accuracy": 90, "depth": 85, "grounding": 88}, "B": {"accuracy": 70, "depth": 65, "grounding": 60}}' };
  });
  return {
    chat,
    fileIO: makeFakeFileIO(),
    now: () => 1_000,
    rng: () => 0.9999, // identity shuffle
    ...overrides,
  };
}

describe("scoreDeliberation", () => {
  it("scores R1 into ratings.json and appends one raw-log line (happy path)", async () => {
    const deps = fakeDeps();
    await scoreDeliberation(INPUT, outputWithResponses(), deps);

    const ratings = await readJson(deps.fileIO, RATINGS_PATH);
    const cellKeys = Object.keys(ratings.cells);
    expect(cellKeys.some((k) => k.includes("model/a") && k.includes("medicine/rash"))).toBe(true);
    expect(cellKeys.some((k) => k.includes("model/b") && k.includes("medicine/rash"))).toBe(true);

    const lines = await logLines(deps.fileIO);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.topicPath).toBe("medicine/rash");
    expect(lines[0]!.topicSource).toBe("classified");
    expect(lines[0]!.workers).toHaveLength(2);
    expect(lines[0]!.workers.every((w: any) => w.median)).toBe(true);
  });

  it("uses the host topic path and skips the classify call", async () => {
    const chat = mock(async () => ({
      content: '{"A": {"accuracy": 90, "depth": 85, "grounding": 88}, "B": {"accuracy": 70, "depth": 65, "grounding": 60}}',
    }));
    const deps = fakeDeps({ chat, hostTopicPath: ["test", "smoke"] });
    await scoreDeliberation(INPUT, outputWithResponses(), deps);

    // only the 3 judge calls — no classify call was made
    expect(chat).toHaveBeenCalledTimes(3);
    const lines = await logLines(deps.fileIO);
    expect(lines[0]!.topicPath).toBe("test/smoke");
    expect(lines[0]!.topicSource).toBe("host");
  });

  it("skips a protocol outside the scored set and logs the reason, without touching ratings", async () => {
    const deps = fakeDeps();
    await scoreDeliberation(INPUT, outputWithResponses({ protocol: "sequential_refinement" }), deps);

    expect(deps.fileIO.writeFile).not.toHaveBeenCalled();
    const lines = await logLines(deps.fileIO);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.skipReason).toBe(ScoringSkipReason.Protocol);
  });

  it("skips evaluation_scoring by default (eval opt-in required)", async () => {
    const deps = fakeDeps();
    await scoreDeliberation(INPUT, outputWithResponses({ protocol: "evaluation_scoring" }), deps);

    expect(deps.fileIO.writeFile).not.toHaveBeenCalled();
    const lines = await logLines(deps.fileIO);
    expect(lines[0]!.skipReason).toBe(ScoringSkipReason.Protocol);
  });

  it("scores evaluation_scoring when explicitly opted in", async () => {
    const deps = fakeDeps({ scoreEvalEnabled: true });
    await scoreDeliberation(INPUT, outputWithResponses({ protocol: "evaluation_scoring" }), deps);

    const lines = await logLines(deps.fileIO);
    expect(lines[0]!.skipReason).toBeUndefined();
    expect(lines[0]!.workers).toHaveLength(2);
  });

  it("does nothing when R1 has no responses", async () => {
    const deps = fakeDeps();
    await scoreDeliberation(INPUT, outputWithResponses({ rounds: [{ number: 1, protocol: "shared_convergence", responses: [] }] }), deps);

    expect(deps.fileIO.writeFile).not.toHaveBeenCalled();
    expect(deps.fileIO.appendFile).not.toHaveBeenCalled();
  });

  it("does nothing when there are no rounds at all", async () => {
    const deps = fakeDeps();
    await scoreDeliberation(INPUT, outputWithResponses({ rounds: undefined }), deps);

    expect(deps.fileIO.writeFile).not.toHaveBeenCalled();
    expect(deps.fileIO.appendFile).not.toHaveBeenCalled();
  });

  it("logs a JudgeFailure skip when the classifier call throws", async () => {
    const chat = mock(async (_model: string, messages: any[]) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("Classify the task")) throw new Error("classifier down");
      return { content: '{"A": {"accuracy": 90, "depth": 85, "grounding": 88}}' };
    });
    const deps = fakeDeps({ chat });
    await scoreDeliberation(INPUT, outputWithResponses(), deps);

    expect(deps.fileIO.writeFile).not.toHaveBeenCalled();
    const lines = await logLines(deps.fileIO);
    expect(lines[0]!.skipReason).toBe(ScoringSkipReason.JudgeFailure);
  });

  it("logs an InvalidTopic skip when the host topic path is malformed", async () => {
    const deps = fakeDeps({ hostTopicPath: ["a|b"] });
    await scoreDeliberation(INPUT, outputWithResponses(), deps);

    expect(deps.fileIO.writeFile).not.toHaveBeenCalled();
    const lines = await logLines(deps.fileIO);
    expect(lines[0]!.skipReason).toBe(ScoringSkipReason.InvalidTopic);
  });

  it("records a per-worker quorum skip and leaves that worker out of ratings", async () => {
    let callIdx = 0;
    const chat = mock(async (_model: string, messages: any[]) => {
      const system = String(messages[0]?.content ?? "");
      if (system.includes("Classify the task")) return { content: '{"domain": "medicine"}' };
      callIdx++;
      // last judge call fails to produce anything usable -> quorum (2/3) fails for both workers
      if (callIdx === 3) return { content: "no json here" };
      return { content: '{"A": {"accuracy": 90, "depth": 85, "grounding": 88}, "B": {"accuracy": 70, "depth": 65, "grounding": 60}}' };
    });
    const deps = fakeDeps({ chat });
    await scoreDeliberation(INPUT, outputWithResponses(), deps);

    const ratings = await readJson(deps.fileIO, RATINGS_PATH);
    expect(Object.keys(ratings.cells)).toHaveLength(0);
    const lines = await logLines(deps.fileIO);
    expect(lines[0]!.workers.every((w: any) => w.skipReason === ScoringSkipReason.Quorum)).toBe(true);
  });

  it("isolates a per-worker recordObservation failure without dropping the other worker", async () => {
    const deps = fakeDeps();
    const badOutput = outputWithResponses({
      rounds: [
        {
          number: 1,
          protocol: "shared_convergence",
          responses: [
            { model: "bad|model", content: "answer A", workerIndex: 0 },
            { model: "model/b", content: "answer B", workerIndex: 1 },
          ],
        },
      ],
    });
    await scoreDeliberation(INPUT, badOutput, deps);

    const ratings = await readJson(deps.fileIO, RATINGS_PATH);
    expect(Object.keys(ratings.cells).some((k) => k.includes("model/b"))).toBe(true);
    expect(Object.keys(ratings.cells).some((k) => k.includes("bad|model"))).toBe(false);

    const lines = await logLines(deps.fileIO);
    const badRecord = lines[0]!.workers.find((w: any) => w.model === "bad|model");
    expect(badRecord).toBeDefined();
    expect(badRecord!.error).toBeDefined();
    expect(badRecord!.median).toBeDefined(); // panel scored it fine; only the coordinate write failed
  });

  it("never throws even when persistence fails unexpectedly (outermost best-effort)", async () => {
    const deps = fakeDeps();
    (deps.fileIO.mkdir as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error("disk full");
    });
    await expect(scoreDeliberation(INPUT, outputWithResponses(), deps)).resolves.toBeUndefined();
  });

  it("forwards webAccess and reasoning_effort onto the log record when present", async () => {
    const deps = fakeDeps();
    await scoreDeliberation({ ...INPUT, webAccess: false, reasoning_effort: 5 }, outputWithResponses(), deps);

    const lines = await logLines(deps.fileIO);
    expect(lines[0]!.webAccess).toBe(false);
    expect(lines[0]!.reasoningEffort).toBe(5);
  });
});
