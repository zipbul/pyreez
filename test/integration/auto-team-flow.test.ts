/**
 * Integration test — auto-team flow: `deliberate --auto-team N` through cli.ts's main() dispatch,
 * score-based team selection (src/deliberation/auto-team), and into the stub deliberateFn.
 *
 * SUT boundary (real implementations):
 *   cli.ts (main, parseArgs) + handlers.ts (handleDeliberate) + deliberation/auto-team/* (selectAutoTeam)
 *   + model/ratings/* (loadRatings, selectionPosterior, thompsonSample via the real ratings file
 *   round-trip) + quality/scoring's classifyTopic (for the no-`--topic` classification call).
 *
 * Outside SUT (test-doubled):
 *   deps.config — a stub HandlersConfig (deliberateFn captures the models it receives;
 *   filteredRegistry is a fixed 3-provider candidate pool; chatFn distinguishes the classifier call
 *   by its system prompt). deps.fileIO — in-memory, pre-seeded with `.pyreez/ratings.json`.
 *   deps.rng — fixed, so Thompson sampling is deterministic.
 */

import { describe, expect, it } from "bun:test";
import { main } from "../../src/cli";
import type { CliDeps } from "../../src/cli";
import type { HandlersConfig } from "../../src/handlers";
import type { DeliberateInput, DeliberateOutput } from "../../src/deliberation/types";
import type { ModelInfo } from "../../src/model/types";
import type { FileIO } from "../../src/report/types";
import { EMPTY_RATINGS, recordObservation, ScoredProtocol, type RatingsFile } from "../../src/model/ratings";
import { CONTENT_AXES, RATINGS_PATH } from "../../src/quality/scoring";

class CliExitError extends Error {
  constructor(readonly code: number) {
    super(`process would exit(${code})`);
  }
}

const TOPIC = "software/testing";

function withObservations(file: RatingsFile, modelId: string, score: number, count: number): RatingsFile {
  let f = file;
  for (const axis of CONTENT_AXES) {
    for (let i = 0; i < count; i++) {
      f = recordObservation(f, { model: modelId, protocol: ScoredProtocol.SharedConvergence, topicPath: TOPIC, axis }, score, i);
    }
  }
  return f;
}

function makeMemoryFileIO(initialFiles: Record<string, string> = {}): FileIO {
  const files = new Map<string, string>(Object.entries(initialFiles));
  return {
    async appendFile(path, data) { files.set(path, (files.get(path) ?? "") + data); },
    async readFile(path) {
      const v = files.get(path);
      if (v === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
      return v;
    },
    async writeFile(path, data) { files.set(path, data); },
    async mkdir(_path) {},
    async glob(_pattern) { return []; },
    async rename(from, to) {
      const v = files.get(from);
      if (v !== undefined) { files.set(to, v); files.delete(from); }
    },
  };
}

const CANDIDATES: ModelInfo[] = [
  { id: "openai/hot", provider: "openai" },
  { id: "google/warm", provider: "google" },
  { id: "xai/cold", provider: "xai" },
];

/** Constant rng -> negative z for every Thompson draw (see select.spec.ts's neutral-rng scenarios):
 *  established (hot) models beat colder/weaker ones deterministically. */
const NEUTRAL_RNG = () => 0.5;

function harness(config: HandlersConfig = {}, fileIO?: FileIO, rng: () => number = NEUTRAL_RNG) {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const deps: CliDeps = {
    config,
    fileIO,
    rng,
    stdout: (t) => stdoutLines.push(t),
    stderr: (t) => stderrLines.push(t),
    exit: (code): never => { throw new CliExitError(code); },
  };
  return { deps, stdoutLines, stderrLines };
}

function captureModelsConfig(overrides?: Partial<HandlersConfig>): { config: HandlersConfig; received: () => readonly string[] | undefined } {
  let receivedModels: readonly string[] | undefined;
  const config: HandlersConfig = {
    filteredRegistry: { getAvailable: () => [...CANDIDATES], getById: (id) => CANDIDATES.find((m) => m.id === id) },
    deliberateFn: async (input: DeliberateInput): Promise<DeliberateOutput> => {
      receivedModels = input.models;
      return { roundsExecuted: 1, totalLLMCalls: input.models.length, modelsUsed: [...input.models], protocol: input.protocol ?? "shared_convergence" };
    },
    ...overrides,
  };
  return { config, received: () => receivedModels };
}

describe("auto-team flow — deliberate --auto-team N", () => {
  it("selects the higher-scored models under a fixed rng and never prints real model names to stderr", async () => {
    let ratings = EMPTY_RATINGS;
    ratings = withObservations(ratings, "openai/hot", 95, 20);
    ratings = withObservations(ratings, "google/warm", 90, 20);
    // "xai/cold" has zero observations anywhere.
    const fileIO = makeMemoryFileIO({ [RATINGS_PATH]: JSON.stringify(ratings) });
    const { config, received } = captureModelsConfig();
    const { deps, stderrLines } = harness(config, fileIO);

    await main([
      "bun", "cli.ts", "deliberate",
      "--task", "write a hello world function",
      "--protocol", "shared_convergence",
      "--auto-team", "2",
      "--topic", TOPIC,
      "--no-debug-capture",
    ], deps);

    expect([...received()!].sort()).toEqual(["google/warm", "openai/hot"]);
    const announceLine = stderrLines.find((l) => l.includes("auto-team"));
    expect(announceLine).toContain("2 workers selected");
    expect(announceLine).not.toContain("openai/hot");
    expect(announceLine).not.toContain("google/warm");
    expect(announceLine).not.toContain("xai/cold");
  });

  it("forces provider diversity >= 2, swapping the weaker same-provider pick", async () => {
    let ratings = EMPTY_RATINGS;
    ratings = withObservations(ratings, "openai/hot", 95, 20);
    // A second, stronger openai-provider candidate so the naive top-2 pick is single-provider.
    const candidatesSingleDominant: ModelInfo[] = [
      { id: "openai/hot", provider: "openai" },
      { id: "openai/second", provider: "openai" },
      { id: "xai/cold", provider: "xai" },
    ];
    ratings = withObservations(ratings, "openai/second", 93, 20);
    const fileIO = makeMemoryFileIO({ [RATINGS_PATH]: JSON.stringify(ratings) });
    const { config, received } = captureModelsConfig({
      filteredRegistry: {
        getAvailable: () => [...candidatesSingleDominant],
        getById: (id) => candidatesSingleDominant.find((m) => m.id === id),
      },
    });
    const { deps } = harness(config, fileIO);

    await main([
      "bun", "cli.ts", "deliberate",
      "--task", "write a hello world function",
      "--protocol", "shared_convergence",
      "--auto-team", "2",
      "--topic", TOPIC,
      "--no-debug-capture",
    ], deps);

    const models = received()!;
    expect(models).toHaveLength(2);
    const providers = models.map((m) => candidatesSingleDominant.find((c) => c.id === m)!.provider);
    expect(new Set(providers).size).toBeGreaterThanOrEqual(2);
    expect(models).toContain("xai/cold"); // the only non-openai candidate must be swapped in
  });

  it("dies when --auto-team and --models are both given", async () => {
    const { config } = captureModelsConfig();
    const { deps, stderrLines } = harness(config, makeMemoryFileIO());

    await expect(main([
      "bun", "cli.ts", "deliberate",
      "--task", "t", "--models", "openai/hot", "--auto-team", "2",
    ], deps)).rejects.toThrow(CliExitError);
    expect(stderrLines.join("\n")).toContain("--auto-team");
    expect(stderrLines.join("\n")).toContain("--models");
  });

  it("dies with the auto-team selection error for a non-scored protocol", async () => {
    const fileIO = makeMemoryFileIO({ [RATINGS_PATH]: JSON.stringify(EMPTY_RATINGS) });
    const { config } = captureModelsConfig();
    const { deps, stderrLines } = harness(config, fileIO);

    await expect(main([
      "bun", "cli.ts", "deliberate",
      "--task", "t",
      "--protocol", "host_interrogation",
      "--auto-team", "2",
      "--topic", TOPIC,
    ], deps)).rejects.toThrow(CliExitError);
    expect(stderrLines.join("\n")).toContain("auto-team");
  });

  it("runs a single classification call when --topic is omitted", async () => {
    let ratings = EMPTY_RATINGS;
    ratings = withObservations(ratings, "openai/hot", 95, 20);
    ratings = withObservations(ratings, "google/warm", 90, 20);
    const fileIO = makeMemoryFileIO({ [RATINGS_PATH]: JSON.stringify(ratings) });
    let classifyCalls = 0;
    const { config, received } = captureModelsConfig({
      chatFn: async (_model, messages) => {
        const system = String(messages[0]?.content ?? "");
        if (system.includes("Classify the task")) {
          classifyCalls++;
          return { content: '{"domain": "software", "subtopic": "testing"}' };
        }
        return { content: "unexpected call" };
      },
    });
    const { deps } = harness(config, fileIO);

    await main([
      "bun", "cli.ts", "deliberate",
      "--task", "write a hello world function",
      "--protocol", "shared_convergence",
      "--auto-team", "2",
      "--no-debug-capture",
    ], deps);

    expect(classifyCalls).toBe(1);
    expect([...received()!].sort()).toEqual(["google/warm", "openai/hot"]);
  });
});
