/**
 * Auto-team feature enums.
 */

/** selectAutoTeam이 던지는 에러의 사유 — 호스트가 원인별로 분기할 수 있게 한다. */
export enum AutoTeamErrorCode {
  /** protocol이 ScoredProtocol 3종이 아니다 — 그 프로토콜은 점수 데이터가 구조적으로 없다. */
  UnscoredProtocol = "unscored_protocol",
  /** 클램프 후 팀 크기가 최소 2 미만이다 (요청 N이 작거나 가용 후보가 부족). */
  TeamTooSmall = "team_too_small",
  /** 전 후보가 provider 1개뿐이라 provider>=2 제약을 만족할 replacement가 없다. */
  SingleProviderAvailable = "single_provider_available",
}
