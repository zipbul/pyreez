import { describe, it, expect, mock } from "bun:test";
import { FileRunLogger } from "./run-logger";
import type { FileIO } from "./types";
import type { RunRecord } from "./run-logger";

// --- Test Doubles ---

function stubFileIO(overrides: Partial<FileIO> = {}): FileIO {
  return {
    appendFile: mock(() => Promise.resolve()),
    readFile: mock(() => Promise.resolve("")),
    writeFile: mock(() => Promise.resolve()),
    mkdir: mock(() => Promise.resolve()),
    glob: mock(() => Promise.resolve([])),
    rename: mock(() => Promise.resolve()),
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
});
