import { describe, it, expect, mock } from "bun:test";
import { LlmJudgeScoringSystem } from "./wrappers";
import type { LlmJudge } from "./judge";
import type { ScoringSystem } from "./interfaces";

function makeFakeJudge(defaultScore: number = 7): LlmJudge {
  return {
    evaluate: mock(async (_task: string, _response: string) => defaultScore),
  } as any;
}

function makeFakeBaseScoring(): ScoringSystem {
  return {
    getScores: mock(async (ids: string[]) =>
      ids.map((id) => ({
        modelId: id,
        dimensions: { JUDGMENT: { mu: 500, sigma: 100 } },
        overall: 500,
      })),
    ),
    update: mock(async () => {}),
  };
}

describe("LlmJudgeScoringSystem", () => {
  // 9. [HP] getScores returns evaluated scores
  it("should return scores for given model IDs", async () => {
    const judge = makeFakeJudge(8);
    const base = makeFakeBaseScoring();
    const scoring = new LlmJudgeScoringSystem(judge, base);

    const scores = await scoring.getScores(["model-a", "model-b"]);
    expect(scores.length).toBe(2);
    expect(scores[0]!.modelId).toBe("model-a");
    expect(scores[1]!.modelId).toBe("model-b");
  });

  // 10. [HP] update records pairwise results
  it("should delegate update to base scoring system", async () => {
    const judge = makeFakeJudge();
    const base = makeFakeBaseScoring();
    const scoring = new LlmJudgeScoringSystem(judge, base);

    await scoring.update([
      { modelAId: "a", modelBId: "b", outcome: "A>B", dimension: "JUDGMENT" },
    ]);

    expect(base.update).toHaveBeenCalled();
  });

  // 11. [NE] judge error → default scores
  it("should return base scores when judge evaluation fails", async () => {
    const judge = {
      evaluate: mock(async () => {
        throw new Error("judge down");
      }),
    } as any;
    const base = makeFakeBaseScoring();
    const scoring = new LlmJudgeScoringSystem(judge, base);

    const scores = await scoring.getScores(["model-a"]);
    expect(scores.length).toBe(1);
    expect(scores[0]!.overall).toBe(500); // base score unchanged
  });

  // 12. [NE] empty model list → empty scores
  it("should return empty array for empty model list", async () => {
    const judge = makeFakeJudge();
    const base = makeFakeBaseScoring();
    const scoring = new LlmJudgeScoringSystem(judge, base);

    const scores = await scoring.getScores([]);
    expect(scores).toEqual([]);
  });

  // 13. [ED] single model → single score
  it("should return single score for single model", async () => {
    const judge = makeFakeJudge(9);
    const base = makeFakeBaseScoring();
    const scoring = new LlmJudgeScoringSystem(judge, base);

    const scores = await scoring.getScores(["only-model"]);
    expect(scores.length).toBe(1);
    expect(scores[0]!.modelId).toBe("only-model");
  });

  // 14. [ED] judge returns 0 → valid minimum score
  it("should handle judge returning minimum score 0", async () => {
    const judge = makeFakeJudge(0);
    const base = makeFakeBaseScoring();
    const scoring = new LlmJudgeScoringSystem(judge, base);

    const scores = await scoring.getScores(["model-a"]);
    expect(scores.length).toBe(1);
    // Score should still be valid (base may be unchanged or slightly adjusted)
    expect(typeof scores[0]!.overall).toBe("number");
  });

  // 15. [CO] partial judge errors → some models get defaults
  it("should handle partial judge failures gracefully", async () => {
    let callCount = 0;
    const judge = {
      evaluate: mock(async () => {
        callCount++;
        if (callCount === 1) throw new Error("fail for first");
        return 8;
      }),
    } as any;
    const base = makeFakeBaseScoring();
    const scoring = new LlmJudgeScoringSystem(judge, base);

    const scores = await scoring.getScores(["model-a", "model-b"]);
    expect(scores.length).toBe(2);
  });

  // 16. [ID] same models → consistent scores
  it("should return consistent scores for same models", async () => {
    const judge = makeFakeJudge(7);
    const base = makeFakeBaseScoring();
    const scoring = new LlmJudgeScoringSystem(judge, base);

    const s1 = await scoring.getScores(["a", "b"]);
    const s2 = await scoring.getScores(["a", "b"]);
    expect(s1[0]!.overall).toBe(s2[0]!.overall);
  });
});
