# 5-슬롯 파이프라인 + 학습 레이어 세부 계획

> Scoring · Classifier · Profiler · Selector · Deliberation — 독립 슬롯, 자유 교체, 로컬 개인화

## 배경

PLAN.md는 "Classification(추측) → Routing(선언) 패러다임 전환"이라는 **단일 방향** 설계다.
이 문서는 그보다 상위 관점에서, 5개 슬롯(스코어링 · 분류기 · 프로파일러 · 셀렉터 · 숙의) 각각에 **복수 variant**가 존재함을 인지하고,
모듈화 + 실험 + 학습을 통해 **최적 조합**을 찾는 로드맵을 정의한다.

### 핵심 원칙

1. **슬롯 독립성** — 5개 슬롯은 경계 타입(boundary type)으로 격리. **호환 조합에 한해** 한 슬롯의 variant 교체가 다른 슬롯에 영향 없음. (→ 호환 매트릭스 참조)
2. **현행 ≠ PLAN.md** — 같은 가족(예: BT)이라도 세부 구현이 다르면 별개 variant로 취급.
3. **코드 재사용** — 이미 구현된 모듈(gating, cascade, preference)은 래핑만으로 활성화.
4. **실험 우선** — 설계 논쟁보다 측정 결과로 결정.
5. **로컬 개인화** — 중앙 집계 없음. 개인화는 100% 로컬(`.pyreez/learning/`, 프로젝트 루트), 초기값은 벤치마크 추적(`scores/models.json`→npm update).
6. **학습 계층화** — Tier 0(통계, $0) → Tier 1(Embedding, $0.3/월) → Tier 2(LLM-Router, $1.5/월) → Tier 3(LLM-Judge, $1.5/월). 사용자가 선택.

---

## 아키텍처 개요

### 5-슬롯 파이프라인

```
prompt
  │
  ▼
┌─────────────┐   ClassifyOutput   ┌──────────────┐   TaskRequirement   ┌────────────┐   EnsemblePlan   ┌──────────────────┐
│  슬롯 2      │ ───────────────▶  │  슬롯 3       │ ───────────────▶   │  슬롯 4     │ ──────────────▶ │  슬롯 5           │
│  Classifier  │                   │  Profiler     │                    │  Selector   │                 │  Deliberation     │
└─────────────┘                    └──────────────┘                     └─────┬──────┘                  └────────┬─────────┘
                                          ▲                                   │                                  │
                                          │                                   │                                  ▼
                                   ┌──────┴──────┐                            │                          DeliberationResult
                                   │  슬롯 1      │◀───────── scores ─────────┘                                  │
                                   │  Scoring     │                                                               ▼
                                   └─────────────┘                                                       ┌────────────────┐
                                          ▲                                                              │ Learning Layer  │
                                          ·                                                              └────────────────┘
                                          ··············· 비동기 배치 피드백 ·························┘  (optional)
```

### 경계 타입 (Boundary Types)

| 경계 | 타입 | 생산자 → 소비자 | 핵심 필드 |
|------|------|---------------|----------|
| `ClassifyOutput` | 분류 결과 | Classifier → Profiler, Learning | domain, taskType, **vocabKind**, complexity, criticality, method, language?, tokens? |
| `TaskRequirement` | 능력 요구사항 | Profiler → Selector | capabilities(weight map), constraints, budget |
| `EnsemblePlan` | 모델 배정 계획 | Selector → Deliberation | models[], strategy, estimatedCost, reason |
| `DeliberationResult` | 최종 결과 | Deliberation → 사용자/Learning | result, roundsExecuted, consensus, totalLLMCalls, protocol |

### 데이터 저장 구조

```
scores/models.json                ← 글로벌 초기값 (벤치마크 기반, npm update로 배포)

.pyreez/                          ← 사용자 프로젝트 루트 dotfile
├── reports/{date}.jsonl          ← 원본: CallRecord (model, taskType, quality, latency, tokens)
├── deliberations/{date}.jsonl    ← 원본: DeliberationRecord (rounds, consensus, modelsUsed)
├── runs/{date}.jsonl             ← 원본: RunRecord (tool, duration, success)
└── learning/                     ← 학습 결과 (신규)
    ├── bt-ratings.json           ← L1: 개인 BT 보정 (scores/models.json + 이 보정 = 실효값)
    ├── preferences.json          ← L2: 선호도 테이블 (taskType × model → W/L/T)
    ├── gating-weights.json       ← L3: MoE expert 가중치
    ├── mf-factors.json           ← L4: MF 잠재 벡터 (context × model, k=8)
    └── embeddings.json           ← T1: 프롬프트 embedding 캐시 (최근 N개)
```

**핵심**: `scores/models.json`(글로벌 초기값) + `.pyreez/learning/bt-ratings.json`(개인 보정) = 실효 점수. 중앙 전송 없음.

---

## 현행 코드 자산 상태

| 구분 | 모듈 | 파일 | 슬롯 | 상태 |
|---|---|---|---|---|
| 메인 파이프라인 통합 | BT 21차원 스코어링 | `model/calibration.ts`, `evaluation/bt-updater.ts` | 슬롯 1 | ✅ 가동 |
| | 키워드 분류기 | `classify/classifier.ts` | 슬롯 2 | ✅ 가동 |
| | 도메인+오버라이드 프로파일러 | `profile/profiler.ts` | 슬롯 3 | ✅ 가동 |
| | 2-Track CE 셀렉터 | `router/selector.ts` | 슬롯 4 | ✅ 가동 |
| | 역할기반 숙의 (leader_decides) | `deliberation/engine.ts` | 슬롯 5 | ✅ 가동 (Phase 1에서 `protocol` 필드 추가 필요) |
| 구현 완료, **미통합** | MoE Gating | `router/gating.ts` | 슬롯 3 대안 | ✅ 코드 존재 |
| | FrugalGPT Cascade | `router/cascade.ts` | 슬롯 4 대안 | ✅ 코드 존재 |
| | Preference Router | `router/preference.ts` | 슬롯 4 대안 | ✅ 코드 존재 |
| | 선호도 테이블 | `router/preference.ts` | 학습 L2 | ✅ 구현, **영속화 누락** |
| | BT 온라인 업데이트 | `evaluation/bt-updater.ts` | 학습 L1 | ✅ 구현 |
| PLAN.md 설계 | Step 기반 전체 전환 | — | 전 슬롯 | 📋 미구현 |
| 미설계 | Elo, LLM-as-Judge, MAB, ADP 등 | — | — | ❌ 없음 |
| 미설계 | Embedding 유사도, LLM-Router, LLM-Judge | — | 학습 T1~T3 | ❌ 없음 |

---

## 슬롯 1: 스코어링 시스템

모델 능력을 수치화하는 방법. 라우팅과 숙의 모두 이 점수를 참조한다.

```typescript
interface ScoringSystem {
  getScores(modelIds: string[]): Promise<ModelScore[]>;  // global + personal 합산 반환
  update(results: PairwiseResult[]): Promise<void>;      // bt-ratings.json(개인 보정)에만 쓰기
}
```

> **소유권**: ScoringSystem이 `scores/models.json`(글로벌) + `.pyreez/learning/bt-ratings.json`(개인) 양쪽을 소유.
> `getScores()`는 합산 반환, `update()`는 개인 보정에만 기록. LearningLayer.enhance()는 L2~L4(선호도/MoE/MF)만 담당.

### Variant 전수 분류

| ID | 이름 | 설명 | 구현 상태 |
|---|---|---|---|
| **S1** | BT 21차원 + TaskType 캘리브레이션 | 현행 구현. 62개 TaskType 체계. | ✅ 가동 |
| **S1-b** | BT 21차원 + WorkflowStep 캘리브레이션 | PLAN.md 설계. ~20개 Step 체계. | 📋 미구현 |
| **S2** | Elo 단일 차원 | 모델당 단일 Elo 점수 (1400 스케일). dims가 비어있으면 Selector는 overall로 fallback. | ❌ 미구현 |
| **S3** | LLM-as-Judge | 제3 LLM이 두 응답을 비교 판정. 실시간. | ❌ 미구현 |
| **S4** | 벤치마크 정적 | MMLU/HumanEval 등 공개 점수 사전 입력. | ❌ 미구현 |

### S1 vs S1-b 정밀 비교

두 variant는 **동일한 BT core**(`bt-updater.ts`)를 공유하지만, calibration layer와 profile layer 구조가 다르다.

| 항목 | S1 (현행) | S1-b (PLAN.md) |
|---|---|---|
| BT core 알고리즘 | `btExpected()`, `updateRating()`, K=32, σ decay=0.97 | 동일 |
| Dimension 수 | 21 (C6+T5+R4+L4+O2) | 동일 |
| Task 분류 체계 | 62 TaskType union | ~20 WorkflowStep |
| Calibration 매핑 | `taskToDimensions()` — 13개 하드코딩 | `stepToDimensions()` — ~20개 매핑 |
| Profile 구조 | 2-level: `DOMAIN_DEFAULTS`(12) + `TASK_OVERRIDES`(12) | 1-level: `STEP_PROFILES`(~20) |
| Profile entry 수 | 24 (12+12) | ~20 |
| Sparse 문제 | 62 type 중 13만 calibration 매핑 → 나머지 miss | ~20 전부 매핑 가능 → sparse 해소 |
| Sigma 임계값 | CONVERGED=100, STALE=300, ANOMALY=100 | 동일 (변경 없음) |
| Bootstrap CI | 100회 리샘플링 | 동일 (변경 없음) |

### S1 현행 구현 핵심 상수

```
K_BASE         = 32       // BT update K-factor
SIGMA_DECAY    = 0.97     // comparison당 sigma 감소율
SIGMA_MIN      = 50       // sigma 하한 (최대 확신)
SIGMA_BASE     = 350      // 초기 sigma
SIGMA_CONVERGED = 100     // "수렴됨" 판정 임계값
SIGMA_STALE    = 300      // "갱신 필요" 판정 임계값
ANOMALY_THRESHOLD = 100   // mu 변동 이상 감지
STRONG_QUALITY_DIFF = 3   // 강한 승리 판정
MIN_QUALITY_DIFF = 1      // 최소 유의 차이
```

### 각 variant 구현 시 필요 작업

| ID | 필요 작업 | 예상 규모 |
|---|---|---|
| S1 | 없음 (현행) | 0 |
| S1-b | `STEP_PROFILES` 정의, `stepToDimensions()` 구현, profiler 교체 | 중 |
| S2 | 단일 Elo rating 타입, update 함수, 기존 BT 인터페이스 어댑터 | 소 |
| S3 | Judge 프롬프트 설계, 호출 파이프라인, 비용 관리 | 대 |
| S4 | 벤치마크 데이터 수집, `models.json` 정적 매핑 | 소 |

---

## 슬롯 2: 분류기 (Classifier)

프롬프트를 어떤 카테고리로 분류하는가. 이전 "Phase A"를 독립 슬롯으로 승격.

```typescript
interface Classifier {
  classify(prompt: string, hints?: RouteHints): Promise<ClassifyOutput>;
}
```

### 출력 타입: ClassifyOutput

```typescript
interface ClassifyOutput {
  domain: string;
  taskType: string;
  vocabKind: "taskType" | "step";  // 어떤 분류 체계인지 판별. Profiler가 올바른 lookup 선택에 사용.
  complexity: "simple" | "moderate" | "complex";
  criticality: "low" | "medium" | "high" | "critical";
  method: "rule" | "llm" | "embedding" | "step-declare";
  language?: string;      // "ko", "en", etc.
  tokens?: { estimatedInput: number; estimatedOutput: number };
}
```

### Variant 전수 분류

| ID | 이름 | 설명 | 구현 상태 |
|---|---|---|---|
| **R-A1** | 키워드 규칙 분류 | 12 domain × 62 taskType 키워드 매칭. `method: "rule"`. | ✅ 가동 |
| **R-A2** | 오케스트레이터 스텝 선언 | ~20 WorkflowStep 직접 선언. classifier 축소/제거. | 📋 미구현 |
| **R-A3** | LLM 분류기 | 프롬프트 → LLM → 분류 결과. 현행에 `method: "llm"` 자리만 존재. | ❌ 미구현 |
| **R-A4** | 임베딩 기반 분류 | 프롬프트 벡터 → nearest cluster/centroid. | ❌ 미구현 |

#### R-A1 vs R-A2 정밀 비교

| 항목 | R-A1 (현행) | R-A2 (PLAN.md) |
|---|---|---|
| 분류 주체 | pyreez 내부 keyword matcher | 외부 오케스트레이터 |
| 카테고리 수 | 12 domain × 62 taskType = 74 | ~20 WorkflowStep |
| 분류 방법 | 키워드 규칙 (정규식 등) | 직접 선언 (MCP `step` 파라미터) |
| 정확도 원천 | 규칙 커버리지 | 호출자의 맥락 이해 |
| Fallback | `method: "llm"` (미구현) | 간단한 keyword fallback |
| 출력 | `ClassifyResult` {domain, taskType, complexity, criticality, method} | `{step: WorkflowStep}` |

---

## 슬롯 3: 프로파일러 (Profiler)

분류 결과를 모델 능력 요구사항(dimension weight)으로 변환. 이전 "Phase B"를 독립 슬롯으로 승격.

```typescript
interface Profiler {
  profile(input: ClassifyOutput): Promise<TaskRequirement>;
}
```

### 출력 타입: TaskRequirement

```typescript
interface TaskRequirement {
  capabilities: Record<string, number>;  // dimension → weight (0~1)
  constraints: {
    minContextWindow?: number;
    requiresToolCalling?: boolean;
    requiresKorean?: boolean;
    structuredOutput?: boolean;
  };
  budget: { maxPerRequest?: number; strategy?: string };
}
```

### Variant 전수 분류

| ID | 이름 | 설명 | 구현 상태 |
|---|---|---|---|
| **R-B1** | 도메인 기본 + 태스크 오버라이드 | 2-level lookup. 12 domain defaults + 12 task overrides. | ✅ 가동 |
| **R-B2** | 스텝 단일 프로파일 | 1-level lookup. ~20 step profiles. | 📋 미구현 |
| **R-B3** | MoE Gating | ArmoRM 방식. 7 expert × softmax → 자동 weight. | ✅ 구현, **미통합** |

#### R-B1 vs R-B2 vs R-B3 정밀 비교

| 항목 | R-B1 (현행) | R-B2 (PLAN.md) | R-B3 (MoE Gating) |
|---|---|---|---|
| Lookup 구조 | `TASK_OVERRIDES[taskType]` ∥ `DOMAIN_DEFAULTS[domain]` | `STEP_PROFILES[step]` | `gate(taskType, domain)` → softmax combine |
| Weight 결정 | 수동 하드코딩 | 수동 하드코딩 | 자동 (expert 조합) |
| Profile 수 | 24 (12+12) | ~20 | 7 expert → 무한 조합 |
| 갱신 | 코드 수정 필요 | 코드 수정 필요 | expert 추가/weight 학습 가능 |
| Korean/non-Latin | ✅ 별도 처리 | ✅ 별도 처리 | ❌ 미포함 (추가 필요) |
| 파일 | `profile/profiler.ts` | — | `router/gating.ts` |

#### R-B1 현행 프로파일 구조 상세

```
DOMAIN_DEFAULTS: 12개 도메인
  CODING:   [CODE_GENERATION:0.3, REASONING:0.25, DEBUGGING:0.2, CODE_UNDERSTANDING:0.15, INSTRUCTION_FOLLOWING:0.1]
  IDEATION: [CREATIVITY:0.35, REASONING:0.25, ANALYSIS:0.2, AMBIGUITY_HANDLING:0.1, INSTRUCTION_FOLLOWING:0.1]
  ...

TASK_OVERRIDES: 12개 특수 태스크
  ANALOGY, FEASIBILITY_QUICK, PRIORITIZATION, AMBIGUITY_DETECTION,
  SYSTEM_DESIGN, IMPLEMENT_ALGORITHM, CODE_REVIEW, SECURITY_REVIEW,
  ROOT_CAUSE, EDGE_CASE_DISCOVERY, SUMMARIZE, TRANSLATE

특수 처리:
  - Korean 감지: /[가-힣ㄱ-ㅎㅏ-ㅣ]/ regex
  - Non-Latin token expansion: ratio × 1.5 factor
  - STRUCTURED_OUTPUT_TASKS: TYPE_DEFINITION, DATA_MODELING, API_DOC, etc.
  - TOOL_CALLING_TASKS: CI_CD_CONFIG, ENVIRONMENT_SETUP, etc.
  - COMPLEXITY_TOKENS: simple(500/200), moderate(2000/1000), complex(8000/4000)
```

#### R-B3 현행 MoE Expert 목록

```
7개 Expert (gating.ts):
  coding:      CODE_GENERATION:0.35, CODE_UNDERSTANDING:0.15, REASONING:0.15, ...
  reasoning:   REASONING:0.30, MULTI_STEP_DEPTH:0.20, ANALYSIS:0.15, ...
  creative:    CREATIVITY:0.35, INSTRUCTION_FOLLOWING:0.20, ...
  translation: MULTILINGUAL:0.40, INSTRUCTION_FOLLOWING:0.20, ...
  analysis:    ANALYSIS:0.25, REASONING:0.20, JUDGMENT:0.15, ...
  math:        MATH_REASONING:0.35, REASONING:0.25, ...
  tool_use:    TOOL_USE:0.35, INSTRUCTION_FOLLOWING:0.20, ...

Gating: patternSimilarity(query, pattern) → softmax(temperature=0.5) → weighted combine → normalize
```

---

## 슬롯 4: 셀렉터 (Selector)

프로파일 결과와 모델 점수를 비교하여 최종 모델(들)을 선택. 이전 "Phase C"를 독립 슬롯으로 승격.

```typescript
interface Selector {
  select(req: TaskRequirement, scores: ModelScore[], budget: BudgetConfig): Promise<EnsemblePlan>;
}
```

### 출력 타입: EnsemblePlan

```typescript
interface EnsemblePlan {
  models: Array<{ modelId: string; role?: string; weight?: number }>;
  strategy: string;
  estimatedCost: number;
  reason: string;
}
```

### Variant 전수 분류

| ID | 이름 | 설명 | 구현 상태 |
|---|---|---|---|
| **R-C1** | 2-Track CE 셀렉터 | HARD FILTER → CE=score/cost → quality-first∥cost-first. | ✅ 가동 |
| **R-C2** | 4-Strategy 셀렉터 | economy/balanced/premium/critical 4전략. | 📋 미구현 |
| **R-C3** | FrugalGPT Cascade | 저가→고가 순차 시도. confidence gate. | ✅ 구현, **미통합** |
| **R-C4** | Preference Router | win/loss/tie 이력 기반 선택. | ✅ 구현, **미통합** |
| **R-C5** | MAB (Multi-Armed Bandit) | Thompson Sampling 또는 UCB1. | ❌ 미구현 |
| **R-C6** | Ensemble Selection | N개 모델 조합 선택. 숙의 연동. | ❌ 미구현 |

#### R-C1 vs R-C2 정밀 비교

| 항목 | R-C1 (현행) | R-C2 (PLAN.md) |
|---|---|---|
| 전략 수 | 2 (quality-first / cost-first) | 4 (economy / balanced / premium / critical) |
| 분기 조건 | `criticality === "critical" \|\| "high"` | `strategy` 파라미터 (설정 또는 요청) |
| CE 공식 | `score / cost` (단일) | 전략별 상이 |
| economy | — | cost-first (현행 cost-first와 유사) |
| balanced | — | score × cost 균형 (**공식 미결정**) |
| premium | — | quality-first (현행 quality-first와 유사) |
| critical | — | quality-only (cost 무시) |
| Adaptive boost | `score × (1 + boost)`, boost ∈ [-1, 1] | 유지 가능 |
| Uncertainty penalty | `1 / (1 + σ / SIGMA_BASE)` | 유지 가능 |

#### R-C1 현행 5-Step 알고리즘 상세

```
Step 1: HARD FILTER
  - contextWindow ≥ estimatedInputTokens
  - requiresToolCalling → supportsToolCalling
  - requiresKorean → MULTILINGUAL.mu ≥ 500
  - 모든 requiredCapability.weight > 0.2 → dimension.mu ≥ MIN_THRESHOLD
  - estimatedCost ≤ budget.perRequest

Step 2: COMPOSITE SCORE
  score = Σ(mu × uncertaintyPenalty × weight) × (1 + adaptiveBoost)
  uncertaintyPenalty = 1 / (1 + σ / 350)

Step 3: COST-EFFICIENCY
  CE = score / estimatedCost

Step 4: 2-TRACK RANKING
  criticality=critical∥high → quality-first: sort by score DESC, CE tiebreak
  otherwise              → cost-first: sort by CE DESC, score tiebreak

Step 5: FALLBACK
  모든 필터 실패 → cheapest model 반환 + warning
```

#### R-C3 현행 Cascade 알고리즘 상세

```
buildCascadeChain(): models sorted by cost ASC
executeCascade():
  for each model in chain:
    if steps ≥ maxSteps → break
    if totalCost + estimatedCost > budgetLimit → budgetExhausted, break
    confidence = checker.checkConfidence(model, prompt)
    if confidence ≥ threshold → accept, break
    else → next model
  no accept → use last tried model
```

#### R-C4 현행 Preference Router 상세

```
PreferenceTable: taskType × modelId → {wins, losses, ties}
record(): PairwiseResult → win/loss/tie 누적
winRate() = (wins + ties × 0.5) / total
entryConfidence() = total / (total + 10)  // sigmoid-like
routeByPreference(): sort by winRate DESC, confidence tiebreak
```

### 라우팅 조합 공간 (슬롯 2 × 슬롯 3 × 슬롯 4)

| Phase A (4) | × Phase B (3) | × Phase C (6) | = 72 이론적 조합 |
|---|---|---|---|

**합리적 조합 ~12개:**

| 조합 | 슬롯 2 | 슬롯 3 | 슬롯 4 | 설명 |
|---|---|---|---|---|
| 현행 | R-A1 | R-B1 | R-C1 | keyword → 2-level profile → 2-track CE |
| PLAN.md | R-A2 | R-B2 | R-C2 | step 선언 → 1-level profile → 4-strategy |
| Gating 교체 | R-A1 | R-B3 | R-C1 | keyword → MoE auto-weight → 2-track CE |
| Cascade 교체 | R-A1 | R-B1 | R-C3 | keyword → 2-level profile → cascade |
| Preference 교체 | R-A1 | R-B1 | R-C4 | keyword → 2-level profile → win-rate |
| Step+Gating | R-A2 | R-B3 | R-C2 | step → MoE → 4-strategy |
| Step+Cascade | R-A2 | R-B2 | R-C3 | step → 1-level → cascade |
| Hybrid | R-A2 | R-B3 | R-C1 | step → MoE → 기존 CE |
| Full-auto | R-A3 | R-B3 | R-C5 | LLM 분류 → MoE → MAB |
| Ensemble | R-A2 | R-B2 | R-C6 | step → profile → N개 모델 조합 |

### Classifier-Profiler 호환 매트릭스

> **슬롯 독립성 한계**: Classifier의 `vocabKind`에 따라 Profiler의 lookup 테이블이 달라져야 함.
> `createEngine()` factory에서 불일치 조합을 컨파일 타임/초기화 시 거부.

| | R-B1 (domain-override) | R-B2 (step-profile) | R-B3 (MoE gating) |
|---|---|---|---|
| **R-A1** (keyword, vocabKind="taskType") | ✅ 호환 | ❌ vocab 불일치 | ✅ 호환 (패턴 매칭) |
| **R-A2** (step, vocabKind="step") | ❌ vocab 불일치 | ✅ 호환 | ✅ 호환 (패턴 매칭) |
| **R-A3** (LLM, vocabKind=설정가능) | ✅ 호환 | ✅ 호환 | ✅ 호환 |
| **R-A4** (embedding, vocabKind=설정가능) | ✅ 호환 | ✅ 호환 | ✅ 호환 |

**규칙**: R-B3(MoE)는 `taskType/domain` 패턴 매칭이므로 vocabKind 무관. R-B1은 taskType, R-B2는 step 전용.

투가: S2(Elo)로 Scoring 교체 시 Selector 호환성:
- S2는 `ModelScore.dimensions`가 비어있음 → Selector는 `overall`로 fallback 필수.
- R-C1/R-C3/R-C4: overall fallback 추가 필요. R-C5(MAB): overall 전용이므로 문제없음.

---

## 슬롯 5: 숙의 프로토콜 (Deliberation)

복수 모델이 협력하여 단일 모델보다 높은 품질을 달성하는 방법.

```typescript
interface DeliberationProtocol {
  deliberate(task: string, plan: EnsemblePlan, scores: ModelScore[], chat: ChatFn): Promise<DeliberationResult>;
}
```

> **scores 파라미터**: D2는 역할 배정에 scores 참조 필수. D1/D3/D6은 무시. 보정된 scores를 전달하여 Selector와 동일 기준.

### Variant 전수 분류

| ID | 이름 | 설명 | 구현 상태 |
|---|---|---|---|
| **D1** | Single-Best | 라우팅 결과 1개 모델에 직접 질문. 숙의 없음. 대조군. | ❌ trivial |
| **D2a** | 역할기반 (leader_decides) | Producer → Reviewers(병렬) → Leader. 기본 consensus. | ✅ 가동 |
| **D2b** | 역할기반 (all_approve) | 동일 구조, 모든 reviewer 승인 필요. | ✅ config 지원 |
| **D2c** | 역할기반 (majority) | 동일 구조, 다수결. | ✅ config 지원 |
| **D3** | Diverge-Synthesize | N개 독립 생성 → 1개 synthesizer 통합. MoA 기반. | ❌ 미구현 |
| **D4** | ADP (Adaptive Deliberation) | diverge → 상호 critique → BT 가중 synthesize. | ❌ 미구현 |
| **D5** | Free-Debate | 자유 형식 다라운드 토론. 턴 순서 무작위/RR. | ❌ 미구현 |
| **D6** | Voting | N개 독립 응답 → 다수결. deterministic task 전용. | ❌ 미구현 |

### 현행 D2 구현 상세

```
역할 배정 (team-composer.ts):
  Producer: CODE_GENERATION:0.35, CREATIVITY:0.25, REASONING:0.2, INSTRUCTION_FOLLOWING:0.2
  Leader:   JUDGMENT:0.4, ANALYSIS:0.3, REASONING:0.2, SELF_CONSISTENCY:0.1
  Reviewer: perspective 키워드 매칭 (보안/성능/품질/창의/수학) → 해당 dimension 가중

다양성 보장: ≥3 distinct providers (reviewer swap 우선)

실행 루프 (engine.ts):
  for round 1..maxRounds(3):
    producer → chat() → parseProduction()
    reviewers → Promise.allSettled → parseReview()  // 병렬, 부분 실패 허용
    leader → chat() → parseSynthesis()
    if escalate → break
    if consensus(mode) → break

Consensus 판정:
  leader_decides: synthesis.decision === "approve"
  all_approve:    decision === "approve" && 모든 reviewer approval
  majority:       decision === "approve" && approved > total/2

Retry: RoundExecutionError → cooldown 등록 → 대체 모델 재배정 → 재시도(maxRetries=1)

프롬프트 (prompts.ts):
  Producer system: "Generate high-quality content. Incorporate feedback if rounds > 0."
  Reviewer system: "Evaluate from [perspective]. Issues + approval + reasoning."
  Leader system:   "Synthesize feedback. Continue/approve/escalate."
  History: 라운드별 markdown 직렬화 (production → reviews → synthesis)
```

### D2 vs D3 vs D4 vs D5 구조 비교

| 항목 | D2 (역할기반) | D3 (Diverge-Synth) | D4 (ADP) | D5 (Free-Debate) |
|---|---|---|---|---|
| 생성자 수 | 1 (Producer) | N (전원) | N (전원) | N (전원) |
| 평가자 | M Reviewers | 없음 | N-1 (상호) | 없음 (자율) |
| 통합자 | 1 (Leader) | 1 (Synthesizer) | 1 (가중 통합) | 없음 (수렴) |
| 역할 고정 | ✅ 고정 | ❌ 없음 | ❌ 없음 | ❌ 없음 |
| 라운드 구조 | 순차 (P→R→L) | 2-phase (생성→통합) | 3-phase (생성→비평→통합) | 자유 턴 |
| Anchoring bias | 높음 (단일 Producer) | 낮음 (독립 생성) | 낮음 (독립 생성) | 중간 |
| LLM 호출 수 (N=3) | 1+M+1 = ~5 | N+1 = 4 | N+(N×(N-1))+1 = 10 | N×turns |
| 비용 | 중 | 중 | 고 | 가변 |
| 학술 기반 | — | MoA (Together AI) | Du et al. (2023) | Wang et al. (2024) |

### D3 Diverge-Synthesize 상세 설계

```
Phase 1 — Diverge:
  for each model in ensemble(N):
    response[i] = chat(model[i], task)  // 병렬, 동일 프롬프트

Phase 2 — Synthesize:
  synthesizer = select_best_model(JUDGMENT, ANALYSIS)
  prompt = "다음 N개 응답을 비교, 통합하여 최적 답변을 생성하라:\n" + responses
  result = chat(synthesizer, prompt)

특징:
  - 역할 없음. 모든 모델이 대등.
  - Anchoring 없음 (독립 생성).
  - Synthesizer 선택이 품질 결정.
  - 가장 간단한 multi-model 패턴.
```

### D4 ADP (Adaptive Deliberation Protocol) 상세 설계

```
Phase 1 — Diverge (D3과 동일):
  for each model in ensemble(N):
    response[i] = chat(model[i], task)  // 병렬

Phase 2 — Critique (신규):
  for each model[i]:
    for each response[j] where j ≠ i:
      critique[i→j] = chat(model[i], "Evaluate this response: " + response[j])
  // N × (N-1) 평가. 병렬 가능.

Phase 3 — Synthesize (가중):
  scores[j] = aggregate(critique[*→j])  // 응답 j에 대한 평가 종합
  weights[j] = normalize(scores[j] × bt_score[model_j])  // BT 점수 연동
  synthesizer = model with highest JUDGMENT score
  prompt = "다음 응답들을 가중치에 따라 통합하라:\n" + weighted_responses
  result = chat(synthesizer, prompt)

특징:
  - 상호 평가로 자체 품질 필터링.
  - BT 점수와 실시간 critique 이중 가중.
  - 비용 높음 (N + N(N-1) + 1 호출).
  - 품질 기대값 최대.
```

### 현행과 PLAN.md의 숙의 차이

**없음.** PLAN.md는 숙의 프로토콜을 변경하지 않는다.
TaskType → WorkflowStep 타입 변경의 간접 영향만 존재하며, engine.ts/prompts.ts의 로직은 동일하게 유지된다.

### 숙의 비용 테이블

> N = 팀 규모 (프로토콜별 정의 상이). 다라운드 시 비용 선형 증가.

| ID | 팀 규모 | 호출 수 (1라운드) | 호출 수 (3라운드 최대) | GPT-4.1-mini 기준 | GPT-4.1 기준 | 비고 |
|---|---|---|---|---|---|---|
| D1 | 1 | 1 | 1 | $0.004 | $0.04 | 대조군 |
| D2 | 1P+2R+1L=4 | 4 | 12 | $0.016~$0.048 | $0.16~$0.48 | 현행 기본값 |
| D3 | N=3 생성자 | 4 (N+1) | 4 | $0.016 | $0.16 | MoA 패턴 |
| D4 | N=3 참여자 | 10 (N+N(N-1)+1) | 10 | $0.04 | $0.40 | 품질 최대 |
| D5 | N=3 참여자 | N×turns | 가변 | 가변 | 가변 | 수렴 불확실 |
| D6 | N=3 생성자 | 3 | 3 | $0.012 | $0.12 | 결정적 작업 전용 |

(기준: 1000 input + 500 output tokens/call. mini: $0.4/$1.6/1M, 4.1: $2/$8/1M)

---

## 학습 레이어

학습은 **모든 슬롯에 걸친 횡단 관심사**이다. 슬롯이 아니라 슬롯들을 개선하는 레이어.

```typescript
interface LearningLayer {
  /** 호출 결과를 기록하고, T3 활성화 시 비동기로 quality 평가 + L1~L4 학습 자동 실행 */
  record(classified: ClassifyOutput, plan: EnsemblePlan, result: DeliberationResult): Promise<void>;
  /** L2~L4 개인 보정 적용 (선호도/MoE/MF). L1 BT는 ScoringSystem 소유. */
  enhance(scores: ModelScore[], classified: ClassifyOutput): Promise<ModelScore[]>;
}
```

> **record() 내부 흐름**: ① 원본 CallRecord 저장 → ② T3 활성화 시 LLM-as-Judge로 quality 자동 평가 (비동기) → ③ quality 결과로 L2~L4 자동 업데이트.
> 외부에서 learn() 호출 불필요 — 복잡성은 record() 내부에 숨김.

### 설계 원칙

| 원칙 | 설명 |
|------|------|
| **로컬 전용** | 모든 연산은 사용자 머신 CPU. 중앙 서버 없음. 데이터 전송 없음. |
| **초기값 분리** | `scores/models.json` = 벤치마크 기반 글로벌 초기값 (npm update로 배포). `.pyreez/learning/` = 개인 보정. |
| **계층적 활성화** | Tier 0($0)만 활성화해도 동작. 상위 Tier는 사용자 선택. |
| **API $0 원칙 (Tier 0)** | 통계 학습은 LLM API를 호출하지 않는다. 기존 CallRecord를 재가공할 뿐. |

### Tier 0: 로컬 통계 학습 (비용 $0)

**원본 데이터**: `.pyreez/reports/*.jsonl` (CallRecord — 이미 수집 중)

| ID | 학습 대상 | 파라미터 수 | 알고리즘 | 저장 | 구현 상태 |
|----|---------|-----------|---------|------|---------|
| **L1** | BT mu/sigma 보정 | 21모델 × 21차원 × 2 = 882 | Bradley-Terry online update (K=32, σ decay=0.97) | `bt-ratings.json` | ✅ 코어 구현, 영속화 분리 필요 |
| **L2** | 선호도 W/L/T | 62 taskType × 21모델 × 3 = ~3,900 | Win rate 카운팅 | `preferences.json` | ✅ 구현, **영속화 누락** |
| **L3** | MoE expert 가중치 | 7 float | Online gradient descent | `gating-weights.json` | ⚠️ 구조만, 학습 없음 |
| **L4** | MF 잠재 벡터 | (20 ctx + 21 model) × k8 = 328 float | SGD matrix factorization | `mf-factors.json` | ❌ 미구현 |

**전체 학습 결과 크기: ~90KB JSON.** 전부 사칙연산, ML 프레임워크 불필요.

#### L1: BT 레이팅 보정

```typescript
// 이미 구현된 핵심 (bt-updater.ts)
rating.mu += K * (actual - btExpected(ratingA, ratingB));
rating.sigma *= SIGMA_DECAY;
// 필요 작업: scores/models.json과 별도로 .pyreez/learning/bt-ratings.json에 개인 보정 저장
// 실효값 = models.json 초기값 + 학습 보정
```

#### L2: 선호도 테이블

```typescript
// 이미 구현된 핵심 (preference.ts)
table[taskType][model].wins += 1;  // 기록
winRate = wins / (wins + losses + ties);  // 조회
// 필요 작업: 메모리 → .pyreez/learning/preferences.json 영속화
```

#### L3: 게이팅 가중치 학습

```typescript
// 미구현. 구현 시:
expertWeights[idx] += learningRate * reward;
const sum = expertWeights.reduce((a, b) => a + b);
expertWeights.forEach((_, i) => expertWeights[i] /= sum);
// ~3줄. 라우팅 성공/실패 피드백으로 expert 가중치 조정.
```

#### L4: Matrix Factorization

```typescript
// 미구현. 구현 시 (~50줄):
const contextFactors: number[][] = [];  // vocabKind에 따라 동적 결정 (taskType=62, step=~20)
const modelFactors: number[][] = Array(21).fill(null).map(() => Array(8).fill(0).map(() => Math.random() * 0.1));

function trainStep(ctx: number, model: number, actual: number) {
  let pred = 0;
  for (let k = 0; k < 8; k++) pred += contextFactors[ctx][k] * modelFactors[model][k];
  const err = actual - pred;
  for (let k = 0; k < 8; k++) {
    contextFactors[ctx][k] += 0.01 * (err * modelFactors[model][k] - 0.01 * contextFactors[ctx][k]);
    modelFactors[model][k] += 0.01 * (err * contextFactors[ctx][k] - 0.01 * modelFactors[model][k]);
  }
}
// context × model 잠재 궁합을 학습. "긴 TS 리팩토링 + Claude" 같은 패턴 자동 발견.
```

### Tier 1: Embedding 유사도 (월 ~$0.3)

```
프롬프트 → text-embedding-3-small API ($0.02/1M tokens) → 1536차원 벡터
과거 성공 사례의 벡터와 cosine similarity → 유사 프롬프트에서 잘된 모델 추천
```

| 항목 | 값 |
|------|-----|
| API | text-embedding-3-small |
| 비용 | $0.02/1M tokens → 1000콜/일 × 500tok = $0.01/일 = **$0.3/월** |
| 저장 | `.pyreez/learning/embeddings.json` (최근 N개 캐시) |
| 연산 | API 1회 호출 + cosine similarity (로컬 CPU) |
| 효과 | 키워드 매칭이 못 잡는 의미적 유사성 ("리팩토링" ≈ "코드 개선") |
| 구현 | ❌ 미구현 |

### Tier 2: LLM-as-End-to-End-Router (월 ~$1.5)

```
프롬프트 → GPT-4.1-nano → "이 프롬프트에 최적 모델: X, 이유: Y"
슬롯 2→3→4를 통째로 bypass하는 shortcut. R-A3(LLM 분류기)와는 별개.
```

| 항목 | 값 |
|------|-----|
| API | GPT-4.1-nano ($0.1/$0.4 per 1M) |
| 비용 | 1000콜/일 × 500tok = $0.05/일 = **$1.5/월** |
| 효과 | LLM이 프롬프트에서 직접 최적 모델 추천 → 슬롯 2-3-4 생략 |
| **위치** | **파이프라인 bypass** (R-A3와 별개. R-A3은 ClassifyOutput 생산, T2는 EnsemblePlan 직접 생산) |
| 구현 | ❌ 미구현 |

### Tier 3: LLM-as-Judge 자동 평가 (월 ~$1.5)

```
결과물 → GPT-4.1-nano → 품질 점수 (1~10)
현재 불투명한 quality 필드 → LLM이 자동 평가 → 이 점수가 L1~L4의 입력
```

| 항목 | 값 |
|------|-----|
| API | GPT-4.1-nano |
| 비용 | 1000콜/일 × ~1000tok = $0.05/일 = **$1.5/월** |
| 효과 | 수동 평가 없이 자동 피드백 루프 완성. TensorZero 스타일. |
| 입력 | 프롬프트 + LLM 응답 |
| 출력 | 0~10 품질 점수 → L1 BT, L2 선호도, L4 MF에 입력 |
| 구현 | ❌ 미구현 |

### 학습 비용 종합

| 조합 | 월 비용 | 경쟁사 대등 수준 |
|------|--------|--------------|
| T0만 | **$0** | 기본 통계 개인화 |
| T0 + T1 | **$0.3** | Embedding 유사도 |
| T0 + T1 + T2 | **$1.8** | E2E LLM 라우터 수준 |
| T0 + T1 + T2 + T3 | **$3.3** | TensorZero 피드백 루프 수준 |

### 학습 트리거

| 영역 | 현재 | 최종 |
|------|------|------|
| L1 BT | 수동 (pyreez_calibrate) | 자동: N건(예: 50) 이상 시 또는 일 1회 |
| L2 선호도 | 매 호출 즉시 (online) | 유지 + 영속화 추가 |
| L3 게이팅 | 없음 | 배치: 100건마다 *(Phase 6 이후)* |
| L4 MF | 없음 | 주기적: 500건 또는 일 1회 *(Phase 6 이후)* |
| T3 Judge | 없음 | 매 호출 후 비동기 평가 |

---

## 피드백 루프

학습이 자동으로 순환하는 메커니즘.

### 현재 문제

1. `pyreez_calibrate`가 **수동 트리거** — 사용자가 호출하지 않으면 레이팅 갱신 안 됨
2. `CallRecord.quality`의 출처가 **불투명** — 누가, 언제 이 점수를 생성하는지 표준 없음
3. 선호도 테이블(L2)이 **프로세스 재시작 시 소멸**

### 해결: 3단계 자동 피드백

```
[사용자 호출]
    ↓
[LLM 응답] → CallRecord 기록
    ↓
[T3: LLM-as-Judge] → quality 점수 자동 생성 (비동기)
    ↓
[L1~L4 학습] → 개인 보정 업데이트 (자동 트리거)
    ↓
[다음 라우팅에 반영] → 더 나은 모델 선택
```

| 메커니즘 | 설명 | 비용 |
|---------|------|------|
| Auto-calibrate | N건 도달 시 자동 BT 업데이트 | $0 |
| LLM-as-Judge | 매 호출 결과를 LLM이 자동 평가 | Tier 3 ($1.5/월) |
| Few-shot 추출 | `.pyreez/deliberations/`에서 성공 사례 자동 선택 → 프롬프트 개선 | $0 |
| 선호도 영속화 | 메모리 → JSON 주기적 sync | $0 |

---

## Prompt 최적화

### 현재 문제

`prompts.ts`의 Producer/Reviewer/Leader 프롬프트가 **하드코딩 문자열**. 변경 = 코드 수정.

### 해결

| 현재 | 최종 |
|------|------|
| 하드코딩 문자열 | 템플릿 + 변수 치환 (`{{task}}`, `{{perspective}}`, `{{history}}`) |
| 고정 지시문 | 과거 성공 deliberation에서 동적 few-shot 삽입 |
| 변경 = 코드 수정 | 변경 = 템플릿 파일 교체 (코드 무변경) |

Few-shot 자동 추출:
```
1. .pyreez/deliberations/ 에서 consensusReached: true 레코드 검색
2. 현재 작업과 유사한 과거 사례 선택 (T1 Embedding 활용 시 의미적 유사도)
3. 해당 사례의 production/review/synthesis를 few-shot example로 삽입
비용: $0 (이미 저장된 데이터 재활용)
```

---

## 슬롯 인터페이스 종합

### 공유 타입

```typescript
/** 모델 점수 — 스코어링 시스템의 출력 */
interface ModelScore {
  modelId: string;
  dimensions: Record<string, { mu: number; sigma: number }>;
  overall: number;  // composite score
}

/** 앙상블 계획 — 셀렉터의 출력 */
interface EnsemblePlan {
  models: Array<{ modelId: string; role?: string; weight?: number }>;
  strategy: string;
  estimatedCost: number;
  reason: string;
}

/** 숙의 결과 — 숙의 프로토콜의 출력 */
interface DeliberationResult {
  result: string;
  roundsExecuted: number;
  consensusReached: boolean;
  totalLLMCalls: number;
  modelsUsed: string[];
  protocol: string;  // 어떤 variant가 사용되었는지
}
```

### 5-슬롯 인터페이스

> 모든 슬롯 인터페이스는 `Promise<T>` 반환으로 통일. sync variant는 즉시 resolve. async variant(R-A3, S3 등)를 타입 안전하게 수용.

```typescript
/** 슬롯 1: 스코어링 시스템 — global + personal 합산 소유 */
interface ScoringSystem {
  getScores(modelIds: string[]): Promise<ModelScore[]>;
  update(results: PairwiseResult[]): Promise<void>;
}

/** 슬롯 2: 분류기 */
interface Classifier {
  classify(prompt: string, hints?: RouteHints): Promise<ClassifyOutput>;
}

/** 슬롯 3: 프로파일러 */
interface Profiler {
  profile(input: ClassifyOutput): Promise<TaskRequirement>;
}

/** 슬롯 4: 셀렉터 */
interface Selector {
  select(req: TaskRequirement, scores: ModelScore[], budget: BudgetConfig): Promise<EnsemblePlan>;
}

/** 슬롯 5: 숙의 프로토콜 — scores는 D2 역할 배정용 (D1/D3은 무시) */
interface DeliberationProtocol {
  deliberate(task: string, plan: EnsemblePlan, scores: ModelScore[], chat: ChatFn): Promise<DeliberationResult>;
}

/** 학습 레이어 (optional) — L1 BT는 ScoringSystem 위임, L2~L4 직접 */
interface LearningLayer {
  record(classified: ClassifyOutput, plan: EnsemblePlan, result: DeliberationResult): Promise<void>;
  enhance(scores: ModelScore[], classified: ClassifyOutput): Promise<ModelScore[]>;
}
```

### Compositor

```typescript
class PyreezEngine {
  constructor(
    private scoring: ScoringSystem,
    private classifier: Classifier,
    private profiler: Profiler,
    private selector: Selector,
    private deliberation: DeliberationProtocol,
    private chat: ChatFn,
    private modelIds: string[],
    private learner?: LearningLayer,
  ) {}

  async run(prompt: string, budget: BudgetConfig, hints?: RouteHints): Promise<DeliberationResult> {
    // 슬롯 1: 점수 조회 (global + personal 합산)
    let scores = await this.scoring.getScores(this.modelIds);

    // TODO: Phase 7 — T2 bypass 체크 (슬롯 2-3-4 건너뛰고 EnsemblePlan 직접 생산)

    // 학습 보정 적용 — L2~L4만 (optional)
    const classified = await this.classifier.classify(prompt, hints);
    if (this.learner) {
      scores = await this.learner.enhance(scores, classified);
    }

    // 슬롯 3→4: 프로파일 → 선택 (슬롯 2 classify는 위에서 완료)
    const requirement = await this.profiler.profile(classified);
    const plan = await this.selector.select(requirement, scores, budget);

    // 단일 모델이면 숙의 생략
    if (plan.models.length === 1) {
      const response = await this.chat(plan.models[0].modelId, prompt);
      return {
        result: response,
        roundsExecuted: 0,
        consensusReached: true,
        totalLLMCalls: 1,
        modelsUsed: [plan.models[0].modelId],
        protocol: "single",
      };
    }

    // 슬롯 5: 숙의 (scores 전달 — D2 역할 배정용)
    const result = await this.deliberation.deliberate(prompt, plan, scores, this.chat);

    // 학습 기록 (optional, 비동기) — 내부에서 T3 평가 + L2~L4 자동
    if (this.learner) {
      this.learner.record(classified, plan, result).catch(() => {});
    }

    return result;
  }
}
```

### Config-based Factory

```typescript
interface AxisConfig {
  scoring: "bt-21" | "bt-step" | "elo" | "llm-judge" | "benchmark";
  classifier: "keyword" | "step-declare" | "llm" | "embedding";
  profiler: "domain-override" | "step-profile" | "moe-gating";
  selector: "2track-ce" | "4strategy" | "cascade" | "preference" | "mab" | "ensemble";
  deliberation: "single" | "role-based" | "diverge-synth" | "adp" | "free-debate" | "voting";
  learning?: {
    tier0: boolean;   // L1~L4 통계 학습
    tier1: boolean;   // Embedding 유사도
    tier2: boolean;   // LLM-as-End-to-End-Router (슬롯 2-3-4 bypass. R-A3과 별개)
    tier3: boolean;   // LLM-as-Judge
  };
}

/** 현행 기본값 */
const DEFAULT_CONFIG: AxisConfig = {
  scoring: "bt-21",
  classifier: "keyword",
  profiler: "domain-override",
  selector: "2track-ce",
  deliberation: "role-based",
  learning: { tier0: true, tier1: false, tier2: false, tier3: false },
};

function createEngine(config: AxisConfig): PyreezEngine { ... }
```

### Variant → 슬롯 매핑

| Variant | 슬롯 | 구현 클래스 (예정) | 기존 코드 |
|---------|------|-----------------|----------|
| S1 | 슬롯 1 | `BtScoringSystem` | `model/calibration.ts`, `evaluation/bt-updater.ts` |
| S1-b | 슬롯 1 | `StepBtScoringSystem` | — |
| S2 | 슬롯 1 | `EloScoringSystem` | — |
| S4 | 슬롯 1 | `BenchmarkScoringSystem` | — |
| R-A1 | 슬롯 2 | `KeywordClassifier` | `classify/classifier.ts` |
| R-A2 | 슬롯 2 | `StepDeclareClassifier` | — |
| R-A3 | 슬롯 2 | `LlmClassifier` | — |
| R-A4 | 슬롯 2 | `EmbeddingClassifier` | — |
| R-B1 | 슬롯 3 | `DomainOverrideProfiler` | `profile/profiler.ts` |
| R-B2 | 슬롯 3 | `StepProfiler` | — |
| R-B3 | 슬롯 3 | `MoeGatingProfiler` | `router/gating.ts` |
| R-C1 | 슬롯 4 | `TwoTrackCeSelector` | `router/selector.ts` |
| R-C2 | 슬롯 4 | `FourStrategySelector` | — |
| R-C3 | 슬롯 4 | `CascadeSelector` | `router/cascade.ts` |
| R-C4 | 슬롯 4 | `PreferenceSelector` | `router/preference.ts` |
| R-C5 | 슬롯 4 | `MabSelector` | — |
| D1 | 슬롯 5 | `SingleBestProtocol` | — (trivial) |
| D2a/b/c | 슬롯 5 | `RoleBasedProtocol` | `deliberation/engine.ts` |
| D3 | 슬롯 5 | `DivergeSynthProtocol` | — |
| D4 | 슬롯 5 | `AdaptiveDelibProtocol` | — |
| D5 | 슬롯 5 | `FreeDebateProtocol` | — |
| D6 | 슬롯 5 | `VotingProtocol` | — |

---

## 구현 로드맵

### Phase 0: 준비 — Working Directory 확인
- 현행 테스트 전체 통과 확인 · **Sonnet**
- 기준 성능 측정 (FIELD-TEST.md 시나리오 일부) · **Sonnet**

### Phase 1: 5-슬롯 인프라
1. 경계 타입 정의 (`src/axis/types.ts`) — ClassifyOutput, TaskRequirement, EnsemblePlan · **Sonnet**
2. 5-슬롯 인터페이스 정의 (`src/axis/scoring.ts`, `classifier.ts`, `profiler.ts`, `selector.ts`, `deliberation.ts`) · **Sonnet**
3. LearningLayer 인터페이스 정의 (`src/axis/learning.ts`) · **Sonnet**
4. PyreezEngine compositor (`src/axis/engine.ts`) · **Opus** (비동기 흐름 조합, T2 bypass 분기, 오류 전파 설계)
5. AxisConfig + createEngine() factory (`src/axis/factory.ts`) · **Opus** (호환 매트릭스 검증 로직, 컴파일타임 거부 설계)
6. 현행 구현을 인터페이스로 래핑 · **Sonnet** (기계적 래핑)
   - S1 → `BtScoringSystem`
   - R-A1 → `KeywordClassifier`
   - R-B1 → `DomainOverrideProfiler`
   - R-C1 → `TwoTrackCeSelector`
   - D2a → `RoleBasedProtocol`
7. 기존 테스트 그린 확인 · **Sonnet**

### Phase 2: 이미 구현된 모듈 활성화 (최저 비용)
1. R-B3 (gating.ts) → `MoeGatingProfiler` 래핑 · **Sonnet**
2. R-C3 (cascade.ts) → `CascadeSelector` 래핑 · **Sonnet**
3. R-C4 (preference.ts) → `PreferenceSelector` 래핑 · **Sonnet**
4. 각각 단위 테스트 작성 · **Sonnet**

### Phase 3: PLAN.md variant 구현 (중간 비용)
1. S1-b: `STEP_PROFILES` + `stepToDimensions()` → `StepBtScoringSystem` · **Opus** (~20개 Step 프로파일 + dimension 매핑 설계)
2. R-A2: MCP `step` 파라미터 추가 (**MCP tool 정의 변경 필요**: pyreez_route/pyreez_ask에 `step` 선택적 파라미터) + 오케스트레이터 룰 → `StepDeclareClassifier` · **Opus** (공개 API 변경, 다운스트림 오케스트레이터 영향 분석)
3. R-B2: `StepProfiler` (단일 맵) · **Sonnet**
4. R-C2: `FourStrategySelector` (economy/balanced/premium/critical) · **Opus** (balanced 공식 미결정 포함, 전략별 CE 수식 설계)

### Phase 4: 숙의 대안 (핵심 실험)
1. D1: `SingleBestProtocol` (trivial, 대조군) · **Sonnet**
2. D3: `DivergeSynthProtocol` (MoA 기반) · **Sonnet** (병렬 생성 + synthesizer 선택 패턴)
3. D4: `AdaptiveDelibProtocol` (ADP — D3 확장) · **Opus** (N×(N-1) 상호 비평 + BT 가중 통합 설계)
4. 각각 프롬프트 설계 + 단위 테스트 · **Opus** (D3/D4의 synthesizer/critique 프롬프트는 품질 직결)

### Phase 5: 학습 레이어 (L1+L2 우선 — quality 불필요)
1. `.pyreez/learning/` 저장 구조 + FileIO · **Sonnet**
2. L2 선호도 영속화 (현재 메모리 → JSON sync) · **Sonnet**
3. Auto-calibrate trigger: `record()` 내부 카운터 → N건(50) 도달 시 `ScoringSystem.update()` 자동 호출 · **Sonnet**
4. LearningLayer 구현체 (L1 BT는 ScoringSystem 위임, L2 선호도 직접) → PyreezEngine 연결 · **Opus** (L1 위임 경계, 비동기 record 내부 흐름 설계)

> L3(MoE 가중치), L4(MF)는 quality 점수 필요 → Phase 6에서 T3 도입 후 활성화.

### Phase 6: 피드백 루프 + Prompt 최적화 + L3/L4
1. T3: LLM-as-Judge 모듈 (nano 모델, 비동기 평가) · **Opus** (프롬프트 설계 + 0~10 점수 추출 + 오류 흡수 설계)
2. Judge 결과 → L1~L4 자동 입력 파이프라인 · **Opus** (비동기 학습 트리거 체인 전체 설계)
3. L3 MoE 가중치 학습 모듈 (베치: 100건마다) · **Sonnet** (online gradient ~3줄)
4. L4 MF 학습 모듈 (~50줄 TypeScript, 주기적: 500건 또는 일 1회) · **Opus** (SGD MF 구현, vocabKind 분기, context 인덱싱)
5. prompts.ts → 템플릿 엔진 전환 · **Sonnet**
6. Few-shot 자동 추출 (deliberation store 활용) · **Opus** (성공 사례 선별 기준, T1 유사도 연동 설계)

### Phase 7: Tier 1~2 학습 (선택적)
1. T1: Embedding 유사도 모듈 (text-embedding-3-small) · **Sonnet** (API 호출 + cosine similarity)
2. T2: LLM-as-End-to-End-Router (슬롯 2-3-4 bypass shortcut, nano 모델) · **Opus** (bypass 분기 조건, EnsemblePlan 직접 파싱, engine 통합)
3. Embedding 캐시 관리 · **Sonnet**
4. R-A4 (Embedding 분류기) 실험 (T1과 묶어 테스트) · **Sonnet**

### Phase 8: 탐색적 대안 (데이터/비용 여유 시)
1. S3: `LlmJudgeScoringSystem` · **Opus** (실시간 Judge → BT 피드백 설계)
2. D5: `FreeDebateProtocol` · **Opus** (턴 수렴 조건, 무한루프 방지, 자유 형식 turn 설계)
3. R-C5: `MabSelector` (Thompson Sampling) · **Opus** (Beta 분포 사전/사후 업데이트, exploitation-exploration 균형)

---

## 실험 설계

### 평가 지표

| 지표 | 설명 | 측정 방법 |
|---|---|---|
| Quality | 응답 품질 | LLM-as-Judge 5점 척도 또는 인간 평가 |
| Cost | 총 API 비용 | token 소비량 × 모델 단가 |
| Latency | 응답 시간 | wall clock (end-to-end) |
| Consistency | 동일 입력 재현성 | N회 반복 σ |
| Learning Δ | 학습 전후 라우팅 정확도 변화 | Day 1 vs Day 30 quality 비교 |

### 1단계: 슬롯별 독립 비교

각 슬롯에서 variant를 교체하면서 다른 슬롯은 고정(현행 baseline).

**고정 기준: S1 + R-A1 + R-B1 + R-C1 + D2a**

| 실험 | 변수 슬롯 | 비교 대상 | 고정 | 예상 실험 수 |
|---|---|---|---|---|
| E-S | 슬롯 1 | S1 vs S1-b | R-A1, R-B1, R-C1, D2a | 2 |
| E-CL | 슬롯 2 | R-A1 vs R-A2 vs R-A3 | S1, R-B1, R-C1, D2a | 3 |
| E-PR | 슬롯 3 | R-B1 vs R-B3 | S1, R-A1, R-C1, D2a | 2 |
| E-SE | 슬롯 4 | R-C1 vs R-C2 vs R-C3 vs R-C4 | S1, R-A1, R-B1, D2a | 4 |
| E-D | 슬롯 5 | D1 vs D2a vs D3 vs D4 | S1, R-A1, R-B1, R-C1 | 4 |

**→ 15개 실험**

> **주의**: E-CL에 R-A2(스텝 선언) 추가 (MCP mock으로 테스트 가능). R-A4는 T1과 묶어 Phase 7 실험.
> **주의**: E-PR에서 R-B2는 R-A2와 묶이지 않으면 vocab 불일치 — 호환 매트릭스 참조.

### 2단계: 슬롯간 교차 조합

1단계에서 각 슬롯 상위 2개 선발 → 조합.

| Top-2 Scoring | × Top-2 Classifier | × Top-2 Profiler | × Top-2 Selector | × Top-2 Deliberation | = 32 조합 |
|---|---|---|---|---|---|

실현 가능한 상위 8~10 조합만 테스트.

> **필터링 기준**: Classifier-Profiler 호환 매트릭스에서 ❌인 조합 제외 후, S2+R-C1 등 Scoring-Selector 비호환 조합도 제외.

### 3단계: 학습 효과 측정

최적 조합을 고정한 뒤, 학습 Tier별 효과 비교.

| 실험 | 학습 설정 | 측정 |
|---|---|---|
| E-L0 | Tier 0만 (통계) | Day 1 vs Day 7 vs Day 30 quality |
| E-L1 | Tier 0 + Tier 1 (Embedding) | 동일 |
| E-L2 | Tier 0 + Tier 1 + Tier 2 (LLM-Router) | 동일 |
| E-L3 | 전체 (T0~T3) | 동일 |

### 4단계: 최종 확정

* 3단계 상위 2-3개 조합 → 대규모 평가 (FIELD-TEST.md 전체)
* Regression test
* 최종 기본값(DEFAULT_CONFIG) 결정

**총 실험: ~25-30개**

---

## 미결정 사항

### 슬롯 설계
- [ ] WorkflowStep 구체적 목록 (~20개) — S1-b, R-A2, R-B2에 공통 영향
- [ ] balanced strategy 구체적 scoring 공식 — R-C2
- [ ] D3/D4 synthesizer 프롬프트 설계
- [ ] D5 종료 조건 (consensus 자동 감지 방법)
- [ ] R-B3(MoE)에 Korean/non-Latin 특수 처리 통합 여부
- [ ] R-C6(Ensemble) 구체적 조합 알고리즘
- [ ] S2(Elo) 사용 시 Selector의 overall fallback 구현 범위

### 학습 레이어
- [x] ~~L4 MF의 context type 목록 정의 (~20개)~~ → vocabKind에 따라 동적 결정 (taskType=62, step=~20)
- [x] ~~Auto-calibrate 임계값~~ → 50건 (record() 내부 카운터 → ScoringSystem.update() 호출)
- [ ] L2 선호도 JSON sync 주기 (매 호출? N건마다?)
- [ ] T1 Embedding 캐시 최대 크기 (최근 N개?)
- [ ] T3 LLM-as-Judge 프롬프트 설계 (평가 기준, 점수 스케일)
- [x] ~~학습 결과와 초기값 합산 공식~~ → ScoringSystem이 global+personal 합산 소유. enhance()는 L2~L4만.

### 피드백 루프
- [x] ~~LLM-as-Judge 비동기 실행 방식~~ → record() 내부에서 비동기 실행, 외부에 learn() 노출 불필요
- [ ] Few-shot 추출 시 유사도 임계값

### 실험
- [ ] 실험 벤치마크 데이터셋 선정
- [ ] 평가 judge 모델 선정 (LLM-as-Judge 사용 시)
- [ ] 학습 효과 측정 기간 (7일? 30일?)
