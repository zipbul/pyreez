/**
 * Unit tests for the ratings store — 리프 적립과 영속(원자적 쓰기), 파일 무결성.
 * FileIO는 전부 test double (실 I/O 금지).
 */

import { describe, it, expect, mock } from "bun:test";
import { cellKey } from "./backoff";
import { ScoredProtocol } from "./enums";
import type { CellCoord, RatingsFile } from "./interfaces";
import type { FileIO } from "../../report/types";
import { EMPTY_RATINGS, loadRatings, recordObservation, saveRatings } from "./store";

const COORD: CellCoord = {
  model: "xai/grok-4.5",
  protocol: ScoredProtocol.SharedConvergence,
  topicPath: "medicine/diagnosis",
  axis: "accuracy",
};

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

describe("recordObservation", () => {
  it("accumulates the observation at the leaf only (전 계층 적립은 이중계수 결함이었다)", () => {
    const file = recordObservation(EMPTY_RATINGS, COORD, 90, 1_000);
    expect(file.cells[cellKey(COORD)]).toEqual({ mean: 90, n: 1, m2: 0 });
    expect(file.cells[cellKey({ ...COORD, topicPath: "medicine" })]).toBeUndefined();
    expect(Object.keys(file.cells)).toHaveLength(1);
  });

  it("stamps updatedAt with the given timestamp", () => {
    const file = recordObservation(EMPTY_RATINGS, COORD, 90, 1_234);
    expect(file.updatedAt).toBe(1_234);
  });

  it("does not move updatedAt backward (역행 방지)", () => {
    const file = recordObservation(EMPTY_RATINGS, COORD, 90, 1_000);
    const stale = recordObservation(file, COORD, 80, 500);
    expect(stale.updatedAt).toBe(1_000);
  });

  it("does not mutate the input file (불변성)", () => {
    const before = recordObservation(EMPTY_RATINGS, COORD, 90, 1);
    const snapshot = JSON.parse(JSON.stringify(before)) as RatingsFile;
    recordObservation(before, COORD, 50, 2);
    expect(before).toEqual(snapshot);
  });

  it("keeps sibling topics independent", () => {
    let file = recordObservation(EMPTY_RATINGS, COORD, 90, 1);
    file = recordObservation(file, { ...COORD, topicPath: "medicine/pharmacology" }, 60, 2);
    expect(file.cells[cellKey(COORD)]!.mean).toBe(90);
    expect(file.cells[cellKey({ ...COORD, topicPath: "medicine/pharmacology" })]!.mean).toBe(60);
  });

  it("rejects a non-finite or out-of-range score", () => {
    expect(() => recordObservation(EMPTY_RATINGS, COORD, Number.NaN, 1)).toThrow();
    expect(() => recordObservation(EMPTY_RATINGS, COORD, Number.POSITIVE_INFINITY, 1)).toThrow();
    expect(() => recordObservation(EMPTY_RATINGS, COORD, 0, 1)).toThrow();
    expect(() => recordObservation(EMPTY_RATINGS, COORD, 101, 1)).toThrow();
  });

  it("rejects a non-finite timestamp", () => {
    expect(() => recordObservation(EMPTY_RATINGS, COORD, 90, Number.NaN)).toThrow();
  });
});

describe("loadRatings", () => {
  it("round-trips a saved file", async () => {
    const file = recordObservation(EMPTY_RATINGS, COORD, 90, 1_000);
    const io = stubFileIO({ readFile: mock(async () => JSON.stringify(file)) });
    expect(await loadRatings(io, ".pyreez/ratings.json")).toEqual(file);
  });

  it("returns the empty ratings when the file is missing (readFile throws), without quarantining", async () => {
    const rename = mock(async () => {});
    const io = stubFileIO({
      readFile: mock(async () => {
        throw new Error("ENOENT");
      }),
      rename,
    });
    expect(await loadRatings(io, ".pyreez/ratings.json")).toEqual(EMPTY_RATINGS);
    expect(rename).not.toHaveBeenCalled();
  });

  it("returns the empty ratings for a blank file, without quarantining", async () => {
    const rename = mock(async () => {});
    const io = stubFileIO({ readFile: mock(async () => "   "), rename });
    expect(await loadRatings(io, ".pyreez/ratings.json")).toEqual(EMPTY_RATINGS);
    expect(rename).not.toHaveBeenCalled();
  });

  it("quarantines corrupt JSON (rename to .corrupt) and returns empty ratings", async () => {
    const rename = mock(async () => {});
    const io = stubFileIO({ readFile: mock(async () => "{ nope"), rename });
    expect(await loadRatings(io, ".pyreez/ratings.json")).toEqual(EMPTY_RATINGS);
    expect(rename).toHaveBeenCalledWith(".pyreez/ratings.json", ".pyreez/ratings.json.corrupt");
  });

  it("quarantines a version mismatch and returns empty ratings", async () => {
    const rename = mock(async () => {});
    const io = stubFileIO({
      readFile: mock(async () => JSON.stringify({ v: 99, updatedAt: 1, cells: {} })),
      rename,
    });
    expect(await loadRatings(io, ".pyreez/ratings.json")).toEqual(EMPTY_RATINGS);
    expect(rename).toHaveBeenCalledWith(".pyreez/ratings.json", ".pyreez/ratings.json.corrupt");
  });

  it("quarantines a foreign container shape (cells as an Array) and returns empty ratings", async () => {
    const rename = mock(async () => {});
    const io = stubFileIO({
      readFile: mock(async () => JSON.stringify({ v: 1, updatedAt: 1, cells: [] })),
      rename,
    });
    expect(await loadRatings(io, ".pyreez/ratings.json")).toEqual(EMPTY_RATINGS);
    expect(rename).toHaveBeenCalledWith(".pyreez/ratings.json", ".pyreez/ratings.json.corrupt");
  });

  it("ignores a quarantine failure and still returns empty ratings (best-effort)", async () => {
    const io = stubFileIO({
      readFile: mock(async () => "{ nope"),
      rename: mock(async () => {
        throw new Error("EACCES");
      }),
    });
    expect(await loadRatings(io, ".pyreez/ratings.json")).toEqual(EMPTY_RATINGS);
  });

  it("drops only the malformed cell and keeps the healthy one (전체 기각 금지)", async () => {
    const good = cellKey(COORD);
    const bad = cellKey({ ...COORD, axis: "depth" });
    const raw = JSON.stringify({
      v: 1,
      updatedAt: 1,
      cells: { [good]: { mean: 90, n: 1, m2: 0 }, [bad]: { mean: Number.NaN, n: 1, m2: 0 } },
    });
    const io = stubFileIO({ readFile: mock(async () => raw) });
    const loaded = await loadRatings(io, ".pyreez/ratings.json");
    expect(loaded.cells[good]).toEqual({ mean: 90, n: 1, m2: 0 });
    expect(loaded.cells[bad]).toBeUndefined();
  });
});

describe("saveRatings", () => {
  it("writes to a temp file then renames over the target (원자적 스왑)", async () => {
    const writes: string[] = [];
    const renames: [string, string][] = [];
    const io = stubFileIO({
      writeFile: mock(async (p: string) => {
        writes.push(p);
      }),
      rename: mock(async (from: string, to: string) => {
        renames.push([from, to]);
      }),
    });

    await saveRatings(io, ".pyreez/ratings.json", EMPTY_RATINGS);

    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toBe(".pyreez/ratings.json");
    expect(renames).toEqual([[writes[0]!, ".pyreez/ratings.json"]]);
  });

  it("ensures the parent directory exists", async () => {
    const mkdir = mock(async () => {});
    const io = stubFileIO({ mkdir });
    await saveRatings(io, ".pyreez/ratings.json", EMPTY_RATINGS);
    expect(mkdir).toHaveBeenCalledWith(".pyreez");
  });

  it("uses a distinct temp file name on every call (동시 실행 충돌 방지)", async () => {
    const writes: string[] = [];
    const io = stubFileIO({
      writeFile: mock(async (p: string) => {
        writes.push(p);
      }),
    });
    await saveRatings(io, ".pyreez/ratings.json", EMPTY_RATINGS);
    await saveRatings(io, ".pyreez/ratings.json", EMPTY_RATINGS);
    expect(writes[0]).not.toBe(writes[1]);
  });
});
