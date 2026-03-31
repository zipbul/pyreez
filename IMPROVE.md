# Deliberation 품질 개선

## 설계 확정 vs 실험 필요 구분

이 문서의 제안은 두 범주로 나뉜다:
- **확정**: 현재 아키텍처에서 부작용 없이 적용 가능. 즉시 구현.
- **실험 필요**: 효과가 이론적으로 타당하나, 모델별 동작 차이/상호작용으로 인해 A/B 테스트 후 확정.

---

## 확정 항목

### 1. Position Shuffling — 순서 편향 제거

#### 문제

`buildDebateWorkerMessages()` 253행: 모든 worker가 타인 포지션을 동일한 순서로 본다. 첫 포지션에 primacy bias, 마지막에 recency bias가 걸린다. 4명 중 worker 0의 포지션이 항상 먼저 오면 나머지 3명이 worker 0에 편향된다.

#### 해결

Fisher-Yates shuffle을 workerIndex + roundNumber seed로 적용. `buildDebateWorkerMessages()`와 `buildDebateFollowUp()` 두 경로 모두에 적용.

```typescript
const others = shuffle(
  lastRound.responses.filter(r => r.workerIndex !== workerIndex),
  workerIndex + roundNumber
).map(r => `One analyst argues:\n${escapeXmlContent(r.content)}`).join("\n\n");
```

비용 0. 부작용 없음. prompt caching, session continuation 영향 없음.

### 2. Anti-Conformity 테크닉별 분기

#### 문제

237행: `technique === "accept"` 분기만 존재. challenge/defend/probe/extend/transform 전부 동일한 `ANTI_CONFORMITY` 적용.

- challenge에서 "입장을 바꾸지 마라"가 방어 자세를 유도하여 진정한 비판을 방해
- extend/transform에서 "입장 유지"가 통합/변형이라는 테크닉 목적과 모순

#### 해결

```typescript
const ANTI_CONFORMITY_BY_TECHNIQUE: Partial<Record<InteractionTechnique, string>> = {
  challenge: `상대의 가장 강한 논점을 구체적으로 인정하라. 그 위에서 남은 약점을 지적하라.
자기 입장에서 포기할 부분을 명시하라.`,
  defend: ANTI_CONFORMITY, // 기존 유지
  accept: ANTI_CONFORMITY_ACCEPT, // 기존 유지
  probe: `모든 입장의 공유 전제를 의심하라. 입장 유지/변경은 이 라운드의 목적이 아니다.`,
  extend: `기존 아이디어의 강점을 보존하면서 깊이를 더하라. 방향 전환이 아니라 확장이다.`,
  transform: `기존 접근들을 결합하거나 재구성하라. 원래 질문의 범위를 벗어나지 마라.`,
};
```

기존 `accept` 분기 패턴 확장. prompt caching 영향 없음 (user message 내 변경). `buildDebateFollowUp()` 322행에도 동일 패턴 적용.

### 3. Cold Join Transcript에 테크닉 라벨 포함

#### 문제

`buildDebateWorkerMessages()` 264-274행: cold join worker가 full transcript를 받지만, 각 라운드가 어떤 테크닉이었는지 정보가 없다. 테크닉 시퀀스가 강화될수록 맥락 손실이 커진다.

#### 해결

Round 타입에 technique을 기록하고, cold join transcript에 라벨 포함:

```
### Round 1 (propose)
One analyst argues: ...

### Round 2 (challenge)
One analyst argues: ...
```

`Round` 타입에 `technique?: InteractionTechnique` 필드 추가. `executeRound()` 결과에 기록.

### 4. Acceptance의 originalPosition을 최종 라운드 기준으로 변경

#### 문제

`buildAcceptanceMessages()` 368행: `originalPosition`이 R1 응답이면, challenge에서 concession 후 달라진 최종 입장과 synthesis의 비교가 R1 기준으로 되어 misrepresented 판정이 부풀려진다.

#### 해결

acceptance 호출 시 `originalPosition`을 해당 worker의 최종 라운드 응답으로 전달. 엔진이 아닌 호출자(wire layer) 수준의 변경.

### 5. workerInstructions 배열 확장 — R1 다양성 포함

#### 문제

`DeliberateInput.workerInstructions`가 단일 string. 모든 worker가 동일한 instruction을 받는다. R1에서 이종 모델만으로 다양성이 부족할 때 구조적 다양성 수단이 없다.

Jekyll & Hyde (ICLR 2025)가 부정한 건 identity 부여("당신은 보수적 분석가")이지, 분석 축 제한("경제적 관점에서만 분석하라")이 아니다. Constraint injection은 scope restriction이므로 해당 연구의 부정적 결과와 다른 메커니즘.

#### 해결

```typescript
// types.ts
readonly workerInstructions?: string | readonly string[];

// callWithFallback() 내
const workerInstruction = Array.isArray(input.workerInstructions)
  ? input.workerInstructions[workerIndex % input.workerInstructions.length]
  : input.workerInstructions;
```

R1의 `buildWorkerMessages()`와 R2+의 debate builder 모두에 적용. 단일 string이면 기존 동작 유지 (하위 호환).

### 6. buildDebateFollowUp 반환 타입 변경

#### 문제

현재 `buildDebateFollowUp()`은 `ChatMessage`(단수)를 반환. prefilling(실험 항목 1) 적용 시 user message + assistant message 2개를 반환해야 한다. `EngineDeps` 인터페이스 변경 필요.

#### 해결

```typescript
// 현재
readonly buildDebateFollowUp?: (...) => ChatMessage;

// 변경
readonly buildDebateFollowUp?: (...) => ChatMessage | ChatMessage[];
```

`callWithFallback()` 407-416행에서 반환값을 배열로 정규화:

```typescript
const followUp = deps.buildDebateFollowUp(...);
const followUpMessages = Array.isArray(followUp) ? followUp : [followUp];
return [...activeHistory, ...followUpMessages];
```

단수 반환 시 기존 동작 유지. prefilling 미적용 상태에서도 안전.

---

## 실험 필요 항목

### 7. 테크닉별 Assistant Prefilling

#### 가설

instruction("~하라")은 모델이 무시할 수 있고, anti-conformity나 steelman과 충돌 시 더 강한 쪽을 따른다. prefilling은 출력의 시작점을 물리적으로 고정하므로 충돌 자체가 불가능하다.

이것이 작동하면 IMPROVE.md 원본의 #1(구조 미변경), #2(steelman 충돌), #3(concession 미유도)가 instruction 수정 없이 한번에 풀린다.

#### 설계

prefill을 헤딩(`## 약점 분석`)이 아닌 문장 시작으로 — 설계 원칙 "Structured output forced on reasoning hurts 10-15%"와의 충돌을 최소화:

```
challenge:  "상대 입장 중 가장 위협적인 논점은"
defend:     "내 입장에 대한 가장 강한 반론을 재구성하면"
accept:     "내 입장에서 변경하는 부분과 그 근거는"
probe:      "모든 입장이 공유하는 검증되지 않은 전제는"
propose:    (prefill 없음 — R1 자유 탐색)
extend:     "기존 아이디어 중 가장 확장 가치가 높은 것은"
transform:  "기존 접근들을 재구성하면"
```

#### 실험해야 할 것

1. **provider 호환성**: Anthropic(네이티브 지원), OpenAI(지원), Google Gemini(동작 차이 가능), xAI(OpenAI 호환). 미지원 provider fallback: prefill 텍스트를 user message 끝에 "다음 문장으로 시작하라:" 형태로 삽입
2. **system prompt "lead with your position"과의 충돌**: challenge prefill은 자기 포지션이 아니라 상대 분석으로 시작. 모델에 따라 system prompt을 우선할 수 있음
3. **사고 제약 vs 행동 유도**: 문장 시작 형태의 prefill이 사고 공간을 제약하는지, 헤딩 형태와 차이가 있는지
4. **Structured decomposition 결합**: challenge에서 Phase 1(상대 약점) → Phase 2(자기 입장 수정)을 한 턴 안에서 유도할 때, Phase 2의 실행률

#### Fallback

prefilling이 특정 provider에서 작동하지 않거나 품질을 떨어뜨리면, 해당 provider에서만 비활성화하고 확정 항목(anti-conformity 분기, position shuffling)으로 커버.

### 8. R1 Pre-commitment → R2 Exploitation

#### 가설

R1에서 "이 조건이 충족되면 내 입장을 바꾸겠다"를 선언하게 하면:
- R1 다양성 증가 (각 worker가 자기 입장의 약점을 명시적으로 인식)
- R2에서 자기 선언을 근거로 concession 유도 가능 (sycophancy가 아니라 자기 일관성으로 작동)
- anti-conformity("입장을 바꾸지 마라")와 "자기가 선언한 조건 충족" 사이에서 후자가 이김

#### 설계

R1 prefill (prefilling 실험과 결합):
```
"내 입장은 다음과 같다. 단, 다음 조건이 충족되면 입장을 변경하겠다:"
```

R2+ 컨텍스트에 자기 pre-commitment 추가:
```
## Your Stated Conditions for Position Change
당신은 이전 라운드에서 다음 조건이면 입장을 바꾸겠다고 선언했습니다:
{파싱된 pre-commitment}

## Other Positions
...
```

`WorkerResponse`에서 pre-commitment 파싱: `parseConfidence()`와 동일한 패턴으로 `parsePreCommitment()` 추가.

#### 실험해야 할 것

1. **파싱 신뢰도**: 모델마다 pre-commitment 형식이 다름. 파싱 실패율 측정
2. **R3+ 처리**: pre-commitment가 R1에만 해당하는지, 매 라운드 갱신해야 하는지
3. **토큰 비용**: pre-commitment 텍스트가 모든 후속 라운드 컨텍스트에 추가됨

#### Fallback

파싱 실패 시 graceful degradation — pre-commitment 컨텍스트 없이 기존 debate 방식으로 진행. 파싱 성공률이 일정 기준(예: 70%) 미만이면 이 기법 자체를 비활성화.

---

## 측정 프레임워크

위 변경들의 효과를 검증하려면 baseline 측정이 선행되어야 한다.

### 메트릭

| 메트릭 | 측정 방법 | 대상 변경 |
|--------|----------|----------|
| concession rate | challenge 라운드 후 자기 입장 수정 비율. "변경", "수정", "포기", "인정" 등 마커 파싱 | #2 anti-conformity, #7 prefilling |
| position drift | 라운드 간 응답의 Levenshtein 변화율 (기존 convergence detection 활용) | #7 prefilling, #8 pre-commitment |
| R1 diversity | R1 응답들 간 pairwise Levenshtein 거리 평균 | #5 workerInstructions 배열, #8 pre-commitment |
| pre-commitment 이행률 | R1 선언 조건이 R2에서 충족되었을 때 실제 입장 변경 비율 | #8 pre-commitment |
| order bias | position shuffling 전후의 첫 번째 포지션 동조율 비교 | #1 position shuffling |

### 측정 순서

1. 현재 시스템으로 baseline 수집 (확정 항목 적용 전)
2. 확정 항목(#1-#6) 적용 후 재측정
3. 실험 항목(#7, #8) 개별 적용 후 단일 변수 측정
4. semantic position drift는 측정 프레임워크 안정 후 embedding 기반으로 확장

---

## 폐기한 접근

### extractDebateDigest() 활용한 포지션 가공

challenge에서 전문 대신 요약을 전달하는 방안. 폐기 이유: `extractDebateDigest()`가 마지막 줄 또는 첫 3줄을 가져오는 휴리스틱 — 핵심을 놓치면 허수아비 논증이 된다. LLM 호출로 요약하면 비용 증가 + 요약 품질 문제. 전문 공유를 유지하되 prefilling과 anti-conformity 분기로 행동을 제어하는 것이 낫다.

### steelman-solitaire user message override

challenge technique instruction에 "steelman-solitaire를 생략하라"를 추가하는 방안. 폐기 이유: prefilling이 이를 대체. assistant prefill이 출력 흐름을 먼저 잡으므로 system prompt의 steelman이 물리적으로 뒤로 밀린다. prefilling이 실험에서 실패할 경우에만 이 방안으로 fallback.

### temperature 분기

worker별 다른 temperature 적용. 폐기 이유: temperature를 올리면 다양성은 늘지만 hallucination이 증가. frontier 모델의 reasoning 성능은 low temperature에 최적화. 분석/비평 태스크에서 부적합. constraint injection(workerInstructions 배열)이 품질 손실 없이 다양성을 확보하는 더 나은 수단.

### challenge를 2라운드로 분리

challenge를 "약점 지적 → concession"으로 2단계 분리. 폐기 이유: 라운드 수 2배 → 비용/레이턴시 2배. prefilling의 structured decomposition으로 한 턴 안에서 동일한 효과를 달성 가능.
