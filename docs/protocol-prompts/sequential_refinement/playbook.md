# sequential_refinement

워커 체인 A→B→C, 각자 이전 워커 출력을 개선. 다양성 아닌 누적이 목적. drafting·iteration·점진 개선용.

---

## When to use
- 글·문서 drafting (기술 글, design doc, RFC)
- 코드 점진 개선 (한 워커가 다음 워커 출력 강화)
- 명세 정제 — 초안을 여러 모델이 순차 보강
- 단일 결과물의 누적 향상

## When to skip
- 다양한 관점 필요 → `shared_convergence`
- weakness 발굴 → `adversarial_debate`
- 점수 산출 → `evaluation_scoring`
- 보안 공격 → `red_team`
- 격리 독립 답변 → `host_interrogation`

---

## 입력 구조

| 필드 | 역할 |
|---|---|
| `--task` | 무엇을 만들지 + 평가 기준 + 출력 형식 |
| `--worker-instructions` | 전 워커 동일 추가 지시 (있으면) |
| `workerOrder` (API) | 체인 순서 명시. 미지정 시 team 순서 |

순서 = 결과 좌우. 마지막 워커가 dominant. 강한 모델을 마지막에 두는 게 보통 유리하나, 약한 모델 → 강한 모델 순으로 두면 강한 모델이 더 많이 fix할 여지가 있어 결과 풍부 [추정 — bench 미확인].

---

## Task 작성 룰

자동 주입:
- **첫 워커**: shared_convergence R1 builder 사용 — depth + DEPTH_EXPLORE + (lens는 maxRounds>1일 때만, default 1이라 사실상 부재) + CONFIDENCE
- **2번째+ 워커**: depth + DEPTH_REFINE + "Do not rewrite from scratch. Build on previous version" + "For every change, state what was wrong and why your version is better" + "Output must be at least as complete... Shortening is not improving"

### 1. 평가 기준 명시
무엇이 "improvement"인지 task 안에 박는다:
- "더 자세히 / 더 정확히 / 더 안전하게 / 더 짧게(불필요한 부분 한정)"
- 어느 dimension에서 개선하는지 — code: correctness/perf/readability, doc: clarity/completeness/example
- 평가 차원 모호하면 워커마다 다른 곳을 "고치며" 점차 발산

### 2. 출력 형식 = 첫 워커 출력 형식
체인이므로 초안 형식이 그대로 누적. 첫 워커에 명시:
- "결과물을 단일 문서로. 워커 메타 코멘트 금지"
- "code only / markdown / spec format" 등 명시

### 3. Change rationale 강제 (자동주입에 이미 있지만 보강 가능)
> "각 변경 후 한 문단 변경 이유를 별도 섹션 `## Changes` 또는 inline diff comment로."

자동 주입의 "state what was wrong"이 단순 lip-service되는 경우 task로 강제 세분화.

### 4. Length-monotonic 자동 주입 인지
시스템이 "Shortening is not improving"을 강제 — task에서 "be concise"·"shorten"·"trim" 박으면 자동 주입과 충돌. 길이 줄이려면 task에 "factually wrong한 부분만 제거 가능"으로 명시(자동 주입과 일관).

### 5. 자동주입 중복 금지
- "improve the previous version"
- "do not rewrite from scratch"
- "build on previous"
- "preserve what works"
- "state why your version is better"
- "no preamble"

### 6. 강한 반론 자가 생성 (DEPTH_REFINE 자동 주입)
DEPTH_REFINE: "After your improvements, find the strongest argument against your changes. If you cannot defend a change, revert it."
→ task에 "self-critique 섹션 추가" 박지 마. 자동 작동.

---

## Pre-flight checklist

- [ ] 평가 dimension 명시?
- [ ] 출력 형식이 첫 워커 출력에서 명확히 정의?
- [ ] task에 "shorten"·"concise" 박지 않음 (자동 주입 충돌)?
- [ ] `workerOrder`로 체인 순서 의도적 지정?
- [ ] 워커 수 = chain 길이 (보통 3-4)?
- [ ] secrets 마스킹?

---

## Examples

### Bad
> "이 코드 개선해. Be concise."

→ "concise"가 자동 주입 "shortening is not improving"과 충돌, target 코드 부재, 평가 dimension 없음.

### Good — design doc drafting
```
<context>
신규 SaaS billing module RFC 초안 작성 중.
</context>

<task>
다음 항목을 포함하는 design doc을 작성·개선하라:
1. Problem statement (한 문단)
2. Proposed architecture (다이어그램은 ASCII 또는 Mermaid)
3. Failure modes 3개 + mitigation
4. Migration plan (단계별 1-2 sprint)
5. Open questions

평가 dimension: completeness, technical accuracy, internal consistency.
</task>

<output-format>
markdown only. preamble·meta-comment 금지. 단일 design doc 결과물.
</output-format>
```

`workerOrder = [0, 1, 2]` — 첫 워커 초안, 두 번째 보강, 세 번째 마무리.

### Good — 코드 점진 개선
```
<task>
다음 함수를 개선하라. 평가 dimension: correctness > security > readability > performance.

```typescript
function parseUserInput(s: string) {
  return JSON.parse(s);
}
```

각 변경에 대해 코드 위에 한 줄 주석으로 변경 이유. 함수 외 컨텍스트 추가 금지.
</task>
```

---

## `--worker-instructions`

전 워커 동일.

**Use**
- 도메인 framing — "Treat as production TypeScript code"
- 추가 제약 — "Preserve all existing public API"
- evidence — "If you change behavior, cite a spec or RFC"

**Skip**
- 자동주입 중복 ("improve", "build on previous")
- 길이 축소 지시 ("be concise") — 자동 주입과 충돌

---

## Models / parameters

### `--models`
- min 1. 체인이므로 동일 provider 여럿도 가능하나 다양성 위해 ≥2 권장
- 워커 수 = chain 길이. 3-4 권장. 5+ 되면 후반 워커가 "변경할 게 없다" 패턴(자동 주입의 "leave unchanged if correct")

### `--max-rounds`
default **1** (`wire.ts`). 단일 라운드 = 단일 chain pass. 다중 라운드는 사용 사례 미정형 — 1 고정 권장.

### `--count`
chain 길이. 비용 = count × 1 round.

---

## Read output

### convergence judge 의미 약화
`inspect`는 워커 응답을 평행 비교 — sequential은 마지막 워커 출력이 final이고 이전은 중간 상태. inspect 사용 시 ranking·quality는 약화 신호.

권장: 마지막 워커 출력을 직접 read. 중간 워커는 회귀 추적용.

### 회귀 검증
체인 후반에서 정보 손실 가능성 — 자동 주입 "Output must be at least as complete"에도 lip-service 발생. 검증:
- 첫 워커 출력 vs 마지막 출력 항목별 비교
- 누락된 항목 발견 시 task에 항목 list 명시 + re-run

### 합성
일반적으로 sequential은 합성 불필요 — 마지막 출력이 결과물. acceptance만 활용:
- 마지막 워커 출력에 대해 모든 워커가 자기 contribution 보존됐는지 acceptance 검증
- `partial`/`reject` 발생 시 어떤 단계에서 손실됐는지 역추적

---

## Re-run / abort

**Re-run**
- 마지막 출력이 첫 출력보다 정보 손실 → task에 보존 항목 list 명시
- 후반 워커가 "변경 없음" 반복 → chain 너무 길거나 첫 워커 출력이 이미 충분. count 감소
- workerOrder 의도와 다른 결과 → 강한 모델을 다른 위치로 이동 후 재실행

**Abort**
- 2회 재실행에도 후반 정보 손실 지속 → task 평가 dimension 재정의 또는 다른 protocol 검토
- 모든 워커가 task 전제 거부

---

## Edge cases

| 상황 | 행동 |
|---|---|
| 첫 워커 출력이 형식 violation (예: code only인데 메타 코멘트 추가) | 후속 워커가 그 형식을 이어가버림 — 첫 워커 출력 단계에서 stop 후 task 명확화하고 재실행 |
| 후반 워커가 출력을 줄임 | 자동 주입 "Shortening is not improving" 무시한 경우. instruction에 "preserve length" 추가 또는 단순 무시(자동 주입이 이미 강제하므로 보통은 발생률 낮음) |
| `modelSwaps` 발생 | swap된 워커가 이전 워커 출력 받기는 하나 모델 변경됨. 결과에 caveat 명시. 위반 시 narrower pool로 재실행 |
| 모든 워커 fail | 즉시 보고. 첫 워커 fail 시 chain 자체 시작 안 됨 |
