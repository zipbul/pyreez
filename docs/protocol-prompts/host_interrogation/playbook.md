# host_interrogation

호스트가 워커들에게 격리 상태로 1:1 질문 → 워커 간 영향 없이 독립 답변 수집. 단일 라운드 default. 워커 contamination이 비싼 task용.

---

## When to use
- 동일 질문 N개 워커에 던져 격리 답변 수집 (juror-style)
- 워커가 서로의 답을 보면 결과 왜곡되는 task
- 사실·정의·spec 확인 — "이 spec에서 X가 의미하는 것?"
- 다단계 audit — 같은 워커에 여러 follow-up 질문 (`previousExchanges`)

## When to skip
- 워커끼리 토론·challenge 필요 → `shared_convergence`/`adversarial_debate`
- 점수 산출 → `evaluation_scoring`
- 점진 개선 → `sequential_refinement`
- 보안 공격 → `red_team`

---

## 입력 구조 (다른 프로토콜과 다름)

| 필드 | 역할 |
|---|---|
| `--task` | `<context>` — 질문 배경. 워커가 답할 것 아님 |
| `--questions "Q1,Q2,Q3"` | 실제 답할 질문 list. CSV. 따옴표 escape 주의 |
| `previousExchanges` (API) | 워커별 이전 Q&A. session 연속 시 사용 |

할당은 1:1 round-robin — worker[i]가 questions[i % N] **하나**에만 답한다 (`engine.ts` executeInterrogationRound). 호출 수 = workers. cost ≈ workers × 1.
- workers > questions → 뒤 워커들이 앞 질문을 중복 수신 (같은 질문에 복수 관점).
- questions > workers → 초과 질문은 실행되지 않음 (`questions_dropped` warning 발생). 모든 질문을 물으려면 workers ≥ questions로 맞출 것.

---

## Task·question 작성 룰

자동 주입: depth + DEPTH_EXPLORE + false-premise 거부 + "Answer only what is asked. Do not volunteer unrelated analysis". CONFIDENCE 자동 주입 **없음**.

### 1. context와 question 역할 분리
- `<context>` (task) — 배경·설정·target 텍스트. 답할 것 아님
- `<question>` — 답을 강제. 직접적·구체적

### 2. 단일 답이 가능하도록 좁혀라
"X에 대해 어떻게 생각하나?" → directional, 무한 답 가능. 좁혀:
- "X가 spec Y의 §3을 위반하는가? Yes/No + 근거"
- "X의 single most likely failure mode + 사전 신호"
- "X가 적용 불가능한 첫 번째 조건"

### 3. Confidence 표기 명시 강제
자동 주입 없으므로 question 안에 박는다:
> "답 끝에 confidence를 HIGH/MEDIUM/LOW로 표기하라."

### 4. 출력 형식 강제
- "한 문단 답 + 근거 한 문단"
- "최대 3문장"
- "Yes/No 먼저, 이유 한 문단"

### 5. 자동주입 중복 금지
- "answer directly", "no preamble" — system에 박혀 있음
- "if premise is false, identify it" — 자동 주입
- "do not volunteer unrelated analysis" — 자동 주입

### 6. workerInstructions 미지원
**중요**: `host_interrogation`은 host instructions를 워커에 주입 안 한다 (다른 프로토콜과 다름). 도메인 framing이 필요하면 `<context>` 안에 박는다.

---

## Pre-flight checklist

- [ ] question이 직접적·구체적 (단일 답 가능)?
- [ ] context와 question 분리?
- [ ] confidence 표기 강제 (자동 안 됨)?
- [ ] 출력 형식 verifiable?
- [ ] questions CSV escape 정상?
- [ ] `previousExchanges` 사용 시 workerIndex 매핑 정확?
- [ ] secrets 마스킹?

---

## Examples

### Bad
> task: "PostgreSQL은 어떤가?"
> questions: "어떻게 생각해?"

→ context·question 분리 안 됨, directional, 답 형식 없음.

### Good — 단일 라운드 멀티 질문
```
--task "4인 SaaS MVP, 6개월 출시, 일일 트랜잭션 1만 예상. PostgreSQL 채택 검토 중."
--questions "PostgreSQL의 single most likely failure mode for this profile? End with HIGH/MED/LOW confidence.,JSONB가 spec상 GIN index 없이 nested field query를 효율 처리하나? Yes/No + 근거 한 문단.,팀 SQL 숙련도 zero일 때 6개월 내 critical incident 예상 빈도? 횟수 + 근거."
```

### Good — 세션 연속 (audit chain, API 호출)
```typescript
// Round 1: questions = ["assumption A 맞나?"]
// 워커 응답 저장 → exchanges[0]에 누적

// Round 2: previousExchanges = { 0: [...exchanges[0]] }
//          questions = ["round 1 답이 ABC라 했는데, 시나리오 X에서도 유효한가?"]
```

세션 연속의 핵심: 워커가 자기 이전 답을 보고 도전당하면 단순 재확인 금지(자동 주입) — evidence로 응답.

---

## Models / parameters

### `--models`
- min 1. 격리되므로 동일 provider 여럿이어도 무방하나, 답 다양성 원하면 ≥2 provider
- 워커 수 = `--count` 또는 models 수

### `--max-rounds`
default 1. 다중 라운드 사용 사례 미정형 — 보통 1로 고정하고 `previousExchanges`로 multi-turn 처리.

### `--count`
- 격리 답변 다수 원하면 ≥3. juror-style은 5-7 권장
- 비용 = workers × (rounds=1) — 워커당 질문 1개(1:1 round-robin)

---

## Read output

### convergence judge 의미 약화
`inspect`는 모든 워커 응답에 동일 질문 답한 경우만 의미 있음. `host_interrogation`은 워커별로 동일 질문 N번이므로 inspect 호출 시:
- 같은 question에 대한 워커들 답을 grouping해 비교
- 다른 question 답이 섞이면 convergence 신호 무효

권장: question당 별도 inspect 호출 또는 inspect 건너뛰고 직접 read.

### 합성
- question별로 답 grouping
- 같은 question에 대한 워커 답을 majority/dissent로 정리
- confidence 표기 분포 확인 — 모두 LOW면 question이 답 불가능
- 합성문 생성 시 question별 결론을 분리 명시 ("Q1: …, Q2: …")

---

## Re-run / abort

**Re-run**
- 워커 답이 question 안 읽고 context만 답함 → question 더 직접적으로
- 모두 LOW confidence → question 자체가 답 불가능 또는 context 정보 부족
- 동일 워커가 `previousExchanges`에서 입장 flip → 자동 주입의 "address with evidence, do not simply reaffirm"가 작동 — flip 자체는 정상이나 근거 약하면 재실행

**Abort**
- 다수 워커가 false-premise 신고 → context 또는 question 전제 검토. 거짓 전제 위 합성 금지
- ≥1 provider 미달

---

## Edge cases

| 상황 | 행동 |
|---|---|
| questions CSV escape 깨짐 (콤마·따옴표) | CLI에서는 question 단순화 또는 API 직접 호출 권장 |
| 워커가 question 외 추가 분석 출력 | 자동 주입의 "answer only what is asked"가 약화된 경우 — re-run 또는 instruction 명시 (단 `host_interrogation`은 workerInstructions 미지원이므로 question 안에 박을 것) |
| `previousExchanges` workerIndex가 현재 team과 mismatch (modelSwap 발생) | swap 후 새 워커는 이전 exchange 부재 — 첫 답이 cold-start. 의도치 않은 동작이면 narrower pool로 재실행 |
| 모든 워커 fail | 즉시 보고 (provider outage 또는 question 자체가 모든 모델 reject — 후자면 전제 검토) |
