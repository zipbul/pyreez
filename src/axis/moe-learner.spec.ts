import { describe, it, expect, mock } from "bun:test";
import type { FileIO } from "../report/types";
import { MoeLearner } from "./moe-learner";

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

describe("MoeLearner", () => {
  // 9. [HP] update increases target expert weight
  it("should increase target expert weight on positive reward", () => {
    const learner = new MoeLearner({ numExperts: 3 });
    const before = learner.getWeights()[0]!;
    learner.update(0, 1.0);
    const after = learner.getWeights()[0]!;
    expect(after).toBeGreaterThan(before);
  });

  // 10. [HP] getWeights returns array summing to ~1.0
  it("should return weights summing to approximately 1.0", () => {
    const learner = new MoeLearner({ numExperts: 4 });
    learner.update(0, 1.0);
    learner.update(2, 0.5);
    const sum = learner.getWeights().reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  // 11. [NE] load with no file → default equal weights
  it("should use default equal weights when load finds no file", async () => {
    const io = makeFakeIO();
    const learner = new MoeLearner({ numExperts: 3, io });
    await learner.load();
    const weights = learner.getWeights();
    expect(weights.length).toBe(3);
    expect(weights[0]).toBeCloseTo(1 / 3, 5);
  });

  // 12. [NE] flush io error → swallowed
  it("should swallow io errors during flush", async () => {
    const io = makeFakeIO();
    (io.writeFile as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error("disk full");
    });
    const learner = new MoeLearner({ numExperts: 3, io });
    learner.update(0, 1.0);
    await expect(learner.flush()).resolves.toBeUndefined();
  });

  // 13. [ED] single expert → always weight 1.0
  it("should keep single expert weight at 1.0", () => {
    const learner = new MoeLearner({ numExperts: 1 });
    learner.update(0, 5.0);
    expect(learner.getWeights()[0]).toBeCloseTo(1.0, 5);
  });

  // 14. [ED] reward=0 → weights unchanged
  it("should not change weights on zero reward", () => {
    const learner = new MoeLearner({ numExperts: 3 });
    const before = [...learner.getWeights()];
    learner.update(1, 0);
    const after = learner.getWeights();
    for (let i = 0; i < 3; i++) {
      expect(after[i]).toBeCloseTo(before[i]!, 5);
    }
  });

  // 15. [ST] round-trip persistence
  it("should persist and restore weights correctly", async () => {
    const io = makeFakeIO();
    const learner1 = new MoeLearner({ numExperts: 3, io, basePath: ".test" });
    learner1.update(0, 2.0);
    learner1.update(2, 1.0);
    await learner1.flush();

    const learner2 = new MoeLearner({ numExperts: 3, io, basePath: ".test" });
    await learner2.load();

    const w1 = learner1.getWeights();
    const w2 = learner2.getWeights();
    for (let i = 0; i < 3; i++) {
      expect(w2[i]).toBeCloseTo(w1[i]!, 5);
    }
  });

  // 16. [OR] different update order → different weights
  it("should produce different weights for different update orders", () => {
    const a = new MoeLearner({ numExperts: 3, learningRate: 0.5 });
    a.update(0, 1.0);
    a.update(1, -0.5);

    const b = new MoeLearner({ numExperts: 3, learningRate: 0.5 });
    b.update(1, -0.5);
    b.update(0, 1.0);

    // Due to normalization after each update, order matters
    const wa = a.getWeights();
    const wb = b.getWeights();
    // At least one weight should differ
    const differs = wa.some((w, i) => Math.abs(w - wb[i]!) > 0.001);
    expect(differs).toBe(true);
  });
});
