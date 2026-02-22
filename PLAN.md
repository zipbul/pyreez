# Pyreez — 기획 확정 사항

## 프로젝트 목표

저비용 LLM 라우터 + 모델 인프라.
Host Agent(Claude Code, Copilot 등)의 **MCP 도구**로 동작하여, 태스크에 최적화된 모델을 선택하고 API 호출을 대행한다.

- **핵심 가치:** 태스크 특성에 맞는 최적 모델 선택 → 비용 최적화 + 품질 확보
- **포지션:** MCP 서버. Host Agent가 오케스트레이션, pyreez는 인프라
- **런타임:** Bun native, TypeScript strict

### 구현 상태

183 테스트 GREEN, 1124 expect() calls. CLASSIFY→PROFILE→SELECT 라우팅 파이프라인 완성.

---

## 1. 설계 철학

### 확정 원리

1. **단일 에이전트의 출력을 신뢰하지 않는다** — 같은 입력에 다른 출력이 나오는 것이 에이전트의 본질. 모든 중요한 결과는 독립적 검증을 거친다.
2. **에이전트의 실수를 빨리 드러낸다** — 짧은 주기, 자기 의심 강제, 교차 검증.
3. **관점의 충돌이 품질을 만든다** — 독립 실행 후 취합이 아니라, 충돌 과정에서 밸런스.
4. **같은 입력에 다른 출력이 나오는 것을 활용한다** — 불일치 = 불확실한 영역 = 집중 검토 대상.
5. **규칙은 최소화, 강제는 구조로 한다** — 규칙이 많을수록 누락이 심해지므로 게이트로 강제.
6. **탐색의 누락을 전제하고 보완한다** — "뭘 놓쳤는가?"가 "뭘 찾았는가?"만큼 중요.
7. **비용 대비 품질을 최적화한다** — 모든 태스크에 최고 모델을 쓸 필요 없다. 태스크 특성에 맞는 최적 모델을 선택한다.
8. **능력치는 추정이 아니라 측정한다** — 모델 점수는 실사용에서 지속 갱신한다.

### 기계 특성에 대한 전제

- 에이전트는 빠르지만 누락이 많다. 장점이 아니라 보완 대상.
- 에이전트 간 합리적 의심, 설득, 합의 루프가 필요하다.
- 성격/페르소나 부여는 하지 않는다. 관점(Lens)과 역할을 부여한다.
- 인간 조직론에서 검증된 원리(애자일의 문제 드러내기, 스쿼드의 관점 충돌 등)는 차용한다.
- 모델마다 강점/약점이 다르다. 이를 활용한 태스크 라우팅이 핵심이다.

---

## 2. 아키텍처: 5+1 구조

### 역할 정의

| 역할 | 담당자 | 설명 |
|------|--------|------|
| **Orchestrator** | Host Agent (Claude Opus, GPT-4.1 등) | 전략 수립, 팀 dispatch, 팀간 조율, 최종 품질 판단. "대빵" |
| **Team** | 논리적 단위 | 도메인 특화 작업 그룹 (리더 + 멤버). 예: 코딩팀, 리뷰팀 |
| **Team Leader** | JUDGMENT/REASONING 상위 모델 (gpt-4.1, o4-mini 등) | 팀 내 작업 분배, 결과 취합, 품질 판단, 핸드오프 패킷 생성 |
| **Team Member** | 라우터가 선택한 최적 모델 | 실제 태스크 수행 (코드 작성, 분석, 테스트 등) |
| **Inter-team Comm** | Handoff Packet 프로토콜 | 팀리더 ↔ 팀리더 구조화된 핸드오프 |
| **pyreez (Infra)** | MCP 서버 | Router + Model Pool + Metrics + Report |

### 구조도

```
Orchestrator (Host Agent) ← 가장 강한 모델, 비용 0
  ├─ Team A Leader (gpt-4.1급) ← 판단+사고
  │   ├─ Member 1 (라우터 선택)
  │   └─ Member 2 (라우터 선택)
  │
  ├─ Team B Leader (gpt-4.1급) ← 판단+사고
  │   └─ Member 3 (라우터 선택)
  │
  └─ Team Leader A ↔ Team Leader B (Handoff Packet)

═══════════════════════════════════════
pyreez (Infrastructure): route + ask + ask_many + scores + report
```

### 모델 배치 원칙

| 역할 | 모델 선택 기준 | 비고 |
|------|---------------|------|
| Orchestrator | Host 모델 그 자체 | 추가 비용 0 |
| Team Leader | JUDGMENT + REASONING 상위, 비용 합리적 | gpt-4.1 또는 o4-mini |
| Team Member | 라우터가 태스크별 최적 선택 | 코드→Codestral, 수학→DeepSeek-R1 등 |

### 컨텍스트 최소화: 3-Layer Summarization

```
[Layer 1] Team Member → Team Leader
  멤버가 원본 작업물 생성 (코드, 분석 등)
  리더가 요약 + 품질 판단

[Layer 2] Team Leader → 다른 Team Leader (Handoff Packet)
  packet = { summary, artifacts, requirements }
  전체 대화 ✕, 패킷만 ✓

[Layer 3] Team Leader → Orchestrator
  최종 결과 + 품질 리포트 (1~2문단)
  오케스트레이터가 "충분한가" 판단 → 부족하면 재지시
```

### Handoff Packet 스키마

```typescript
interface HandoffPacket {
  /** 핵심 요약 1-2문장 */
  summary: string;
  /** 산출물 (코드, 분석, 설계 등) */
  artifacts: string[];
  /** 다음 팀에 대한 요구사항 */
  requirements: string[];
}
```

### 시스템 경계

- **Host Agent (VSCode Copilot / Claude Code)** — 사용자 인터페이스 + Orchestrator + MCP 클라이언트
- **pyreez** — Bun 프로세스, MCP 서버, 라우팅 + 모델 호출 인프라
- **GitHub Models API** — LLM 프로바이더

### MCP 도구 (5개)

| 도구 | 용도 |
|------|------|
| `route` | 태스크 설명 → 최적 모델 선택 (CLASSIFY→PROFILE→SELECT) |
| `ask` | 선택된 모델에 단일 LLM 호출 |
| `ask_many` | 여러 모델에 동시 호출 (병렬 비교) |
| `scores` | 모델 성능 데이터 조회/갱신 |
| `report` | 호출 결과 기록 (비용, 품질, 지연시간) |

### MCP 전송

- stdio
- 진행 보고: MCP notification 한 줄 상태 (컨텍스트 최소화)
- 결과 반환: JSON 구조화 데이터

---

## 3. 태스크 분류 체계

### 12 도메인, 62 태스크 유형

코딩만이 아닌 소프트웨어 개발 전체 수명 주기를 커버한다.

#### D1. IDEATION (아이디어, 5)

| 태스크 유형 | 설명 |
|---|---|
| BRAINSTORM | 자유 발상, 아이디어 대량 생성 |
| ANALOGY | 유사 사례/비유를 통한 해결책 도출 |
| CONSTRAINT_DISCOVERY | 숨겨진 제약 조건 발견 |
| OPTION_GENERATION | 선택지 생성 및 나열 |
| FEASIBILITY_QUICK | 빠른 실현 가능성 판단 |

#### D2. PLANNING (기획/계획, 7)

| 태스크 유형 | 설명 |
|---|---|
| GOAL_DEFINITION | 목표 정의 및 명확화 |
| SCOPE_DEFINITION | 범위 정의 (포함/제외) |
| PRIORITIZATION | 우선순위 결정 |
| MILESTONE_PLANNING | 마일스톤/단계 계획 |
| RISK_ASSESSMENT | 리스크 식별 및 평가 |
| RESOURCE_ESTIMATION | 리소스(시간/비용/인력) 추정 |
| TRADEOFF_ANALYSIS | 트레이드오프 분석 |

#### D3. REQUIREMENTS (요구사항, 6)

| 태스크 유형 | 설명 |
|---|---|
| REQUIREMENT_EXTRACTION | 비정형 입력에서 요구사항 추출 |
| REQUIREMENT_STRUCTURING | 요구사항 구조화/정형화 |
| AMBIGUITY_DETECTION | 모호한 요구사항 탐지 |
| COMPLETENESS_CHECK | 누락된 요구사항 확인 |
| CONFLICT_DETECTION | 상충하는 요구사항 탐지 |
| ACCEPTANCE_CRITERIA | 인수 조건 작성 |

#### D4. ARCHITECTURE (아키텍처/설계, 8)

| 태스크 유형 | 설명 |
|---|---|
| SYSTEM_DESIGN | 전체 시스템 설계 |
| MODULE_DESIGN | 모듈/컴포넌트 설계 |
| INTERFACE_DESIGN | 인터페이스/API 설계 |
| DATA_MODELING | 데이터 모델 설계 |
| PATTERN_SELECTION | 디자인 패턴 선택 |
| DEPENDENCY_ANALYSIS | 의존성 분석 |
| MIGRATION_STRATEGY | 마이그레이션 전략 |
| PERFORMANCE_DESIGN | 성능 설계 |

#### D5. CODING (코딩, 10)

| 태스크 유형 | 설명 |
|---|---|
| CODE_PLAN | 코딩 계획 (before 구현) |
| SCAFFOLD | 프로젝트/파일 뼈대 생성 |
| IMPLEMENT_FEATURE | 기능 구현 |
| IMPLEMENT_ALGORITHM | 알고리즘 구현 |
| REFACTOR | 리팩토링 |
| OPTIMIZE | 성능 최적화 |
| TYPE_DEFINITION | 타입 정의 |
| ERROR_HANDLING | 에러 핸들링 구현 |
| INTEGRATION | 외부 연동/통합 |
| CONFIGURATION | 설정 파일 작성 |

#### D6. TESTING (테스팅, 7)

| 태스크 유형 | 설명 |
|---|---|
| TEST_STRATEGY | 테스트 전략 수립 |
| TEST_CASE_DESIGN | 테스트 케이스 설계 |
| UNIT_TEST_WRITE | 단위 테스트 작성 |
| INTEGRATION_TEST_WRITE | 통합 테스트 작성 |
| EDGE_CASE_DISCOVERY | 경계/예외 케이스 발견 |
| TEST_DATA_GENERATION | 테스트 데이터 생성 |
| COVERAGE_ANALYSIS | 커버리지 분석 |

#### D7. REVIEW (검토, 7)

| 태스크 유형 | 설명 |
|---|---|
| CODE_REVIEW | 코드 리뷰 |
| DESIGN_REVIEW | 설계 리뷰 |
| SECURITY_REVIEW | 보안 리뷰 |
| PERFORMANCE_REVIEW | 성능 리뷰 |
| CRITIQUE | 일반 비평/비판 |
| COMPARISON | 대안 비교 평가 |
| STANDARDS_COMPLIANCE | 표준/규칙 준수 여부 확인 |

#### D8. DOCUMENTATION (문서화, 6)

| 태스크 유형 | 설명 |
|---|---|
| API_DOC | API 문서 작성 |
| TUTORIAL | 튜토리얼/가이드 작성 |
| COMMENT_WRITE | 코드 주석 작성 |
| CHANGELOG | 변경 로그 작성 |
| DECISION_RECORD | 의사결정 기록(ADR) 작성 |
| DIAGRAM | 다이어그램 생성 (Mermaid 등) |

#### D9. DEBUGGING (디버깅, 7)

| 태스크 유형 | 설명 |
|---|---|
| ERROR_DIAGNOSIS | 에러 메시지 분석/진단 |
| LOG_ANALYSIS | 로그 분석 |
| REPRODUCTION | 재현 시나리오 작성 |
| ROOT_CAUSE | 근본 원인 분석 |
| FIX_PROPOSAL | 수정안 제안 |
| FIX_IMPLEMENT | 수정 구현 |
| REGRESSION_CHECK | 회귀 확인 |

#### D10. OPERATIONS (운영, 5)

| 태스크 유형 | 설명 |
|---|---|
| DEPLOY_PLAN | 배포 계획 |
| CI_CD_CONFIG | CI/CD 설정 |
| ENVIRONMENT_SETUP | 환경 설정 |
| MONITORING_SETUP | 모니터링 설정 |
| INCIDENT_RESPONSE | 장애 대응 |

#### D11. RESEARCH (조사, 5)

| 태스크 유형 | 설명 |
|---|---|
| TECH_RESEARCH | 기술 조사/리서치 |
| BENCHMARK | 벤치마크/성능 비교 |
| COMPATIBILITY_CHECK | 호환성 확인 |
| BEST_PRACTICE | 베스트 프랙티스 조사 |
| TREND_ANALYSIS | 기술 트렌드 분석 |

#### D12. COMMUNICATION (커뮤니케이션, 5)

| 태스크 유형 | 설명 |
|---|---|
| SUMMARIZE | 요약 |
| EXPLAIN | 설명 (개념/코드/결정) |
| REPORT | 리포트 작성 |
| TRANSLATE | 번역 (자연어 간, 또는 기술↔비기술) |
| QUESTION_ANSWER | 질의 응답 |

---

## 4. 능력치 모델

### 21차원 능력치 체계 (✅ 구현 완료)

5개 카테고리, 21개 차원. `scores/models.json`에서 관리.

#### Cognitive 인지 능력 (6)

| ID | 차원 | 설명 |
|---|---|---|
| C1 | REASONING | 논리적 추론, 인과관계 파악 |
| C2 | MATH_REASONING | 수학적 추론, 수치 연산 |
| C3 | MULTI_STEP_DEPTH | 다단계 논리 체인, 복잡한 계획 수립 |
| C4 | CREATIVITY | 창의적 발상, 참신한 아이디어 |
| C5 | ANALYSIS | 분석적 분해, 패턴 인식 |
| C6 | JUDGMENT | 판단력, 좋고 나쁨 평가 |

#### Technical 기술 능력 (5)

| ID | 차원 | 설명 |
|---|---|---|
| T1 | CODE_GENERATION | 코드 생성 품질 |
| T2 | CODE_UNDERSTANDING | 코드 이해/분석 |
| T3 | DEBUGGING | 디버깅 능력 (오류 탐지, 수정) |
| T4 | SYSTEM_THINKING | 시스템 수준 사고 (전체 아키텍처) |
| T5 | TOOL_USE | tool calling / function calling 능력 |

#### Trustworthiness 신뢰성 (4)

| ID | 차원 | 설명 |
|---|---|---|
| R1 | HALLUCINATION_RESISTANCE | 환각 저항 |
| R2 | CONFIDENCE_CALIBRATION | 자신감 보정 정확도 |
| R3 | SELF_CONSISTENCY | 자기 일관성 |
| R4 | AMBIGUITY_HANDLING | 모호함 처리 능력 |

#### Language 언어 능력 (4)

| ID | 차원 | 설명 |
|---|---|---|
| L1 | INSTRUCTION_FOLLOWING | 지시 따르기 정확도 |
| L2 | STRUCTURED_OUTPUT | 구조화된 출력 (JSON, 표, 코드블럭) |
| L3 | LONG_CONTEXT | 긴 입력 처리 (대규모 코드베이스) |
| L4 | MULTILINGUAL | 다국어 처리 (한국어 등) |

#### Operational 운영 (2)

| ID | 차원 | 설명 |
|---|---|---|
| O1 | SPEED | 응답 속도 (tokens/sec) |
| O2 | COST_EFFICIENCY | 비용 대비 성능 |

### 태스크 유형 → 요구 능력 매핑 (✅ 구현 완료)

계층적 상속: **Domain Default → TaskType Override**

12개 도메인 기본값 정의 + 필요 시 태스크별 override. 62개를 하나씩 하드코딩하지 않는다.

---

## 5. 모델 레지스트리 (✅ 구현 완료)

### GitHub Models API (유일한 프로바이더)

- Base URL: `models.github.ai`
- 인증: Fine-grained PAT (`models:read` scope)
- 엔드포인트: `POST /inference/chat/completions`

### 18개 모델 (scores/models.json 관리)

| 모델 | Input $/1M | Output $/1M | Context | Tool Calling |
|---|---|---|---|---|
| openai/gpt-4.1 | $2.00 | $8.00 | 1M | ✅ |
| openai/gpt-4.1-mini | $0.40 | $1.60 | 1M | ✅ |
| openai/gpt-4.1-nano | $0.10 | $0.40 | 1M | ✅ |
| openai/gpt-4o | $2.50 | $10.00 | 128K | ✅ |
| openai/gpt-4o-mini | $0.15 | $0.60 | 128K | ✅ |
| openai/o3 | $10.00 | $40.00 | 200K | ✅ |
| openai/o4-mini | $1.10 | $4.40 | 200K | ✅ |
| deepseek/DeepSeek-R1-0528 | $1.35 | $5.40 | 64K | ❌ |
| deepseek/DeepSeek-V3-0324 | $0.50 | $2.00 | 64K | ✅ |
| xai/grok-3 | $3.00 | $15.00 | 131K | ✅ |
| xai/grok-3-mini | $0.25 | $1.27 | 131K | ✅ |
| meta/Llama-4-Maverick-17B-128E-Instruct-FP8 | $0.25 | $1.00 | 1M | ✅ |
| meta/Llama-4-Scout-17B-16E-Instruct | $0.15 | $0.60 | 512K | ✅ |
| microsoft/Phi-4-reasoning | $0.13 | $0.50 | 32K | ✅ |
| microsoft/Phi-4 | $0.13 | $0.50 | 16K | ✅ |
| microsoft/Phi-4-mini-instruct | $0.08 | $0.30 | 128K | ✅ |
| mistral/Codestral-2501 | $0.30 | $0.90 | 256K | ✅ |
| mistral/Mistral-Medium-3 | $0.40 | $2.00 | 131K | ✅ |

### 점수 관리

- 21차원 × 18모델 = 378개 점수값
- `scores/models.json`에서 직접 관리 (JSON commit)
- 초기값: Arena 벤치마크 기반 추정 (confidence 0.3)
- 갱신: 실사용 중 에이전트/사람이 평가 → 점수 수정 → commit

### 모델별 적합 태스크 요약

| 모델 | 비용 등급 | 강점 | 적합 태스크 |
|---|---|---|---|
| **o3** | 최고가 | 추론(최강), 수학, 분석 | ROOT_CAUSE, IMPLEMENT_ALGORITHM, TRADEOFF_ANALYSIS |
| **gpt-4.1** | 고가 | 추론, 판단, 시스템 사고, 균형 | SYSTEM_DESIGN, SECURITY_REVIEW, Team Leader |
| **DeepSeek-R1** | 중고가 | 추론, 수학, 코드 이해 | ROOT_CAUSE, IMPLEMENT_ALGORITHM (tool calling 불가) |
| **grok-3** | 중고가 | 추론, 창의성, 균형 | ARCHITECTURE, BRAINSTORM, CODE_REVIEW |
| **o4-mini** | 중가 | 추론, 수학, 코드 | Team Leader (비용 효율), 복잡한 코딩 |
| **gpt-4.1-mini** | 중가 | 코드, 지시 이행, 균형 | IMPLEMENT_FEATURE, CODE_REVIEW, TEST_CASE_DESIGN |
| **DeepSeek-V3** | 중저가 | 코드, 분석, 비용 효율 | IMPLEMENT_FEATURE, REFACTOR |
| **Codestral** | 저가 | 코드(특화), 디버깅 | CODE_GENERATION, DEBUGGING, REFACTOR |
| **grok-3-mini** | 저가 | 추론, 창의성, 속도 | BRAINSTORM, SUMMARIZE |
| **Mistral-Medium-3** | 저가 | 다국어, 균형 | TRANSLATE, EXPLAIN |
| **Llama-4-Maverick** | 저가 | 다국어(한국어), 긴 컨텍스트 | TRANSLATE, LONG_CONTEXT 요구 태스크 |
| **Llama-4-Scout** | 최저가급 | 긴 컨텍스트, 다국어 | 간단한 태스크+긴 컨텍스트 |
| **Phi-4-reasoning** | 최저가급 | 추론, 수학, 속도 | 간단한 추론, 분류 |
| **Phi-4** | 최저가급 | 코드, 속도 | TYPE_DEFINITION, 간단한 코딩 |
| **gpt-4o** | 고가 | 범용, tool calling | 레거시 호환, 범용 |
| **gpt-4o-mini** | 최저가급 | 속도, 구조화 출력 | SCAFFOLD, CHANGELOG, 분류 |
| **gpt-4.1-nano** | 최저가 | 속도(최강급), 비용(최저) | CLASSIFY(내부), 간단한 QA |
| **Phi-4-mini** | 최저가 | 속도(최강), 최저 비용 | CLASSIFY(내부), 초간단 태스크 |

---

## 6. 라우팅 파이프라인 (pyreez 핵심, ✅ 구현 완료)

### 개요

```
[태스크 설명]
     ↓
Phase 1: CLASSIFY — 태스크 분류 (12 도메인, 62 유형)
     ↓
Phase 2: PROFILE — 요구 능력치 프로파일링 (21차원)
     ↓
Phase 3: SELECT — 비용 최적화 모델 선택
     ↓
[최적 모델 ID 반환]
```

### Phase 1: CLASSIFY (분류, ✅ 구현 완료)

하이브리드 분류기: 규칙 → LLM 폴백

```
Input: 사용자 프롬프트 (자연어)
Output: { domain: TaskDomain, taskType: TaskType, complexity, criticality }
```

- **규칙 기반** (1차): 키워드 매칭으로 명확한 경우 즉시 분류 (비용 $0)
- **LLM 폴백** (2차): 규칙으로 결정 못하면 최저가 모델로 분류
- **복잡도 판정**: `simple` | `moderate` | `complex`
- **중요도 판정**: `low` | `medium` | `high` | `critical`

### Phase 2: PROFILE (프로파일링, ✅ 구현 완료)

각 태스크의 TaskType → 요구 능력치 매핑:

```typescript
interface TaskRequirement {
  taskType: TaskType;
  domain: TaskDomain;
  requiredCapabilities: Array<{
    dimension: CapabilityDimension;
    weight: number;      // 중요도 가중치 (합계=1.0)
    minimum?: number;    // 하한선 (미달 시 탈락)
  }>;
  requiresToolCalling: boolean;
}
```

계층적 상속: Domain Default → TaskType Override.

### Phase 3: SELECT (모델 선택, ✅ 구현 완료)

비용 최적화 모델 선택 알고리즘:

```
Step 1: HARD FILTER (제거)
  - context 크기 초과 → 제거
  - tool calling 필요인데 미지원 → 제거
  - 한국어 필요인데 MULTILINGUAL < 5 → 제거
  - 능력 하한선 미달 → 제거
  - 예상 비용 > 태스크 예산 or 잔여 예산 → 제거

Step 2: COMPOSITE SCORE (종합 점수)
  score = Σ(dimScore × confidenceFactor × weight)
  confidenceFactor = 0.5 + 0.5 × confidence[dim]
  // 신뢰도 낮으면 보수적으로 깎음

Step 3: COST-EFFICIENCY (비용 효율)
  costEfficiency = score / expectedCost
  정렬: costEfficiency DESC → score DESC (동점 시)

Step 4: BUDGET-AWARE (예산 인식)
  잔여 예산 > 50% → 품질 우선
  잔여 예산 ≤ 50% → 비용 우선

Step 5: FALLBACK
  필터 통과 모델 없음 → 제약 완화 → 최저가 모델 + 경고
```

---

## 7. LLM 클라이언트 (✅ 구현 완료)

### GitHub Models API

Pyreez가 직접 HTTP로 LLM API 호출. Bun 내장 `fetch` 사용. SDK 없음.

| 엔드포인트 | 용도 |
|---|---|
| `POST /inference/chat/completions` | 챗 완성 |

- Base URL: `models.github.ai`
- 인증: Fine-grained PAT (`models:read` scope), `PYREEZ_GITHUB_PAT` 환경변수
- OpenAI 호환 API 형식

### 법적 근거

- `api.githubcopilot.com` 직접 접근: **불가** (ToS 위반)
- `models.github.ai`: **합법** (공식 REST API)

---

## 8. 기술 스택

- **Runtime:** Bun (native, Node.js 미고려)
- **Language:** TypeScript (strict, ESNext)
- **Interface:** MCP (stdio)
- **MCP SDK:** `@modelcontextprotocol/sdk@^1.27.0`
- **Schema:** `zod@^4.3.6` (zod/v4)
- **LLM:** GitHub Models API (`models.github.ai`) — PAT 인증, OpenAI 호환
- **LLM Client:** plain HTTP fetch (SDK/프레임워크 없음)
- **HTTP:** Bun 내장 `fetch`
- **Test:** `bun:test` exclusively
- **Score Storage:** `scores/models.json` (JSON commit 기반)

---

## 9. 구현 로드맵

### Phase A: 라우팅 기반 (✅ 완료)

| 단위 | 내용 | 상태 |
|---|---|---|
| A1 | 타입 시스템 (TaskDomain, TaskType, 21 CapabilityDimension) | ✅ |
| A2 | ModelRegistry (18모델, JSON 기반, 21차원 점수) | ✅ |
| A3 | Classifier (규칙 + LLM 하이브리드) | ✅ |
| A4 | Profiler (Domain Default → TaskType Override, 21차원) | ✅ |
| A5 | Selector (HARD FILTER → COMPOSITE → CE → BUDGET → FALLBACK) | ✅ |
| A6 | Router 통합 (CLASSIFY→PROFILE→SELECT 파이프라인) | ✅ |
| A7 | LLM Client (GitHub Models API, OpenAI 호환) | ✅ |
| A8 | MCP Server 기본 (stdio transport) | ✅ |

### Phase B: 아키텍처 전환

| 단위 | 내용 | 상태 |
|---|---|---|
| B1 | Agent/FeatureTeam 제거 (레거시 MVP 코드) | ✅ |
| B2 | MCP 도구 5개 등록 (route, ask, ask_many, scores, report) | ✅ |
| B3 | Report 모듈 (호출 기록, 비용 추적) | ✅ |
| B4 | Score 갱신 워크플로우 — FileReporter 영속화 + CallRecord 확장(context/team) + summary 모드 | ✅ |

### Phase C: 고도화

| 단위 | 내용 | 상태 |
|---|---|---|
| C1 | 레이트 리밋 관리 (GitHub API 한도 대응) | ❌ |
| C2 | 에러 핸들링 강화 (Phase별 재시도/폴백) | ❌ |
| C3 | 로깅/모니터링 (실행 아카이브) | ❌ |
| C4 | Classification 사전 검증 (분류 모델 정확도 벤치마크) | ❌ |

---

## 10. 설계 검토 — 미해결 논의 (Design Review)

> 결정이 확정되면 `결정: 미확정` → `결정: (선택)` 으로 갱신.
> ~~취소선~~은 폐기된 항목.

### 확정 완료

---

#### DR-001: Phase 간 컨텍스트 전달 전략

- **결정:** ✅ 확정 — Phase 1-3은 구조화 타입 전환 (ClassifyResult → TaskRequirement → RouteResult). pyreez 내부 Phase 간에는 타입만 전달하므로 컨텍스트 폭발 없음. 팀간 컨텍스트는 Handoff Packet (Section 2) 으로 관리.

---

#### DR-003: 에이전트 간 소통 프로토콜

- **결정:** ✅ 확정 — Handoff Packet `{ summary, artifacts, requirements }`. 팀리더가 취합하여 구조화된 패킷으로 다른 팀리더에게 전달. pyreez 범위 밖 (Host Orchestrator가 관리).

---

#### DR-004: MVP → v2 마이그레이션 전략

- **결정:** ✅ v2 타입 선행 — Agent/FeatureTeam (레거시 MVP) 제거 예정. v2 타입 시스템 위에 새 MCP 도구 구축. Phase B에서 수행.

---

#### DR-006: Provider 폴백 체인

- **결정:** ✅ GitHub Only — 단일 프로바이더. Docker/Ollama 제거됨. 폴백 체인 불필요.

---

#### DR-019: MCP Tool 확장

- **결정:** ✅ 5개 도구 — `route`, `ask`, `ask_many`, `scores`, `report`.

---

### 폐기

---

#### ~~DR-008: DAG 에러 전파 전략~~

- **폐기 사유:** DAG 실행이 pyreez 범위에서 제거됨. Orchestrator(Host)가 실행 흐름 관리.

---

#### ~~DR-018: Bayesian EMA α 감쇠 스케줄~~

- **폐기 사유:** 수학적 자동 점수 갱신 폐기. Orchestrator가 매 호출 후 AI 판단으로 갱신 여부 결정. scores/models.json 직접 수정 → commit.
- **대체 설계:** 2-Layer 평가 — Team Leader(1차 quality) + Orchestrator(2차 갱신 판단). CallRecord에 context metrics + team metadata 포함. FileReporter로 `.pyreez/reports/{date}.jsonl` 영속화.

---

### 미확정

---

#### DR-002: 예산(Budget) 설정 방식

- **문제:** 예산이 없으면 SELECT의 Budget-Aware 로직이 작동 불가.

| Option | 설명 |
|---|---|
| A | 3-tier 예산 — 요청당($1), 일일($10), 월간($100) |
| B | 요청당 예산만 — 기본 $1, override 가능 |
| C | 자동 예산 — complexity에서 산출 (simple=$0.10, moderate=$0.50, complex=$2.00) |

**결정:** 미확정

---

#### DR-005: 파이프라인 레벨 에러 핸들링

- **문제:** CLASSIFY 오분류 시 전체 파이프라인 잘못된 방향.

| Option | 설명 |
|---|---|
| A | Fail-fast + 1회 재시도 |
| B | 분류 검증 게이트 (규칙 기반 교차 검증) |
| C | Checkpoint 복구 |

**결정:** 미확정

---

#### DR-007: 레이트 리밋 관리

- **문제:** GitHub API 무료 티어 (Low 15 req/min, 150 req/day).

| Option | 설명 |
|---|---|
| A | 토큰 버킷 큐잉 |
| B | 응답 헤더 기반 (`X-RateLimit-Remaining` + `Retry-After`) |
| C | 사전 예산 배분 (호출 수 계산 → 한도 비교) |

**결정:** 미확정

---

#### DR-009: 로깅/모니터링

- **문제:** Phase별 입출력, 비용 데이터의 기록/저장 방법.

| Option | 설명 |
|---|---|
| A | 구조화 로그 (JSON stdout/file) |
| B | 실행 아카이브 (`.pyreez/runs/{timestamp}.json`) |
| C | A+B 결합 |

**결정:** 미확정

---

#### DR-010: 성능 SLA

- **문제:** `route` 호출 최대 응답 시간.

| Option | 설명 |
|---|---|
| A | Phase별 타임아웃 — CLASSIFY 5s, PROFILE 1s, SELECT 1s |
| B | 전체 타임아웃만 — route 10s |

**결정:** 미확정

---

#### DR-012: 복잡도(complexity) 판정 기준

- **문제:** `simple | moderate | complex` 의 구체적 판정 기준.

**제안:**

| 복잡도 | 조건 |
|---|---|
| simple | 단일 파일/함수, 명확한 지시, 출력 < 500 tokens |
| moderate | 2-5개 파일, 조건부 로직, 출력 500-2000 tokens |
| complex | 다중 모듈, 아키텍처 결정, 출력 > 2000 tokens or 도메인 전문성 |

**결정:** 미확정

---

#### DR-013: 중요도(criticality) 판정 기준

- **문제:** `low | medium | high | critical` 의 정의.

**제안:**

| 중요도 | 조건 |
|---|---|
| low | COMMENT_WRITE, CHANGELOG 등 보조 |
| medium | IMPLEMENT_FEATURE, REFACTOR 등 일반 |
| high | SYSTEM_DESIGN, ROOT_CAUSE 등 구조적 |
| critical | SECURITY_REVIEW, INCIDENT_RESPONSE 등 |

**결정:** 미확정

---

#### DR-014: 능력치 가중치 전체 분포

- **문제:** Top-3만 명시(합계 ~0.75). 나머지 0.25의 21차원 분배.

| Option | 설명 |
|---|---|
| A | Top-N + 균등 잔여 |
| B | 21차원 전체 명시 |
| C | Top-N만 사용, 나머지 가중치=0 |

**결정:** 미확정

---

#### DR-015: FALLBACK 제약 완화 순서

- **문제:** HARD FILTER 후 후보 0개일 때 어떤 제약을 어떤 순서로 완화하는지.

**제안 순서:**

1. 능력 하한선 완화 (minimum → 0)
2. 한국어 제약 완화
3. tool calling 제약 완화
4. 예산 2배까지 허용 + 경고
5. context 제약은 완화 불가
6. 여전히 0개 → 최저가 + 경고

**결정:** 미확정

---

#### DR-016: 태스크 62유형 단계적 구현

- **문제:** 62개 전체를 한 번에 분류 구현하면 부담.

| Option | 설명 |
|---|---|
| A | Phase 1: 핵심 20유형 (D5+D6+D9 일부) → Phase 2: 나머지 |
| B | 도메인 단위 순차 추가 |
| C | 62유형 모두 타입 정의, 분류는 점진 정밀화 |

**결정:** 미확정

---

#### DR-017: 21차원 능력치 관리 부담 경감

- **문제:** 21차원 × 18모델 = 378개 점수. 관리 부담.

| Option | 설명 |
|---|---|
| A | 핵심 5차원 자주 갱신 + 보조 16차원 분기 1회 |
| B | 태스크별 on-demand 갱신 |
| C | 전체 동일 주기 |

**결정:** 미확정

---

#### DR-020: CLASSIFY 사전 검증

- **문제:** 분류 모델의 62유형 분류 능력을 실증 없이 전제.

| Option | 설명 |
|---|---|
| A | 분류 정확도만 먼저 벤치마크 |
| B | 구현과 병행 검증 |
| C | 원래 로드맵대로 나중에 검증 |

**결정:** 미확정

---

## 11. 기능 아이디어 후보 (Feature Ideas Backlog)

> 코어 구현 이후 검토할 확장 기능 후보.

---

#### FI-001: Confidence-based Escalation (자신감 기반 에스컬레이션)

- **설명:** 에이전트 출력의 confidence가 낮으면 자동으로 상위 모델이 검증/재실행
- **기대 효과:** 불필요한 검토 비용 제거 + 품질 위험 구간 자동 감지
- **우선순위:** 높음

---

#### FI-002: Prompt Cache Layer (프롬프트 캐시)

- **설명:** 동일 system prompt + 유사 입력 캐시하여 중복 LLM 호출 제거
- **우선순위:** 중간

---

#### FI-003: Dry-run Mode (드라이런)

- **설명:** LLM 호출 없이 라우팅만 실행하여 예상 비용/모델 선택 미리 표시
- **우선순위:** 높음

---

#### FI-004: Adaptive Workflow (적응형 워크플로우)

- **설명:** 출력 품질에 따라 워크플로우 동적 승격/축소
- **우선순위:** 낮음

---

#### FI-005: Learning-from-Feedback (피드백 학습)

- **설명:** Host의 accept/reject 신호 기반 모델 점수 자동 갱신
- **우선순위:** 중간

---

#### FI-006: Model Canary Testing (자동 모델 탐색)

- **설명:** 새 모델 발견 시 자동 벤치마크 → 레지스트리 등록
- **우선순위:** 낮음

---

#### FI-007: Context Budget Manager (컨텍스트 예산 관리)

- **설명:** 모델 context window 기반 관련 정보 자동 선별/압축
- **우선순위:** 높음

---

## 12. 미확정 잔여 항목

| # | 항목 | 상태 |
|---|------|------|
| E | MCP notification 실시간 표시 가능 여부 검증 | 미확정 |

---

## 변경 이력

| 일자 | 내용 |
|---|---|
| 2026-02-22 | PLAN.md 전면 개정. 5+1 아키텍처(Host=Orchestrator, pyreez=Infra) 반영. 16→21차원, 9→18모델 구현 완료 반영. Docker/Ollama 제거. Phase 5-6(COMPOSE/EXECUTE) pyreez 범위 밖으로 이동. DR 5건 확정, 2건 폐기. COMMUNICATION-PROTOCOL.md 삭제. |
