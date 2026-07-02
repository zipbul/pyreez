/**
 * Unit tests for transcript helpers (capture file layout + interrogation replay shape).
 * I/O is exercised through a mocked FileIO; the pure builders are tested directly.
 */

import { describe, it, expect, mock } from "bun:test";
import {
  transcriptEntryFilename,
  buildInterrogationMessages,
  writeTranscript,
  loadTranscriptEntry,
  type TranscriptEntry,
} from "./transcript";
import type { FileIO } from "../report/types";

function entry(over: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    round: 1,
    workerIndex: 0,
    model: "openai/gpt-5.5",
    messages: [
      { role: "system", content: "SYS" },
      { role: "user", content: "U" },
    ],
    output: "worker output",
    ...over,
  };
}

function mockFileIO(over: Partial<FileIO> = {}): FileIO {
  return {
    appendFile: mock(async () => {}),
    readFile: mock(async () => ""),
    writeFile: mock(async () => {}),
    mkdir: mock(async () => {}),
    glob: mock(async () => []),
    removeGlob: mock(async () => {}),
    rename: mock(async () => {}),
    ...over,
  };
}

describe("transcriptEntryFilename", () => {
  it("keys by round + workerIndex + sanitized model (slashes → dashes)", () => {
    expect(transcriptEntryFilename(entry())).toBe("r1_w0_openai-gpt-5.5.json");
  });

  it("distinguishes two workers that resolved to the same model", () => {
    const a = transcriptEntryFilename(entry({ workerIndex: 0, model: "x/m" }));
    const b = transcriptEntryFilename(entry({ workerIndex: 1, model: "x/m" }));
    expect(a).not.toBe(b);
  });
});

describe("buildInterrogationMessages", () => {
  it("appends the worker's own output then the follow-up question, preserving prior messages", () => {
    const e = entry();
    const msgs = buildInterrogationMessages(e, "Why did you say that?");
    expect(msgs).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "U" },
      { role: "assistant", content: "worker output" },
      { role: "user", content: "Why did you say that?" },
    ]);
  });

  it("keeps the system block in place so the adapter re-splits it on replay", () => {
    const msgs = buildInterrogationMessages(entry(), "q");
    expect(msgs[0]).toEqual({ role: "system", content: "SYS" });
  });
});

describe("writeTranscript", () => {
  it("mkdirs the dir, writes one file per entry, and writes the deliberate result", async () => {
    const io = mockFileIO();
    const result = { roundsExecuted: 2 };
    await writeTranscript("/tmp/t", [entry(), entry({ workerIndex: 1 })], result, io);

    expect(io.mkdir).toHaveBeenCalledWith("/tmp/t");
    const writes = (io.writeFile as ReturnType<typeof mock>).mock.calls.map((c) => c[0]);
    expect(writes).toContain("/tmp/t/r1_w0_openai-gpt-5.5.json");
    expect(writes).toContain("/tmp/t/r1_w1_openai-gpt-5.5.json");
    expect(writes).toContain("/tmp/t/result.json");
  });
});

describe("loadTranscriptEntry", () => {
  it("globs by round+worker and parses the matching entry", async () => {
    const e = entry();
    const io = mockFileIO({
      glob: mock(async () => ["/tmp/t/r1_w0_openai-gpt-5.5.json"]),
      readFile: mock(async () => JSON.stringify(e)),
    });
    const loaded = await loadTranscriptEntry("/tmp/t", 1, 0, io);
    expect(loaded).toEqual(e);
    expect(io.glob).toHaveBeenCalledWith("/tmp/t/r1_w0_*.json");
  });

  it("throws a clear error when no entry matches", async () => {
    const io = mockFileIO({ glob: mock(async () => []) });
    await expect(loadTranscriptEntry("/tmp/t", 9, 9, io)).rejects.toThrow(/no transcript entry/i);
  });
});
