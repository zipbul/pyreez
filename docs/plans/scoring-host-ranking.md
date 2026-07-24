# 채점 재설계: 호스트 순위 채점 (host-ranking)

## 목표
도메인/주제별로 각 모델의 강점을 익명·공정하게 여러 런에 걸쳐 학습하고, 미래 런에서 주제에 맞는 팀을 자동 구성한다. pyreez는 정답 키 시스템이 아니라 결과물의 **가치**를 상대적으로 평가한다.

## 채점 방식
호스트가 같은 런에서 나온 익명 답들을 **순위**로 채점한다. 절대점수(1~100)를 매기지 않는다.

- pyreez가 워커를 실행하고, 호스트에게는 익명 답(라벨 A·B·C…, 순서 셔플)만 전달한다.
- 호스트는 가치 기준으로 순위만 제출한다 (예: `B > A > C`).
- pyreez는 라벨↔실제 모델 매핑을 알고 있어, 순위를 `(주제, 축)` 셀의 상대 비교 관측으로 기록한다.
- 여러 런이 쌓이면 주제별 모델 강약이 드러나고, 자동 팀 선택에 쓴다.

순위를 쓰는 이유: 호스트가 후하든 짜든(순서만 봄), 문제가 쉽든 어렵든(같은 런 비교) 채점이 흔들리지 않는다. 절대점수는 이 둘이 모델 실력과 섞여 셀을 오염시킨다.

## 동작 시나리오
1. 호스트가 던진다: *"당뇨 진단법 설계"*
2. pyreez가 워커 3개를 돌려 익명 답 A·B·C를 호스트에 전달(누가 어느 모델인지 호스트는 모름).
3. 호스트가 순위 제출: *"B > A > C"*.
4. pyreez는 내부적으로 B=grok, A=opus, C=haiku임을 알아 `medicine/diagnosis`에 grok > opus > haiku 관측 1건 기록.
5. 런이 수십 건 쌓이면 "의료 진단은 grok이 강하다"가 드러난다.
6. 다음 의료 태스크에서 자동 팀이 grok을 우선 배치한다.

## 구현 로드맵
전면 전환을 한 번에 하지 않는다. 인프라를 먼저 깔고 데이터를 모아, 순위가 절대점수보다 실제로 나은지 측정한 뒤 전환한다.

### Phase 1 — 인프라
- **Run manifest 영속화**: deliberate 완료 시 원자적 저장 — `runId`, protocol, topic, axis 스키마 버전, `{ (runId, round, workerIndex) → (실제모델, 답 digest) }`, 표시 순서, `pending/submitted` 상태. debug capture와 독립. 라벨 키는 모델이 아니라 `(round, workerIndex)`(동일 모델이 여러 슬롯에 들어갈 수 있음).
- **`rank-submit` CLI**: `rank-submit --run <id> --axis <a> --ranking "B>A>C"`. `(run, axis)` 유니크 + idempotency로 중복/부분/상충 제출 거부. 한 ranking = 1 원자 레코드.
- **주입 방어**: 답 본문을 구조화 전달 + delimiter 인코딩 + untrusted-content 명시.

### Phase 2 — 순위 신호 수집
- 순위를 별도 append-only 로그에 기록. 기존 절대점수 파이프라인은 그대로 병행(폴백).
- 순위 → 런/호스트 단위로 군집된 pairwise 관측(완전순위 1개를 N개 독립 관측으로 세지 않음).

### Phase 3 — 측정 게이트
전환 전, 오프라인에서 사전 고정한 기준을 통과해야만 다음 단계로 간다:
- `(protocol, 상위 domain)`별 비교 그래프 giant component 비율
- bridge edge 최소 관측 run 수, 모델별 distinct host 수, host-model 이분 그래프 연결성
- θ 발산 발생률 상한
- 절대점수 대비 held-out pairwise log loss(BT가 실제로 더 나은가)

### Phase 4 — 조건부 전환
- 전역 스위치 금지. 충분한 pairwise + multi-host coverage가 있는 `(domain, protocol)` 셀만 순위 기반 사용, 나머지는 절대점수 유지.
- 순위 강도(θ)는 절대점수 셀과 물리적으로 분리 저장(스케일 비호환). `select.ts`에 명시 모드 분기.
- 계층 적합: 리프가 아니라 상위 도메인 계층에서 적합 + 리프는 shrinkage. θ→Gaussian 근사 후 기존 thompson 샘플러 재사용, 공동 posterior 1회 샘플링.

## 한계
- 답 본문 문체로 모델 계열이 드러나 호스트가 자기 계열을 선호하는 편향은 완전히 제거되지 않는다("더 공정"이지 "완전 공정"이 아님).
- 탐색(다양한 모델 배치)은 기존 Thompson sampling이 이미 수행하며, 본 설계는 채점 신호의 공정성만 개선한다.
- host×model 교차노출이 부족한 단일 호스트 배포에서는 문체편향 보정이 원리적으로 불가하다.
