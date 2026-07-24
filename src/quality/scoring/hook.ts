/**
 * Scoring hook — 심의 종료 후 R1을 3-judge 패널로 채점해 ratings에 적립한다.
 * 완전 best-effort: 어떤 실패도 심의 결과 자체를 죽이지 않는다(이 함수는 절대 던지지 않는다).
 *
 * 흐름: 프로토콜 게이트(ScoredProtocol 3종만, eval은 옵트인) → 주제 확보(호스트 우선, 아니면
 * 분류 1콜) → topicPathFromSegments 검증 → 3-judge 패널 채점 → 워커·축별 recordObservation
 * (워커 단위 격리 — 한 워커의 실패가 다른 워커·런 전체를 삼키지 않는다) → ratings.json 저장 →
 * raw 로그 1줄 append.
 */

import type { DeliberateInput, DeliberateOutput } from "../../deliberation/types";
import {
  loadRatings,
  recordObservation,
  saveRatings,
  ScoredProtocol,
  topicPathFromSegments,
} from "../../model/ratings";
import { classifyTopic } from "./classify";
import { CONTENT_AXES, RATINGS_LOG_PATH, RATINGS_PATH } from "./constants";
import { ScoringSkipReason } from "./enums";
import type { RunScoringRecord, ScoringDeps, WorkerScoringRecord } from "./interfaces";
import { appendScoringLog } from "./log";
import { runPanel } from "./panel";

const SCORED_PROTOCOLS: ReadonlySet<string> = new Set(Object.values(ScoredProtocol));

function topicSourceOf(deps: ScoringDeps): "host" | "classified" {
  return deps.hostTopicPath?.length ? "host" : "classified";
}

function baseRecord(deps: ScoringDeps, result: DeliberateOutput): Omit<RunScoringRecord, "workers"> {
  return { v: 1, ts: deps.now(), protocol: result.protocol };
}

export async function scoreDeliberation(
  input: DeliberateInput,
  result: DeliberateOutput,
  deps: ScoringDeps,
): Promise<void> {
  try {
    const evalOk = result.protocol !== ScoredProtocol.EvaluationScoring || deps.scoreEvalEnabled === true;
    if (!SCORED_PROTOCOLS.has(result.protocol) || !evalOk) {
      await appendScoringLog(deps.fileIO, RATINGS_LOG_PATH, {
        ...baseRecord(deps, result),
        workers: [],
        skipReason: ScoringSkipReason.Protocol,
      });
      return;
    }

    const responses = result.rounds?.[0]?.responses;
    if (!responses?.length) return; // 채점할 R1이 없다 — 로그도 남기지 않는다(원천적으로 발생 안 함)

    let segments: string[];
    try {
      segments = await classifyTopic(deps, input.task);
    } catch {
      await appendScoringLog(deps.fileIO, RATINGS_LOG_PATH, {
        ...baseRecord(deps, result),
        topicSource: topicSourceOf(deps),
        workers: [],
        skipReason: ScoringSkipReason.JudgeFailure,
      });
      return;
    }

    let topicPath: string;
    try {
      topicPath = topicPathFromSegments(segments);
    } catch {
      await appendScoringLog(deps.fileIO, RATINGS_LOG_PATH, {
        ...baseRecord(deps, result),
        topicSource: topicSourceOf(deps),
        workers: [],
        skipReason: ScoringSkipReason.InvalidTopic,
      });
      return;
    }

    const contents = responses.map((r) => r.content);
    const panel = await runPanel(deps, input.task, CONTENT_AXES, contents);

    let file = await loadRatings(deps.fileIO, RATINGS_PATH);
    const workerRecords: WorkerScoringRecord[] = [];
    const now = deps.now();

    for (const worker of panel.workers) {
      const resp = responses[worker.workerIndex];
      if (!resp) continue;

      if (!worker.median) {
        workerRecords.push({
          model: resp.model,
          workerIndex: worker.workerIndex,
          judgeScores: worker.judgeScores,
          skipReason: ScoringSkipReason.Quorum,
        });
        continue;
      }

      // 워커 단위 격리: 이 워커의 cellKey/recordObservation이 던져도 다른 워커·런 전체를 삼키면 안 된다.
      try {
        for (const axis of CONTENT_AXES) {
          const score = worker.median[axis];
          if (score === undefined) continue;
          file = recordObservation(
            file,
            { model: resp.model, protocol: result.protocol as ScoredProtocol, topicPath, axis },
            score,
            now,
          );
        }
        workerRecords.push({
          model: resp.model,
          workerIndex: worker.workerIndex,
          judgeScores: worker.judgeScores,
          median: worker.median,
        });
      } catch (e) {
        workerRecords.push({
          model: resp.model,
          workerIndex: worker.workerIndex,
          judgeScores: worker.judgeScores,
          median: worker.median,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    await saveRatings(deps.fileIO, RATINGS_PATH, file);
    await appendScoringLog(deps.fileIO, RATINGS_LOG_PATH, {
      ...baseRecord(deps, result),
      topicPath,
      topicSource: topicSourceOf(deps),
      ...(input.webAccess != null ? { webAccess: input.webAccess } : {}),
      ...(input.reasoning_effort != null ? { reasoningEffort: input.reasoning_effort } : {}),
      workers: workerRecords,
    });
  } catch {
    // best-effort — 채점은 심의 결과를 절대 죽이지 않는다
  }
}
