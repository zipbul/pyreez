# Pyreez 개선 과제

IDEATION:BRAINSTORM debate 테스트 결과 도출된 구조적 개선 과제.

---

## 1. Cooldown 에러 타입별 범위 분기

### 현상

`engine.ts`의 `callWithFallback`에서 모든 에러가 `pool.markFailed()` → `cooldown.addProvider()`를 호출.
404 (model not found)도 provider-level cooldown을 트리거하여 동일 provider의 정상 모델까지 차단.

```
// 현재: 무조건 provider-level
pool.markFailed(currentModel, errorMsg);
// → cooldown.add(modelId) + cooldown.addProvider(modelId)
```

### 개선 방안

**A. 에러 타입별 cooldown 범위 매핑**

`classifyError()`의 결과를 `markFailed()`에 전달하여 범위 결정:

| 에러 타입 | cooldown 범위 | 근거 |
|-----------|---------------|------|
| `rate_limit` (429) | provider | spending cap, quota는 provider 공유 자원 |
| `auth_error` (401/403) | provider | API key는 provider 단위 |
| `server_error` (5xx) | provider | 인프라 장애는 provider 단위 |
| `timeout` | model | 특정 모델 과부하 가능, 같은 provider 다른 모델은 정상일 수 있음 |
| `degenerate` | model | 모델 고유 품질 문제 |
| `unknown` (404 등) | model | 모델 미존재, 설정 오류 등 개별 문제 |

**B. markFailed에 scope 파라미터 추가**

```typescript
markFailed(modelId: string, reason: string, scope: "model" | "provider"): void
```

engine에서 `classifyError()` 후 scope 결정하여 전달.

**C. Provider cooldown을 threshold 기반으로 전환**

같은 provider에서 N개 이상 모델이 연속 실패 시에만 provider-level cooldown.
단일 모델 실패로는 provider 전체를 차단하지 않음.

---

## 2. Evaluation Dimension 도메인별 가중치

### 현상

Thompson Sampling에서 5개 dimension을 균등 평균(각 20%)으로 계산:

```typescript
dimSum += betaSample(params.alpha, params.beta);
// ...
score = dimSum / BINARY_DIMENSIONS.length; // 5로 나눔
```

IDEATION:BRAINSTORM에서 `factually_correct`와 `novel_perspective`가 동일 가중치.
브레인스토밍에서 "사실 검증"이 "독창성"과 같은 비중이면 안전하고 지루한 아이디어만 선택됨.

### 개선 방안

**A. 도메인별 가중치 맵**

```typescript
const DOMAIN_WEIGHTS: Record<string, Record<string, number>> = {
  IDEATION: {
    factually_correct: 0.10,
    addresses_task: 0.20,
    provides_evidence: 0.15,
    novel_perspective: 0.40,
    internally_consistent: 0.15,
  },
  REVIEW: {
    factually_correct: 0.30,
    addresses_task: 0.20,
    provides_evidence: 0.25,
    novel_perspective: 0.05,
    internally_consistent: 0.20,
  },
  // ...
};
```

Thompson Sampling에서:
```typescript
dimSum += weight * betaSample(params.alpha, params.beta);
```

**B. Evaluation 프롬프트에도 도메인 컨텍스트 주입**

현재 external evaluator 프롬프트에 도메인 정보가 없음. IDEATION 태스크 평가 시 "novel_perspective를 엄격하게, factually_correct는 관대하게" 같은 도메인별 가이드라인 추가.

**C. 도메인별 dimension 세트 자체를 다르게 구성**

IDEATION 전용 dimension: `originality`, `feasibility_sketch`, `cross_domain_connection`, `provocation_value`.
CODING 전용 dimension: `correctness`, `edge_case_coverage`, `readability`.
공통 dimension과 도메인 특화 dimension을 분리.

---

## 3. SkillCell 키 구조 — Sparse Matrix 문제

### 현상

키: `model:domain:taskType`. 12 domains × 78 task_types × N models = 최대 936×N 셀.
대부분의 셀이 uniform prior(α=1, β=1) 상태로 영구 잔류. Wilson score exclusion(≥10 obs) 도달이 비현실적.

### 개선 방안

**A. 계층적 집계 (Hierarchical Bayesian)**

3단계 fallback:
1. `model:domain:taskType` — 데이터 있으면 사용
2. `model:domain` — task_type 무관 집계
3. `family:domain` — 같은 family(예: claude-4 계열) 집계

Thompson Sampling 시 관찰 수에 따라 가중 혼합:

```typescript
const cellObs = cell?.total ?? 0;
const domainCell = store.getForDomain(modelId, domain);
const familyCell = store.getForFamily(family, domain, taskType);

// 관찰 수가 적으면 상위 계층 prior에 의존
const effectiveAlpha = cell.alpha + (domainCell.alpha - 1) * shrinkage;
```

**B. Task type 클러스터링**

78개 task_type을 의미적 클러스터로 축소:

| 클러스터 | task_types |
|----------|-----------|
| creative | BRAINSTORM, ANALOGY, OPTION_GENERATION |
| analytical | TRADEOFF_ANALYSIS, COMPARISON, CRITIQUE |
| implementation | IMPLEMENT_FEATURE, IMPLEMENT_ALGORITHM, REFACTOR |
| verification | CODE_REVIEW, SECURITY_REVIEW, COMPLETENESS_CHECK |

클러스터 단위로 SkillCell 관리. 936 → ~48 조합으로 축소.

**C. Domain-only 모드 + task_type 보정**

기본은 `model:domain`으로만 추적. task_type은 domain 점수에 대한 multiplier로 작용:

```typescript
score = domainScore * taskTypeMultiplier(taskType)
```

multiplier는 경험적 가중치 테이블. SkillCell 수를 12×N으로 축소.

---

## 4. Critic 역할 프롬프트 비대칭성

### 현상

Advocate: "Champion the strongest solution with concrete evidence" → 자연스럽게 구체적이고 긴 응답.
Critic: "Find weaknesses, failure modes, unstated assumptions" → 비판만 하고 대안 제시 안 함.

R1에서 grok-4(critic)가 "novel features are rare and impractical"이라는 회의론만 제출.
대안은 R2 debate 규칙에 의해서야 나옴.

### 개선 방안

**A. Critic 프롬프트에 대안 의무 추가**

```
Find weaknesses, failure modes, unstated assumptions in other approaches.
Then propose a concrete alternative that addresses the weaknesses you found.
Your alternative must be at least as specific as the original proposal.
```

비판과 대안을 XML 구조에 모두 포함:
```xml
<critique>...</critique>
<alternative>
  <position>...</position>
  <evidence>...</evidence>
</alternative>
```

**B. Devil's Advocate + Constructive Critic 분리**

critic 역할을 두 가지로 세분화:
- **Destructive critic**: 순수 약점 탐색 (현재 critic)
- **Constructive critic**: 약점 지적 + 반드시 대안 제시

팀 크기에 따라 배분. 3명이면 advocate + constructive critic + wildcard.

**C. R1에서도 debate 규칙 적용**

현재 debate 규칙("concede or counter with new evidence")은 R2+에서만 적용.
R1부터 모든 워커에게 "position + evidence + alternative" 구조를 강제하면 첫 라운드부터 구체적 대안이 나옴.

---

## 5. Silent Team Degradation

### 현상

5명 팀에서 2명(Google 모델)이 실패 → 3명으로 축소. 경고 없이 진행.
사용자(호스트)는 결과를 받아야 팀 축소를 인지.

### 개선 방안

**A. 최소 팀 크기 임계값**

```typescript
const MIN_TEAM_SIZE = Math.max(2, Math.ceil(originalTeamSize * 0.6));
```

활성 워커가 임계값 미만이면:
- 추가 모델 선택 시도 (fallback pool에서 보충)
- 보충 불가 시 degraded mode 경고를 결과에 포함

**B. 결과에 degradation 메타데이터 추가**

```typescript
interface DeliberateOutput {
  // ...기존 필드
  degradation?: {
    originalTeamSize: number;
    activeTeamSize: number;
    lostSlots: Array<{ model: string; reason: string }>;
    warning: string;
  };
}
```

**C. 팀 구성 시 provider 분산 강화**

동일 provider에서 최대 1명만 선택. 현재 `ceil(count/2)` → 더 엄격하게.
provider 장애 시 최대 1명만 손실되도록 보장.

---

## 6. Acceptance 검증 깊이

### 현상

acceptance 응답에 `misrepresented`/`unresolved` 필드 반환 구조는 존재하나(`server.ts:427-436`), 프롬프트가 "verify if accurately represented"로 수동적이라 실질적으로 거의 항상 accept만 반환됨.
synthesis에서 워커 입장을 약화시켜도 accept 통과 → 검증이 너무 관대.

### 개선 방안

**A. Acceptance 응답 구조 강화**

현재 verdict는 `"accept" | "reject"` 2종. `"partial"` 추가하여 "대체로 맞지만 일부 왜곡" 표현 가능:

```typescript
interface AcceptanceResult {
  verdict: "accept" | "reject" | "partial";
  accuracy_score: number;  // 0-1, 입장 반영 정확도
  misrepresentations: string[];  // 왜곡된 부분 구체 인용
  omissions: string[];  // 누락된 핵심 주장
  unresolved: string[];  // synthesis에서 해결 안 된 갈등
}
```

**B. Adversarial acceptance 프롬프트**

현재 프롬프트가 수동적이라 기존 `misrepresented`/`unresolved` 파싱 구조가 사실상 사장됨.
"Find at least one way the synthesis misrepresents or weakens your position" 같은 adversarial 프레이밍으로 변경.
실제 문제가 없으면 "none found"를 명시적으로 반환하되, 디폴트가 "찾아라"여야 검증이 엄격해짐.

**C. Cross-worker 검증**

각 워커가 자기 입장만 확인하는 게 아니라, 다른 워커의 입장도 정확히 반영되었는지 교차 검증.
A가 B의 입장이 왜곡되었다고 지적할 수 있음 → 자기 편향 보완.

---

## 7. 모델 가용성 사전 검증

### 현상

`local/ai/qwen3-coder`가 models.json에 `available: true`로 등록되어 있지만 실제 사용 불가(404).
`registry.getAvailable()` 필터링 인프라는 존재하나, 모델 설정이 실제 가용성과 불일치할 때 런타임 실패 → fallback 소모.

**즉시 조치**: qwen3-coder의 `available`을 `false`로 변경하면 현재 문제는 해결. 아래는 구조적 방지책.

### 개선 방안

**A. Deliberation 시작 전 health check**

```typescript
async function probeModel(modelId: string): Promise<boolean> {
  // 최소 비용 호출 (1 token)로 가용성 확인
}
```

팀 구성 후, 실제 deliberation 전에 선택된 모델들을 probe.
실패 모델은 즉시 교체 → fallback pool 소모 방지.
`available` 필드의 수동 관리 의존성을 제거.

**B. 런타임 실패 시 available 자동 갱신**

반복 실패(예: 동일 모델 3회 연속 404) 시 `available`을 `false`로 자동 전환.
세션 내에서뿐 아니라 models.json에도 반영하여 다음 세션에서 재시도 방지.

**C. Cooldown persistence across sessions**

현재 cooldown은 세션 내에서만 유효. 이전 세션에서 반복 실패한 모델을 다음 세션에서도 계속 시도.
`scores/cooldown.json` 같은 파일로 최근 실패 이력을 유지하고, startup 시 로드.

---

## 8. 에러 정규화

### 현상

raw JSON 에러가 결과에 그대로 노출:
```
{"error":{"code":429,"message":"Your project has exceeded its spending cap.","status":"RESOURCE_EXHAUSTED"}}
```

### 개선 방안

**A. 표준 에러 형식**

```typescript
interface NormalizedError {
  code: string;        // "RATE_LIMIT" | "AUTH" | "MODEL_NOT_FOUND" | "SERVER" | "TIMEOUT"
  message: string;     // 사람이 읽을 수 있는 한 줄 설명
  provider: string;
  model: string;
  retryable: boolean;
  raw?: string;        // 디버그용 원본 (opt-in)
}
```

**B. Provider별 에러 파서**

각 provider adapter에서 에러를 NormalizedError로 변환. MCP 결과에는 정규화된 형태만 노출.

---

## 9. Hallucination을 IDEATION에서 재정의

### 현상

`FailureFlags.hallucination`이 모든 도메인에서 동일하게 부정적.
IDEATION:BRAINSTORM에서 "존재하지 않는 것을 그럴듯하게 구성"은 hallucination이 아니라 핵심 역량.

### 개선 방안

**A. 도메인별 failure flag 해석**

```typescript
const FAILURE_INTERPRETATION: Record<string, Record<string, "critical" | "warning" | "neutral">> = {
  IDEATION: {
    hallucination: "neutral",   // 창의적 구성은 hallucination이 아님
    refusal: "critical",         // 아이디어 거부는 치명적
    off_topic: "warning",
    degenerate: "critical",
  },
  REVIEW: {
    hallucination: "critical",  // 리뷰에서 허위 사실은 치명적
    refusal: "warning",
    off_topic: "critical",
    degenerate: "critical",
  },
};
```

Thompson Sampling에서 failure penalty를 해석에 따라 조절.

**B. IDEATION 전용 failure flag**

hallucination 대신:
- `ungrounded_claim`: 검증 가능한 사실을 잘못 주장 (예: "Python에 이미 이 기능이 있다")
- `lazy_recombination`: 기존 아이디어 이름만 바꿔서 재탕
- `no_mechanism`: 아이디어만 있고 작동 원리 설명 없음

**C. External evaluator 프롬프트에 도메인 컨텍스트**

현재 evaluator 프롬프트에 domain 정보 없음. 추가:

```
Domain: IDEATION, Task: BRAINSTORM
Note: In ideation tasks, speculative or imaginative claims about features that
don't yet exist are NOT hallucinations. Only flag hallucination for false claims
about existing, verifiable facts.
```

---

## 10. Cooldown 라운드 간 전파

### 현상

R1에서 Google provider가 429로 실패 → R2에서 동일 Google 모델을 다시 시도 → 동일 에러.
`failedWorkers`에 R1, R2 모두 같은 에러가 기록됨.

### 개선 방안

**A. 팀 워커 호출 전 cooldown 체크 추가**

CooldownManager는 프로세스 스코프로 라운드 간 공유됨 (`index.ts:116-117`).
그러나 `callWithFallback()`에서 팀 워커의 최초 호출은 cooldown 체크 없이 직접 실행됨 — fallback pool의 `getNext()`만 cooldown을 확인.
R1에서 cooldown에 등록된 모델이 R2에서 팀 워커로 재호출되는 것이 원인.

**B. 팀 워커 호출 전 cooldown 체크 추가**

```typescript
// executeRound에서 각 워커 호출 전
if (cooldown.isOnCooldown(worker.model)) {
  // 즉시 fallback으로 전환, API 호출 낭비 방지
}
```

**C. 라운드 시작 시 팀 재구성**

R1 후 실패한 워커를 팀에서 제거하고, 가용 모델로 교체한 새 팀으로 R2 진행.
현재는 R1 팀 그대로 R2에 진입하여 실패가 반복됨.
