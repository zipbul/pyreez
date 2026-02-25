import { describe, it, expect, mock } from "bun:test";
import type { FileIO } from "../report/types";
import { FewShotExtractor } from "./few-shot";

function makeFakeIO(store: Record<string, string> = {}): FileIO {
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
    glob: mock(async (pattern: string) => {
      return Object.keys(store).filter((k) => k.endsWith(".jsonl"));
    }),
    removeGlob: mock(async () => {}),
  };
}

function makeDelibRecord(taskType: string, consensus: boolean, result: string): string {
  return JSON.stringify({
    taskType,
    consensusReached: consensus,
    result,
    modelsUsed: ["a", "b"],
  });
}

describe("FewShotExtractor", () => {
  // 30. [HP] returns matching consensus examples
  it("should return matching consensus examples for taskType", async () => {
    const store: Record<string, string> = {};
    store[".pyreez/deliberations/log.jsonl"] = [
      makeDelibRecord("IMPLEMENT_FEATURE", true, "Good implementation"),
      makeDelibRecord("IMPLEMENT_FEATURE", false, "Failed attempt"),
      makeDelibRecord("IMPLEMENT_FEATURE", true, "Another success"),
      makeDelibRecord("DEBUG", true, "Debug success"),
    ].join("\n");

    const io = makeFakeIO(store);
    const extractor = new FewShotExtractor({
      io,
      basePath: ".pyreez/deliberations",
      maxExamples: 5,
    });

    const examples = await extractor.extract("IMPLEMENT_FEATURE");
    expect(examples.length).toBe(2);
    expect(examples[0]).toContain("Good implementation");
  });

  // 31. [HP] limits results to maxExamples
  it("should limit results to maxExamples", async () => {
    const store: Record<string, string> = {};
    store[".pyreez/deliberations/log.jsonl"] = [
      makeDelibRecord("CODE", true, "Result 1"),
      makeDelibRecord("CODE", true, "Result 2"),
      makeDelibRecord("CODE", true, "Result 3"),
      makeDelibRecord("CODE", true, "Result 4"),
    ].join("\n");

    const io = makeFakeIO(store);
    const extractor = new FewShotExtractor({
      io,
      basePath: ".pyreez/deliberations",
      maxExamples: 2,
    });

    const examples = await extractor.extract("CODE");
    expect(examples.length).toBe(2);
  });

  // 32. [NE] IO error → empty array
  it("should return empty array on IO error", async () => {
    const io = makeFakeIO();
    (io.glob as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error("IO failure");
    });
    const extractor = new FewShotExtractor({ io });

    const examples = await extractor.extract("IMPLEMENT_FEATURE");
    expect(examples).toEqual([]);
  });

  // 33. [NE] no consensus examples → empty
  it("should return empty array when no consensus examples exist", async () => {
    const store: Record<string, string> = {};
    store[".pyreez/deliberations/log.jsonl"] = [
      makeDelibRecord("CODE", false, "Failed 1"),
      makeDelibRecord("CODE", false, "Failed 2"),
    ].join("\n");

    const io = makeFakeIO(store);
    const extractor = new FewShotExtractor({
      io,
      basePath: ".pyreez/deliberations",
    });

    const examples = await extractor.extract("CODE");
    expect(examples).toEqual([]);
  });

  // 34. [ED] maxExamples=0 → empty array
  it("should return empty array when maxExamples is 0", async () => {
    const store: Record<string, string> = {};
    store[".pyreez/deliberations/log.jsonl"] = [
      makeDelibRecord("CODE", true, "Result 1"),
    ].join("\n");

    const io = makeFakeIO(store);
    const extractor = new FewShotExtractor({
      io,
      basePath: ".pyreez/deliberations",
      maxExamples: 0,
    });

    const examples = await extractor.extract("CODE");
    expect(examples).toEqual([]);
  });

  // 35. [ED] store has many → returns only top N
  it("should return only top N from many examples", async () => {
    const store: Record<string, string> = {};
    const lines = [];
    for (let i = 0; i < 20; i++) {
      lines.push(makeDelibRecord("CODE", true, `Result ${i}`));
    }
    store[".pyreez/deliberations/log.jsonl"] = lines.join("\n");

    const io = makeFakeIO(store);
    const extractor = new FewShotExtractor({
      io,
      basePath: ".pyreez/deliberations",
      maxExamples: 3,
    });

    const examples = await extractor.extract("CODE");
    expect(examples.length).toBe(3);
  });
});
