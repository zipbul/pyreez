import { describe, it, expect, mock } from "bun:test";
import { FileFeedbackStore } from "./feedback-store";
import type { FileIO } from "./types";
import type { FeedbackRecord } from "./feedback-types";

function makeFakeIO(): FileIO & { store: Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    store,
    appendFile: mock(async (path: string, data: string) => {
      store[path] = (store[path] ?? "") + data;
    }),
    readFile: mock(async (path: string) => {
      if (store[path] !== undefined) return store[path];
      throw new Error("ENOENT");
    }),
    writeFile: mock(async (path: string, data: string) => {
      store[path] = data;
    }),
    mkdir: mock(async () => {}),
    glob: mock(async (pattern: string) => {
      const dir = pattern.replace("/*.jsonl", "");
      return Object.keys(store).filter((k) => k.startsWith(dir) && k.endsWith(".jsonl"));
    }),
    removeGlob: mock(async () => {}),
  };
}

function makeFeedback(overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: "boolean",
    value: true,
    ...overrides,
  };
}

describe("FileFeedbackStore", () => {
  it("should record feedback as JSONL", async () => {
    const io = makeFakeIO();
    const store = new FileFeedbackStore(".pyreez/feedback", io);
    const feedback = makeFeedback({ sessionId: "s1", modelId: "m1" });

    await store.record(feedback);

    expect(io.mkdir).toHaveBeenCalledWith(".pyreez/feedback");
    expect(io.appendFile).toHaveBeenCalledTimes(1);
    const writtenPath = (io.appendFile as ReturnType<typeof mock>).mock.calls[0]![0] as string;
    expect(writtenPath).toContain(".jsonl");
    const writtenData = (io.appendFile as ReturnType<typeof mock>).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenData.trim());
    expect(parsed.sessionId).toBe("s1");
    expect(parsed.modelId).toBe("m1");
    expect(parsed.type).toBe("boolean");
    expect(parsed.value).toBe(true);
  });

  it("should retrieve all recorded feedback", async () => {
    const io = makeFakeIO();
    const store = new FileFeedbackStore(".pyreez/feedback", io);

    await store.record(makeFeedback({ sessionId: "s1" }));
    await store.record(makeFeedback({ sessionId: "s2" }));

    const all = await store.getAll();
    expect(all.length).toBe(2);
  });

  it("should query by sessionId", async () => {
    const io = makeFakeIO();
    const store = new FileFeedbackStore(".pyreez/feedback", io);

    await store.record(makeFeedback({ sessionId: "s1", modelId: "m1" }));
    await store.record(makeFeedback({ sessionId: "s2", modelId: "m2" }));

    const result = await store.query({ sessionId: "s1" });
    expect(result.length).toBe(1);
    expect(result[0]!.sessionId).toBe("s1");
  });

  it("should query by modelId", async () => {
    const io = makeFakeIO();
    const store = new FileFeedbackStore(".pyreez/feedback", io);

    await store.record(makeFeedback({ modelId: "m1" }));
    await store.record(makeFeedback({ modelId: "m2" }));
    await store.record(makeFeedback({ modelId: "m1" }));

    const result = await store.query({ modelId: "m1" });
    expect(result.length).toBe(2);
  });

  it("should return empty when no files exist", async () => {
    const io = makeFakeIO();
    const store = new FileFeedbackStore(".pyreez/feedback", io);

    const all = await store.getAll();
    expect(all).toEqual([]);
  });

  it("should handle all four feedback types", async () => {
    const io = makeFakeIO();
    const store = new FileFeedbackStore(".pyreez/feedback", io);

    await store.record(makeFeedback({ type: "boolean", value: true }));
    await store.record(makeFeedback({ type: "float", value: 0.85 }));
    await store.record(makeFeedback({ type: "comment", value: "good response" }));
    await store.record(makeFeedback({ type: "demonstration", value: "corrected output" }));

    const all = await store.getAll();
    expect(all.length).toBe(4);
    expect(all.map((r) => r.type).sort()).toEqual(["boolean", "comment", "demonstration", "float"]);
  });
});
