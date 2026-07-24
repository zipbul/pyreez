/**
 * 3-judge panel — 각 judge를 1콜로 실행한다(런당 judge 3콜 고정, 워커 수와 무관).
 * 워커 순서는 콜마다 셔플한다(위치편향 완화). 쿼럼: 워커별로 3/3 judge가 모두 유효한 판정을
 * 냈을 때만 중앙값을 낸다 — 판사 1명이 던지거나 아무것도 파싱 못 하면 그 판사는 이 런의
 * 모든 워커에 대해 무효표로 취급된다(quorum 미달로 자연스레 스킵된다).
 */

import { JUDGE_PANEL } from "./constants";
import type { ScoringDeps } from "./interfaces";
import { buildPanelMessages, parsePanelVerdict } from "./rubric";

export interface PanelWorkerResult {
  readonly workerIndex: number;
  /** JUDGE_PANEL과 같은 순서. 그 judge가 이 워커를 채점하지 못했으면 undefined. */
  readonly judgeScores: readonly (Readonly<Record<string, number>> | undefined)[];
  /** 축별 중앙값 — 3/3 judge 모두 유효했을 때만 존재. */
  readonly median?: Readonly<Record<string, number>>;
}

export interface PanelResult {
  readonly workers: readonly PanelWorkerResult[];
  /** JUDGE_PANEL 인덱스 — 던지거나 이 런에서 단 하나의 유효 판정도 못 낸 judge. */
  readonly failedJudges: readonly number[];
}

/** Fisher–Yates, rng 주입식(결정론적 테스트 가능). */
function shuffledIndices(n: number, rng: () => number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = tmp;
  }
  return idx;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** 3-judge 패널을 실행하고, 워커별 축 중앙값(쿼럼 충족 시)을 계산한다. */
export async function runPanel(
  deps: ScoringDeps,
  task: string,
  axes: readonly string[],
  contents: readonly string[],
): Promise<PanelResult> {
  const n = contents.length;
  // judgeVerdicts[j][w] = judge j가, 원래 워커 인덱스 w에 대해 매긴 점수 (undefined = 무효)
  const judgeVerdicts: (Readonly<Record<string, number>> | undefined)[][] = [];
  const failedJudges: number[] = [];

  for (let j = 0; j < JUDGE_PANEL.length; j++) {
    const judgeModel = JUDGE_PANEL[j]!;
    const order = shuffledIndices(n, deps.rng); // order[presentedPos] = originalWorkerIndex
    const verdicts: (Readonly<Record<string, number>> | undefined)[] = new Array(n).fill(undefined);
    try {
      const shuffledContents = order.map((origIdx) => contents[origIdx]!);
      const r = await deps.chat(judgeModel, buildPanelMessages(task, axes, shuffledContents), { webAccess: false });
      const parsed = parsePanelVerdict(r.content, axes, n);
      let anyValid = false;
      for (let pos = 0; pos < n; pos++) {
        const verdict = parsed[pos];
        if (verdict) {
          verdicts[order[pos]!] = verdict.scores;
          anyValid = true;
        }
      }
      if (!anyValid) failedJudges.push(j);
    } catch {
      failedJudges.push(j);
    }
    judgeVerdicts.push(verdicts);
  }

  const workers: PanelWorkerResult[] = [];
  for (let w = 0; w < n; w++) {
    const perJudge = judgeVerdicts.map((v) => v[w]);
    const validCount = perJudge.filter((v) => v !== undefined).length;
    let workerMedian: Record<string, number> | undefined;
    if (validCount === JUDGE_PANEL.length) {
      const medianScores: Record<string, number> = {};
      for (const axis of axes) {
        const values = perJudge.map((v) => v?.[axis]).filter((v): v is number => typeof v === "number");
        const m = median(values);
        if (m !== undefined) medianScores[axis] = m;
      }
      if (Object.keys(medianScores).length > 0) workerMedian = medianScores;
    }
    workers.push({ workerIndex: w, judgeScores: perJudge, ...(workerMedian ? { median: workerMedian } : {}) });
  }

  return { workers, failedJudges };
}
