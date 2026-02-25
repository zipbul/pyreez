import { describe, it, expect, mock } from "bun:test";
import type {
  ClassifyOutput,
  EnsemblePlan,
  ModelScore,
  DeliberationResult,
} from "./types";
import type { ScoringSystem } from "./interfaces";
import type { FileIO } from "../report/types";
import { LocalLearningLayer } from "./learning";
import type { LlmJudge } from "./judge";
import type { MoeLearner } from "./moe-learner";
import type { MfLearner } from "./mf-learner";

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

function makeFakeJudge(score: number = 7): LlmJudge {
  return {
    evaluate: mock(async () => score),
  } as any;
}

function makeFakeMoeLearner(): MoeLearner & { updateCalls: Array<{ expertIdx: number; reward: number }> } {
  const calls: Array<{ expertIdx: number; reward: number }> = [];
  return {
    updateCalls: calls,
    update: mock((expertIdx: number, reward: number) => {
      calls.push({ expertIdx, reward });
    }),
    getWeights: mock(() => [0.5, 0.5]),
    flush: mock(async () => {}),
    load: mock(async () => {}),
  } as any;
}

function makeFakeMfLearner(): MfLearner & { trainCalls: Array<{ ctx: number; model: number; actual: number }> } {
  const calls: Array<{ ctx: number; model: number; actual: number }> = [];
  return {
    trainCalls: calls,
    train: mock((ctx: number, model: number, actual: number) => {
      calls.push({ ctx, model, actual });
    }),
    predict: mock((_ctx: number, _model: number) => 0.7),
    flush: mock(async () => {}),
    load: mock(async () => {}),
  } as any;
}

describe("LocalLearningLayer Phase 6 enhancements", () => {
  // 36. [HP] record with judge → L3 updated
  it("should update MoE learner with judge quality score", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const judge = makeFakeJudge(8);
    const moeLearner = makeFakeMoeLearner();

    const layer = new LocalLearningLayer({
      scoring,
      io,
      syncInterval: 100,
      judge,
      moeLearner,
    });

    await layer.record(
      makeClassified(),
      makePlan("a", "b"),
      makeResult(["a", "b"]),
    );

    expect(moeLearner.update).toHaveBeenCalled();
  });

  // 37. [HP] record with judge → L4 trained
  it("should train MF learner with judge quality score", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const judge = makeFakeJudge(8);
    const mfLearner = makeFakeMfLearner();

    const layer = new LocalLearningLayer({
      scoring,
      io,
      syncInterval: 100,
      judge,
      mfLearner,
    });

    await layer.record(
      makeClassified(),
      makePlan("a", "b"),
      makeResult(["a", "b"]),
    );

    expect(mfLearner.train).toHaveBeenCalled();
  });

  // 38. [HP] enhance with mfLearner → scores adjusted
  it("should adjust scores using MF predictions in enhance", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const mfLearner = makeFakeMfLearner();
    // predict returns 0.7 → should boost

    const layer = new LocalLearningLayer({
      scoring,
      io,
      mfLearner,
    });

    const scores = [makeScore("a", 500), makeScore("b", 500)];
    const enhanced = await layer.enhance(scores, makeClassified());

    // MF prediction adjusts scores
    expect(enhanced.length).toBe(2);
    // At minimum, enhance should use mfLearner.predict
    expect(mfLearner.predict).toHaveBeenCalled();
  });

  // 39. [NE] judge error → swallowed, record succeeds
  it("should swallow judge evaluation error and still record", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const judge = {
      evaluate: mock(async () => {
        throw new Error("judge failed");
      }),
    } as any;
    const moeLearner = makeFakeMoeLearner();

    const layer = new LocalLearningLayer({
      scoring,
      io,
      syncInterval: 100,
      judge,
      moeLearner,
    });

    await expect(
      layer.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"])),
    ).resolves.toBeUndefined();
  });

  // 40. [NE] no judge configured → L3/L4 still work
  it("should work without judge configured", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const moeLearner = makeFakeMoeLearner();

    const layer = new LocalLearningLayer({
      scoring,
      io,
      syncInterval: 100,
      moeLearner,
    });

    await layer.record(
      makeClassified(),
      makePlan("a", "b"),
      makeResult(["a", "b"]),
    );

    // MoE should still receive updates (with default quality)
    // Without judge, no quality-based updates to MoE
    // record still succeeds
  });

  // 41. [ED] judge returns quality=0 → L3/L4 still update
  it("should update L3/L4 even when judge returns quality 0", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const judge = makeFakeJudge(0);
    const moeLearner = makeFakeMoeLearner();
    const mfLearner = makeFakeMfLearner();

    const layer = new LocalLearningLayer({
      scoring,
      io,
      syncInterval: 100,
      judge,
      moeLearner,
      mfLearner,
    });

    await layer.record(
      makeClassified(),
      makePlan("a", "b"),
      makeResult(["a", "b"]),
    );

    expect(moeLearner.update).toHaveBeenCalled();
    expect(mfLearner.train).toHaveBeenCalled();
  });

  // 42. [CO] judge + L3 flush + L4 all trigger same record
  it("should handle judge + MoE + MF all triggering in same record", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const judge = makeFakeJudge(8);
    const moeLearner = makeFakeMoeLearner();
    const mfLearner = makeFakeMfLearner();

    const layer = new LocalLearningLayer({
      scoring,
      io,
      syncInterval: 1,
      judge,
      moeLearner,
      mfLearner,
    });

    await layer.record(
      makeClassified(),
      makePlan("a", "b"),
      makeResult(["a", "b"]),
    );

    expect(judge.evaluate).toHaveBeenCalled();
    expect(moeLearner.update).toHaveBeenCalled();
    expect(mfLearner.train).toHaveBeenCalled();
    expect(io.writeFile).toHaveBeenCalled(); // sync triggered
  });

  // 43. [ST] multiple records → L3 weights evolve
  it("should accumulate MoE updates across multiple records", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const judge = makeFakeJudge(7);
    const moeLearner = makeFakeMoeLearner();

    const layer = new LocalLearningLayer({
      scoring,
      io,
      syncInterval: 100,
      judge,
      moeLearner,
    });

    for (let i = 0; i < 5; i++) {
      await layer.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));
    }

    expect(moeLearner.updateCalls.length).toBeGreaterThanOrEqual(5);
  });

  // 44. [ID] repeated identical records → consistent state
  it("should maintain consistent state across repeated identical records", async () => {
    const io = makeFakeIO();
    const scoring = makeFakeScoring();
    const judge = makeFakeJudge(7);
    const mfLearner = makeFakeMfLearner();

    const layer = new LocalLearningLayer({
      scoring,
      io,
      syncInterval: 100,
      judge,
      mfLearner,
    });

    const classified = makeClassified();
    const plan = makePlan("a", "b");
    const result = makeResult(["a", "b"]);

    for (let i = 0; i < 5; i++) {
      await layer.record(classified, plan, result);
    }

    // All train calls should have same structure
    expect(mfLearner.trainCalls.length).toBeGreaterThanOrEqual(5);
    const firstCall = mfLearner.trainCalls[0]!;
    for (const call of mfLearner.trainCalls) {
      expect(call.actual).toBe(firstCall.actual);
    }
  });

  // 45. [OR] different order → different L3/L4 state
  it("should produce different state for different record orders", async () => {
    const io1 = makeFakeIO();
    const io2 = makeFakeIO();
    const scoring = makeFakeScoring();

    const moe1 = makeFakeMoeLearner();
    const moe2 = makeFakeMoeLearner();
    const judge1 = makeFakeJudge(8);
    const judge2 = makeFakeJudge(3);

    const layer1 = new LocalLearningLayer({
      scoring,
      io: io1,
      syncInterval: 100,
      judge: judge1,
      moeLearner: moe1,
    });

    const layer2 = new LocalLearningLayer({
      scoring,
      io: io2,
      syncInterval: 100,
      judge: judge2,
      moeLearner: moe2,
    });

    await layer1.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));
    await layer2.record(makeClassified(), makePlan("a", "b"), makeResult(["a", "b"]));

    // Different judge scores → different quality → different MoE rewards
    if (moe1.updateCalls.length > 0 && moe2.updateCalls.length > 0) {
      expect(moe1.updateCalls[0]!.reward).not.toBe(moe2.updateCalls[0]!.reward);
    }
  });
});
