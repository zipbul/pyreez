/**
 * Ratings store — 리프 관측 적립과 파일 영속.
 * 저장은 항상 리프 1셀뿐이다 — backoff.effectivePosterior가 조회 시점에 배타 슬라이스로
 * 상위 계층 신호를 합성한다(store가 조상까지 적립하면 같은 관측이 depth번 계수된다).
 * 쓰기는 임시파일 → rename의 원자적 스왑 (동시 실행이 파일을 반쯤 덮는 것 방지;
 * 병렬 실행 간 병합은 v1 범위 밖 — 설계 §2 한계 5).
 */

import type { FileIO } from "../../report/types";
import type { CellCoord, RatingCell, RatingsFile } from "./interfaces";
import { SCORE_MAX, SCORE_MIN } from "./constants";
import { cellKey } from "./backoff";
import { EMPTY_CELL, updateCell } from "./welford";

export const EMPTY_RATINGS: RatingsFile = { v: 1, updatedAt: 0, cells: {} };

/** 관측 1건(한 런의 3-judge 중앙값)을 리프 셀 1개에만 적립한 새 파일을 반환한다. */
export function recordObservation(
  file: RatingsFile,
  coord: CellCoord,
  score: number,
  ts: number,
): RatingsFile {
  if (!Number.isFinite(score) || score < SCORE_MIN || score > SCORE_MAX) {
    throw new Error(`recordObservation: score must be within [${SCORE_MIN}, ${SCORE_MAX}]: ${score}`);
  }
  if (!Number.isFinite(ts)) {
    throw new Error(`recordObservation: ts must be finite: ${ts}`);
  }
  const key = cellKey(coord);
  const cells = { ...file.cells, [key]: updateCell(file.cells[key] ?? EMPTY_CELL, score) };
  return { v: 1, updatedAt: Math.max(file.updatedAt, ts), cells };
}

function isRatingCell(u: unknown): u is RatingCell {
  if (typeof u !== "object" || u === null) return false;
  const c = u as Record<string, unknown>;
  return (
    typeof c.mean === "number" &&
    Number.isFinite(c.mean) &&
    typeof c.n === "number" &&
    Number.isInteger(c.n) &&
    c.n >= 1 &&
    typeof c.m2 === "number" &&
    Number.isFinite(c.m2) &&
    c.m2 >= 0
  );
}

function isRatingsFile(u: unknown): u is { v: 1; updatedAt: number; cells: Record<string, unknown> } {
  if (typeof u !== "object" || u === null) return false;
  const f = u as Record<string, unknown>;
  if (f.v !== 1) return false;
  if (typeof f.updatedAt !== "number" || !Number.isFinite(f.updatedAt) || f.updatedAt < 0) return false;
  if (typeof f.cells !== "object" || f.cells === null || Array.isArray(f.cells)) return false;
  return true;
}

/** 손상·이형 파일을 격리한다 (best-effort — 실패해도 로드는 계속 진행한다). */
async function quarantine(io: FileIO, path: string): Promise<void> {
  try {
    await io.rename(path, `${path}.corrupt`);
  } catch {
    // 격리 실패는 무시하고 EMPTY로 계속 진행한다.
  }
}

/**
 * 파일을 로드한다. 불량 셀은 개별 드롭하고 건강한 셀은 살린다(NaN 1건이 무관한
 * 관측 다수를 말소하는 전체 기각을 방지). 손상 JSON·이형 스키마는 격리 후 빈 상태로
 * 시작한다. 파일 부재(readFile throw)와 공백 파일은 격리 대상이 아니다(첫 실행이
 * 정상 상태 — 채점은 best-effort이지 심의를 죽이면 안 된다).
 */
export async function loadRatings(io: FileIO, path: string): Promise<RatingsFile> {
  let raw: string;
  try {
    raw = await io.readFile(path);
  } catch {
    return EMPTY_RATINGS;
  }
  if (raw.trim() === "") return EMPTY_RATINGS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await quarantine(io, path);
    return EMPTY_RATINGS;
  }
  if (!isRatingsFile(parsed)) {
    await quarantine(io, path);
    return EMPTY_RATINGS;
  }

  const cells: Record<string, RatingCell> = {};
  for (const [key, value] of Object.entries(parsed.cells)) {
    if (isRatingCell(value)) cells[key] = value;
  }
  return { v: 1, updatedAt: parsed.updatedAt, cells };
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : ".";
}

/** 임시파일에 쓰고 rename으로 스왑 — 동시 실행 2개가 서로의 반쯤 쓴 파일을 덮지 않는다. */
export async function saveRatings(io: FileIO, path: string, file: RatingsFile): Promise<void> {
  await io.mkdir(dirOf(path));
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  await io.writeFile(tmp, JSON.stringify(file));
  await io.rename(tmp, path);
}
