# Pyreez 전체 코드베이스 감사 보고서

**일자**: 2026-03-10
**범위**: src/ 전체 (88파일, 71,693 LOC), scores/models.json
**테스트**: 877 pass / 1 pre-existing fail / 11,840 assertions

---

## 1. 아키텍처 현황 — 무엇이 잘 되어있나

### 견고한 부분 (건드리지 않아도 됨)

| 모듈 | 상태 | 근거 |
|------|------|------|
| **5-Slot Pipeline 인터페이스** (axis/interfaces.ts) | 견고 | Scoring/Profiler/Selector/Deliberation/Learning 인터페이스 분리 깔끔. 느슨한 결합 |
| **Pipeline Compositor** (axis/engine.ts) | 견고 | 114 LOC, 최소 책임. 10 테스트 |
| **BT Rating 수학** (evaluation/bt-updater.ts) | 견고 | Bradley-Terry 업데이트 대칭적, sigma decay, anomaly 감지, bootstrapCI. 39 테스트 |
| **LLM Provider 추상화** (llm/) | 견고 | 8개 프로바이더, 일관된 인터페이스, 에러 정규화. 41 테스트 |
| **Model Registry** (model/registry.ts) | 견고 | 21D 역량 모델, V1→V2 마이그레이션, 필터링 API. 52 테스트 |
| **Profiler** (profile/profiler.ts) | 견고 | Domain→Capability weight 매핑, 한국어 감지, 토큰 추정. 62 테스트 |
| **Selector (composite-score)** (router/composite-score.ts) | 견고 | Thompson Sampling, truncated normal, pool-relative cost. 88 assertions |
| **Preference Table** (router/preference.ts) | 견고 | 시간 감쇠, confidence sigmoid, RouteLLM 스타일. 50 테스트 |
| **Report/Persistence** (report/) | 견고 | FileIO DI, JSONL, InMemory/File 분리. 121 테스트 |
| **BT Scoring Wrapper** (axis/wrappers.ts:BtScoringSystem) | 견고 | Registry 로딩, 21D sigma→confidence 변환. 9 테스트 |
| **SharedContext** (deliberation/shared-context.ts) | 견고 | 불변 설계, 라운드 추가, 쿼리. 완벽한 테스트 |
| **Cooldown** (deliberation/cooldown.ts) | 견고 | TTL 기반, 단순, 완벽 테스트 |
| **Config** (config.ts) | 견고 | JSONC 라우팅, env var 분리. 21 테스트 |
| **MCP Server Tool Interface** (mcp/server.ts) | 견고 | Zod 검증, 3 tools, 에러 새니타이징. 100+ 테스트 |
| **Cost Estimation** (cost/effective-cost.ts) | 견고 | 프로바이더별 캐싱 매트릭스. 18 테스트 |

### 기능적이지만 패치가 누적된 부분

| 모듈 | 상태 | 문제 |
|------|------|------|
| **Deliberation Engine** (deliberation/engine.ts) | 패치 누적 | JSON 파싱 3단 폴백, deliberation block strip, debate round1 강제, validation retry 중첩 |
| **Prompts** (deliberation/prompts.ts) | 패치 누적 | 8곳에 taskNature 분기 산재, 200줄 프롬프트 텍스트 인라인 |
| **Wire** (deliberation/wire.ts) | 하드코딩 | generation params 하드코딩, 팀사이즈 하드코딩, debate 최소라운드 하드코딩 |
| **Synthesis Validator** (deliberation/synthesis-validator.ts) | 취약 | 정규식 기반, 섹션명 하드코딩, 3번째 nature 추가 시 실패 |
| **Learning Layer** (axis/learning.ts) | 복잡 | MfIndex 생성 시점 고정, dead code (calibrated 플래그), scale 미문서화 |
| **TwoTrackCeSelector** (axis/wrappers.ts:TwoTrackCeSelector) | 중간 | Provider 이름 split("/"), O(n²) diversity, console.warn |

---

## 2. 구조적 문제 — 시스템 전체 차원

### 문제 A: Task→Dimension 매핑 이중화

**두 곳에서 독립적으로 유지:**
- `profile/profiler.ts` → TASK_OVERRIDES (14/62 태스크만 커버)
- `model/calibration.ts` → taskToDimensions() (별도 매핑)

**위험**: 프로파일러가 IMPLEMENT_FEATURE에 CREATIVITY 추가해도 캘리브레이션은 모름. BT 레이팅 업데이트와 라우팅 기준이 어긋남.

**수정**: 단일 소스 `task-dimensions.ts` 생성, 양쪽에서 참조.

### 문제 B: TaskNature 분기 산재 (8곳)

현재 artifact/critique 분기가 다음에 분산:
1. `prompts.ts:247` — worker 프롬프트 선택
2. `prompts.ts:375` — leader 프롬프트 선택
3. `prompts.ts:392` — summary manifest
4. `prompts.ts:321` — debate suffix
5. `synthesis-validator.ts:73` — validation 스킵
6. `engine.ts:482` — validation 조건
7. `wire.ts:232` — 팀 사이즈
8. `wire.ts:256-264` — generation params

**위험**: 3번째 nature 추가 시 8곳 수정 필요. 누락 시 런타임 불일치.

**수정**: `TaskNatureConfig` 레코드로 통합 (팀사이즈, 프롬프트 variant, validation 여부, gen params 포함).

### 문제 C: 매직 넘버 19개

| 값 | 위치 | 의미 |
|----|------|------|
| T=1.0, top_p=0.9 | wire.ts:257 | worker gen params |
| T=0.7 | wire.ts:262 | leader temperature |
| 2048/4096/8192 | wire.ts:259,263 | max_tokens |
| T=0, 1024 | poll-judge.ts:235 | judge params |
| 300 | team-composer.ts:151 | minScore |
| 3 | wire.ts:266 | debate min rounds |
| 3, 5 | wire.ts:232 | artifact/critique 팀 사이즈 |
| diff<1, diff>=3 | poll-judge.ts:178-184 | pairwise 임계값 |
| 300000 | cooldown.ts:34 | cooldown TTL ms |
| 2 | synthesis-validator.ts:40 | max ideas warning |
| 0.7/0.3 | config.ts default | quality/cost weight |
| 0.4/0.3/0.2/0.1 | team-composer.ts:36-41 | leader dim weights |
| 0.15 | composite-score.ts:45 | min confidence |
| 8, 0.01 | mf-learner.ts | latent dim, learning rate |

**수정**: `deliberation/defaults.ts` + `axis/defaults.ts`에 named constants 집약.

### 문제 D: 에러 처리 비대칭

| 실패 유형 | 현재 처리 | 문제 |
|-----------|----------|------|
| Worker 전원 실패 | RoundExecutionError → retry | OK |
| Leader 실패 | RoundExecutionError → retry | OK |
| Worker 부분 실패 | 계속 진행 + failedWorkers 기록 | OK |
| Validation 실패 | 1회 재시도 → flag | Silent — 진단 불가 |
| PoLL Judge 실패 | 무시 | Silent — 품질 신호 소실 |
| Store 저장 실패 | 무시 | Silent — 데이터 손실 |

**수정**: Telemetry hook 추가 (onValidationFail, onJudgeFail, onStoreFail).

### 문제 E: Cost 공식 이중화

- `cost/effective-cost.ts` → estimateStaticCost()
- `router/composite-score.ts` → 인라인 동일 공식

**수정**: composite-score가 effective-cost를 import하도록 통일.

---

## 3. 연구 Gap — 최신 논문 대비

### 3.1 Generation Params (5건)

| ID | 현재 | 최적 (연구) | 심각도 |
|----|------|------------|--------|
| G1 | Worker T=1.0 + top_p=0.9 동시 | T OR top_p 하나만 사용 (OpenAI 권장) | High |
| G2 | Worker T=1.0 | Instruction-tuned 모델 최적 T=0.7-0.9 (TURN 2025) | High |
| G3 | Leader T=0.7 | 합성 역할에 T=0.3-0.5 최적 | Medium |
| G4 | 정적 max_tokens | 복잡도별 동적 할당 (TALE 2024: 67% 절감) | Medium |
| G5 | min_p 미사용 | min_p=0.1 > top_p (ICLR 2025), API 미지원 | Low |

### 3.2 Anti-Sycophancy (6건)

| ID | 현재 | 최적 (연구) | 심각도 |
|----|------|------------|--------|
| S1 | 산문 지시만 ("Do NOT agree") | 구조적 메커니즘 필요 (Free-MAD 5단계: 13-16% 향상) | Critical |
| S2 | Identity 라벨 포함 ("Response 1 (model)") | Anonymization: conformity gap 0.608→0.024 (Kang 2025) | High |
| S3 | 모든 워커 동일 posture | Mixed team (1+ contrarian): DCR 86%→감소 | High |
| S4 | 비구조화 반박 | Free-MAD: Enumerate→Analyze→Compare→Decide→No-majority | Medium |
| S5 | Confidence drift 미감지 | ConfMAD: 라운드간 20+ 하락 + majority 전환 = sycophancy 플래그 | Medium |
| S6 | 라운드 수 제한 약함 | Sycophancy 비선형 가속 → 2-3 라운드 최적 | Low |

### 3.3 PoLL Judge (6건)

| ID | 현재 | 최적 (연구) | 심각도 |
|----|------|------------|--------|
| P1 | 응답 순서 고정 | Swap-and-average 필수 (Raina 2024: 일부 모델 consistency 0.57) | Critical |
| P2 | 3-criteria 범용 루브릭 | Task-specific rubric: Spearman 0.76 vs 0.51 (ICER 2025) | High |
| P3 | pairwise 임계값 미보정 | diff<1/>=3 arbitrary. 0-5 스케일이 최적 (2025 연구) | Medium |
| P4 | Judge 합의도 미측정 | Gwet's AC2 + Spearman 이중 보고 (Debbas 2025) | Medium |
| P5 | max_tokens=1024 | 복잡한 평가 시 절삭 위험. 2048 권장 | Medium |
| P6 | T=0 고정 | T=0이 self-consistency 오히려 저하 가능 (Rating Roulette 2025) | Low |

---

## 4. 수정 전략 — 레이어별 분류

### Layer 0: Constants 추출 (코드 0줄 신규, 이동만)
- 매직 넘버 19개를 `defaults.ts`로 집약
- 기존 참조 모두 업데이트
- 기능 변경 없음, 테스트 변경 없음

### Layer 1: TaskNature 통합 (구조 개선)
- `TaskNatureConfig` 레코드 생성
- 8곳의 산재 분기를 config lookup으로 교체
- 프롬프트 텍스트를 별도 파일로 분리

### Layer 2: Task→Dimension 단일 소스 (데이터 정합성)
- `task-dimensions.ts` 생성
- profiler.ts와 calibration.ts가 동일 소스 참조

### Layer 3: Generation Params 보정 (파라미터 수정)
- Worker T: 1.0 → 0.8(artifact)/0.9(critique)
- top_p 제거 (temperature만 사용)
- Leader T: 0.7 → 0.4(artifact)/0.5(critique)
- complexity별 max_tokens tier

### Layer 4: PoLL Judge 강화 (알고리즘 개선)
- Swap-and-average (양방향 평가)
- Nature별 task-specific rubric
- Judge 합의도 측정 (Gwet's AC2)
- max_tokens 1024→2048

### Layer 5: Anti-Sycophancy 구조화 (프롬프트+로직)
- Response anonymization (leader에게 identity 제거)
- Mixed posture (1+ contrarian 역할)
- Free-MAD 5단계 구조화 반박
- Confidence drift 감지

### Layer 6: Telemetry (관측성)
- onValidationFail, onJudgeFail, onStoreFail hooks
- Cost 공식 통일
- Routing trace 와이어링

---

## 5. 각 Layer별 영향 범위

| Layer | 수정 파일 수 | 신규 파일 | 테스트 영향 | 위험도 |
|-------|-------------|----------|------------|--------|
| L0: Constants | ~15 (import 변경) | 2 (defaults.ts) | 0 (동작 불변) | 최소 |
| L1: TaskNature 통합 | 8 (분기 교체) | 1 (task-nature-config.ts) | 중간 (프롬프트 테스트) | 낮음 |
| L2: Dimension 단일화 | 3 (profiler, calibration, 신규) | 1 (task-dimensions.ts) | 낮음 | 낮음 |
| L3: Gen Params | 2 (wire.ts, defaults.ts) | 0 | 낮음 (값만 변경) | 중간 (성능 변동) |
| L4: PoLL 강화 | 2 (poll-judge.ts, 신규 rubric) | 1 (rubrics.ts) | 중간 | 중간 |
| L5: Anti-Sycophancy | 3 (prompts.ts, engine.ts, wire.ts) | 0 | 높음 (프롬프트 전면 변경) | 높음 |
| L6: Telemetry | 4 (engine, wire, poll-judge, server) | 0 | 낮음 | 최소 |

---

## 6. 기존 버그 (감사 중 발견)

| ID | 위치 | 설명 | 심각도 |
|----|------|------|--------|
| B1 | model/registry.spec.ts:171 | filterByContext >= 비교 off-by-one (877 pass, 1 fail) | Low |
| B2 | axis/engine.ts:75 | 단일모델 chat 실패 시 try-catch 없음 → 파이프라인 크래시 | Medium |
| B3 | axis/learning.ts:173 | `calibrated = true` 설정되지만 읽히지 않음 (dead code) | Low |
| B4 | llm/providers/xai.ts | 테스트 파일 없음 (81 LOC 미테스트) | Low |
| B5 | poll-judge.ts:251 | 1명 judge 성공 시 MIN_JUDGES(2) 미만이지만 진행 | Low |
| B6 | wire.ts:232 | 사용 가능 모델이 팀사이즈보다 적을 때 검증 없음 | Low |

---

## 7. 결론

**전체 코드베이스는 견고하다.** 5-slot 파이프라인, BT 레이팅, Provider 추상화, Selector 변형, Persistence 레이어 모두 잘 설계되어 있고 테스트가 충분하다.

**문제는 deliberation 모듈에 집중되어 있다.** 패치가 누적된 곳은 engine.ts, prompts.ts, wire.ts, synthesis-validator.ts 4개 파일이다. 여기에 연구 gap (generation params, anti-sycophancy, PoLL)이 겹친다.

**"전면 리팩토링"은 불필요하다.** 견고한 파이프라인 위에 Layer 0→6 순서로 점진적 개선하면 된다. Layer 0-2는 구조 정리 (위험 최소), Layer 3-5는 알고리즘 개선 (위험 중간), Layer 6은 관측성 추가.
