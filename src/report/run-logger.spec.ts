import { describe, it, expect, mock, beforeEach } from "bun:test";
import { FileRunLogger } from "./run-logger";
import type { FileIO } from "./types";
import type { RunRecord } from "./run-logger";

// --- Test Doubles ---

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

function validRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-001",
    timestamp: 1708700000000,
    tool: "route",
    durationMs: 120,
    success: true,
    ...overrides,
  };
}

// --- Tests ---

describe("FileRunLogger", () => {
  // --- Constructor ---

  it("should throw when baseDir is empty", () => {
    expect(() => new FileRunLogger("", stubFileIO())).toThrow("baseDir");
  });

  it("should throw when io is missing", () => {
    expect(() => new FileRunLogger(".pyreez/runs", null as any)).toThrow("io");
  });

  // --- log ---

  it("should save run record as JSONL line with mkdir", async () => {
    const io = stubFileIO();
    const logger = new FileRunLogger(".pyreez/runs", io);
    const record = validRecord();

    await logger.log(record);

    expect(io.mkdir).toHaveBeenCalledWith(".pyreez/runs");
    expect(io.appendFile).toHaveBeenCalledTimes(1);
    const [path, data] = (io.appendFile as ReturnType<typeof mock>).mock
      .calls[0]!;
    expect(path).toContain(".pyreez/runs/");
    expect(path).toEndWith(".jsonl");
    const parsed = JSON.parse(data.replace("\n", ""));
    expect(parsed.id).toBe("run-001");
    expect(parsed.tool).toBe("route");
    expect(parsed.success).toBe(true);
  });

  it("should throw when record id is empty", async () => {
    const logger = new FileRunLogger(".pyreez/runs", stubFileIO());

    await expect(logger.log(validRecord({ id: "" }))).rejects.toThrow("id");
  });

  it("should throw when record tool is empty", async () => {
    const logger = new FileRunLogger(".pyreez/runs", stubFileIO());

    await expect(logger.log(validRecord({ tool: "" }))).rejects.toThrow(
      "tool",
    );
  });

  it("should propagate appendFile error", async () => {
    const io = stubFileIO({
      appendFile: mock(() => Promise.reject(new Error("disk full"))),
    });
    const logger = new FileRunLogger(".pyreez/runs", io);

    await expect(logger.log(validRecord())).rejects.toThrow("disk full");
  });

  // --- query ---

  it("should return all records when no filter", async () => {
    const records = [
      validRecord({ id: "r1", tool: "route" }),
      validRecord({ id: "r2", tool: "ask", success: false }),
    ];
    const io = stubFileIO({
      glob: mock(() => Promise.resolve([".pyreez/runs/2026-02-23.jsonl"])),
      readFile: mock(() =>
        Promise.resolve(records.map((r) => JSON.stringify(r)).join("\n") + "\n"),
      ),
    });
    const logger = new FileRunLogger(".pyreez/runs", io);

    const result = await logger.query();

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("r1");
    expect(result[1]!.id).toBe("r2");
  });

  it("should filter records by tool", async () => {
    const records = [
      validRecord({ id: "r1", tool: "route" }),
      validRecord({ id: "r2", tool: "ask" }),
      validRecord({ id: "r3", tool: "route" }),
    ];
    const io = stubFileIO({
      glob: mock(() => Promise.resolve([".pyreez/runs/2026-02-23.jsonl"])),
      readFile: mock(() =>
        Promise.resolve(records.map((r) => JSON.stringify(r)).join("\n") + "\n"),
      ),
    });
    const logger = new FileRunLogger(".pyreez/runs", io);

    const result = await logger.query({ tool: "route" });

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.tool === "route")).toBe(true);
  });

  it("should filter records by success status", async () => {
    const records = [
      validRecord({ id: "r1", success: true }),
      validRecord({ id: "r2", success: false }),
      validRecord({ id: "r3", success: true }),
    ];
    const io = stubFileIO({
      glob: mock(() => Promise.resolve([".pyreez/runs/2026-02-23.jsonl"])),
      readFile: mock(() =>
        Promise.resolve(records.map((r) => JSON.stringify(r)).join("\n") + "\n"),
      ),
    });
    const logger = new FileRunLogger(".pyreez/runs", io);

    const result = await logger.query({ success: false });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("r2");
  });

  it("should limit query results", async () => {
    const records = [
      validRecord({ id: "r1" }),
      validRecord({ id: "r2" }),
      validRecord({ id: "r3" }),
    ];
    const io = stubFileIO({
      glob: mock(() => Promise.resolve([".pyreez/runs/2026-02-23.jsonl"])),
      readFile: mock(() =>
        Promise.resolve(records.map((r) => JSON.stringify(r)).join("\n") + "\n"),
      ),
    });
    const logger = new FileRunLogger(".pyreez/runs", io);

    const result = await logger.query({ limit: 2 });

    expect(result).toHaveLength(2);
  });

  it("should return empty when no files exist", async () => {
    const io = stubFileIO({
      glob: mock(() => Promise.resolve([])),
    });
    const logger = new FileRunLogger(".pyreez/runs", io);

    const result = await logger.query();

    expect(result).toHaveLength(0);
  });

  it("should skip malformed JSON lines", async () => {
    const valid = validRecord({ id: "r1" });
    const content = `${JSON.stringify(valid)}\n{bad json\n`;
    const io = stubFileIO({
      glob: mock(() => Promise.resolve([".pyreez/runs/2026-02-23.jsonl"])),
      readFile: mock(() => Promise.resolve(content)),
    });
    const logger = new FileRunLogger(".pyreez/runs", io);

    const result = await logger.query();

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("r1");
  });

  // -- ED: undefined timestamp fallback --

  it("should use current date path when record timestamp is undefined", async () => {
    // Arrange
    const io = stubFileIO();
    const logger = new FileRunLogger(".pyreez/runs", io);
    const record = validRecord({ timestamp: undefined as any });

    // Act
    await logger.log(record);

    // Assert — path should be a valid YYYY-MM-DD, not NaN
    const call = (io.appendFile as any).mock.calls[0];
    const path = call[0] as string;
    expect(path).toMatch(/\.pyreez\/runs\/\d{4}-\d{2}-\d{2}\.jsonl$/);
    expect(path).not.toContain("NaN");
  });

  // -- ED: negative limit --

  it("should return empty array when limit is negative", async () => {
    // Arrange — 2 records available
    const records = [validRecord({ id: "r1" }), validRecord({ id: "r2" })];
    const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const io = stubFileIO({
      glob: mock(() => Promise.resolve([".pyreez/runs/2026-02-23.jsonl"])),
      readFile: mock(() => Promise.resolve(content)),
    });
    const logger = new FileRunLogger(".pyreez/runs", io);

    // Act
    const result = await logger.query({ limit: -1 });

    // Assert — Math.max(0, -1) = 0 → empty
    expect(result).toHaveLength(0);
  });
});
