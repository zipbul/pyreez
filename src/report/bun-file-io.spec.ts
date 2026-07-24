/**
 * BunFileIO unit tests.
 * SUT: BunFileIO — thin adapter implementing FileIO via node:fs/promises.
 * All I/O operations mocked via mock.module("node:fs/promises").
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";

// --- Mocks for node:fs/promises ---
const mockAppendFile = mock(() => Promise.resolve());
const mockReadFile = mock(() => Promise.resolve(""));
const mockMkdir = mock(() => Promise.resolve());
const mockReaddir = mock(() => Promise.resolve([] as string[]));
const mockWriteFile = mock(() => Promise.resolve());
const mockRename = mock(() => Promise.resolve());

mock.module("node:fs/promises", () => ({
  appendFile: mockAppendFile,
  readFile: mockReadFile,
  mkdir: mockMkdir,
  readdir: mockReaddir,
  writeFile: mockWriteFile,
  rename: mockRename,
}));

// SUT must be imported AFTER mock.module
const { BunFileIO } = await import("./bun-file-io");

describe("BunFileIO", () => {
  let io: InstanceType<typeof BunFileIO>;

  beforeEach(() => {
    mockAppendFile.mockClear();
    mockReadFile.mockClear();
    mockMkdir.mockClear();
    mockReaddir.mockClear();
    mockWriteFile.mockClear();

    // Reset to defaults
    mockAppendFile.mockImplementation(() => Promise.resolve());
    mockReadFile.mockImplementation(() => Promise.resolve(""));
    mockMkdir.mockImplementation(() => Promise.resolve());
    mockReaddir.mockImplementation(() => Promise.resolve([]));
    mockWriteFile.mockImplementation(() => Promise.resolve());

    io = new BunFileIO();
  });

  // === HP ===

  it("should delegate appendFile to fs with utf-8 encoding", async () => {
    await io.appendFile("/tmp/test.jsonl", '{"data":1}\n');

    expect(mockAppendFile).toHaveBeenCalledTimes(1);
    expect(mockAppendFile).toHaveBeenCalledWith(
      "/tmp/test.jsonl",
      '{"data":1}\n',
      "utf-8",
    );
  });

  it("should delegate readFile to fs with utf-8 encoding", async () => {
    mockReadFile.mockImplementation(() =>
      Promise.resolve('{"model":"gpt-4.1"}\n'),
    );

    const result = await io.readFile("/tmp/test.jsonl");

    expect(result).toBe('{"model":"gpt-4.1"}\n');
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/test.jsonl", "utf-8");
  });

  it("should delegate mkdir to fs with recursive true", async () => {
    await io.mkdir("/tmp/.pyreez/reports");

    expect(mockMkdir).toHaveBeenCalledTimes(1);
    expect(mockMkdir).toHaveBeenCalledWith("/tmp/.pyreez/reports", {
      recursive: true,
    });
  });

  it("should parse glob pattern and return sorted matching entries", async () => {
    mockReaddir.mockImplementation(() =>
      Promise.resolve(["2026-02-22.jsonl", "2026-02-20.jsonl", "readme.md"]),
    );

    const result = await io.glob(".pyreez/reports/*.jsonl");

    expect(result).toEqual([
      ".pyreez/reports/2026-02-20.jsonl",
      ".pyreez/reports/2026-02-22.jsonl",
    ]);
    expect(mockReaddir).toHaveBeenCalledWith(".pyreez/reports");
  });

  it("respects the prefix before '*' (not just the suffix) — interrogate worker/round selection", async () => {
    // A pattern like "r2_w1_*.json" must match ONLY r2_w1_* files, not every *.json in the dir.
    // Bug: glob filtered on the suffix (".json") alone, so loadTranscriptEntry always got the first
    // sorted entry (r1_w0) regardless of --round/--worker.
    mockReaddir.mockImplementation(() =>
      Promise.resolve([
        "r1_w0_anthropic-haiku.json",
        "r1_w1_xai-grok-build.json",
        "r2_w1_xai-grok-build.json",
        "r2_w2_openai-gpt.json",
        "result.json",
      ]),
    );

    const result = await io.glob("dir/r2_w1_*.json");

    expect(result).toEqual(["dir/r2_w1_xai-grok-build.json"]);
  });

  // === NE ===

  it("should propagate readFile error", async () => {
    mockReadFile.mockImplementation(() =>
      Promise.reject(new Error("ENOENT: no such file")),
    );

    await expect(io.readFile("/nonexistent")).rejects.toThrow(
      "ENOENT: no such file",
    );
  });

  it("should propagate appendFile error", async () => {
    mockReadFile.mockImplementation(() =>
      Promise.reject(new Error("EACCES: permission denied")),
    );
    mockAppendFile.mockImplementation(() =>
      Promise.reject(new Error("EACCES: permission denied")),
    );

    await expect(io.appendFile("/readonly/file", "data")).rejects.toThrow(
      "EACCES: permission denied",
    );
  });

  it("should propagate mkdir error", async () => {
    mockMkdir.mockImplementation(() =>
      Promise.reject(new Error("EACCES: permission denied")),
    );

    await expect(io.mkdir("/root/forbidden")).rejects.toThrow(
      "EACCES: permission denied",
    );
  });

  it("should return empty array when glob readdir fails", async () => {
    mockReaddir.mockImplementation(() =>
      Promise.reject(new Error("ENOENT: no such directory")),
    );

    const result = await io.glob("nonexistent/*.jsonl");

    expect(result).toEqual([]);
    expect(mockReaddir).toHaveBeenCalledWith("nonexistent");
  });

  // === ED ===

  it("should handle appendFile with empty data", async () => {
    await io.appendFile("/tmp/file.jsonl", "");

    expect(mockAppendFile).toHaveBeenCalledWith("/tmp/file.jsonl", "", "utf-8");
  });

  it("should handle glob with no matching files", async () => {
    mockReaddir.mockImplementation(() =>
      Promise.resolve(["readme.md", "config.json"]),
    );

    const result = await io.glob("data/*.jsonl");

    expect(result).toEqual([]);
  });

  it("should default dir to '.' when glob pattern has no slash", async () => {
    mockReaddir.mockImplementation(() =>
      Promise.resolve(["test.jsonl", "other.txt"]),
    );

    const result = await io.glob("*.jsonl");

    expect(result).toEqual(["test.jsonl"]);
    expect(mockReaddir).toHaveBeenCalledWith(".");
  });

  it("should match all entries when glob suffix is empty", async () => {
    mockReaddir.mockImplementation(() =>
      Promise.resolve(["a.txt", "b.jsonl", "c.md"]),
    );

    const result = await io.glob("data/*");

    expect(result).toEqual(["data/a.txt", "data/b.jsonl", "data/c.md"]);
  });

  // === ID ===

  it("should succeed when mkdir called on existing directory", async () => {
    mockMkdir.mockImplementation(() => Promise.resolve());

    await io.mkdir("/existing/dir");
    await io.mkdir("/existing/dir");

    expect(mockMkdir).toHaveBeenCalledTimes(2);
  });

  // === writeFile ===

  it("should delegate writeFile to fs.writeFile with utf-8 encoding", async () => {
    // Arrange
    const path = "/tmp/models.json";
    const data = JSON.stringify({ version: 2, models: {} }, null, 2);

    // Act
    await io.writeFile(path, data);

    // Assert
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith(path, data, "utf-8");
  });

  it("should propagate underlying writeFile error", async () => {
    // Arrange
    mockWriteFile.mockImplementation(() =>
      Promise.reject(new Error("EACCES: permission denied")),
    );

    // Act + Assert
    await expect(io.writeFile("/readonly/models.json", "data")).rejects.toThrow(
      "EACCES: permission denied",
    );
  });

  it("should delegate writeFile with empty string data", async () => {
    // Arrange / Act
    await io.writeFile("/tmp/empty.json", "");

    // Assert
    expect(mockWriteFile).toHaveBeenCalledWith("/tmp/empty.json", "", "utf-8");
  });

  // === rename ===

  it("should delegate rename to fs.rename", async () => {
    await io.rename("/tmp/old.json", "/tmp/new.json");
    expect(mockRename).toHaveBeenCalledWith("/tmp/old.json", "/tmp/new.json");
  });
});
