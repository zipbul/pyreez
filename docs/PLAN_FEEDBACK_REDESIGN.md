# Plan: Feedback 시스템 재설계 구현

> Spec: `docs/SPEC_FEEDBACK_REDESIGN.md`
> 2026-03-19 작성. 서브에이전트 크로스체크 후 수정 반영.

## 설계 결정 (Spec에서 확정)

1. BT pairwise → per-model binary scoring + Thompson Sampling
2. 호스트 평가 → 외부 evaluator (cheap model, rotated)
3. Elo → 선택 경로에서 제거 (shadow mode)
4. Wilson score → 도메인별 회피 추천
5. Cold-start → 3-tier Bayesian prior + 필수 탐색 슬롯

## 현재 시스템 핵심 경로

```
pyreez_feedback(winner/loser)
  → BtScoringSystem.update() → btUpdateRating() → persistRatings()
  → scores/models.json (21-dimension mu/sigma)

pyreez_deliberate
  → selectDiverseModels() — scoreDimensions(SELECTION_DIMS) + provider round-robin
  → deliberate() → PoLL judge → auto BT update
```

## 목표 시스템 핵심 경로

```
deliberate() 완료
  → ExternalEvaluator.evaluate(responses) — binary 5dim + 4 failure flags
  → SkillCellStore.update(model, domain, taskType, feedback)
  → skillcells.json (per model×domain×task_type Beta counts)

pyreez_deliberate
  → thompsonSelect() — Beta sampling + provider diversity + exclusion
  → deliberate() → ExternalEvaluator → SkillCell update

pyreez_feedback (변경)
  → 호스트가 binary feedback 제출 (선택적, 외부 평가자 보완)
```

## 크로스체크에서 발견된 문제와 해결

| # | 문제 | 심각도 | 해결 |
|---|------|--------|------|
| 1 | `ModelInfo`에 `family` 필드 없음 → Cold-Start Tier 1/2 불가 | 블로커 | Step 0에서 family 필드 추가 선행 |
| 2 | `DeliberateInput`에 domain/taskType 없음 → thompsonSelect 호출 불가 | 블로커 | Step 1에서 타입 확장 |
| 3 | Beta distribution sampler 없음 | 블로커 | Step 3-A에서 수학 유틸리티 구현 |
| 4 | `WireDeps`, `PyreezMcpServerConfig` 확장 누락 | 높음 | Step 6, 8에서 인터페이스 변경 명시 |
| 5 | Dual-write 시 BT shadow 미축적 경로 | 높음 | Step 8에서 preferences 필수 유지 (evaluations만 optional 추가) |
| 6 | `PyreezEngine` auto_route 경로 TS 전환 미결 | 중간 | Phase 1에서는 BT 유지, 별도 Step으로 분리 |
| 7 | evaluator rotation state 관리 없음 | 중간 | Step 5에서 rotation tracker 추가 |
| 8 | evaluator 실패 graceful degradation 테스트 없음 | 중간 | Step 5 테스트에 추가 |

## 구현 단계

### Step 0: 선행 작업 — family 필드 추가

**파일**: `src/model/types.ts`, `scores/models.json`

`ModelInfo`에 `family?: string` 필드 추가. models.json에 각 모델의 family 태깅:
- `anthropic` provider → `claude-4` family
- `xai` provider → `grok-4` family
- `openai` provider → `gpt-5` family
- 등등. provider와 다를 수 있음 (같은 provider의 다른 아키텍처)

Family가 없는 모델은 provider를 fallback으로 사용 (IMPROVE_DELIBERATION.md 항목 2에서 이미 설계).

**테스트**: typecheck + registry 로딩 테스트.

### Step 1: 타입 정의

**파일**: `src/axis/types.ts`, `src/model/types.ts`, `src/deliberation/types.ts`

```typescript
// src/axis/types.ts 에 추가

interface BinaryDimensions {
  factually_correct: boolean;
  addresses_task: boolean;
  provides_evidence: boolean;
  novel_perspective: boolean;
  internally_consistent: boolean;
}

interface FailureFlags {
  hallucination: boolean;
  refusal: boolean;
  off_topic: boolean;
  degenerate: boolean;
}

interface FeedbackRecord {
  deliberation_id: string;
  model_id: string;
  domain: string;
  task_type: string;
  evaluator_id: string;
  dimensions: BinaryDimensions;
  failures: FailureFlags;
  timestamp: number;
}

interface BetaParams {
  alpha: number; // pass count + 1
  beta: number;  // fail count + 1
}

interface SkillCell {
  model_id: string;
  domain: string;
  task_type: string;
  dimensions: Record<string, BetaParams>;
  failure_counts: Record<string, number>;
  total: number;
}
```

추가: `src/deliberation/types.ts`의 `DeliberateInput`에 domain/taskType 필드 추가:

```typescript
// src/deliberation/types.ts 에 추가
interface DeliberateInput {
  // ... 기존 필드
  domain?: string;    // wire.ts에서 thompsonSelect에 전달
  taskType?: string;  // wire.ts에서 thompsonSelect에 전달
}
```

**테스트**: typecheck로 검증.

### Step 2: SkillCell 저장소

**파일**: 신규 `src/model/skillcell-store.ts`

```typescript
interface SkillCellStore {
  get(modelId: string, domain: string, taskType: string): SkillCell | undefined;
  getAll(domain: string, taskType: string): SkillCell[];
  update(record: FeedbackRecord): void;
  save(): Promise<void>;
  load(): Promise<void>;
}
```

- 저장: `scores/skillcells.json` (models.json과 분리 — BT 데이터 보존)
- 메모리: `Map<string, SkillCell>` (key = `${modelId}:${domain}:${taskType}`)
- update: `pass → alpha += 1`, `fail → beta += 1`, failure flag → count++
- 초기값: `alpha = 1, beta = 1` per dimension

**테스트**: unit test — update, get, persistence round-trip.

### Step 3-A: Beta Distribution Sampler

**파일**: 신규 `src/math/beta.ts`

```typescript
/** Sample from Beta(alpha, beta) distribution using Jöhnk's algorithm. */
export function betaSample(alpha: number, beta: number): number
```

Bun/JS에 Beta distribution sampler가 없으므로 직접 구현. Jöhnk's algorithm 또는 gamma 기반 변환.

**테스트**: unit test — 알려진 mean/variance에 수렴하는지 N=10000 샘플로 통계 검증.

### Step 3-B: Thompson Sampling 선택

**파일**: `src/deliberation/team-composer.ts` 변경

현재 `selectDiverseModels`를 교체하지 않고, 새 함수 `thompsonSelect` 추가. wire.ts에서 스위칭.

```typescript
function thompsonSelect(
  domain: string,
  taskType: string,
  pool: ModelInfo[],
  count: number,
  store: SkillCellStore,
): ModelInfo[] {
  // 1. Exclusion check (Wilson score)
  // 2. Per-model: sample from each dimension's Beta, average
  // 3. Sort by sampled score
  // 4. Enforce provider diversity: max ceil(n/2) from same provider
  // 5. Reserve 1 slot for cold-start (total < MIN_OBS)
  // 6. Return selected models
}
```

**의존**: Step 2 (SkillCellStore), Step 4 (Wilson exclusion)

**테스트**:
- deterministic seed로 TS 결과 검증
- provider diversity 강제 검증
- cold-start 슬롯 검증
- exclusion 검증
- uniform prior (alpha=1, beta=1)에서 탐색 비율 검증

### Step 4: Wilson Score 회피 추천

**파일**: `src/deliberation/team-composer.ts`에 함수 추가

```typescript
function shouldExclude(cell: SkillCell | null): boolean
function wilsonLower(passRate: number, n: number, z: number): number
```

**테스트**: 경계값 — n=0, n<MIN_OBS, passRate=0, passRate=1, threshold 경계.

### Step 5: 외부 평가자 (ExternalEvaluator)

**파일**: 신규 `src/deliberation/external-evaluator.ts`

```typescript
interface ExternalEvaluator {
  evaluate(
    task: string,
    response: WorkerResponse,
    domain: string,
    taskType: string,
  ): Promise<FeedbackRecord>;
}
```

- evaluator 모델 선택: 워커 모델과 다른 provider에서 cheap model
- evaluator rotation: 매 deliberation마다 다른 provider의 evaluator. rotation state는 in-memory (last_evaluator_provider)로 관리. 이전 provider와 다른 provider에서 가장 저렴한 model 선택.
- 프롬프트: binary yes/no 판정 5개 + failure flag 4개 = 9개 boolean
- JSON structured output 요청 → 파싱

**의존**: chatFn (기존 LLM 호출 인프라)

**테스트**:
- mock chatFn으로 프롬프트 구조 검증
- JSON 파싱 에러 처리 → graceful degradation (SkillCell 업데이트 건너뜀)
- evaluator가 워커와 같은 provider면 다른 걸로 교체하는 로직
- 모든 available evaluator가 같은 provider인 경우 → provider 제약 완화
- evaluator timeout/네트워크 에러 → SkillCell 업데이트 건너뜀
- rotation state: 이전과 다른 provider 선택 검증

### Step 6: Wire 연결 — deliberation 후 자동 평가

**파일**: `src/deliberation/wire.ts` 변경

`WireDeps` 인터페이스에 추가:
```typescript
interface WireDeps {
  // ... 기존 필드
  externalEvaluator?: ExternalEvaluator;
  skillCellStore?: SkillCellStore;
}
```

현재: deliberation → PoLL judge → BT update
변경: deliberation → ExternalEvaluator → SkillCell update (+ PoLL/BT shadow)

```typescript
// wire.ts의 createDeliberateFn 내부, deliberation 결과 처리 부분

// 새 경로: 외부 평가자 → SkillCell
if (deps.externalEvaluator && deps.skillCellStore) {
  for (const response of result.rounds[last].responses) {
    const feedback = await deps.externalEvaluator.evaluate(
      input.task, response, classification.domain, classification.taskType
    );
    deps.skillCellStore.update(feedback);
  }
  await deps.skillCellStore.save();
}

// 기존 경로: PoLL → BT (shadow mode, best-effort)
if (deps.pollJudge && deps.scoring) {
  // 기존 코드 유지 — shadow mode
}
```

**의존**: Step 2, Step 5

**테스트**: integration test — deliberation 결과 → evaluator 호출 → SkillCell 업데이트 검증.

### Step 7: 팀 선택 전환

**파일**: `src/deliberation/wire.ts` 변경

현재: `selectDiverseModels(available, MAX_AUTO_TEAM)`
변경: `thompsonSelect(domain, taskType, available, MAX_AUTO_TEAM, skillCellStore)`

```typescript
if (deps.skillCellStore) {
  const selected = thompsonSelect(
    classification.domain,
    classification.taskType ?? DOMAIN_DEFAULTS[classification.domain],
    available,
    MAX_AUTO_TEAM,
    deps.skillCellStore,
  );
  // ... composeTeam with selected
} else {
  // fallback to existing selectDiverseModels
  const selected = selectDiverseModels(available, MAX_AUTO_TEAM);
}
```

**의존**: Step 3

**테스트**: wire.spec.ts에서 thompsonSelect 경로 검증.

### Step 8: MCP 도구 스키마 변경

**파일**: `src/mcp/server.ts`

`pyreez_feedback` input schema 변경:

```typescript
// 기존
preferences: z.array(z.object({
  winner: z.string(),
  loser: z.string(),
  dimension: z.enum(ALL_DIMENSIONS).optional(),
}))

// 변경: 기존 유지 + 새 형식 추가 (dual-write)
preferences: z.array(z.object({
  winner: z.string(),
  loser: z.string(),
  dimension: z.enum(ALL_DIMENSIONS).optional(),
})).optional(),

evaluations: z.array(z.object({
  model_id: z.string(),
  domain: z.string(),
  task_type: z.string(),
  dimensions: z.object({
    factually_correct: z.boolean(),
    addresses_task: z.boolean(),
    provides_evidence: z.boolean(),
    novel_perspective: z.boolean(),
    internally_consistent: z.boolean(),
  }),
  failures: z.object({
    hallucination: z.boolean(),
    refusal: z.boolean(),
    off_topic: z.boolean(),
    degenerate: z.boolean(),
  }),
})).optional(),
```

- `preferences` → 기존 BT 경로 (shadow mode). **필수 유지** — BT shadow 데이터 축적 보장
- `evaluations` → 새 SkillCell 경로. optional 추가.
- preferences는 필수, evaluations는 optional. 이렇게 해야 dual-write 기간에 BT-TS 상관 모니터링 가능.

`PyreezMcpServerConfig` 인터페이스에 추가:
```typescript
interface PyreezMcpServerConfig {
  // ... 기존 필드
  skillCellStore?: SkillCellStore;
}
```

**의존**: Step 2

**테스트**: 기존 MCP 테스트 확장 — 새 스키마 검증.

### Step 9: Index 와이어링

**파일**: `src/index.ts`

```typescript
// SkillCell store 초기화
const skillCellStore = new FileSkillCellStore({
  io: fileIO,
  path: "scores/skillcells.json",
});
await skillCellStore.load();

// External evaluator 초기화
const externalEvaluator = new LLMExternalEvaluator({
  chatFn: axisChatFn,
  registry,
  cooldown: sharedCooldown,
});

// Wire에 전달
const deliberateFn = createDeliberateFn({
  ...existingDeps,
  skillCellStore,
  externalEvaluator,
});

// MCP 서버에 전달
const server = new PyreezMcpServer({
  ...existingOpts,
  skillCellStore,
});
```

**의존**: Step 2, 5, 6, 7, 8 전부

### Step 10: Cold-Start Prior 구현

**파일**: `src/deliberation/team-composer.ts`의 `thompsonSelect` 내부

```typescript
function getColdStartPrior(
  modelId: string,
  domain: string,
  taskType: string,
  store: SkillCellStore,
  registry: ModelRegistry,
): BetaParams {
  // Tier 1: same family + same domain
  // Tier 2: same family + any domain
  // Tier 3: uniform (alpha=1, beta=1)
}
```

**의존**: Step 2, 3. `models.json`에 `family` 필드 필요 — IMPROVE_DELIBERATION.md 항목 2에서 이미 설계됨.

**테스트**: 3-tier 각각 검증.

## 구현 순서 (의존성 기반)

```
Step 0:  family 필드 추가 ──────────────────────────┐
                                                     │
Step 1:  타입 정의 (+ DeliberateInput 확장) ────────┤
                                                     │
Step 2:  SkillCell 저장소 ─────────────────────┬────┤
                                                │    │
Step 3-A: Beta sampler ────────────────────────┤    │
                                                │    │
Step 4:  Wilson Score ─────────────────────────┤    │
                                                │    │
Step 3-B: Thompson Sampling ───────────────────┤    │
                                                │    │
Step 10: Cold-Start Prior ─────────────────────┤    │
                                                │    │
Step 5:  외부 평가자 + rotation tracker ───────┤    │
                                                │    │
Step 6:  Wire 연결 (+ WireDeps 확장) ─────────┤    │
                                                │    │
Step 7:  팀 선택 전환 ────────────────────────┤    │
                                                │    │
Step 8:  MCP 스키마 (+ ServerConfig 확장) ────┤    │
                                                │    │
Step 9:  Index 와이어링 ───────────────────────┘    │
                                                     │
Verify: typecheck + 전체 테스트 ─────────────────────┘
Validate: Spec 대비 코드 추적
```

**미결 사항 (Phase 1 범위 밖):**
- `PyreezEngine` auto_route 경로의 TS 전환 — BT 유지, 별도 Plan
- Phase 2 ordinal 확장 — 데이터 확인 후 별도 Plan
- gaming 감지 (downstream satisfaction signal) — 별도 Plan
- inter-evaluator variance 모니터링 — 별도 Plan

## 추가 변경 파일 (크로스체크에서 발견)

| 파일 | 변경 | Step |
|------|------|------|
| `src/deliberation/types.ts` | `DeliberateInput`에 domain/taskType 추가 | Step 1 |
| 신규 `src/math/beta.ts` | Beta distribution sampler | Step 3-A |
| 신규 `src/model/skillcell-store.ts` | SkillCell 저장소 | Step 2 |
| 신규 `src/deliberation/external-evaluator.ts` | 외부 평가자 | Step 5 |
| 신규 `scores/skillcells.json` | SkillCell 데이터 | Step 2 |

## 변경하지 않는 것

- `src/evaluation/bt-updater.ts` — BT 코드 수정 없음. shadow mode로 유지.
- `scores/models.json` — 기존 BT 데이터 보존. 새 데이터는 `scores/skillcells.json`에 별도 저장.
- `src/axis/learning.ts` — Phase 1에서는 건드리지 않음. SkillCell이 안정화된 후 적응.

## 리스크

| 리스크 | 완화 |
|--------|------|
| 외부 평가자 비용 증가 | cheap model(Haiku-class) 사용, 9개 boolean 판정 = 최소 토큰 |
| 외부 평가자 가용성 | fallback: 평가 실패 시 SkillCell 업데이트 건너뜀 (best-effort) |
| TS가 기존 selectDiverseModels보다 나빠지면 | fallback: `skillCellStore` 없으면 기존 경로 사용 (Step 7의 조건부 분기) |
| skillcells.json 파일 크기 | model×domain×task_type 조합. 50 모델 × 12 도메인 × 50 태스크 = 30,000 셀. 각 ~200 bytes → ~6MB. 관리 가능. |

## 테스트 계획

| Step | 테스트 유형 | 파일 |
|------|-----------|------|
| 1 | typecheck | - |
| 2 | unit | `src/model/skillcell-store.spec.ts` |
| 3 | unit | `src/deliberation/team-composer.spec.ts` (추가) |
| 4 | unit | `src/deliberation/team-composer.spec.ts` (추가) |
| 5 | unit | `src/deliberation/external-evaluator.spec.ts` |
| 6 | unit | `src/deliberation/wire.spec.ts` (추가) |
| 7 | unit | `src/deliberation/wire.spec.ts` (추가) |
| 8 | unit | `src/mcp/server.spec.ts` (추가) |
| 9 | typecheck + 전체 | - |
| 10 | unit | `src/deliberation/team-composer.spec.ts` (추가) |

## Spec 대비 체크리스트

| Spec 항목 | Plan Step | 상태 |
|----------|-----------|------|
| Binary 5 dimensions + 4 failure flags | Step 1 | 설계 완료 |
| SkillCell (model×domain×task_type) | Step 2 | 설계 완료 |
| Thompson Sampling | Step 3 | 설계 완료 |
| Wilson Score exclusion | Step 4 | 설계 완료 |
| External evaluator + rotation | Step 5 | 설계 완료 |
| 자동 평가 (deliberation 후) | Step 6 | 설계 완료 |
| Elo 제거 (선택 경로) | Step 7 | fallback 분기로 처리 |
| MCP 스키마 변경 | Step 8 | dual-write (기존 호환) |
| Cold-start 3-tier | Step 10 | family 필드 의존 |
| BT shadow mode | - | 기존 코드 유지, 변경 없음 |
| Phase 2 ordinal | - | **이 Plan 범위 밖** — 데이터 확인 후 별도 Plan |
