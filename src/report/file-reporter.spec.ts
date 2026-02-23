import { describe, it, expect, mock, beforeEach } from "bun:test";
import { FileReporter } from "./file-reporter";
import type { CallRecord, FileIO, ReportSummary } from "./types";

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

function stubFileIO(overrides: Partial<FileIO> = {}): FileIO {
  return {
    appendFile: mock(() => Promise.resolve()),
    readFile: mock(() => Promise.resolve("")),
    mkdir: mock(() => Promise.resolve()),
    glob: mock(() => Promise.resolve([])),
    removeGlob: mock(() => Promise.resolve()),
    ...overrides,
  };
}

// --- Tests ---

describe("FileReporter", () => {
  // === HP (Happy Path) ===

  it("should record valid call by appending JSON line via io", async () => {
    const io = stubFileIO();
    const reporter = new FileReporter("/data/reports", io);
    const record = validRecord();

    await reporter.record(record);

    expect(io.mkdir).toHaveBeenCalledTimes(1);
    expect(io.appendFile).toHaveBeenCalledTimes(1);

    const appendCall = (io.appendFile as ReturnType<typeof mock>).mock.calls[0]!;
    const writtenPath = appendCall[0] as string;
    const writtenData = appendCall[1] as string;

    expect(writtenPath).toMatch(/\/data\/reports\/\d{4}-\d{2}-\d{2}\.jsonl$/);
    expect(writtenData).toEndWith("\n");

    const parsed = JSON.parse(writtenData.trim());
    expect(parsed.model).toBe("openai/gpt-4.1");
    expect(parsed.taskType).toBe("CODE_WRITE");
    expect(parsed.quality).toBe(8);
    expect(parsed.latencyMs).toBe(1200);
    expect(parsed.tokens).toEqual({ input: 100, output: 200 });
  });

  it("should record call with context metrics included", async () => {
    const io = stubFileIO();
    const reporter = new FileReporter("/data/reports", io);
    const record = validRecord({
      context: { windowSize: 128000, utilization: 0.45, estimatedWaste: 0.1 },
    });

    await reporter.record(record);

    const appendCall = (io.appendFile as ReturnType<typeof mock>).mock.calls[0]!;
    const parsed = JSON.parse((appendCall[1] as string).trim());
    expect(parsed.context).toEqual({
      windowSize: 128000,
      utilization: 0.45,
      estimatedWaste: 0.1,
    });
  });

  it("should record call with all optional fields", async () => {
    const io = stubFileIO();
    const reporter = new FileReporter("/data/reports", io);
    const record = validRecord({
      context: { windowSize: 128000, utilization: 0.5 },
      teamId: "team-alpha",
      leaderId: "openai/gpt-4.1",
    });

    await reporter.record(record);

    const appendCall = (io.appendFile as ReturnType<typeof mock>).mock.calls[0]!;
    const parsed = JSON.parse((appendCall[1] as string).trim());
    expect(parsed.teamId).toBe("team-alpha");
    expect(parsed.leaderId).toBe("openai/gpt-4.1");
    expect(parsed.context.windowSize).toBe(128000);
  });

  it("should return all records from multiple files via getAll", async () => {
    const io = stubFileIO({
      glob: mock(() =>
        Promise.resolve([
          "/data/reports/2026-02-20.jsonl",
          "/data/reports/2026-02-21.jsonl",
        ]),
      ),
      readFile: mock((path: string) => {
        if (path.includes("02-20")) {
          return Promise.resolve(
            JSON.stringify(validRecord({ model: "model-a" })) + "\n",
          );
        }
        return Promise.resolve(
          JSON.stringify(validRecord({ model: "model-b" })) +
            "\n" +
            JSON.stringify(validRecord({ model: "model-c" })) +
            "\n",
        );
      }),
    });
    const reporter = new FileReporter("/data/reports", io);

    const all = await reporter.getAll();

    expect(all).toHaveLength(3);
    expect(all[0]!.model).toBe("model-a");
    expect(all[1]!.model).toBe("model-b");
    expect(all[2]!.model).toBe("model-c");
  });

  it("should filter records by model via getByModel", async () => {
    const io = stubFileIO({
      glob: mock(() =>
        Promise.resolve(["/data/reports/2026-02-20.jsonl"]),
      ),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify(validRecord({ model: "openai/gpt-4.1" })) +
            "\n" +
            JSON.stringify(validRecord({ model: "meta/Llama-4-Maverick" })) +
            "\n" +
            JSON.stringify(validRecord({ model: "openai/gpt-4.1" })) +
            "\n",
        ),
      ),
    });
    const reporter = new FileReporter("/data/reports", io);

    const filtered = await reporter.getByModel("openai/gpt-4.1");

    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.model === "openai/gpt-4.1")).toBe(true);
  });

  it("should filter records by taskType via getByTaskType", async () => {
    const io = stubFileIO({
      glob: mock(() =>
        Promise.resolve(["/data/reports/2026-02-20.jsonl"]),
      ),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify(validRecord({ taskType: "CODE_WRITE" })) +
            "\n" +
            JSON.stringify(validRecord({ taskType: "CODE_REVIEW" })) +
            "\n" +
            JSON.stringify(validRecord({ taskType: "CODE_WRITE" })) +
            "\n",
        ),
      ),
    });
    const reporter = new FileReporter("/data/reports", io);

    const filtered = await reporter.getByTaskType("CODE_WRITE");

    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.taskType === "CODE_WRITE")).toBe(true);
  });

  it("should return summary with avg quality and count per model", async () => {
    const io = stubFileIO({
      glob: mock(() =>
        Promise.resolve(["/data/reports/2026-02-20.jsonl"]),
      ),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify(
            validRecord({
              model: "model-a",
              quality: 8,
              latencyMs: 1000,
              tokens: { input: 100, output: 200 },
              context: { windowSize: 128000, utilization: 0.5 },
            }),
          ) +
            "\n" +
            JSON.stringify(
              validRecord({
                model: "model-a",
                quality: 6,
                latencyMs: 2000,
                tokens: { input: 200, output: 400 },
                context: { windowSize: 128000, utilization: 0.3 },
              }),
            ) +
            "\n" +
            JSON.stringify(
              validRecord({
                model: "model-b",
                quality: 9,
                latencyMs: 500,
                tokens: { input: 50, output: 100 },
              }),
            ) +
            "\n",
        ),
      ),
    });
    const reporter = new FileReporter("/data/reports", io);

    const summary = await reporter.summary();

    expect(summary.totalRecords).toBe(3);
    expect(summary.models["model-a"]!.count).toBe(2);
    expect(summary.models["model-a"]!.avgQuality).toBe(7);
    expect(summary.models["model-a"]!.avgLatencyMs).toBe(1500);
    expect(summary.models["model-a"]!.avgTokens).toEqual({
      input: 150,
      output: 300,
    });
    expect(summary.models["model-a"]!.avgContextUtilization).toBe(0.4);
    expect(summary.models["model-b"]!.count).toBe(1);
    expect(summary.models["model-b"]!.avgQuality).toBe(9);
    expect(summary.models["model-b"]!.avgContextUtilization).toBeNull();
  });

  // === NE (Negative / Error) ===

  it("should throw when baseDir is empty", () => {
    expect(() => new FileReporter("", stubFileIO())).toThrow(
      "baseDir is required",
    );
  });

  it("should throw when io is null", () => {
    expect(
      () => new FileReporter("/data", null as unknown as FileIO),
    ).toThrow("io is required");
  });

  it("should throw when model is empty on record", async () => {
    const reporter = new FileReporter("/data", stubFileIO());

    await expect(
      reporter.record(validRecord({ model: "" })),
    ).rejects.toThrow("model is required");
  });

  it("should throw when taskType is empty on record", async () => {
    const reporter = new FileReporter("/data", stubFileIO());

    await expect(
      reporter.record(validRecord({ taskType: "" })),
    ).rejects.toThrow("taskType is required");
  });

  it("should throw when quality is null on record", async () => {
    const reporter = new FileReporter("/data", stubFileIO());

    await expect(
      reporter.record(
        validRecord({ quality: null as unknown as number }),
      ),
    ).rejects.toThrow("quality is required");
  });

  it("should propagate error when io.appendFile rejects", async () => {
    const io = stubFileIO({
      appendFile: mock(() => Promise.reject(new Error("disk full"))),
    });
    const reporter = new FileReporter("/data", io);

    await expect(reporter.record(validRecord())).rejects.toThrow("disk full");
  });

  it("should propagate error when io.glob rejects", async () => {
    const io = stubFileIO({
      glob: mock(() => Promise.reject(new Error("permission denied"))),
    });
    const reporter = new FileReporter("/data", io);

    await expect(reporter.getAll()).rejects.toThrow("permission denied");
  });

  it("should skip malformed JSON lines in getAll", async () => {
    const io = stubFileIO({
      glob: mock(() =>
        Promise.resolve(["/data/reports/2026-02-20.jsonl"]),
      ),
      readFile: mock(() =>
        Promise.resolve(
          JSON.stringify(validRecord({ model: "valid-model" })) +
            "\n" +
            "NOT_VALID_JSON\n" +
            JSON.stringify(validRecord({ model: "another-valid" })) +
            "\n",
        ),
      ),
    });
    const reporter = new FileReporter("/data", io);

    const all = await reporter.getAll();

    expect(all).toHaveLength(2);
    expect(all[0]!.model).toBe("valid-model");
    expect(all[1]!.model).toBe("another-valid");
  });

  // === ED (Edge) ===

  it("should return empty array from getAll when no files exist", async () => {
    const io = stubFileIO({
      glob: mock(() => Promise.resolve([])),
    });
    const reporter = new FileReporter("/data", io);

    const all = await reporter.getAll();

    expect(all).toEqual([]);
    expect(all).toHaveLength(0);
  });

  it("should record with quality 0 boundary", async () => {
    const io = stubFileIO();
    const reporter = new FileReporter("/data", io);

    await reporter.record(validRecord({ quality: 0 }));

    const appendCall = (io.appendFile as ReturnType<typeof mock>).mock.calls[0]!;
    const parsed = JSON.parse((appendCall[1] as string).trim());
    expect(parsed.quality).toBe(0);
  });

  it("should return empty summary when no records exist", async () => {
    const io = stubFileIO({
      glob: mock(() => Promise.resolve([])),
    });
    const reporter = new FileReporter("/data", io);

    const summary = await reporter.summary();

    expect(summary.totalRecords).toBe(0);
    expect(summary.models).toEqual({});
  });

  // === CO (Corner) ===

  it("should record with all-zero values successfully", async () => {
    const io = stubFileIO();
    const reporter = new FileReporter("/data", io);

    await reporter.record(
      validRecord({
        quality: 0,
        latencyMs: 0,
        tokens: { input: 0, output: 0 },
      }),
    );

    expect(io.appendFile).toHaveBeenCalledTimes(1);
    const appendCall = (io.appendFile as ReturnType<typeof mock>).mock.calls[0]!;
    const parsed = JSON.parse((appendCall[1] as string).trim());
    expect(parsed.quality).toBe(0);
    expect(parsed.latencyMs).toBe(0);
    expect(parsed.tokens).toEqual({ input: 0, output: 0 });
  });

  it("should handle mixed valid and corrupt files in getAll", async () => {
    const io = stubFileIO({
      glob: mock(() =>
        Promise.resolve([
          "/data/reports/2026-02-20.jsonl",
          "/data/reports/2026-02-21.jsonl",
        ]),
      ),
      readFile: mock((path: string) => {
        if (path.includes("02-20")) {
          return Promise.resolve(
            JSON.stringify(validRecord({ model: "good" })) + "\n",
          );
        }
        return Promise.resolve("CORRUPT\nALSO_CORRUPT\n");
      }),
    });
    const reporter = new FileReporter("/data", io);

    const all = await reporter.getAll();

    expect(all).toHaveLength(1);
    expect(all[0]!.model).toBe("good");
  });

  it("should round-trip records with optional fields undefined", async () => {
    const record = validRecord(); // no context, no teamId, no leaderId
    const serialized = JSON.stringify(record) + "\n";
    const io = stubFileIO({
      glob: mock(() => Promise.resolve(["/data/2026-02-20.jsonl"])),
      readFile: mock(() => Promise.resolve(serialized)),
    });
    const reporter = new FileReporter("/data", io);

    const all = await reporter.getAll();

    expect(all).toHaveLength(1);
    expect(all[0]!.context).toBeUndefined();
    expect(all[0]!.teamId).toBeUndefined();
    expect(all[0]!.leaderId).toBeUndefined();
    expect(all[0]!.model).toBe("openai/gpt-4.1");
  });

  // === ST (State Transition) ===

  it("should return empty getAll on fresh instance then record then getAll shows record", async () => {
    let fileContent = "";
    const io = stubFileIO({
      glob: mock(() => {
        if (fileContent) return Promise.resolve(["/data/2026-02-22.jsonl"]);
        return Promise.resolve([]);
      }),
      readFile: mock(() => Promise.resolve(fileContent)),
      appendFile: mock((path: string, data: string) => {
        fileContent += data;
        return Promise.resolve();
      }),
    });
    const reporter = new FileReporter("/data", io);

    const beforeAll = await reporter.getAll();
    expect(beforeAll).toHaveLength(0);

    await reporter.record(validRecord({ model: "test-model" }));

    const afterAll = await reporter.getAll();
    expect(afterAll).toHaveLength(1);
    expect(afterAll[0]!.model).toBe("test-model");
  });

  it("should return empty getAll after record then clear", async () => {
    let fileContent = "";
    let hasFiles = false;
    const io = stubFileIO({
      glob: mock(() => {
        if (hasFiles) return Promise.resolve(["/data/2026-02-22.jsonl"]);
        return Promise.resolve([]);
      }),
      readFile: mock(() => Promise.resolve(fileContent)),
      appendFile: mock((path: string, data: string) => {
        fileContent += data;
        hasFiles = true;
        return Promise.resolve();
      }),
      removeGlob: mock(() => {
        fileContent = "";
        hasFiles = false;
        return Promise.resolve();
      }),
    });
    const reporter = new FileReporter("/data", io);

    await reporter.record(validRecord());
    await reporter.clear();

    const all = await reporter.getAll();
    expect(all).toHaveLength(0);
  });

  it("should record new data after clear and getAll shows only new", async () => {
    let fileContent = "";
    let hasFiles = false;
    const io = stubFileIO({
      glob: mock(() => {
        if (hasFiles) return Promise.resolve(["/data/2026-02-22.jsonl"]);
        return Promise.resolve([]);
      }),
      readFile: mock(() => Promise.resolve(fileContent)),
      appendFile: mock((path: string, data: string) => {
        fileContent += data;
        hasFiles = true;
        return Promise.resolve();
      }),
      removeGlob: mock(() => {
        fileContent = "";
        hasFiles = false;
        return Promise.resolve();
      }),
    });
    const reporter = new FileReporter("/data", io);

    await reporter.record(validRecord({ model: "old-model" }));
    await reporter.clear();
    await reporter.record(validRecord({ model: "new-model" }));

    const all = await reporter.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.model).toBe("new-model");
  });

  // === ID (Idempotency) ===

  it("should return same results from getAll called twice", async () => {
    const io = stubFileIO({
      glob: mock(() => Promise.resolve(["/data/2026-02-20.jsonl"])),
      readFile: mock(() =>
        Promise.resolve(JSON.stringify(validRecord()) + "\n"),
      ),
    });
    const reporter = new FileReporter("/data", io);

    const first = await reporter.getAll();
    const second = await reporter.getAll();

    expect(first).toEqual(second);
  });

  it("should append duplicate records not deduplicate", async () => {
    const io = stubFileIO();
    const reporter = new FileReporter("/data", io);
    const record = validRecord();

    await reporter.record(record);
    await reporter.record(record);

    expect(io.appendFile).toHaveBeenCalledTimes(2);
  });

  it("should not error when clear called twice", async () => {
    const io = stubFileIO();
    const reporter = new FileReporter("/data", io);

    await reporter.clear();
    await reporter.clear();

    expect(io.removeGlob).toHaveBeenCalledTimes(2);
  });

  // === OR (Ordering) ===

  it("should preserve insertion order in getAll across multiple files", async () => {
    const io = stubFileIO({
      glob: mock(() =>
        Promise.resolve([
          "/data/2026-02-19.jsonl",
          "/data/2026-02-20.jsonl",
          "/data/2026-02-21.jsonl",
        ]),
      ),
      readFile: mock((path: string) => {
        if (path.includes("02-19")) {
          return Promise.resolve(
            JSON.stringify(validRecord({ model: "first" })) + "\n",
          );
        }
        if (path.includes("02-20")) {
          return Promise.resolve(
            JSON.stringify(validRecord({ model: "second" })) +
              "\n" +
              JSON.stringify(validRecord({ model: "third" })) +
              "\n",
          );
        }
        return Promise.resolve(
          JSON.stringify(validRecord({ model: "fourth" })) + "\n",
        );
      }),
    });
    const reporter = new FileReporter("/data", io);

    const all = await reporter.getAll();

    expect(all).toHaveLength(4);
    expect(all[0]!.model).toBe("first");
    expect(all[1]!.model).toBe("second");
    expect(all[2]!.model).toBe("third");
    expect(all[3]!.model).toBe("fourth");
  });
});
