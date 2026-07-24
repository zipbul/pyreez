/**
 * Raw scoring log — 런당 1줄 JSONL append. affinity.ts의 appendAffinityLog와 동일한
 * 멀티라이터-세이프 append 전용 패턴(compaction 없음 — 이 로그는 진단용 원본이다).
 */

import type { FileIO } from "../../report/types";
import type { RunScoringRecord } from "./interfaces";

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : ".";
}

/** 런 1건의 채점 기록을 JSONL 한 줄로 append한다. */
export async function appendScoringLog(fileIO: FileIO, path: string, record: RunScoringRecord): Promise<void> {
  await fileIO.mkdir(dirOf(path));
  await fileIO.appendFile(path, JSON.stringify(record) + "\n");
}
