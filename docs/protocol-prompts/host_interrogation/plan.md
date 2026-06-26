# host_interrogation 정밀화 계획

Codex(GPT-5.4) + Claude(Opus 4.7) 이원 리뷰.

---

## High

### H1. `workerInstructions` 타입 계약 정리
- **위치**: `prompts.ts:415-419` builder, `engine.ts:741-745` 호출
- **문제**: `DeliberateInput`이 `workerInstructions` 허용, handler가 전달, CLI가 받음. 그러나 host_interrogation builder가 받지 않아 **silent drop**. 사용자는 도메인 framing이 적용된다고 가정 가능 → 디버깅 어려움
- **선택**: 두 옵션 중 (a) 권장
  - (a) **builder에 workerInstructions 추가** — `<instructions>${escapeXmlContent(workerInstructions)}</instructions>` 삽입. 다른 protocol과 통일성
  - (b) **handler에서 거부 warning** — protocol이 host_interrogation이고 worker_instructions가 있으면 에러
- **변경 (a 적용)**:
  ```ts
  export function buildHostInterrogationMessages(
    task: string, question: string,
    previousExchanges?: readonly InterrogationExchange[],
    workerInstructions?: string,
  ): ChatMessage[] { ... }
  ```
  user message에 `<host-instructions>` 추가
- **출처**: Codex#2
- **비용**: signature 1, engine 1, prompt 1. 호환성 영향

### H2. Round-robin question silent loss
- **위치**: `engine.ts:736-738`
- **문제**: `questions[index % questions.length]`. workers=3, questions=5면 Q4·Q5 **실행 안 됨**. playbook은 cost = workers × questions로 잘못 명시
- **선택**:
  - (a) **nested loop** — 모든 (worker, question) 쌍 호출. cost = workers × questions
  - (b) **validation** — `questions.length > workers.length` 시 handler에서 에러
- **권고**: (a). juror-style의 본 의도는 N 워커 × Q 질문이지 워커 1개당 1 질문이 아님. 단 cost·도구 호환성 큰 변경
- **변경 (a)**: `executeInterrogationRound`에서 outer loop questions, inner loop workers. response metadata에 `questionIndex` 추가. types에 `WorkerResponse.questionIndex?: number` 추가
- **출처**: Codex#7
- **비용**: engine + types + response shape 변경. spec.ts·acceptance·합성 모두 영향. **큰 변경**

### H3. previousExchanges 안전성 (model swap 대응)
- **위치**: `engine.ts:737-740`, `types.ts:160-163`
- **문제**: previousExchanges는 workerIndex로만 키. fallback으로 모델 swap 발생 시 new 모델이 old 워커 exchange 받음. session continuity 가정 위배
- **변경**: `InterrogationExchange`에 `model?: string` 추가. `engine.ts:737-740`에서 current participant model과 matching exchange만 전달. 미스매치 시 cold-start (빈 exchanges)
- **출처**: Codex#6
- **비용**: types + engine. backward compat 가능 (model optional)

---

## Medium

### M1. previousExchanges self-anchor metacognitive prefix
- **위치**: `prompts.ts:422-426`
- **문제**: `<your-answer>${ex.answer}</your-answer>` 1인칭 노출 → self-anchor
- **변경**:
  ```
  <previous-exchange>
  These are your prior answers — treat them as evidence to re-evaluate, not commitments. New evidence may change them.
  <question>...</question>
  <your-answer>...</your-answer>
  </previous-exchange>
  ```
- **출처**: 내#1 (shared_convergence M3와 동일 패턴)
- **비용**: 1줄 prefix

### M2. CONFIDENCE_AND_UNCERTAINTY 자동 주입
- **위치**: `prompts.ts:402-405` system
- **문제**: parser는 모든 응답 confidence 파싱 시도. host_interrogation에서 prompt 자동 주입 없음 → 워커가 표기 안 함 → `confidence: undefined` 빈번. host downstream 활용 불가
- **변경**: `buildSystemPrompt`에 CONFIDENCE 추가 또는 constraints에 `End with "confidence: HIGH|MEDIUM|LOW".` 한 줄
- **출처**: Codex#3
- **비용**: system 5줄 또는 constraint 1줄

### M3. "Answer only" ↔ premise rejection 충돌 해소
- **위치**: `prompts.ts:407-410`
- **문제**: "Answer only what is asked" + "If premise false, identify before answering" — 워커가 거부 시 scope 위반 해석 가능
- **변경**: 순서 + 명시
  ```
  Priority order:
  1. If the question contains a false premise, identify it and stop. Premise rejection takes precedence over scope discipline.
  2. Otherwise, answer only what is asked. Do not volunteer unrelated analysis.
  ```
- **출처**: 내#2
- **비용**: 4줄 교체

### M4. False-premise machine-readable format
- **위치**: `prompts.ts:407-410`
- **문제**: 거부 텍스트에 양식 없음 → host가 정상 응답과 구분 못 함. playbook은 사람이 읽는 절차로 둠
- **변경**: 출력 contract 추가
  ```
  If rejecting a false premise: start your response with `<premise-status>false</premise-status>\n<false-premise>...evidence...</false-premise>`.
  Otherwise: start with `<premise-status>valid</premise-status>`.
  ```
- **출처**: Codex#4
- **비용**: 2-3줄 + host downstream 파싱 추가 가능

### M5. N 비공개 → reasoning depth anchor
- **위치**: `prompts.ts:402-403` system 또는 user message 상단
- **문제**: 워커가 자기가 N명 중 1명인지 모름 → single-shot Q&A 수준 reasoning
- **변경**: system에 1줄 추가
  ```
  Other analysts will independently answer the same question. Reason as a sole expert producing your best answer — do not assume or simulate consensus.
  ```
- **출처**: 내#3
- **비용**: 1줄

### M6. Multi-round 동작 정의
- **위치**: `engine.ts:1168-1169`, `engine.ts:731-739`
- **문제**: `maxRounds > 1`에서 같은 questions 재실행. previousExchanges 누적 X. progressive 의도 불분명
- **선택**:
  - (a) maxRounds > 1 시 handler 에러 (host_interrogation = single round)
  - (b) progressive — 직전 round 응답을 previousExchanges로 자동 누적
- **권고**: (a). multi-round host_interrogation 사용 사례 미정형. progressive는 별도 API 설계 필요
- **출처**: Codex#9
- **비용**: handler validation 1개

---

## Low

### L1. `question` vs `context` 강제력
- **위치**: `prompts.ts:407-410` constraints
- **변경**: "Treat `<context>` as background only; answer the `<question>`, not the context." 한 줄 추가
- **출처**: Codex#5
- **비용**: 1줄

### L2. DEPTH_EXPLORE 의문
- **위치**: `prompts.ts:402-405`
- **문제**: single-shot Q&A에 "consider multiple approaches" → verbose 응답 유도 가능
- **변경**: 측정 후 결정. host_interrogation 전용 `DEPTH_INTERROGATE` ("Answer directly with the strongest reasoning chain. State what evidence would change your answer.") 후보. bench 가능
- **출처**: 내#4, Codex#10 (단편)

### L3. CSV escape 가이드
- **위치**: SKILL.md (shared-convergence.md L59만 있음)
- **변경**: SKILL.md operational caveat에 questions CSV escape 주의 + `--questions-file` 옵션 검토
- **출처**: 내#5
- **비용**: 문서 1줄

### L4. Premise rejection in exchanges ambiguity
- **위치**: M4 적용 후 자동 해결. previousExchanges가 `<premise-status>false</premise-status>` 포함하면 워커가 식별 가능

### L5. context fan-out — host 책임
- **위치**: playbook
- **변경**: pre-flight checklist에 "이전 worker 응답/합성/majority signal을 context에 넣지 말 것" 추가
- **출처**: Codex#1
- **비용**: 문서 1줄

### L6. Acceptance protocol-aware
- **위치**: `prompts.ts:588-608`
- **문제**: host_interrogation worker는 question별 답변 → acceptance "your position" 모호
- **변경**: adversarial plan M6과 통합 — `buildAcceptanceMessages`에 `protocol` + `question?` 추가. host_interrogation일 때 "your answer to this question" 분기
- **출처**: Codex#8
- **상태**: adversarial plan M6과 묶어 처리

---

## 실행 순서

1. **M1 self-anchor prefix** — 1줄
2. **M2 CONFIDENCE 주입** — constraint 1줄
3. **M3 priority order** — 4줄 교체
4. **M5 N 비공개 anchor** — 1줄
5. **M4 false-premise format** — output contract
6. **L1 context 강제력** — 1줄
7. **H1 workerInstructions 추가** — signature + engine
8. **H3 previousExchanges model 안전성** — types + engine
9. **M6 maxRounds > 1 거부** — handler validation
10. **H2 nested loop** — **큰 변경. 별도 작업으로 분리 권장**. types·합성·acceptance·spec 영향

---

## 측정 권고

가설:
- M2 적용 후 confidence 표기 응답 비율 ≥80% (현재 [추정] <30%)
- M3+M4 적용 후 false-premise rejection 자동 검출 가능
- H2 적용 후 cost 정확성 (현재 playbook 명시 cost와 실제 일치)

---

## Out of scope

- `2026 SOTA reasoning effort routing` (Codex#10) — 별도 작업. workerGenParams 추상화 필요
- tool use 통합 — 별도 작업
- H2 nested loop — 본 계획에서 결정, 구현은 별도 PR 권장 (큰 변경)
