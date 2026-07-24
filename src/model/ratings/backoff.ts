/**
 * Hierarchical backoff — 배타적 슬라이스 체인. 저장은 리프 1셀에만 되므로
 * (store.recordObservation), 조회 시 상위 계층 신호는 "그 계층 아래이면서 더 깊은
 * 계층은 아닌" 배타 슬라이스를 병합해 얻는다. 전 계층에 적립한 뒤 조상 사후를
 * 체인하면 같은 관측이 depth번 계수되어 사후분산이 과소평가된다(폐기된 v1 결함).
 */

import type { CellCoord, GaussianPosterior, ParsedKey, RatingCell, RatingsFile } from "./interfaces";
import { BOOT_N_THRESHOLD, GLOBAL_PRIOR, SIGMA2_FLOOR, TAU2_PER_HOP } from "./constants";
import { conjugatePosterior } from "./posterior";
import { EMPTY_CELL, mergeCells } from "./welford";

const SEP = "|";

/** "medicine/" → "medicine". 빈 세그먼트는 버려지되, 결과가 통째로 비면("///") 거부한다. */
export function normalizeTopicPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`normalizeTopicPath: no segments in ${JSON.stringify(path)}`);
  }
  for (const segment of segments) {
    if (segment.includes(SEP)) {
      throw new Error(`normalizeTopicPath: segment must not contain "${SEP}": ${segment}`);
    }
  }
  return segments.join("/");
}

/** deliberation의 topicPath: string[] → 정규화된 문자열 (P2 소비용). */
export function topicPathFromSegments(segments: readonly string[]): string {
  return normalizeTopicPath(segments.join("/"));
}

/** "a/b/c" → ["a", "a/b", "a/b/c"] (루트 우선). 정규화된 경로를 가정한다. */
export function topicAncestry(topicPath: string): string[] {
  const segments = topicPath.split("/");
  return segments.map((_, i) => segments.slice(0, i + 1).join("/"));
}

/** 좌표 → 저장 키. topicPath는 정규화 후 사용 — trailing slash 등으로 저장/조회 키가 어긋나지 않는다. */
export function cellKey(coord: CellCoord): string {
  const topicPath = normalizeTopicPath(coord.topicPath);
  for (const part of [coord.model, coord.protocol, coord.axis]) {
    if (part.length === 0) {
      throw new Error("cellKey: model/protocol/axis must not be empty");
    }
    if (part.includes(SEP)) {
      throw new Error(`cellKey: component must not contain "${SEP}": ${part}`);
    }
  }
  return [coord.model, coord.protocol, topicPath, coord.axis].join(SEP);
}

/**
 * cellKey()의 역. 컴포넌트에 SEP를 금지해 정확히 4파트로 split된다 — 아니면 손상 키로 보고 건너뛴다.
 * 배럴로도 노출된다 — `ratings` CLI 커맨드(P5)가 사람이 읽을 수 있는 형태로 셀을 나열할 때 쓴다.
 */
export function parseCellKey(key: string): ParsedKey | undefined {
  const parts = key.split(SEP);
  if (parts.length !== 4) return undefined;
  return { model: parts[0]!, protocol: parts[1]!, topicPath: parts[2]!, axis: parts[3]! };
}

/** t가 p 자신이거나 p의 하위 경로인가. */
function isUnder(t: string, p: string): boolean {
  return t === p || t.startsWith(`${p}/`);
}

/** coord와 (model, protocol, axis)가 일치하고 topicPath가 match를 만족하는 셀들을 하나로 합친다. */
function mergeMatching(
  file: RatingsFile,
  coord: CellCoord,
  match: (topicPath: string) => boolean,
): RatingCell {
  let merged = EMPTY_CELL;
  for (const [key, cell] of Object.entries(file.cells)) {
    const parsed = parseCellKey(key);
    if (!parsed) continue;
    if (parsed.model !== coord.model || parsed.protocol !== coord.protocol || parsed.axis !== coord.axis) continue;
    if (!match(parsed.topicPath)) continue;
    merged = mergeCells(merged, cell);
  }
  return merged;
}

/** 슬라이스 표본이 얇으면(n < BOOT_N_THRESHOLD) floor에 한 홉만큼 더해 원샷 절벽을 완화한다. */
function applySlice(prior: GaussianPosterior, slice: RatingCell): GaussianPosterior {
  const floor = slice.n > 0 && slice.n < BOOT_N_THRESHOLD ? SIGMA2_FLOOR + TAU2_PER_HOP : SIGMA2_FLOOR;
  return conjugatePosterior(slice, prior, floor);
}

/**
 * 좌표의 유효 사후분포. GLOBAL_PRIOR에서 시작해 배타 슬라이스(전역 → 형제… → 리프)를
 * 순서대로 켤레 갱신한다. 계층을 한 단계 내려갈 때마다 TAU2_PER_HOP만큼 분산을 팽창시킨다
 * (슬라이스가 비어도 팽창은 적용된다 — 더 구체적인 좌표를 물을수록 그 자체로 불확실성이
 * 커진다). 리프 적용 후에는 더 내려갈 곳이 없으므로 팽창하지 않는다.
 */
export function effectivePosterior(file: RatingsFile, coord: CellCoord): GaussianPosterior {
  const topicPath = normalizeTopicPath(coord.topicPath);
  const prefixes = topicAncestry(topicPath); // [s1, s1/s2, ..., topicPath], 길이 d
  const depth = prefixes.length;

  // slice_0: 전역 — topicPath가 최상위 도메인 아래가 아닌 모든 셀 (타 도메인)
  let posterior = applySlice(GLOBAL_PRIOR, mergeMatching(file, coord, (t) => !isUnder(t, prefixes[0]!)));

  for (let i = 0; i < depth; i++) {
    posterior = { ...posterior, variance: posterior.variance + TAU2_PER_HOP };
    const prefix = prefixes[i]!;
    const isLeaf = i === depth - 1;
    const slice = isLeaf
      ? mergeMatching(file, coord, (t) => isUnder(t, prefix))
      : mergeMatching(file, coord, (t) => isUnder(t, prefix) && !isUnder(t, prefixes[i + 1]!));
    posterior = applySlice(posterior, slice);
  }

  return posterior;
}
