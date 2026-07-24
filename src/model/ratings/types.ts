/**
 * Ratings feature type aliases.
 */

import type { CellCoord } from "./interfaces";

/** 축을 제외한 셀 좌표 — 3축 결합 조회(selectionPosterior)의 입력. */
export type CellCoordBase = Omit<CellCoord, "axis">;

/** 균등 [0,1) 난수원 — 주입식이라 테스트가 결정론적이다. */
export type Rng = () => number;
