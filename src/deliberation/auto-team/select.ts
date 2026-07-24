/**
 * Auto-team selection — score-based team selection over Thompson-sampled posteriors.
 * 설계: docs/plans/scoring-redesign-v5.md §1, §1.5
 *
 * 흐름: 프로토콜 게이트(ScoredProtocol 3종만) → 각 후보의 selectionPosterior(3축 결합) →
 * thompsonSample 1회 추출 → 샘플값 내림차순 정렬 → 상위 N(클램프) 선택 → provider>=2 제약
 * (미달 시 마지막 슬롯을 차순위 타 provider 후보와 교체, 교체 불가면 throw) → 최종 순서 셔플
 * (렌즈 배정 회전).
 */

import { ScoredProtocol, selectionPosterior, thompsonSample } from "../../model/ratings";
import type { Rng } from "../../model/ratings";
import { CONTENT_AXES } from "../../quality/scoring";
import { MIN_PROVIDERS } from "./constants";
import { AutoTeamErrorCode } from "./enums";
import type { AutoTeamDeps, AutoTeamResult, ModelDiagnostic } from "./interfaces";

const SCORED_PROTOCOLS: ReadonlySet<string> = new Set(Object.values(ScoredProtocol));

export class AutoTeamSelectionError extends Error {
  readonly code: AutoTeamErrorCode;

  constructor(code: AutoTeamErrorCode, message: string) {
    super(message);
    this.name = "AutoTeamSelectionError";
    this.code = code;
  }
}

interface ScoredCandidate extends ModelDiagnostic {
  readonly provider: string;
}

/** Fisher–Yates, rng 주입식(결정론적 테스트 가능) — panel.ts의 셔플과 동일한 알고리즘. */
function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export function selectAutoTeam(deps: AutoTeamDeps): AutoTeamResult {
  const { candidates, ratingsFile, protocol, topicPath, n, rng } = deps;

  if (!SCORED_PROTOCOLS.has(protocol)) {
    throw new AutoTeamSelectionError(
      AutoTeamErrorCode.UnscoredProtocol,
      `auto-team supports only scored protocols (${[...SCORED_PROTOCOLS].join(", ")}) — pass --models to run "${protocol}" instead`,
    );
  }

  if (!Number.isInteger(n)) {
    throw new AutoTeamSelectionError(AutoTeamErrorCode.TeamTooSmall, `auto-team: N must be an integer, got ${n}`);
  }

  // 각 후보의 3축 결합 사후 + 톰슨 1회 추출. candidates 순서대로 rng를 소비한다(재현성).
  const scored: ScoredCandidate[] = candidates.map((c) => {
    const posterior = selectionPosterior(
      ratingsFile,
      { model: c.id, protocol: protocol as ScoredProtocol, topicPath },
      CONTENT_AXES,
    );
    const sample = thompsonSample(posterior, rng);
    return { model: c.id, provider: c.provider, mean: posterior.mean, variance: posterior.variance, sample };
  });
  scored.sort((a, b) => b.sample - a.sample);

  const targetN = Math.min(n, scored.length);
  if (targetN < MIN_PROVIDERS) {
    throw new AutoTeamSelectionError(
      AutoTeamErrorCode.TeamTooSmall,
      `auto-team: at least ${MIN_PROVIDERS} models are required (requested N=${n}, available candidates=${scored.length})`,
    );
  }

  const selected = scored.slice(0, targetN);
  const providerSet = new Set(selected.map((c) => c.provider));
  if (providerSet.size < MIN_PROVIDERS) {
    const dominant = selected[0]!.provider;
    const replacement = scored.slice(targetN).find((c) => c.provider !== dominant);
    if (!replacement) {
      throw new AutoTeamSelectionError(
        AutoTeamErrorCode.SingleProviderAvailable,
        `auto-team: only one provider (${dominant}) is available among the candidates — cannot satisfy provider>=${MIN_PROVIDERS}`,
      );
    }
    selected[selected.length - 1] = replacement;
  }

  const final = shuffled(selected, rng);
  return {
    models: final.map((c) => c.model),
    diagnostics: final.map((c) => ({ model: c.model, mean: c.mean, variance: c.variance, sample: c.sample })),
  };
}
