import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";
import type {
  ClassifyOutput,
  EnsemblePlan,
  ModelScore,
  DeliberationResult,
} from "./types";
import type { ScoringSystem } from "./interfaces";
import type { FileIO } from "../report/types";

// SUT — not yet implemented (RED phase)
import { LocalLearningLayer } from "./learning";

// -- Helpers --

function makeClassified(taskType = "IMPLEMENT_FEATURE"): ClassifyOutput {
  return {
    domain: "CODING",
    taskType,
    vocabKind: "taskType",
    complexity: "moderate",
    criticality: "medium",
    method: "rule",
  };
}

function makePlan(...modelIds: string[]): EnsemblePlan {
  return {
    models: modelIds.map((id) => ({ modelId: id })),
    strategy: "test",
    estimatedCost: 0,
    reason: "test",
  };
}

function makeResult(modelsUsed: string[]): DeliberationResult {
  return {
    result: "test result",
    roundsExecuted: 1,
    consensusReached: true,
    totalLLMCalls: modelsUsed.length,
    modelsUsed,
    protocol: "role-based",
  };
}

function makeScore(modelId: string, overall = 500): ModelScore {
  return {
    modelId,
    dimensions: { JUDGMENT: { mu: overall, sigma: 100 } },
    overall,
  };
}

function makeFakeIO(): FileIO {
  const store: Record<string, string> = {};
  return {
    appendFile: mock(async (path: string, data: string) => {
      store[path] = (store[path] ?? "") + data;
    }),
    readFile: mock(async (path: string) => {
      if (store[path] !== undefined) return store[path];
      throw new Error("ENOENT: no such file");
    }),
    writeFile: mock(async (path: string, data: string) => {
      store[path] = data;
    }),
    mkdir: mock(async () => {}),
    glob: mock(async () => []),
    removeGlob: mock(async () => {}),
  };
}

function makeFakeScoring(): ScoringSystem {
  return {
    getScores: mock(async (ids: string[]) =>
      ids.map((id) => makeScore(id)),
    ),
    update: mock(async () => {}),
  };
}

describe("LocalLearningLayer", () => {
  // 1. [HP] record with multi-model plan → preference table updated
  it("should update preference table when recording multi-model plan", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({ scoring, io, syncInterval: 100 });

    const plan = makePlan("model-a", "model-b", "model-c");
    const result = makeResult(["model-a", "model-b", "model-c"]);

    await layer.record(makeClassified(), plan, result);

    // After recording, enhance should reflect some preference data
    const scores = [makeScore("model-a"), makeScore("model-b"), makeScore("model-c")];
    const enhanced = await layer.enhance(scores, makeClassified());

    // At minimum, scores should be returned (table was updated)
    expect(enhanced.length).toBe(3);
  });

  // 2. [HP] enhance with preference data → winning model score boosted
  it("should boost score for model with higher preference win rate", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({ scoring, io, syncInterval: 100 });

    // Record multiple results where model-a always "wins" (first in modelsUsed)
    for (let i = 0; i < 5; i++) {
      await layer.record(
        makeClassified(),
        makePlan("model-a", "model-b"),
        makeResult(["model-a", "model-b"]),
      );
    }

    const scores = [makeScore("model-a", 500), makeScore("model-b", 500)];
    const enhanced = await layer.enhance(scores, makeClassified());

    // model-a should have higher or equal score than model-b
    const aScore = enhanced.find((s) => s.modelId === "model-a")!.overall;
    const bScore = enhanced.find((s) => s.modelId === "model-b")!.overall;
    expect(aScore).toBeGreaterThanOrEqual(bScore);
  });

  // 3. [HP] enhance with no preference data → scores unchanged
  it("should return scores unchanged when no preference data exists", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({ scoring, io });

    const scores = [makeScore("model-a", 500), makeScore("model-b", 300)];
    const enhanced = await layer.enhance(scores, makeClassified());

    expect(enhanced[0]!.overall).toBe(500);
    expect(enhanced[1]!.overall).toBe(300);
  });

  // 4. [HP] syncPreferences writes correct JSON
  it("should write preference data as JSON on sync", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({ scoring, io, syncInterval: 1 });

    await layer.record(
      makeClassified(),
      makePlan("model-a", "model-b"),
      makeResult(["model-a", "model-b"]),
    );

    // syncInterval=1 → sync triggered on first record
    expect(io.writeFile).toHaveBeenCalled();
    const writeCall = (io.writeFile as ReturnType<typeof mock>).mock.calls[0];
    expect(writeCall).toBeDefined();
    // Path should include preferences.json
    expect(writeCall![0]).toContain("preferences.json");
    // Content should be valid JSON
    expect(() => JSON.parse(writeCall![1] as string)).not.toThrow();
  });

  // 5. [HP] loadPreferences reads and populates table
  it("should load preferences from file and use them in enhance", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();

    // Pre-populate IO with preference data
    const prefData = {
      "IMPLEMENT_FEATURE": {
        "model-a": { modelId: "model-a", taskType: "IMPLEMENT_FEATURE", wins: 10, losses: 0, ties: 0 },
        "model-b": { modelId: "model-b", taskType: "IMPLEMENT_FEATURE", wins: 0, losses: 10, ties: 0 },
      },
    };
    await io.writeFile(".pyreez/learning/preferences.json", JSON.stringify(prefData));

    const layer = new LocalLearningLayer({ scoring, io, basePath: ".pyreez/learning" });
    await layer.init();

    const scores = [makeScore("model-a", 500), makeScore("model-b", 500)];
    const enhanced = await layer.enhance(scores, makeClassified());

    const aScore = enhanced.find((s) => s.modelId === "model-a")!.overall;
    const bScore = enhanced.find((s) => s.modelId === "model-b")!.overall;
    expect(aScore).toBeGreaterThan(bScore);
  });

  // 6. [HP] autoCalibrate at threshold → calls scoring.update()
  it("should call scoring.update after reaching auto-calibrate threshold", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({
      scoring,
      io,
      autoCalibThreshold: 3,
      syncInterval: 100,
    });

    for (let i = 0; i < 3; i++) {
      await layer.record(
        makeClassified(),
        makePlan("model-a", "model-b"),
        makeResult(["model-a", "model-b"]),
      );
    }

    expect(scoring.update).toHaveBeenCalled();
  });

  // 7. [NE] loadPreferences with missing file → empty table no error
  it("should not throw when preferences file does not exist", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({ scoring, io });

    // No file written → loadPreferences should handle gracefully
    await expect(layer.init()).resolves.toBeUndefined();
  });

  // 8. [NE] syncPreferences io failure → swallowed
  it("should swallow io errors during sync", async () => {
    const io = makeFakeIO();
    (io.writeFile as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error("disk full");
    });
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({ scoring, io, syncInterval: 1 });

    // Should not throw despite writeFile failure
    await expect(
      layer.record(
        makeClassified(),
        makePlan("model-a", "model-b"),
        makeResult(["model-a", "model-b"]),
      ),
    ).resolves.toBeUndefined();
  });

  // 9. [NE] record with empty plan → no error
  it("should not throw when plan has no models", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({ scoring, io, syncInterval: 100 });

    await expect(
      layer.record(makeClassified(), makePlan(), makeResult([])),
    ).resolves.toBeUndefined();
  });

  // 10. [ED] recordCount at syncInterval → triggers sync
  it("should trigger sync at exact sync interval", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({ scoring, io, syncInterval: 3 });

    for (let i = 0; i < 2; i++) {
      await layer.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));
    }
    expect(io.writeFile).not.toHaveBeenCalled();

    await layer.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));
    expect(io.writeFile).toHaveBeenCalled();
  });

  // 11. [ED] recordCount at autoCalibThreshold → triggers calibrate
  it("should trigger calibrate at exact threshold", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({
      scoring,
      io,
      autoCalibThreshold: 2,
      syncInterval: 100,
    });

    await layer.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));
    expect(scoring.update).not.toHaveBeenCalled();

    await layer.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));
    expect(scoring.update).toHaveBeenCalled();
  });

  // 12. [ED] single model plan → no pairwise no preference change
  it("should not record preference for single-model plan", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({ scoring, io, syncInterval: 100 });

    await layer.record(makeClassified(), makePlan("model-a"), makeResult(["model-a"]));

    const scores = [makeScore("model-a", 500)];
    const enhanced = await layer.enhance(scores, makeClassified());
    expect(enhanced[0]!.overall).toBe(500); // unchanged
  });

  // 13. [ED] empty scores → enhance returns empty
  it("should return empty array when scores are empty", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({ scoring, io });

    const enhanced = await layer.enhance([], makeClassified());
    expect(enhanced).toEqual([]);
  });

  // 14. [CO] record at combined sync+calibrate threshold → both trigger
  it("should trigger both sync and calibrate when thresholds align", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({
      scoring,
      io,
      autoCalibThreshold: 3,
      syncInterval: 3,
    });

    for (let i = 0; i < 3; i++) {
      await layer.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));
    }

    expect(io.writeFile).toHaveBeenCalled();
    expect(scoring.update).toHaveBeenCalled();
  });

  // 15. [ST] recordCount accumulates across multiple calls
  it("should accumulate record count across multiple calls", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({
      scoring,
      io,
      autoCalibThreshold: 5,
      syncInterval: 100,
    });

    for (let i = 0; i < 4; i++) {
      await layer.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));
    }
    expect(scoring.update).not.toHaveBeenCalled();

    await layer.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));
    expect(scoring.update).toHaveBeenCalled();
  });

  // 16. [ST] preference table preserves state across enhance calls
  it("should preserve preference state between enhance calls", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({ scoring, io, syncInterval: 100 });

    for (let i = 0; i < 3; i++) {
      await layer.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));
    }

    const scores = [makeScore("a"), makeScore("b")];
    const e1 = await layer.enhance(scores, makeClassified());
    const e2 = await layer.enhance(scores, makeClassified());

    expect(e1[0]!.overall).toBe(e2[0]!.overall);
    expect(e1[1]!.overall).toBe(e2[1]!.overall);
  });

  // 17. [ST] dirty flag resets after sync
  it("should not re-sync on next record after successful sync", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({ scoring, io, syncInterval: 2 });

    // 2 records → sync
    await layer.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));
    await layer.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));
    const writeCalls1 = (io.writeFile as ReturnType<typeof mock>).mock.calls.length;

    // 3rd record → no additional sync (dirty reset)
    await layer.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));
    const writeCalls2 = (io.writeFile as ReturnType<typeof mock>).mock.calls.length;

    // Next sync should happen at record 4 (syncInterval=2 → every 2nd)
    expect(writeCalls2).toBe(writeCalls1);

    await layer.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));
    const writeCalls3 = (io.writeFile as ReturnType<typeof mock>).mock.calls.length;
    expect(writeCalls3).toBe(writeCalls1 + 1);
  });

  // 18. [ID] repeated record → consistent state
  it("should maintain consistent state with repeated identical records", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({ scoring, io, syncInterval: 100 });

    const classified = makeClassified();
    const plan = makePlan("model-a", "model-b");
    const result = makeResult(["model-a", "model-b"]);

    for (let i = 0; i < 5; i++) {
      await layer.record(classified, plan, result);
    }

    const scores = [makeScore("model-a"), makeScore("model-b")];
    const e1 = await layer.enhance(scores, classified);
    // All 5 records had same "winner" → consistent boost direction
    const aScore = e1.find((s) => s.modelId === "model-a")!.overall;
    const bScore = e1.find((s) => s.modelId === "model-b")!.overall;
    expect(aScore).toBeGreaterThanOrEqual(bScore);
  });

  // 19. [OR] record order affects which model gets boosted
  it("should reflect recording order in preference boost", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const layer = new LocalLearningLayer({ scoring, io, syncInterval: 100 });

    // Record model-b as winner (first in modelsUsed)
    for (let i = 0; i < 5; i++) {
      await layer.record(
        makeClassified(),
        makePlan("model-b", "model-a"),
        makeResult(["model-b", "model-a"]),
      );
    }

    const scores = [makeScore("model-a", 500), makeScore("model-b", 500)];
    const enhanced = await layer.enhance(scores, makeClassified());

    const bScore = enhanced.find((s) => s.modelId === "model-b")!.overall;
    const aScore = enhanced.find((s) => s.modelId === "model-a")!.overall;
    expect(bScore).toBeGreaterThanOrEqual(aScore);
  });
});
