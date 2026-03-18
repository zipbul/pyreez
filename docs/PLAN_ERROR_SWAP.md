# Deliberation Error Handling Overhaul

## 배경

현재 deliberation에서 워커 실패 시 재시도 + TTL 쿨다운 방식으로 처리한다.

### 문제점

1. **chatAdapter가 429에 3번 재시도** — 크레딧 소진(spending cap)이면 시간+비용 낭비
2. **429를 전부 rate_limit(30초 TTL)로 분류** — spending cap 소진도 30초 후 재시도. 크레딧 소진은 영구적인데 일시적으로 취급
3. **에러 내용이 유저에게 전달되지 않음** — `failedWorkers`가 라운드 안에 묻혀 있고, synthesis host가 유저에게 안내할 수 없음
4. **pyreez_scores ↔ pyreez_deliberate 레지스트리 불일치** — scores는 50개 전체 모델 반환, deliberate는 설정된 provider만 허용. 유저가 scores에서 확인한 모델을 deliberate에 넣으면 "Unknown model" 에러
5. **429의 실제 의미가 provider마다 다름** — OpenAI `insufficient_quota`(영구), Google `RESOURCE_EXHAUSTED`(spending cap=영구 or rate limit=일시적), Anthropic/xAI(구분 불가). 현재 코드는 이를 모두 동일하게 처리

### 발생 사례

```
Google Gemini: 429 "Your project has exceeded its spending cap." (RESOURCE_EXHAUSTED)
→ 현재 코드: rate_limit 30초 쿨다운 → 30초 후 재시도 → 또 실패 → 에스컬레이션해도 최대 4분
→ 실제: 크레딧 충전 전까지 영구 불가
```

## 목표

- **모든 에러 → 즉시 다른 모델로 교체 (기능 무중단)**
- **에러 내용을 유저에게 투명하게 보고** — 시스템이 판단하지 않고, synthesis host가 유저에게 안내
- **Debate 라운드 2+에서 워커 교체 시 자연스러운 합류** — 새 참여자로 전체 토론 기록과 함께 투입

## 설계 결정 (논의 과정에서 확정)

### D1: 에러 발생 시 즉시 교체 (재시도 없음)

chatAdapter의 retry 로직 제거. 어떤 에러든 즉시 throw → per-worker fallback이 처리.

**근거**: 429가 rate limit인지 크레딧 소진인지 정확히 구분 불가 (provider마다 다름). 재시도는 낭비.

### D2: Per-worker fallback (팀 전체 재구성 아님)

개별 워커 단위로 fallback. 팀 전체를 교체하지 않음.
각 워커가 실패하면 fallback 풀에서 다음 모델로 교체. 병렬 실행 유지.

```
await Promise.allSettled(workers.map(w => callWithFallback(w, fallbackPool)))
```

### D3: Fallback 풀 = 기존 Top 5 팀

별도 풀 생성 불필요. 현재 `selectDiverseModels`로 선정된 Top 5 모델이 팀.
3명이 워커면 나머지 2명이 자연스럽게 fallback.
같은 모델 중복 허용 — 같은 모델이라도 다른 의견을 낼 가능성 충분.
풀 소진 시 해당 슬롯 포기 (빈 슬롯이 하위 모델보다 나음).

```
팀: [A, B, C, D, E] (Top 5)
워커: [A, B, C]
A 실패 → D → D도 실패 → E → E도 실패 → 빈 슬롯
```

### D4: Debate 라운드 2+ 교체 — 트랜스크립트 기반 즉시 참여

catch-up(이전 라운드 재생) 하지 않음. 새 참여자로 전체 토론 기록과 함께 현재 라운드에 바로 투입.

**근거**:
- catch-up은 순차 LLM 호출로 레이턴시 증가
- catch-up 시 죽은 워커의 참고자료가 독립성을 오염
- 신선한 시각이 토론에 새 에너지를 줄 수 있음

프롬프트 구조:
```
## Full Debate Transcript
### Round 1
<worker role="advocate">...</worker>
<worker role="critic">...</worker>
<worker role="wildcard">...</worker>
### Round 2
...

You are joining this debate as a new participant.
Read the full transcript. Identify what existing participants missed.
```

### D5: 에러 보고는 시스템이 판단하지 않음

ModelSwap 정보를 output에 포함. Synthesis host가 유저에게:
> "google/gemini-2.5-pro에서 429 에러 발생 (Your project has exceeded its spending cap) → anthropic/claude-sonnet-4.6으로 교체했습니다. 크레딧 소진으로 추측됩니다."

### D6: 쿨다운 → Session-level set + Provider 전파 유지

TTL/에스컬레이션 제거. 실패한 모델은 해당 세션에서 영구 제외.
**단, provider-level 전파는 유지**: 모델 A(anthropic/claude-sonnet) 실패 시 같은 provider의 다른 모델(anthropic/claude-opus)도 쿨다운. spending cap 등 provider-level 에러가 같은 provider의 다른 모델에도 영향을 주기 때문.

### D7: 최소 워커 수 제한 없음

워커 1명도 허용 (현행 유지).

### D8: Manual mode fallback 불가 + pyreez_scores configured_only

**Fallback**: `input.models`로 명시적 모델을 지정한 경우 fallback 없음. 유저가 의도적으로 특정 모델을 선택한 것이므로, 다른 모델로 대체하면 의도 위반.

**Registry 불일치 해소**: `pyreez_scores`에 `configured_only` 옵션 추가. `true`면 설정된 provider 모델만 반환하여 `pyreez_deliberate`와 일관성 확보.

실패 시 해당 슬롯 포기 + ModelSwap에 에러 기록.

### D9: 0-response 라운드 처리

모든 워커 + fallback이 전부 실패한 경우에도 RoundExecutionError를 throw하되, 그 전에 축적된 ModelSwap 기록을 에러에 포함시킨다. 에러를 받는 쪽(wire.ts → server.ts)에서 modelSwaps를 추출하여 유저에게 전달 가능.

### D10: Debate 교체 시 ghost content 처리

교체된 워커의 이전 라운드 응답은 트랜스크립트에 그대로 남긴다. 제거하지 않음.
- 다른 워커들(A, C)의 기존 프롬프트(`buildDebateWorkerMessages`)는 "last round responses"만 보여주므로 ghost content 문제 없음
- 새 워커(E)의 프롬프트(`buildColdJoinMessages`)는 전체 트랜스크립트를 보여주므로 B의 이전 응답도 자연스럽게 포함
- B의 응답은 "이전 참가자의 기여"로 취급됨

### D11: ModelSwap 기록 형식 — flat list

라운드/워커 정보가 포함된 flat list. 연쇄 교체도 개별 레코드로 기록.
`replacement`는 optional — fallback 소진 또는 manual mode에서 교체 불가 시 생략.

```typescript
// A→D (R1), D→E (R2) 연쇄 교체 시:
modelSwaps: [
  { original: "A", replacement: "D", round: 1, error: "429 spending cap", httpStatus: 429 },
  { original: "D", replacement: "E", round: 2, error: "timeout", httpStatus: 408 },
]

// Fallback 소진 또는 manual mode에서 교체 불가 시:
modelSwaps: [
  { original: "A", round: 1, error: "429 spending cap", httpStatus: 429 },
]
```

### D12: FallbackPool 동시 접근 — 선점 방식

`callWithFallback`이 `Promise.allSettled` 내에서 병렬 실행되므로, 같은 fallback 모델을 중복 획득하는 경합이 발생할 수 있다.

해결: FallbackPool이 내부적으로 **선점(claim) 방식** 사용. `getNext()`가 호출되면 해당 모델을 즉시 풀에서 제거하여 다른 callWithFallback이 같은 모델을 받지 못하게 한다. JavaScript 싱글 스레드 특성상 `getNext()` 자체는 atomic이지만, async/await 경계에서 interleaving이 발생하므로 `getNext()` 시점에 선점이 필수.

```typescript
// FallbackPool 내부:
getNext(excludeIds: Set<string>): ModelInfo | undefined {
  for (const model of this.remaining) {
    if (!excludeIds.has(model.id) && !this.cooldown.isOnCooldown(model.id)) {
      this.remaining.delete(model);  // 즉시 선점 — 다른 호출자가 받을 수 없음
      return model;
    }
  }
  return undefined;
}
```

## 구현 계획

### Step 1: `src/deliberation/types.ts` — ModelSwap 타입 추가

- [ ] `ModelSwap` interface 추가

```typescript
export interface ModelSwap {
  readonly original: string;
  readonly replacement?: string;   // undefined = fallback 소진 또는 manual mode
  readonly round: number;
  readonly error: string;
  readonly httpStatus?: number;
}
```

- [ ] `DeliberateOutput`에 `modelSwaps?: readonly ModelSwap[]` 추가
- [ ] typecheck 통과 확인

### Step 2: `src/deliberation/wire.ts` — chatAdapter retry 제거

- [ ] `createChatAdapter` retry 루프 제거 → 단일 호출, 실패 시 즉시 throw
- [ ] `ChatAdapterOptions`에서 retry 관련 필드 제거 (`maxRetries`, `baseDelayMs`, `retryableStatuses`, `randomFn`, `maxRetryAfterMs`)
- [ ] `RetryEvent` 타입, `onRetry` 콜백, `DEFAULT_ADAPTER_OPTIONS` retry 필드 제거
- [ ] `stripThinkTags`, GenerationParams 포워딩, truncation 감지 유지
- [ ] `wire.spec.ts`: retry 테스트 3개 삭제 (429 retry, maxRetries exhaustion, onRetry callback), 성공·stripThinkTags·truncation 테스트 유지
- [ ] test + typecheck 통과 확인

### Step 3: `src/deliberation/cooldown.ts` — Session-level set 간소화

- [ ] 내부를 `Set<string>` 기반으로 변경
  - `add()` → set.add (TTL/escalation 없음, 세션 내 영구)
  - `isOnCooldown()` → set.has
  - `getCooledDownIds()` → set 반환
  - `addProvider` → provider 전파 유지 (같은 provider의 모든 모델을 set에 추가)
- [ ] `CooldownManager` interface 유지 (호환성)
- [ ] `classifyError`, `findLLMClientError` 유지 + `findLLMClientError` export 추가 (ModelSwap.httpStatus 추출용)
- [ ] `ERROR_TYPE_TTL`, `MAX_ESCALATION_FACTOR`, `computeTtl` 삭제
- [ ] `cooldown.spec.ts`:
  - 삭제: TTL 만료(18-24), 커스텀 TTL(36-42, 44-50), error-type TTL(124-134), 에스컬레이션(136-149, 151-163), getEntry fields(192-202) — 8개
  - 유지: 즉시 쿨다운 확인, getCooledDownIds, 미등록 모델 false, clear, classifyError — 6개+
  - 수정: addProvider → provider 전파는 유지하되 TTL 없이 영구 set 추가로 변경
  - 신규: 세션 레벨 영구 쿨다운 확인 (TTL 만료 없음)
- [ ] test + typecheck 통과 확인

### Step 4: `src/deliberation/prompts.ts` — 트랜스크립트 기반 즉시 참여 프롬프트

- [ ] `buildColdJoinMessages` 함수 신규 추가
  - 모든 이전 라운드의 전체 토론 기록을 `## Full Debate Transcript`로 구성
  - 라운드별로 `### Round N` 하위에 `<worker role="...">` 태그로 응답 표시
  - `## Your Previous Response` 없음
  - system prompt: 해당 role (advocate/critic/wildcard) + "새 참가자로 합류. 기존 참가자가 놓친 점을 식별하라"
  - role은 workerIndex 기반 유지 (advocate/critic/wildcard)
  - `extractDebateDigest` 재사용하여 트랜스크립트 압축
- [ ] `EngineDeps`(`engine.ts`)에 `buildColdJoinMessages?` optional 필드 추가
- [ ] `prompts.spec.ts`: 신규 10개 테스트
  - full transcript 포함 확인
  - "Your Previous Response" 미포함 확인
  - role 할당 확인 (workerIndex 0=advocate, 1=critic, 2=wildcard)
  - host instructions 포함 시 동작
  - taskNature artifact vs critique 구분
  - round budget 포함
  - 빈 라운드 대응
  - XML escape 적용
  - 다수 라운드 트랜스크립트
  - output structure 포함
- [ ] test + typecheck 통과 확인

### Step 5: `src/deliberation/engine.ts` — 핵심 변경

#### 5A: FallbackPool + callWithFallback

- [ ] `FallbackPool` interface 정의 (engine.ts 내부, export)

```typescript
export interface FallbackPool {
  /** 쿨다운 + 제외 목록에 없는 다음 모델 반환. 선점 방식 — 호출 시 풀에서 즉시 제거 (D12). 소진 시 undefined. */
  getNext(excludeIds: Set<string>): ModelInfo | undefined;
  /** 실패한 모델을 provider 포함 쿨다운에 추가 */
  markFailed(modelId: string, reason: string): void;
}
```

- [ ] `callWithFallback` 내부 함수 구현 (executeRound 안에서)
  1. `chat(w.model, messages)` 시도
  2. 실패 → `pool.markFailed(w.model, error)` → `pool.getNext(excludeIds)` 로 대체
  3. 대체 모델로 메시지 재구성 (callWithFallback 내부에서 판단):
     - R1 or diverge-synth: `buildWorkerMessages` 사용 (기존과 동일)
     - R2+ debate: `buildColdJoinMessages` 사용 (교체 워커는 이전 응답이 없으므로 full transcript 필요)
     - 판단 기준: swap 여부 + `roundNumber > 1` + `protocol === "debate"` (replacementWorkers set 불필요)
  4. 대체도 실패 → 풀 소진까지 반복
  5. 전부 실패 시 `{ failed: true, swaps: ModelSwap[] }` 반환
  6. 성공 시 `{ response: WorkerResponse, swaps: ModelSwap[] }` 반환

#### 5B: executeRound 시그니처 변경

- [ ] 파라미터 추가: `fallbackPool?: FallbackPool` (replacementWorkers 불필요 — cold join 판단은 callWithFallback 내부에서 swap 여부 + roundNumber > 1 + debate으로 결정)
- [ ] 반환 타입에 `modelSwaps: ModelSwap[]` 추가
- [ ] 기존 "partial failure → fewer workers" 로직을 per-worker fallback으로 대체
- [ ] 기존 "total failure → RoundExecutionError" 로직은 모든 워커의 fallback 전부 소진 시에만 발생
- [ ] RoundExecutionError에 `modelSwaps` 필드 추가 (0-response 시 에러에 swap 기록 포함)

#### 5C: deliberate() 변경

- [ ] `modelSwaps: ModelSwap[]` 배열을 deliberate 스코프에서 관리
- [ ] 기존 "total failure → team recomposition" 로직 (242-307행) 제거
- [ ] "proactive worker replacement" (322-352행) 제거
- [ ] `RetryDeps` 대신 `FallbackPool` 수신 → `FallbackDeps` 인터페이스 신규 정의

```typescript
export interface FallbackDeps {
  readonly pool: FallbackPool;
}
```

- [ ] swap 발생 시 `currentTeam.workers` 해당 index 모델 교체
- [ ] ~~replacementWorkers 불필요~~ — cold join은 callWithFallback 내부에서만 발생 (swap 시점 해당 라운드). 다음 라운드부터 교체 워커는 자기 응답을 보유하므로 buildDebateWorkerMessages로 정상 참여
- [ ] 출력에 `modelSwaps` 포함
- [ ] manual mode (`input.models` 지정): fallbackPool 없이 실행. 실패 시 빈 슬롯.

#### 5D: 테스트 (`engine.spec.ts`)

- [ ] 삭제 5개: retry/recomposition 테스트 (336-411행), proactive replacement (729-825행)
- [ ] 수정 3개: partial failure, total failure, failedWorkers 테스트 → fallback 로직 반영
- [ ] 신규 7개:
  - swap 기록 확인 (ModelSwap 필드 검증)
  - fallback 체인 순차 시도 확인 (A→D→E)
  - 풀 소진 시 빈 슬롯 확인
  - debate R2+에서 교체 시 cold join 메시지 사용 확인
  - workerIndex identity 유지 확인
  - httpStatus 포함 확인 (LLMClientError에서 추출)
  - provider 전파: 같은 provider 모델 fallback 건너뛰기 확인
  - 동시 실패 시 FallbackPool 선점: A, B 동시 실패 → D, E 각각 다른 모델 할당 확인
  - fallback 소진 시 ModelSwap.replacement가 undefined 확인
- [ ] test + typecheck 통과 확인

### Step 6: `src/deliberation/wire.ts` — Wiring 업데이트

- [ ] `createDeliberateFn`의 `engineDeps`에 `buildColdJoinMessages` 추가 (import from prompts.ts)
- [ ] `retryDeps` → `FallbackDeps` 변경
  - `FallbackPool` 구현체 생성: Top 5 선정 모델 + cooldown 기반
  - auto mode: `selectDiverseModels`로 5개 선정 → 3개 워커 + pool에 5개 전체 등록
  - manual mode: `FallbackDeps` 전달하지 않음 (fallback 없음)
- [ ] `RetryDeps` import/사용 제거
- [ ] `wire.spec.ts`:
  - engineDeps에 buildColdJoinMessages 포함 확인
  - FallbackPool 구성 확인
  - manual mode에서 fallback 없음 확인
- [ ] test + typecheck 통과 확인

### Step 7: `src/mcp/server.ts` — pyreez_scores configured_only

- [ ] `pyreez_scores` inputSchema에 `configured_only?: boolean` 추가
- [ ] `handleScores`에서 `configured_only: true` → `filteredRegistry` 사용
- [ ] `PyreezMcpServer` 생성자에 `filteredRegistry` 전달 추가 (기존 `registry` 외에 별도 파라미터)
- [ ] 기존 동작 (configured_only 미지정 시 전체 반환) 유지
- [ ] test + typecheck 통과 확인

### Step 8: `src/index.ts` — filteredRegistry 전달

- [ ] `PyreezMcpServer` 생성 시 `filteredRegistry`도 전달
- [ ] test + typecheck 통과 확인

### Step 9: 추가 파일 수정

- [ ] `src/axis/wrappers.ts`: `RetryDeps` → `FallbackDeps`로 변경 (DivergeSynthProtocol의 retryDeps 필드, runDeliberation 시그니처, effectiveRetryDeps 구성 모두 변경)
- [ ] `src/deliberation/store-types.ts`: `DeliberationRecord`에 `modelSwaps?: readonly ModelSwap[]` 추가 (저장용)
- [ ] test + typecheck 통과 확인

## 실행 순서

```
Step 1 (types)
  ↓
Step 2 (wire retry 제거) ──→ Step 3 (cooldown 간소화)
                                       ↓
               Step 4 (cold join prompts) ──→ Step 5 (engine 핵심)
                                                       ↓
                                                Step 6 (wire wiring)
                                                       ↓
                                         Step 7 (server) + Step 8 (index)
                                                       ↓
                                                Step 9 (추가 파일)
```

각 Step 후 `bun test` + `bun run typecheck` 통과 확인.

## 테스트 영향 요약

| 영역 | 삭제 | 수정 | 신규 |
|---|---|---|---|
| wire.spec.ts (retry) | 3 | 0 | 2 |
| cooldown.spec.ts | 8 | 1 | 1 |
| prompts.spec.ts | 0 | 0 | 10 |
| engine.spec.ts | 5 | 3 | 9 |
| **합계** | **16** | **4** | **22** |

## 최종 검증

- [ ] `bun run typecheck` — 전체 타입 검증
- [ ] `bun test` — 전체 테스트 통과
- [ ] 수동 검증: MCP deliberation 호출 시 워커 실패 시뮬레이션 → modelSwaps 출력 확인
- [ ] pyreez_scores configured_only=true → 설정된 provider만 반환 확인
