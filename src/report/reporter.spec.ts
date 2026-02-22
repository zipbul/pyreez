import { describe, it, expect } from "bun:test";
import { InMemoryReporter } from "./reporter";
import type { CallRecord } from "./types";

// --- Fixtures ---

function validRecord(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    model: "openai/gpt-4.1",
    taskType: "CODE_WRITE",
    quality: 8,
    latencyMs: 1200,
    tokens: { input: 100, output: 200 },
    ...overrides,
  };
}

// --- Tests ---

describe("InMemoryReporter", () => {
  // === HP ===

  it("should record valid call successfully", async () => {
    const reporter = new InMemoryReporter();
    const record = validRecord();

    await reporter.record(record);

    const all = reporter.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].model).toBe("openai/gpt-4.1");
    expect(all[0].taskType).toBe("CODE_WRITE");
    expect(all[0].quality).toBe(8);
    expect(all[0].latencyMs).toBe(1200);
    expect(all[0].tokens).toEqual({ input: 100, output: 200 });
  });

  it("should return all records in order via getAll", async () => {
    const reporter = new InMemoryReporter();

    await reporter.record(validRecord({ model: "openai/gpt-4.1" }));
    await reporter.record(validRecord({ model: "openai/gpt-4.1-mini" }));
    await reporter.record(validRecord({ model: "meta/Llama-4-Maverick" }));

    const all = reporter.getAll();
    expect(all).toHaveLength(3);
    expect(all[0].model).toBe("openai/gpt-4.1");
    expect(all[1].model).toBe("openai/gpt-4.1-mini");
    expect(all[2].model).toBe("meta/Llama-4-Maverick");
  });

  it("should filter records by model via getByModel", async () => {
    const reporter = new InMemoryReporter();

    await reporter.record(validRecord({ model: "openai/gpt-4.1" }));
    await reporter.record(validRecord({ model: "openai/gpt-4.1-mini" }));
    await reporter.record(validRecord({ model: "openai/gpt-4.1" }));

    const filtered = reporter.getByModel("openai/gpt-4.1");
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.model === "openai/gpt-4.1")).toBe(true);
  });

  it("should filter records by taskType via getByTaskType", async () => {
    const reporter = new InMemoryReporter();

    await reporter.record(validRecord({ taskType: "CODE_WRITE" }));
    await reporter.record(validRecord({ taskType: "CODE_REVIEW" }));
    await reporter.record(validRecord({ taskType: "CODE_WRITE" }));

    const filtered = reporter.getByTaskType("CODE_WRITE");
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.taskType === "CODE_WRITE")).toBe(true);
  });

  it("should clear all records", async () => {
    const reporter = new InMemoryReporter();

    await reporter.record(validRecord());
    await reporter.record(validRecord());
    expect(reporter.getAll()).toHaveLength(2);

    reporter.clear();
    expect(reporter.getAll()).toHaveLength(0);
  });

  it("should return copy from getAll not reference", async () => {
    const reporter = new InMemoryReporter();

    await reporter.record(validRecord());

    const first = reporter.getAll();
    const second = reporter.getAll();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  // === NE ===

  it("should throw when model is empty", async () => {
    const reporter = new InMemoryReporter();

    await expect(
      reporter.record(validRecord({ model: "" })),
    ).rejects.toThrow("model is required");
  });

  it("should throw when taskType is empty", async () => {
    const reporter = new InMemoryReporter();

    await expect(
      reporter.record(validRecord({ taskType: "" })),
    ).rejects.toThrow("taskType is required");
  });

  it("should throw when quality is null", async () => {
    const reporter = new InMemoryReporter();

    await expect(
      reporter.record(validRecord({ quality: null as unknown as number })),
    ).rejects.toThrow("quality is required");
  });

  // === ED ===

  it("should return empty array from getAll when no records", () => {
    const reporter = new InMemoryReporter();

    expect(reporter.getAll()).toEqual([]);
    expect(reporter.getAll()).toHaveLength(0);
  });

  it("should return empty array from getByModel when no match", async () => {
    const reporter = new InMemoryReporter();

    await reporter.record(validRecord({ model: "openai/gpt-4.1" }));

    expect(reporter.getByModel("nonexistent/model")).toHaveLength(0);
  });

  it("should record with quality 0 boundary", async () => {
    const reporter = new InMemoryReporter();

    await reporter.record(validRecord({ quality: 0 }));

    const all = reporter.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].quality).toBe(0);
  });

  // === CO ===

  it("should return empty after clear then getAll", async () => {
    const reporter = new InMemoryReporter();

    await reporter.record(validRecord());
    await reporter.record(validRecord());
    reporter.clear();

    expect(reporter.getAll()).toHaveLength(0);
    expect(reporter.getByModel("openai/gpt-4.1")).toHaveLength(0);
    expect(reporter.getByTaskType("CODE_WRITE")).toHaveLength(0);
  });
});
