# Architecture Redesign Plan

> Classification(추측) → Routing(선언) 패러다임 전환

## 합의 사항 (4가지)

1. **오케스트레이터 전용 에이전트 룰** — pyreez MCP 사용법이 포함된 에이전트 룰 생성
2. **워크플로우 스텝 최대 20개** — domain 12개를 세분화, 개발 전체 커버
3. **엔진은 매칭만** — 오케스트레이터가 step + task로 쿼리 → 엔진이 strategy 기반 모델 선정
4. **오케스트레이터 거부권 없음** — 태스크 판단 + 엔진 설정 + 흐름만. 사용자만 거부권 보유.

## 핵심 변경 3개축

1. **TaskType 62개 → WorkflowStep ~20개** (타입 + 프로파일러 + 분류기)
2. **CE 공식 → Strategy 기반 선택** (셀렉터)
3. **오케스트레이터가 step 선언** (MCP 인터페이스 + 에이전트 룰)

---

## 수정 목록

### 1. 타입 시스템 재설계

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1-1 | `src/classify/types.ts` | `TaskType` 62개 유니온 삭제. `WorkflowStep` ~20개 type으로 교체. `TaskDomain` 12개는 워크플로우 스텝의 상위 그룹. `DOMAIN_TASK_TYPES` → `STEP_DOMAIN` 매핑. `ClassifyResult` → step 기반 구조. |
| 1-2 | `src/router/types.ts` | `RouteHints` — `domain_hint`/`task_type_hint` → `step` (WorkflowStep). `Strategy` 타입 추가 (`"economy" \| "balanced" \| "premium" \| "critical"`). |
| 1-3 | `src/profile/types.ts` | `TaskRequirement.taskType` → `step: WorkflowStep`. |

### 2. 워크플로우 스텝 정의 (~20개)

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 2-1 | `src/classify/types.ts` | domain 12개를 세분화하여 ~20개 워크플로우 스텝 정의. 예: `BRAINSTORM`, `PLAN`, `SPEC`, `DESIGN`, `IMPLEMENT`, `TEST_WRITE`, `REVIEW`, `DOCUMENT`, `DEBUG`, `DEPLOY`, `RESEARCH`, `EXPLAIN`, `SECURITY_REVIEW`, `PERFORMANCE_OPTIMIZE`, `REFACTOR`, `DATA_MODEL`, `MIGRATE`, `INCIDENT_RESPONSE`, `TRANSLATE`, `INTEGRATE` 등. 구체적 목록은 별도 설계. |

### 3. 프로파일러 리팩토링

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 3-1 | `src/profile/profiler.ts` | `DOMAIN_DEFAULTS`(12) + `TASK_OVERRIDES`(12) → `STEP_PROFILES`(~20) 단일 맵 통합. 각 워크플로우 스텝별 capability weight 프로파일 정의. `STRUCTURED_OUTPUT_TASKS`/`TOOL_CALLING_TASKS`도 step 기반. `profileTask()` 시그니처 변경. |

### 4. 셀렉터 알고리즘 개편

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 4-1 | `src/router/selector.ts` | CE = score/cost 공식 교체. Strategy 기반 선택: `economy` = cost-first(현행), `balanced` = score×cost 균형(기본값), `premium` = quality-first, `critical` = quality-only. `isQualityFirst()` → strategy 기반 전환. |

### 5. 라우터 파이프라인 변경

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 5-1 | `src/router/router.ts` | `CLASSIFY→PROFILE→SELECT` → `RESOLVE_STEP→PROFILE→SELECT`. 오케스트레이터가 step 선언 시 바로 PROFILE→SELECT. step 미제공 시 에러 또는 간단한 fallback. `DEFAULT_DOMAIN_TASK_TYPE` 제거. `RouteResult` 타입 변경. |

### 6. 키워드 분류기 축소

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 6-1 | `src/classify/classifier.ts` | 주력 경로에서 제거. 완전 삭제 또는 fallback 유지 — 결정 필요. |
| 6-2 | `src/classify/classifier.spec.ts` | 삭제 또는 축소. |

### 7. MCP 서버 인터페이스

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 7-1 | `src/mcp/server.ts` | `pyreez_route` 스키마: `domain_hint`/`task_type_hint` 62개 enum → `step` (WorkflowStep ~20개). `complexity_hint` 유지. `strategy` 파라미터 추가 (또는 설정에서 로드). 응답 경량화: `selection.model.capabilities`(21차원) 제거, 필수 정보만 반환(model id, name, score, cost, reason). |

### 8. 설정 파일 확장

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 8-1 | `src/config.ts` | `PyreezConfig`에 `strategy` 필드 추가. 환경변수 `PYREEZ_STRATEGY`로 로드. 기본값 `"balanced"`. |

### 9. 엔트리포인트

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 9-1 | `src/index.ts` | config에서 strategy 로드 → routeFn / server에 전달. classifier import 정리. |

### 10. 오케스트레이터 에이전트 룰 (새 파일)

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 10-1 | 새 파일 (위치 미정) | pyreez MCP 도구 사용법, 워크플로우 스텝 ~20개 목록 + 설명, strategy 선택 가이드, "step을 반드시 선언할 것", "엔진 결과를 거부하지 말 것" 명시. |

### 11. 테스트 파일

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 11-1 | `src/classify/classifier.spec.ts` | 삭제 또는 fallback용 축소 |
| 11-2 | `src/profile/profiler.spec.ts` | STEP_PROFILES 기반 전면 재작성 |
| 11-3 | `src/router/selector.spec.ts` | strategy 기반 선택 테스트 재작성 |
| 11-4 | `src/router/router.spec.ts` | step 기반 파이프라인 테스트 재작성 |
| 11-5 | `src/mcp/server.spec.ts` | 새 인터페이스 반영 |
| 11-6 | `src/config.spec.ts` | strategy 설정 테스트 추가 |

### 12. 기타 영향 파일

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 12-1 | `src/router/gating.ts` + `.spec.ts` | TaskType 참조 → step 기반 변경 |
| 12-2 | `src/router/cascade.ts` + `.spec.ts` | ClassifyResult 참조 확인/변경 |
| 12-3 | `src/router/preference.ts` + `.spec.ts` | TaskType 참조 확인/변경 |
| 12-4 | `src/deliberation/engine.ts` | route 호출 시 영향 확인 |
| 12-5 | `src/deliberation/team-composer.ts` | 모델 선택 시 TaskType 참조 여부 확인 |
| 12-6 | `src/evaluation/` 폴더 | suite.ts, pipeline.ts 등 TaskType 참조 확인 |

### 13. 문서

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 13-1 | `FIELD-TEST.md` | 새 아키텍처(step 기반)에 맞게 테스트 시나리오 전면 재작성 |
| 13-2 | `README.md` | 아키텍처 설명 업데이트 |
| 13-3 | `TODO.md` | 진행상황 반영 |

---

## 구현 순서 (안)

1. 워크플로우 스텝 ~20개 확정 (설계)
2. 타입 시스템 변경 (1-1, 1-2, 1-3)
3. 프로파일러 리팩토링 (3-1)
4. 셀렉터 알고리즘 개편 (4-1)
5. 라우터 파이프라인 변경 (5-1)
6. 분류기 축소/삭제 (6-1, 6-2)
7. 설정 파일 확장 (8-1)
8. MCP 인터페이스 변경 (7-1)
9. 엔트리포인트 업데이트 (9-1)
10. 기타 영향 파일 수정 (12-*)
11. 전체 테스트 재작성 (11-*)
12. 오케스트레이터 에이전트 룰 작성 (10-1)
13. 문서 업데이트 (13-*)

---

## 미결정 사항

- [ ] 워크플로우 스텝 구체적 목록 (~20개)
- [ ] classifier.ts 완전 삭제 vs fallback 유지
- [ ] strategy를 pyreez_route 파라미터로 받을지 vs 설정 파일에서만 로드할지
- [ ] 오케스트레이터 에이전트 룰 파일 위치
- [ ] balanced strategy의 구체적 scoring 공식
