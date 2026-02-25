import { describe, it, expect, mock } from "bun:test";
import type { FileIO } from "../report/types";
import { MfLearner } from "./mf-learner";

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

describe("MfLearner", () => {
  // 17. [HP] train step reduces prediction error
  it("should reduce prediction error after training", () => {
    const learner = new MfLearner({ numContexts: 3, numModels: 3, latentDim: 4 });
    const before = Math.abs(1.0 - learner.predict(0, 0));

    for (let i = 0; i < 50; i++) {
      learner.train(0, 0, 1.0);
    }

    const after = Math.abs(1.0 - learner.predict(0, 0));
    expect(after).toBeLessThan(before);
  });

  // 18. [HP] predict returns dot product
  it("should return a numeric prediction", () => {
    const learner = new MfLearner({ numContexts: 2, numModels: 2 });
    const pred = learner.predict(0, 0);
    expect(typeof pred).toBe("number");
    expect(Number.isFinite(pred)).toBe(true);
  });

  // 19. [NE] out-of-range index does not crash
  it("should not crash on out-of-range indices", () => {
    const learner = new MfLearner({ numContexts: 2, numModels: 2 });
    // Should handle gracefully — return 0 or default
    expect(() => learner.predict(-1, 0)).not.toThrow();
    expect(() => learner.predict(0, 99)).not.toThrow();
    expect(() => learner.train(-1, 0, 1.0)).not.toThrow();
  });

  // 20. [NE] load ENOENT → fresh factors
  it("should use fresh random factors when load finds no file", async () => {
    const io = makeFakeIO();
    const learner = new MfLearner({ numContexts: 2, numModels: 2, io });
    await learner.load();
    // Should still work after failed load
    const pred = learner.predict(0, 0);
    expect(typeof pred).toBe("number");
  });

  // 21. [ED] latentDim=1 → still functional
  it("should work with latentDim of 1", () => {
    const learner = new MfLearner({ numContexts: 2, numModels: 2, latentDim: 1 });
    for (let i = 0; i < 20; i++) {
      learner.train(0, 0, 1.0);
    }
    const pred = learner.predict(0, 0);
    expect(pred).toBeGreaterThan(0);
  });

  // 22. [ST] multiple trains → prediction converges
  it("should converge prediction toward target after many training steps", () => {
    const learner = new MfLearner({ numContexts: 2, numModels: 2, latentDim: 4, learningRate: 0.05 });
    const target = 0.8;

    for (let i = 0; i < 500; i++) {
      learner.train(1, 1, target);
    }

    const pred = learner.predict(1, 1);
    expect(Math.abs(pred - target)).toBeLessThan(0.3);
  });

  // 23. [ST] round-trip persistence
  it("should persist and restore factors correctly", async () => {
    const io = makeFakeIO();
    const learner1 = new MfLearner({ numContexts: 2, numModels: 2, latentDim: 2, io, basePath: ".test" });
    for (let i = 0; i < 50; i++) {
      learner1.train(0, 0, 1.0);
    }
    await learner1.flush();

    const learner2 = new MfLearner({ numContexts: 2, numModels: 2, latentDim: 2, io, basePath: ".test" });
    await learner2.load();

    expect(learner2.predict(0, 0)).toBeCloseTo(learner1.predict(0, 0), 5);
  });

  // 24. [ID] repeated train same data → consistent
  it("should produce consistent state with repeated same training data", () => {
    const a = new MfLearner({ numContexts: 2, numModels: 2, latentDim: 2 });
    const b = new MfLearner({ numContexts: 2, numModels: 2, latentDim: 2 });

    // Note: random init means factors differ — test consistency of operations only
    // Train a lot to see convergence toward same target
    for (let i = 0; i < 100; i++) {
      a.train(0, 0, 0.5);
    }
    for (let i = 0; i < 100; i++) {
      b.train(0, 0, 0.5);
    }

    // Both should converge toward similar predictions for same target
    expect(Math.abs(a.predict(0, 0) - b.predict(0, 0))).toBeLessThan(0.3);
  });
});
