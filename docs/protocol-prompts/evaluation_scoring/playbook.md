# evaluation_scoring

워커 격리 상태로 동일 subject를 동일 criteria에 대해 독립 채점 → aggregation으로 종합 점수·verdict. judge bias 회피.

---

## When to use
- 후보안 평가·grading (PR, design, draft 등)
- 다수 모델 평균 점수가 단일 judge보다 신뢰 높을 때
- 합·불 결정 — verdict 기반
- A/B 비교의 정량 score (각 후보를 별도 deliberate로 채점)

## When to skip
- 점수 불필요, 합의된 입장 → `shared_convergence`
- 약점 발굴 → `adversarial_debate`
- 점진 개선 → `sequential_refinement`
- 보안 공격 → `red_team`
- 자유 형식 답변 → `host_interrogation`

---

## 입력 구조 (다른 프로토콜과 다름)

| 필드 | 역할 |
|---|---|
| `--task` | 채점의 의도·맥락 |
| `--criteria` | 평가 기준. 가중치·anchor 명시 권장 |
| `--subject` | 채점 대상 (텍스트·코드·design) |
| `--aggregation` | `voting`(default) / `consensus` / `confidence_weighted` |
| `--worker-instructions` | 도메인 framing |

---

## Task·criteria·subject 작성 룰

자동 주입:
- depth (factual ground·premise reject·verify)
- "Evaluate against provided criteria. Do not invent additional"
- "Do not consider how other evaluators might score. Judge independently"
- 출력 형식 강제: 각 criterion 분석 → confidence 표기 → verdict 한 문장 → score 1-10
- 점수 anchor: 1-2 fundamentally flawed, 3-4 significant issues, 5-6 acceptable, 7-8 good, 9-10 excellent

DEPTH_EXPLORE/REFINE **미주입**. CONFIDENCE fragment **미주입** — 단 출력 형식이 confidence 인라인 표기 강제.

### 1. Criteria 명시 — anchor와 weight
가중치·anchor 모호하면 워커마다 다른 척도 사용 → 평균 무효.

좋은 예:
```
1. Correctness (40%) — does it produce expected output for all spec cases?
2. Security (30%) — does it handle malicious input safely?
3. Readability (20%) — can a new engineer maintain it within 1 sprint?
4. Performance (10%) — meets P95 < 100ms target?
```

나쁜 예: "코드 품질 평가하라" — 차원 모호.

### 2. Subject 자체 완결성
워커는 subject 외 정보 부족. 외부 reference 필요하면 task에 함께 박는다 (spec 발췌, 비교 baseline).

### 3. 점수 anchor 충돌 금지
자동 주입의 1-10 anchor와 다른 anchor 박으면 충돌. 1-5 scale 등 변경 금지. 필요하면 verdict로 표현하고 score는 자동 anchor 따름.

### 4. Criterion 추가 금지 강제 (자동 주입에 이미)
워커가 criteria 외 항목 평가 시 결과 noise. instruction 또는 task에 "criteria 외 항목 무시" 박지 마 — 자동 주입이 이미 강제.

### 5. 자동주입 중복 금지
- "evaluate independently"
- "do not consider others"
- "score 1-10"
- "confidence: HIGH/MEDIUM/LOW"
- "verdict 한 문장"
- "no preamble"

---

## Aggregation 선택 가이드

| method | 동작 | 사용 |
|---|---|---|
| `voting` (default) | 각 워커 verdict의 majority verdict + 표 수 | verdict가 categorical (accept/reject, A/B) 일 때 |
| `consensus` | 모두 동일 verdict → 채택. 분산 → 결과 없음 | 만장일치 필요한 high-stakes (보안 승인, prod release) |
| `confidence_weighted` | 워커 score를 confidence(HIGH=3, MED=2, LOW=1)로 가중 평균 | 정량 score 결과 + 자신감 반영 |

### 어떤 걸 언제
- 합·불, accept/reject → `voting`
- "전원 OK 아니면 보류" → `consensus`
- 정량 비교, 후보 ranking → `confidence_weighted`

---

## Pre-flight checklist

- [ ] criteria가 weight·anchor 명시?
- [ ] subject 완결 (외부 reference 부족 없음)?
- [ ] aggregation method 선택 의도적?
- [ ] consensus 사용 시 분산 가능성 인지 (결과 없을 수 있음)?
- [ ] 점수 anchor 1-10 자동 주입과 충돌 없음?
- [ ] 자동주입 중복 없음?
- [ ] secrets 마스킹?

---

## Examples

### Bad
> task: "이 코드 평가해", criteria: "good", subject: "func() {...}"

→ criteria 모호, subject 컨텍스트 부족.

### Good — PR 채점
```
--task "신규 user authentication module의 production readiness 평가."
--criteria "1. Spec 준수 (40%): RFC 6749 §4.1 OAuth flow 정확 구현. anchor 1=spec violation, 5=partial, 10=full compliance.
2. Security (30%): timing attack·CSRF·token leak 방어. anchor 1=critical vuln, 5=주요 방어 부재, 10=production-ready.
3. Test coverage (20%): unit + integration. anchor 1=zero, 5=happy path only, 10=edge case 포함.
4. Maintainability (10%): 신규 엔지니어 1 sprint 안 onboarding 가능."
--subject "<PR diff 또는 코드 전체>"
--aggregation confidence_weighted
```

### Good — 만장일치 보안 승인
```
--task "Production deploy 승인 평가."
--criteria "1. Critical/high security finding 부재.
2. Backward compatibility 깨지지 않음.
3. Rollback plan 명확.
verdict: APPROVE / REJECT."
--subject "<release notes + diff>"
--aggregation consensus
```

전원 APPROVE 아니면 결과 없음 → 자동 reject 처리.

---

## `--worker-instructions`

**Use**
- 도메인 framing — "Treat as RFC 6749 OAuth 2.0 evaluation"
- 외부 reference — "Refer to OWASP Top 10 2025 for security category"

**Skip**
- 자동주입 중복 ("evaluate independently", "score 1-10")
- 새 criterion 추가 — "Also consider X" → 자동 주입 "do not invent" 위반

---

## Models / parameters

### `--models`
- min 1. ≥3 권장 (점수 평균 의미)
- consensus 사용 시 ≥3, 단일 모델 reject만으로 결과 없음 — 모델 다양성·품질 고려

### `--max-rounds`
default **1**. 다중 라운드 사용 사례 없음.

### `--count`
- voting/confidence_weighted: ≥3, 5 권장 (홀수로 tie 회피)
- consensus: 워커 수 적을수록 합의 확률↑, 너무 적으면 신뢰↓

---

## Read output

### `aggregation` 필드 직접 read
deliberate output에 `aggregation` 객체 (다른 프로토콜에 없음):
- `method` — 사용된 method
- `results` — 각 워커별 score·verdict·confidence
- `weightedScore` (confidence_weighted) — 가중 평균
- `majorityVerdict`, `voteCount` (voting)
- `consensus` (consensus, 합의 시만)

### convergence judge 의미 약화
`inspect`의 convergence는 텍스트 응답 비교 — 점수·verdict 합의는 `aggregation`이 직접 제공. inspect는 quality findings에만 의미 (워커가 ungrounded claim했는지).

### 분산이 큰 경우
score std deviation 큼 → criteria가 모호하거나 subject가 underspec. re-run 전:
- 워커별 score 차이 원인을 응답 직접 read
- 같은 criterion에 대해 다른 anchor 적용한 것이라면 task 보강
- 근본적 가치관 차이라면 (e.g. security vs velocity) trade-off 명시 필요 → 결과 채택 가능

### consensus 결과 없음
모든 워커 합의 안 됐다는 사실 자체가 신호 — subject가 양면적이거나 criteria 부족. broader deliberation 또는 사용자 escalate.

---

## Re-run / abort

**Re-run**
- score std > 3 (1-10 scale에서 큰 분산) → criteria anchor 명시 보강
- 워커들이 criteria 외 항목 평가 → instruction에 도메인 framing 보강
- consensus 결과 없음 + criteria 모호 → criteria 정제 후 재실행
- `self_judge_bias` → 사실상 무관 (judge가 평가 안 함, 워커가 평가)

**Abort**
- 2회 재실행에도 분산 큼 → subject 또는 criteria 근본 결함. 사용자 escalate
- 다수 워커가 subject 부족 신고 (외부 reference 요구) → subject 보강 후 재실행

---

## Edge cases

| 상황 | 행동 |
|---|---|
| 모든 워커 동일 score (예: 전원 7) | 좋은 신호일 수도, criteria가 변별력 없을 수도. 응답 직접 read해 reasoning 확인 |
| consensus 사용 시 1명 dissent | dissent 응답 우선 read. 합의 깨는 게 valid한지 판단 후 (a) 수정해 재실행 (b) reject로 진행 |
| score와 verdict 불일치 (예: verdict "good" + score 3) | 자동 주입의 "must be consistent" 위반 — re-run 또는 verdict/score 중 evidence 강한 쪽 채택 |
| confidence 모두 LOW | criteria·subject 정보 부족. 보강 후 재실행 |
| `modelSwaps` 발생 | swap된 워커 score는 약 caveat. provider diversity 회복되면 재실행 |
| 모든 워커 fail | 즉시 보고. subject가 policy violation 가능성 |
