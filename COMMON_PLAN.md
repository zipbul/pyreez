# COMMON_PLAN: 상호작용 기법 시스템

> 2026-03-26 v7. 구현 정합성 리뷰 반영. 승인 후 구현 시작.
> 연구 자료: `docs/INTERACTION_TECHNIQUE_RESEARCH.md`

## 0. Phase 0 — 전제 검증

구현 전에 핵심 가정을 검증한다: **emphasis instruction이 실제로 LLM 출력을 바꾸는가?**

```
방법: 동일 태스크를 동일 모델에 challenge / probe / propose로 각각 실행
비용: API 호출 5-10회
```

**pass/fail 기준:**

| 측정 | pass | fail 시 |
|------|------|---------|
| 기법 간 출력 차이 | 각 기법 3회 실행. 사람이 출력만 보고 어떤 기법인지 식별 가능 | 구분 불가 쌍을 합침 |
| confidence 마커 출력 | 대부분의 응답에서 마커 감지 | 마커 요청 문구 강화 또는 기능 제거 |
| 수렴 감지 threshold | 실제 debate 실행 후 수렴/미수렴 케이스에서 적정값 결정 | — |

이 검증 없이 구현하면, 전제가 틀렸을 때 전체가 낭비.

## 1. 목적

현재 debate는 "다른 응답 보여주고 알아서 해" 상태. NeurIPS 2025 Spotlight("Debate or Vote")가 이게 martingale임을 증명 — 기법 지정 없이는 품질이 올라가지 않는다.

이번에 구현하는 것:
1. 7개 상호작용 기법 (emphasis) + per-round 지원
2. 반순응 보호 (accept 변형 포함)
3. 신뢰도 + 불확실성 표현 (통합)
4. 수렴 감지 (조기 종료)
5. SKILL.md 전면 개선

공유 방식은 **전체 공유(all) 유지**. 주요 5개 provider (Anthropic, OpenAI, Google, DeepSeek, xAI) 전부 75-90% 프롬프트 캐싱 지원. sparse/digest는 미미한 비용 절감 대비 정보 왜곡 위험이 크므로 도입하지 않음.

종료 조건은 **maxRounds + 수렴 감지**. 반복 알고리즘의 convergence = change < epsilon은 하네스 엔지니어링 표준. 반순응/accept과의 상호작용은 보완 관계 (accept → 수렴 의도 → 감지 종료는 정상, 반순응 → 수렴 저항 → 감지 안 걸림 → 계속도 정상).

## 2. 7개 기법

| 기법 | 정의 | 성격 | 핵심 출처 |
|------|------|------|----------|
| **challenge** | 약점, 빈틈, 반례, 오류를 찾아라 | 파괴적 | SC-MAS 2026, Free-MAD 2025, Prakken why |
| **defend** | 도전에 대해 입장을 방어하고 강화하라 | 방어적 | Lorenzen Defence, Free-MAD retention |
| **accept** | 타당한 점을 수용하고 입장을 수정하라 | 수렴적 | Prakken concede, ReConcile 2024 |
| **probe** | 빈틈, 미검토 가정, 열린 질문을 찾아라 | 탐색적 | Prakken question, AIED 2025 Q |
| **propose** | 새 방향을 제시하라 | 생성-신규 | SIGDIAL 2025 Proposer, DMAD ICLR 2025 |
| **extend** | 기존 아이디어를 심화/확장하라 | 생성-심화 | Guilford Elaboration, Nijstad Persistence pathway, SIGDIAL 2025 Reviser |
| **transform** | 기존 아이디어를 재구성/결합하라 | 생성-변형 | Guilford Flexibility, Nijstad Flexibility pathway, Boden Transformational, SCAMPER combine/adapt |

### 2.1 설계 근거

- **공격+반박을 challenge로 합침**: LLM 실행에서 출력이 거의 동일. 분리 시 구분 붕괴 위험.
- **defend 추가**: accept(양보)과 defend(유지)는 다른 행위.
- **probe 추가**: challenge(파괴적) vs probe(탐색적)는 다른 출력. Science Advances 2025 확인.
- **extend/transform 교차검증**: 창의성 연구 4개 분야에서 독립 연산 확인. LLM 실행에서 미검증 — Phase 0에서 붕괴 확인 시 합침.
- **synthesize 제외**: 10+ 시스템에서 호스트 책임.
- **retract 제외**: LLM에 persistent commitment 없음. accept가 흡수.
- **eliminate/clarify/concede 흡수**: 각각 challenge/probe/accept에 흡수 가능.
- **reframe = transform**: 2소스 교차검증.
- **7개는 인지적 상한선**: Miller 7±2, Cicchetti et al.

### 2.2 기법은 강조(emphasis), 제약(constraint) 아님

**연구 근거 (4소스 교차검증):**
- Acar et al. 2019 (SAGE): 제약-창의성 역U자형.
- CRANE ICML 2025 (arXiv 2502.09061): 구조화 출력 강제 → 추론 10-15% 저하.
- Nemeth 2001 (Wiley): authentic dissent > devil's advocate 역할극.
- DETAIL Matters Dec 2025 (arXiv 2512.02246): 과도한 동사 구체성 → CoT 정확도 하락.

**원칙**: "이것에 집중하되 다른 관찰도 포함하라"(emphasis).

### 2.3 per-round technique

단일 값이면 모든 라운드에 동일 적용. 배열이면 라운드별 적용.

```typescript
technique?: InteractionTechnique | readonly InteractionTechnique[]
// 배열: techniques[roundIndex], 배열 소진 시 마지막 기법 반복
// 단일값: 모든 라운드에 동일
// 빈 배열: technique 없음 (기존 동작)
```

**필요한 이유**: propose(R1) → challenge(R2) → defend(R3) 흐름에서 멀티콜로 하면 세션 연속이 끊김. R3 defend에서 워커가 자기 R1 입장을 모름 — 방어 불가능.

### 2.4 technique injection 위치

**technique instruction은 USER message에 삽입한다. system message가 아님.**

system message는 depth instructions + role만 포함 (라운드/기법 무관 상수). technique + workerInstructions + 다른 워커 응답 + 태스크는 user message에. 이렇게 해야 system prefix가 동일하게 유지되어 프롬프트 캐싱이 보존됨.

현재 코드에서 `buildDebateFollowUp`은 이미 user message에 instructions를 넣음. `buildWorkerMessages`와 `buildDebateWorkerMessages`의 `<host-instructions>`를 system → user로 이동해야 함.

### 2.5 알려진 불확실성

| 불확실성 | 해소 방법 |
|----------|----------|
| extend vs transform이 LLM에서 구분되는 출력을 내는가 | Phase 0. 붕괴 시 합침 |
| technique emphasis의 한계 효용 | A/B 비교 (technique 있음 vs 없음) |
| 각 technique instruction 문구가 최적인가 | 반복 개선 |

## 3. 반순응 보호 (Anti-Conformity)

다른 워커 응답이 공유되는 모든 라운드에 적용. **단, accept 기법일 때는 변형 적용.**

**기본 (challenge/defend/probe/propose/extend/transform):**
```
Carefully assess the discrepancies between your analysis and others'.
Change your position only if there is clear evidence that your own analysis is incorrect,
not to reach consensus. You may not rely on the principle of conformity.
```

**accept 변형:**
```
Seek valid points to incorporate. Confirm agreement with independent reasoning —
state what specific evidence or logic led you to the same conclusion.
Change your position where evidence is stronger. Maintain where yours holds.
```

accept에서 기본 반순응을 쓰면 논리적 모순 ("입장 바꾸지 마" + "타당한 점 수용하고 입장 수정"). accept 변형은 독립적 추론으로 합의를 확인하도록 유도하여 순응 없는 수렴을 가능하게 함.

근거: Free-MAD 2025, Talk Isn't Always Cheap ICML 2025, Sparse 2024 (3소스 교차검증). accept 변형은 워커 리뷰에서 발견된 모순 해소.

## 4. 신뢰도 + 불확실성 (통합)

모든 워커 프롬프트에 적용:

```
For each major claim, indicate your confidence:
- HIGH: strong evidence or direct expertise
- MEDIUM: reasonable inference but limited evidence
- LOW: speculative or uncertain
Do not force confidence — if genuinely uncertain, say so.
```

근거: AceMAD Mar 2026, Demystifying MAD Jan 2026, Productive Discussion Moves Jan 2026, Mercer exploratory talk.

### 4.1 파싱 전략

**명시적 마커만 파싱. 추론하지 않음.**

```
1차: 정규식으로 "HIGH confidence", "HIGH:", "confidence: HIGH" 등 명시적 마커 탐지
2차: 못 찾으면 undefined 반환
```

헤징 언어 밀도로 추론하지 않는 이유: 모델별 체계적 편향 (Claude는 GPT보다 더 헤지).

**파싱 실패(undefined)는 정상.** 신호 없음을 의미. downstream에서 null로 처리. 기본값 가정 없음.

### 4.2 신뢰도 소비자

confidence의 소비자는 **호스트**이다. 엔진 내 자동 소비 없음 (의도적).

- **호스트 synthesis**: deliberate 출력의 각 response에 `confidence` 필드 포함. 호스트가 가중치로 활용.
- **사용자 투명성**: 사용자가 어떤 주장이 확신 있고 어떤 것이 추측인지 확인 가능.
- **엔진 미사용**: confidence가 공유/종료/선별 등 엔진 로직에 영향을 주지 않음.

### 4.3 한계

- 워커의 자기 보고 신뢰도가 calibrated되지 않을 수 있음
- RLHF 훈련이 자신 있는 표현을 유도 — LOW 빈도가 매우 낮을 수 있음 (3단계 → 실질 2단계)
- 신뢰도 보정(calibration)이 아닌 신뢰도 신호(signal)

## 5. 수렴 감지 (조기 종료)

**하네스 엔지니어링 표준**: 반복 알고리즘에서 convergence = change < epsilon.

```
방법: 각 워커의 R(N) 전체 텍스트 vs R(N-1) 전체 텍스트
메트릭: 문자 수준 편집 거리 / max(len1, len2)
수렴: 전 워커의 변화율 < threshold
threshold: configurable. Phase 0에서 실제 debate 실행 후 적정값 결정.
```

2000자 텍스트 편집 거리 = O(n²) ≈ 4M 연산. 워커 5명 = 20M. 밀리초 단위. 성능 문제 없음.

**"첫 N자" 비교를 하지 않는 이유**: 모델마다 응답 시작이 다름 (meta-statement, markdown header 등). 전체 텍스트 비교가 model-agnostic.

**상호작용 (보완 관계):**
- accept + 수렴: accept으로 수렴 의도 → 수렴 감지 발동 → 종료. **의도된 동작.**
- 반순응 + 수렴: 반순응이 수렴 저항 → 감지 안 걸림 → 계속. **의도된 동작.**

## 6. 기능 상호작용

| 조합 | 동작 |
|------|------|
| **accept + 반순응** | 반순응 → accept 변형으로 교체 (Section 3) |
| **per-round technique + 세션 연속** | R(N) technique instruction만 활성. 이전 라운드 technique은 세션 히스토리에 자연 포함되나 추가 삽입하지 않음 |
| **transform + 범위** | transform instruction에 "within the scope of the original question" 포함하여 주제 탈선 방지 |
| **technique + 캐싱** | technique은 user message에 삽입 (Section 2.4). system prefix 불변 → 캐시 보존 |
| **per-round technique 배열 + 수렴 감지** | per-round technique 배열이 지정된 경우 수렴 감지 비활성. 호스트가 의도적으로 설계한 시퀀스(예: propose→accept→challenge)에서 중간 수렴이 후속 라운드를 건너뛰는 것을 방지. 단일값 또는 미지정 시 수렴 감지 정상 작동 |

## 7. 구현 단계

### 7.1 types.ts

```typescript
export type InteractionTechnique =
  | "challenge" | "defend" | "accept" | "probe"
  | "propose" | "extend" | "transform";
```

`DeliberateInput`에 추가:
- `technique?: InteractionTechnique | readonly InteractionTechnique[]`

`WorkerResponse`에 추가:
- `confidence?: "high" | "medium" | "low"`

`DeliberateOutput` rounds의 각 response 타입 변경:
```typescript
readonly rounds?: readonly {
  number: number;
  responses?: readonly { model: string; content: string; confidence?: "high" | "medium" | "low" }[];
  failedWorkers?: readonly FailedWorker[];
}[];
```

### 7.2 prompts.ts

| 추가 항목 | 적용 범위 |
|-----------|----------|
| `TECHNIQUE_INSTRUCTIONS` (7개 emphasis) | technique 지정 시, **USER message에** |
| `ANTI_CONFORMITY` (기본) | 다른 워커 응답 공유 시 항상 (accept 제외) |
| `ANTI_CONFORMITY_ACCEPT` (accept 변형) | technique=accept 시 |
| `CONFIDENCE_AND_UNCERTAINTY` | 모든 워커 프롬프트에 항상 |
| `<host-instructions>` 위치 이동 | system → user message |

기법별 emphasis instruction:

```typescript
const TECHNIQUE_INSTRUCTIONS: Record<InteractionTechnique, string> = {
  challenge: "Focus on identifying weaknesses, counter-examples, and errors in these positions. Present specific evidence for each flaw. Include other relevant observations as they arise.",
  defend: "Focus on defending your position against challenges raised. Strengthen your argument with additional evidence and address objections. Note where challenges have merit.",
  accept: "Focus on identifying valid points from other positions. Modify your position where others present stronger evidence. State what changed and why.",
  probe: "Focus on identifying unexamined assumptions, blind spots, and open questions. What hasn't been considered? What conditions haven't been tested? Note strong points as well.",
  propose: "Focus on offering a new approach that differs from existing positions. Ground your proposal in specific evidence or reasoning. Acknowledge what existing approaches get right.",
  extend: "Focus on building on the strongest ideas presented. Add depth, detail, or specificity. What concrete next steps or implications follow?",
  transform: "Focus on reshaping or combining existing ideas into a different framing, within the scope of the original question. What happens if we change the constraints, combine approaches, or shift the perspective?",
};
```

### 7.3 engine.ts

| 변경 | 내용 |
|------|------|
| per-round technique | `techniques[roundIndex]` 인덱싱. 배열 소진 시 마지막 기법 반복. 빈 배열 → technique 없음 |
| technique 전달 | 해당 라운드의 technique을 prompt builder에 전달 |
| confidence 파싱 | 워커 응답에서 명시적 마커만 추출. 못 찾으면 undefined |
| 수렴 감지 | 라운드 종료 후 각 워커의 현재/이전 응답 전체 텍스트 편집 거리 비교. 전 워커 변화율 < threshold면 조기 종료. **per-round technique 배열 지정 시 비활성** |
| 편집 거리 구현 | Levenshtein distance 직접 구현 (외부 패키지 없음, Bun-first) |

`EngineDeps` 시그니처 변경 — 각 빌더에 technique 파라미터 추가:

```typescript
readonly buildWorkerMessages: (
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
  workerIndex?: number,
  technique?: InteractionTechnique,
) => ChatMessage[];
readonly buildDebateWorkerMessages?: (
  ctx: SharedContext,
  instructions?: string,
  roundInfo?: RoundInfo,
  workerIndex?: number,
  technique?: InteractionTechnique,
) => ChatMessage[];
readonly buildDebateFollowUp?: (
  ctx: SharedContext,
  otherResponses: readonly WorkerResponse[],
  roundInfo?: RoundInfo,
  instructions?: string,
  technique?: InteractionTechnique,
) => ChatMessage;
```

### 7.4 server.ts

`pyreez_deliberate` input에 추가:

```typescript
technique: z
  .union([
    z.enum(["challenge", "defend", "accept", "probe", "propose", "extend", "transform"]),
    z.array(z.enum(["challenge", "defend", "accept", "probe", "propose", "extend", "transform"])),
  ])
  .optional()
  .describe("Interaction technique. Single value for all rounds, or array for per-round. Emphasis, not constraint."),
```

`pyreez_deliberate` output: 각 response에 `confidence` 포함.

### 7.5 SKILL.md

전면 개선. STATUS 항목 A~H 해소 + technique 선택 가이드:

```
**technique selection**: Choose based on what output you need.
Technique is emphasis, not constraint — workers may include other observations.

- challenge: 리뷰, 검증, 문제점 찾기, 왜곡 확인
- defend: 도전 후 입장 강화, 반론에 대한 응답
- accept: 수렴이 필요할 때, 합의 도출
- probe: 누락 찾기, 미검토 가정 발견, 탐색
- propose: 새 아이디어, 대안, 가설
- extend: 기존 아이디어 구체화, 심화, 다음 단계
- transform: 프레이밍 전환, 접근 결합, 관점 변경

Per-round: technique: ["propose", "challenge", "defend"]
Single: technique: "challenge"
Omit: free response (기존 동작)
```

## 8. 테스트 계획

### 8.1 prompts.spec.ts

| 테스트 | 검증 |
|--------|------|
| 각 기법별 instruction 삽입 | 7개 기법 × 3개 빌더, **user message에 위치** |
| host-instructions 위치 | system이 아닌 user message |
| 반순응 기본 삽입 | 공유 라운드 + accept 아닌 기법에서 |
| 반순응 accept 변형 | technique=accept 시 변형 문구 |
| 신뢰도+불확실성 삽입 | 모든 빌더에서 항상 |
| technique + workerInstructions 결합 | 양쪽 다 포함 |
| technique 없을 때 기존 동작 | technique instruction 미삽입 |
| transform 범위 제한 | "within the scope" 포함 확인 |

### 8.2 engine.spec.ts

| 테스트 | 검증 |
|--------|------|
| per-round technique 단일값 | 모든 라운드에 동일 technique |
| per-round technique 배열 | 라운드별 다른 technique |
| per-round technique 배열 소진 | 마지막 기법 반복 |
| per-round technique 빈 배열 | technique 없음 (기존 동작) |
| confidence 파싱 — 명시적 마커 | HIGH/MEDIUM/LOW 추출 |
| confidence 파싱 — 마커 없음 | undefined 반환 |
| 수렴 감지 — 수렴 시 | 조기 종료 |
| 수렴 감지 — 미수렴 시 | maxRounds까지 계속 |
| 수렴 감지 — per-round 배열 시 | 수렴해도 조기 종료 안 함 |
| 기존 테스트 | 깨지지 않음 |

### 8.3 server.spec.ts

| 테스트 | 검증 |
|--------|------|
| technique 단일값 유효/무효 | 7개 수용, 무효값 거부 |
| technique 배열 유효/무효 | 유효 배열 수용, 무효 요소 거부 |
| confidence 출력 | output에 포함 |

### 8.4 server-integration.spec.ts

| 테스트 | 검증 |
|--------|------|
| technique + debate | 기법 instruction + anti-conformity + confidence/uncertainty (user message에) |
| per-round technique + debate | 라운드별 다른 instruction |
| technique=accept + debate | accept 변형 반순응 |

### 8.5 핵심 상호작용 테스트

| 조합 | 검증 |
|------|------|
| accept + 반순응 | accept 변형 문구 삽입, 기본 반순응 미삽입 |
| per-round [propose, challenge, defend] | R1 propose, R2 challenge + 반순응, R3 defend + 반순응 |
| transform + 범위 | "within the scope" 포함 |
| technique + system prompt | system message에 technique 미포함 확인 |
| per-round 배열 + 수렴 감지 | 수렴 조건 충족해도 시퀀스 완주 |

## 9. STATUS 항목 해소 매핑

| STATUS 항목 | 해소 방법 |
|-------------|----------|
| A~H | SKILL.md 전면 개선 |
| I. 반순응 보호 | prompts.ts — 항상 삽입 (accept 변형 포함) |

## 10. 영향 범위

| 파일 | 변경 유형 |
|------|----------|
| `src/deliberation/types.ts` | 타입 추가 (InteractionTechnique, confidence) |
| `src/deliberation/prompts.ts` | 기법 instruction (user message) + 반순응 (기본/accept 변형) + 신뢰도/불확실성 + host-instructions 위치 이동 |
| `src/deliberation/engine.ts` | per-round technique + confidence 파싱 + 수렴 감지 |
| `src/mcp/server.ts` | technique (배열 지원) + confidence 출력 |
| `.claude/skills/pyreez/SKILL.md` | 전면 개선 |
| `src/deliberation/prompts.spec.ts` | 기법 + 반순응 변형 + 위치 테스트 |
| `src/deliberation/engine.spec.ts` | per-round technique + confidence + 수렴 감지 테스트 |
| `src/mcp/server.spec.ts` | 파라미터 테스트 |
| `src/mcp/server-integration.spec.ts` | 통합 + 상호작용 테스트 |

## 11. 하지 않는 것

- **sparse/digest 공유 모드**: 주요 provider 전부 75-90% 캐싱. 정보 왜곡 위험. 전체 공유 유지.
- **함수 리네이밍** (buildDebateWorkerMessages 등): 후속.
- **per-worker technique**: 후속.
- **의미적 다양성 기반 선별**: 임베딩 없이 신뢰 불가.
- **워커 tool access**: STATUS 항목 L.
- **토폴로지 최적화**: STATUS 항목 O.
- **Brier score 기반 신뢰도 보정**: 정답 태스크에서만 가능.
- **비대칭 가중치**: 신뢰도 데이터 축적 후.
- **기법 sub-type 분기**: PROCESS 처방.
- **기법별 프레이밍 동사 변경**: instruction 위에 추가 효과 미검증.

## 12. 제한사항

| 제한사항 | 근거 |
|----------|------|
| emphasis의 행동 변화 효과가 엄격하게 검증 불가 | 모든 출력이 어떤 기법과도 호환 (unfalsifiable). Science Advances 2025가 프레이밍 효과 확인하지만 strict compliance 측정 불가 |
| confidence 3단계가 실질적으로 2단계일 수 있음 | RLHF가 자신 있는 표현 유도. LOW 빈도 매우 낮을 것으로 예상 |
| 멀티라운드에서 세션 자기일관성 편향 | 워커가 자기 R1 입장에 앵커링. 라운드가 늘어도 다양성 제한적 증가 |
| martingale을 완전히 깨지 못함 | 반순응 + 신뢰도 신호는 필요 조건이지 충분 조건 아님 (AceMAD Mar 2026) |
| 멀티라운드 기법 전환 시 페르소나 비일관성 | R1 challenge → R2 accept면 자기 공격적 R1이 세션에 남아 confused hedging 위험. Phase 0 검증 대상 |

## 13. 구현 순서

```
Phase 0: 전제 검증 (API 5-10회)
  - emphasis instruction이 출력을 바꾸는가? (70%+ 구분)
  - confidence 마커를 출력하는가? (75%+ 출력)
  - fail 시: 구분 불가 기법 합침 / confidence 제거

Phase 1: 타입 기반
  1. types.ts — InteractionTechnique, confidence, DeliberateInput 확장

Phase 2: 프롬프트
  2. prompts.ts — TECHNIQUE_INSTRUCTIONS + ANTI_CONFORMITY (기본/accept 변형) + CONFIDENCE_AND_UNCERTAINTY
  3. prompts.ts — host-instructions를 system → user message로 이동
  4. prompts.spec.ts — RED → GREEN

Phase 3: 엔진
  5. engine.ts — per-round technique 전달 + confidence 파싱 + 수렴 감지
  6. engine.spec.ts — RED → GREEN

Phase 4: 외부 인터페이스
  7. server.ts — technique (배열 지원) + confidence 출력
  8. server.spec.ts + server-integration.spec.ts — RED → GREEN

Phase 5: 호스트 가이드
  9. SKILL.md — 전면 개선

Phase 6: 검증
  10. Verify: 전체 테스트 + typecheck
  11. Validate: 각 설계 결정을 코드에서 확인
```
