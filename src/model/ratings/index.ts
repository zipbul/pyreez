/**
 * Ratings 모듈 공개 API — 채점 훅(P2)·자동 팀 선발(P4)·ratings 커맨드(P5)가 소비한다.
 * 내부 구현(welford, posterior)은 배럴에서 노출하지 않는다.
 */

export { ScoredProtocol } from "./enums";
export type { RatingCell, CellCoord, RatingsFile, GaussianPosterior, ParsedKey } from "./interfaces";
export type { CellCoordBase, Rng } from "./types";
export { GLOBAL_PRIOR, SIGMA2_FLOOR, TAU2_PER_HOP } from "./constants";
export { EMPTY_RATINGS, recordObservation, loadRatings, saveRatings } from "./store";
export { effectivePosterior, cellKey, parseCellKey, topicPathFromSegments } from "./backoff";
export { selectionPosterior } from "./selection";
export { thompsonSample } from "./thompson";
