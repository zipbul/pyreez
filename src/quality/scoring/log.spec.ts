/**
 * Unit tests for the raw scoring log — 런당 1줄 JSONL append.
 */

import { describe, it, expect, mock } from "bun:test";
import { appendScoringLog } from "./log";
import type { RunScoringRecord } from "./interfaces";
import type { FileIO } from "../../report/types";

function stubFileIO(over: Partial<FileIO> = {}): FileIO {
  return {
    appendFile: mock(async () => {}),
    readFile: mock(async () => ""),
    writeFile: mock(async () => {}),
    mkdir: mock(async () => {}),
    glob: mock(async () => []),
    rename: mock(async () => {}),
    ...over,
  };
}

const RECORD: RunScoringRecord = {
  v: 1,
  ts: 1_000,
  protocol: "shared_convergence",
  topicPath: "medicine/diagnosis",
  topicSource: "classified",
  workers: [],
};

describe("appendScoringLog", () => {
  it("ensures the parent directory exists", async () => {
    const mkdir = mock(async () => {});
    const io = stubFileIO({ mkdir });
    await appendScoringLog(io, ".pyreez/ratings-log.jsonl", RECORD);
    expect(mkdir).toHaveBeenCalledWith(".pyreez");
  });

  it("appends the record as a single JSON line", async () => {
    const appendFile = mock(async () => {});
    const io = stubFileIO({ appendFile });
    await appendScoringLog(io, ".pyreez/ratings-log.jsonl", RECORD);
    expect(appendFile).toHaveBeenCalledWith(".pyreez/ratings-log.jsonl", JSON.stringify(RECORD) + "\n");
  });

  it("does not attempt mkdir for a bare (non-nested) path", async () => {
    const mkdir = mock(async () => {});
    const io = stubFileIO({ mkdir });
    await appendScoringLog(io, "ratings-log.jsonl", RECORD);
    expect(mkdir).toHaveBeenCalledWith(".");
  });
});
