/**
 * Unit tests for FileDeliberationStore.
 *
 * SUT: FileDeliberationStore (file-store.ts)
 * All FileIO operations are test-doubled via DI injection.
 */

import { describe, it, expect, mock } from "bun:test";
import { FileDeliberationStore } from "./file-store";
import type { FileIO } from "../report/types";
import type { DeliberationRecord } from "./store-types";

// -- Fixtures --

function stubFileIO(overrides: Partial<FileIO> = {}): FileIO {
  return {
    appendFile: mock(() => Promise.resolve()),
    readFile: mock(() => Promise.resolve("")),
    writeFile: mock(() => Promise.resolve()),
    mkdir: mock(() => Promise.resolve()),
    glob: mock(() => Promise.resolve([])),
    removeGlob: mock(() => Promise.resolve()),
    ...overrides,
  };
}

function makeRecord(overrides: Partial<DeliberationRecord> = {}): DeliberationRecord {
  return {
    id: "rec-001",
    task: "Write unit tests",
    timestamp: 1700000000000,
    consensusReached: true,
    roundsExecuted: 2,
    result: "Generated code here",
    modelsUsed: ["openai/gpt-4.1", "meta/llama-4-scout"],
    totalLLMCalls: 7,
    ...overrides,
  };
}

// Helper: build io that returns records from readFile
function ioWithRecords(records: DeliberationRecord[]): FileIO {
  const content = records.map((r) => JSON.stringify(r)).join("\n");
  return stubFileIO({
    glob: mock(() => Promise.resolve(["2025-01-01.jsonl"])),
    readFile: mock(() => Promise.resolve(content)),
  });
}

describe("FileDeliberationStore", () => {
  // =================================================================
  // Happy Path
  // =================================================================

  describe("save", () => {
    it("should call io.mkdir to ensure directory exists on save", async () => {
      // Arrange
      const io = stubFileIO();
      const store = new FileDeliberationStore("/data/deliberations", io);
      const record = makeRecord();

      // Act
      await store.save(record);

      // Assert
      expect(io.mkdir).toHaveBeenCalledTimes(1);
      expect((io.mkdir as ReturnType<typeof mock>).mock.calls[0]![0]).toBe(
        "/data/deliberations",
      );
    });

    it("should call io.appendFile with JSON + newline on save", async () => {
      // Arrange
      const io = stubFileIO();
      const store = new FileDeliberationStore("/data/deliberations", io);
      const record = makeRecord();

      // Act
      await store.save(record);

      // Assert
      expect(io.appendFile).toHaveBeenCalledTimes(1);
      const [path, data] = (io.appendFile as ReturnType<typeof mock>).mock
        .calls[0]!;
      expect(path).toContain("/data/deliberations/");
      expect(path).toMatch(/\.jsonl$/);
      expect(data).toBe(JSON.stringify(record) + "\n");
    });
  });

  describe("query", () => {
    it("should return all records when query has no filters", async () => {
      // Arrange
      const r1 = makeRecord({ id: "r1" });
      const r2 = makeRecord({ id: "r2", task: "Other task" });
      const io = ioWithRecords([r1, r2]);
      const store = new FileDeliberationStore("/data", io);

      // Act
      const results = await store.query({});

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe("r1");
      expect(results[1]!.id).toBe("r2");
    });

    it("should filter by task using partial string match", async () => {
      // Arrange
      const r1 = makeRecord({ id: "r1", task: "Write unit tests" });
      const r2 = makeRecord({ id: "r2", task: "Design API schema" });
      const io = ioWithRecords([r1, r2]);
      const store = new FileDeliberationStore("/data", io);

      // Act
      const results = await store.query({ task: "unit" });

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("r1");
    });

    it("should filter by model in modelsUsed", async () => {
      // Arrange
      const r1 = makeRecord({
        id: "r1",
        modelsUsed: ["openai/gpt-4.1", "meta/llama-4-scout"],
      });
      const r2 = makeRecord({
        id: "r2",
        modelsUsed: ["mistralai/mistral-large"],
      });
      const io = ioWithRecords([r1, r2]);
      const store = new FileDeliberationStore("/data", io);

      // Act
      const results = await store.query({ model: "meta/llama-4-scout" });

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("r1");
    });

    it("should filter by consensusReached boolean", async () => {
      // Arrange
      const r1 = makeRecord({ id: "r1", consensusReached: true });
      const r2 = makeRecord({ id: "r2", consensusReached: false });
      const io = ioWithRecords([r1, r2]);
      const store = new FileDeliberationStore("/data", io);

      // Act
      const results = await store.query({ consensusReached: false });

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("r2");
    });

    it("should limit results when limit is specified", async () => {
      // Arrange
      const records = Array.from({ length: 5 }, (_, i) =>
        makeRecord({ id: `r${i}` }),
      );
      const io = ioWithRecords(records);
      const store = new FileDeliberationStore("/data", io);

      // Act
      const results = await store.query({ limit: 2 });

      // Assert
      expect(results).toHaveLength(2);
    });

    it("should apply multiple filters together", async () => {
      // Arrange
      const r1 = makeRecord({
        id: "r1",
        task: "Write code",
        consensusReached: true,
      });
      const r2 = makeRecord({
        id: "r2",
        task: "Write tests",
        consensusReached: false,
      });
      const r3 = makeRecord({
        id: "r3",
        task: "Write docs",
        consensusReached: true,
      });
      const io = ioWithRecords([r1, r2, r3]);
      const store = new FileDeliberationStore("/data", io);

      // Act
      const results = await store.query({
        task: "Write",
        consensusReached: true,
      });

      // Assert
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id)).toEqual(["r1", "r3"]);
    });
  });

  describe("getById", () => {
    it("should return matching record for getById", async () => {
      // Arrange
      const r1 = makeRecord({ id: "r1" });
      const r2 = makeRecord({ id: "r2" });
      const io = ioWithRecords([r1, r2]);
      const store = new FileDeliberationStore("/data", io);

      // Act
      const result = await store.getById("r2");

      // Assert
      expect(result).toBeDefined();
      expect(result!.id).toBe("r2");
    });
  });

  // =================================================================
  // Negative / Error
  // =================================================================

  describe("validation errors", () => {
    it("should throw when record.id is missing on save", async () => {
      // Arrange
      const io = stubFileIO();
      const store = new FileDeliberationStore("/data", io);
      const record = makeRecord({ id: "" });

      // Act & Assert
      expect(store.save(record)).rejects.toThrow();
    });

    it("should throw when record.task is missing on save", async () => {
      // Arrange
      const io = stubFileIO();
      const store = new FileDeliberationStore("/data", io);
      const record = makeRecord({ task: "" });

      // Act & Assert
      expect(store.save(record)).rejects.toThrow();
    });
  });

  describe("io errors", () => {
    it("should propagate io error on save", async () => {
      // Arrange
      const io = stubFileIO({
        appendFile: mock(() => Promise.reject(new Error("disk full"))),
      });
      const store = new FileDeliberationStore("/data", io);
      const record = makeRecord();

      // Act & Assert
      expect(store.save(record)).rejects.toThrow("disk full");
    });

    it("should propagate io.readFile error on query", async () => {
      // Arrange
      const io = stubFileIO({
        glob: mock(() => Promise.resolve(["2025-01-01.jsonl"])),
        readFile: mock(() => Promise.reject(new Error("read failed"))),
      });
      const store = new FileDeliberationStore("/data", io);

      // Act & Assert
      expect(store.query({})).rejects.toThrow("read failed");
    });
  });

  describe("invalid data handling", () => {
    it("should skip invalid JSON lines on query", async () => {
      // Arrange
      const validRecord = makeRecord({ id: "valid" });
      const content = `not-json\n${JSON.stringify(validRecord)}\n{broken`;
      const io = stubFileIO({
        glob: mock(() => Promise.resolve(["2025-01-01.jsonl"])),
        readFile: mock(() => Promise.resolve(content)),
      });
      const store = new FileDeliberationStore("/data", io);

      // Act
      const results = await store.query({});

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("valid");
    });

    it("should return undefined for non-existent id on getById", async () => {
      // Arrange
      const r1 = makeRecord({ id: "r1" });
      const io = ioWithRecords([r1]);
      const store = new FileDeliberationStore("/data", io);

      // Act
      const result = await store.getById("nonexistent");

      // Assert
      expect(result).toBeUndefined();
    });
  });

  // =================================================================
  // Edge
  // =================================================================

  describe("edge cases", () => {
    it("should return empty array when no files exist", async () => {
      // Arrange
      const io = stubFileIO({
        glob: mock(() => Promise.resolve([])),
      });
      const store = new FileDeliberationStore("/data", io);

      // Act
      const results = await store.query({});

      // Assert
      expect(results).toHaveLength(0);
    });

    it("should return empty array when limit is 0", async () => {
      // Arrange
      const io = ioWithRecords([makeRecord()]);
      const store = new FileDeliberationStore("/data", io);

      // Act
      const results = await store.query({ limit: 0 });

      // Assert
      expect(results).toHaveLength(0);
    });

    it("should return empty array when no records match filters", async () => {
      // Arrange
      const io = ioWithRecords([makeRecord({ task: "Write code" })]);
      const store = new FileDeliberationStore("/data", io);

      // Act
      const results = await store.query({ task: "NONEXISTENT" });

      // Assert
      expect(results).toHaveLength(0);
    });
  });

  // =================================================================
  // Corner
  // =================================================================

  describe("corner cases", () => {
    it("should return only valid records when mixed with invalid JSON lines", async () => {
      // Arrange
      const r1 = makeRecord({ id: "ok1" });
      const r2 = makeRecord({ id: "ok2" });
      const content = `${JSON.stringify(r1)}\n{invalid}\n${JSON.stringify(r2)}\nnot-json`;
      const io = stubFileIO({
        glob: mock(() => Promise.resolve(["f.jsonl"])),
        readFile: mock(() => Promise.resolve(content)),
      });
      const store = new FileDeliberationStore("/data", io);

      // Act
      const results = await store.query({});

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0]!.id).toBe("ok1");
      expect(results[1]!.id).toBe("ok2");
    });

    it("should return all records when limit exceeds total count", async () => {
      // Arrange
      const records = [makeRecord({ id: "r1" }), makeRecord({ id: "r2" })];
      const io = ioWithRecords(records);
      const store = new FileDeliberationStore("/data", io);

      // Act
      const results = await store.query({ limit: 100 });

      // Assert
      expect(results).toHaveLength(2);
    });
  });

  // =================================================================
  // Idempotency
  // =================================================================

  describe("idempotency", () => {
    it("should return identical results for identical queries", async () => {
      // Arrange
      const records = [
        makeRecord({ id: "r1", task: "Alpha" }),
        makeRecord({ id: "r2", task: "Beta" }),
      ];
      const io = ioWithRecords(records);
      const store = new FileDeliberationStore("/data", io);

      // Act
      const results1 = await store.query({ task: "Alpha" });
      const results2 = await store.query({ task: "Alpha" });

      // Assert
      expect(results1).toEqual(results2);
    });
  });
});
