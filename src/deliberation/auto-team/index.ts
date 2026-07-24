/**
 * Auto-team 모듈 공개 API — cli.ts(--auto-team 배선, P4)가 소비한다.
 * 내부 구현(select 알고리즘 본체)은 배럴 밖으로도 selectAutoTeam/AutoTeamSelectionError로 노출된다
 * (호스트/CLI가 에러 코드로 실패 원인을 분기할 수 있어야 하므로).
 */

export { AutoTeamErrorCode } from "./enums";
export type { AutoTeamDeps, AutoTeamResult, ModelDiagnostic } from "./interfaces";
export type { ModelId } from "./types";
export { MIN_PROVIDERS } from "./constants";
export { AutoTeamSelectionError, selectAutoTeam } from "./select";
