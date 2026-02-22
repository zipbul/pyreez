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
const mockUnlink = mock(() => Promise.resolve());

mock.module("node:fs/promises", () => ({
  appendFile: mockAppendFile,
  readFile: mockReadFile,
  mkdir: mockMkdir,
  readdir: mockReaddir,
  unlink: mockUnlink,
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
    mockUnlink.mockClear();

    // Reset to defaults
    mockAppendFile.mockImplementation(() => Promise.resolve());
    mockReadFile.mockImplementation(() => Promise.resolve(""));
    mockMkdir.mockImplementation(() => Promise.resolve());
    mockReaddir.mockImplementation(() => Promise.resolve([]));
    mockUnlink.mockImplementation(() => Promise.resolve());

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

  it("should delete all matching files via removeGlob", async () => {
    mockReaddir.mockImplementation(() =>
      Promise.resolve(["a.jsonl", "b.jsonl"]),
    );

    await io.removeGlob("data/*.jsonl");

    expect(mockUnlink).toHaveBeenCalledTimes(2);
    expect(mockUnlink).toHaveBeenCalledWith("data/a.jsonl");
    expect(mockUnlink).toHaveBeenCalledWith("data/b.jsonl");
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

  it("should propagate unlink error in removeGlob", async () => {
    mockReaddir.mockImplementation(() => Promise.resolve(["file.jsonl"]));
    mockUnlink.mockImplementation(() =>
      Promise.reject(new Error("EPERM: operation not permitted")),
    );

    await expect(io.removeGlob("dir/*.jsonl")).rejects.toThrow(
      "EPERM: operation not permitted",
    );
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

  // === CO ===

  it("should handle removeGlob when glob returns empty", async () => {
    mockReaddir.mockImplementation(() => Promise.resolve([]));

    await io.removeGlob("empty/*.jsonl");

    expect(mockUnlink).not.toHaveBeenCalled();
  });

  // === ID ===

  it("should succeed when mkdir called on existing directory", async () => {
    mockMkdir.mockImplementation(() => Promise.resolve());

    await io.mkdir("/existing/dir");
    await io.mkdir("/existing/dir");

    expect(mockMkdir).toHaveBeenCalledTimes(2);
  });

  it("should succeed when removeGlob called twice", async () => {
    let callCount = 0;
    mockReaddir.mockImplementation(() => {
      callCount++;
      return callCount === 1
        ? Promise.resolve(["file.jsonl"])
        : Promise.resolve([]);
    });

    await io.removeGlob("dir/*.jsonl");
    expect(mockUnlink).toHaveBeenCalledTimes(1);

    await io.removeGlob("dir/*.jsonl");
    expect(mockUnlink).toHaveBeenCalledTimes(1); // no additional unlink
  });
});
