# adversarial_debate

여러 모델이 독립 입장 → 서로 입장에서 약점 발굴 → steelman 후 challenge. 수렴 비강제. 단일 안의 hidden flaw·blind spot 노출.

---

## When to use
- 결정 직전 design·proposal stress-test
- 단일 강력한 안의 weakness 발굴
- code review·PR review에서 reviewer 다양성

## When to skip
- 단일 답 수렴 → `shared_convergence`
- 점수·등급 → `evaluation_scoring`
- 점진 개선 → `sequential_refinement`
- 보안 공격(비대칭 역할) → `red_team`
- 격리 독립 답변 → `host_interrogation`

---

## Task 작성 룰

워커 system·approach에 자동 주입되는 것 (task에 또 박지 마):
- steelman 강제 + "Do not agree to reach consensus / Do not soften criticism"
- HIGH/MEDIUM/LOW confidence (finding별)
- **증거 규율**: 워커는 lookup이 없다 → 추론 체인이 기본 증거. 정확 기억이 아닌 source/identifier/quote/number는 금지(불확실 시 capability만 기술 + `[unverified]`). 날조는 무근거보다 나쁨.
- **confidence 규율**: HIGH = 싼 결정적 체크 하나로 판가름(spec/config/code 확인, 반례) / MEDIUM = 부하·타이밍·벤치마크 필요하거나 추론 갭 / LOW = 추측·`[unverified]`. 추론만으론 HIGH 아님.
- **출력 형식**: severity 순(critical 먼저) 정렬, finding마다 reason-before-verdict 필드 순서 `(target) / steelman / weakness / evidence / falsification / verdict(severity+confidence)` + 마지막 "채택 가능 조건" 한 줄.

### 1. Failure-condition framing
"X 좋은가?" → "X 깨지는 조건". directional은 모두 동의 → debate 가치 0.

### 2. Target 명시
- 공격 대상 design·proposal 텍스트(full or 요약) task 안에 포함
- 가정 list — 워커가 어떤 가정을 공격할지 인지
- stake — 약점 미발견 시 무엇이 깨지나

### 3. 증거·출력 형식을 task에 다시 지정하지 마라
severity 분류·finding 구조·증거 규율은 **워커 기본값**이다. task에서 또 강제하면 중복.
특히 **"외부 출처 1개 필수 / 인용 불가능하면 제외"류 지시 금지** — lookup 없는 워커에게 인용을 강제하면 그럴듯한 출처를 **날조**한다(측정으로 확인된 실패 모드). 워커는 이미 "정확 기억 인용 또는 추론, 불확실은 [unverified]"로 동작한다.
도메인 특이 형식이 꼭 필요하면 `--worker-instructions`로 override(워커가 host 형식 우선).

### 4. 자동주입 중복 금지
워커에 이미 박혀 있어 task에 또 박지 마:
- "find weakness" / "be critical" / "challenge"
- "steelman the opposing argument"
- "do not agree to reach consensus" / "do not soften"
- HIGH/MEDIUM/LOW confidence 표기, severity 분류, finding 출력 형식
- "be objective" / "cite a source" — 워커 approach가 evidence-based critique를, 증거 규율이 인용 정직성을 이미 강제

---

## Pre-flight checklist

- [ ] failure-condition framing?
- [ ] target 텍스트 task에 포함?
- [ ] models ≥2 (engine 강제), provider ≥2 권장?
- [ ] 1인칭·persona·자동주입 중복(steelman·confidence·severity·증거 규율·출력 형식) 없음?
- [ ] "외부 출처 강제"류 지시 없음? (날조 유발 — 워커 기본값에 맡겨라)
- [ ] secrets·internal paths 마스킹?

---

## Examples

### Bad
> "이 architecture에 문제 있나? Be critical."

→ 자동주입 중복, target 부재.

### Good — design challenge
`--task` 안의 내용은 워커에게 `<task>…</task>`로 감싸지며 XML이 escape된다. 따라서 task 본문엔 **마크다운 헤더**를 써라(중첩 XML 태그는 리터럴 `&lt;…&gt;`로 깨진다). 출력 형식은 워커 기본값이라 task에서 지정하지 않는다.
```
## Context
50인 엔지니어 팀, Rails monolith → microservices 12개월 plan.

## Target design
- Phase 1: API gateway (3개월)
- Phase 2: User·Auth service 분리 (3개월)
- Phase 3: Billing·Order 분리 (4개월)
- Phase 4: Legacy 50% 퇴직 (2개월)

## Stake
계획 결함 미발견 시 12-18개월 일정 + 인력비용 손실.

## Question
본 plan이 12개월 timeline 내 실패하는 구체 시나리오를 발굴하라.
```
(severity 순 finding·steelman·evidence·falsification·채택 조건은 워커가 자동 출력.)

---

## `--worker-instructions`

**Use**
- 도메인 framing — "Treat as a distributed systems migration"
- severity 정의 도메인화 — "critical = blocks delivery, high = >1mo delay, ..."
- 출력 형식 override — 워커 기본 형식 대신 특정 스키마가 필요할 때

**Skip**
- 자동주입 중복 ("find weakness", "do not soften", steelman, confidence, severity)
- "be objective"
- **"외부 출처 인용 강제"류** ("Reject critiques without a citation") — lookup 없는 워커가 인용을 날조한다. 증거 규율(추론 기본·정확 기억만 인용·불확실 [unverified])이 이미 정직성을 강제

---

## Models / parameters

### `--models`
- **min 2 강제** — engine 거부
- ≥3 distinct provider 권장. 같은 family >50%면 perspective 약화

### `--max-rounds`
| 값 | 사용 |
|---|---|
| **3** | default. R1 입장 → R2 challenge → R3 commit |
| 4-5 | high-stakes design, R2에서 새 약점 추가 시 |
| 1-2 | 약점 표면화 부족 — 비권장 |

### `--count`
default = model 수. ≥4면 critique 다양성↑, 비용↑

### `--web-access`
finding이 **외부 specific**(DB 내부 동작·API/flag·버전 default·벤치마크·incident 주장)에 걸리면 **`--web-access true` 권장**.
- lookup 없는 워커는 외부 specific을 confident-wrong으로 단언하는 경향이 있고, 이건 프롬프트 규칙으로 0이 안 된다. web-access 워커는 fetch해서 검증·URL 인용하고, **peer가 날조한 통계·역인용까지 소스 fetch로 잡아낸다**(verbatim quote·fabrication catch 모두 외부 재검증으로 확인된 동작).
- **claude(anthropic) 워커만** 도구를 받는다 — codex/gemini는 무시. 따라서 web-access 런은 anthropic 모델 ≥2로 구성.
- 비용·지연 ~2-3×. 단순 판단·tradeoff엔 불필요 — 사실 정확성이 결론을 가르는 high-stakes에서만.
- 인용 URL 품질은 섞인다(저질 SEO 블로그 포함). 워커가 소스 mismatch를 flag하지만, load-bearing 인용은 `--factual true` 또는 호스트가 직접 1~2건 fetch 확인.

---

## Read output

### convergence judge 의미 약화
`inspect`의 convergence judge는 `shared_convergence` 전제 설계.
- `level: high` — 보통 task 결함 신호 (워커 모두 같은 약점만 → target narrow 또는 다양화 부족)
- `level: diverse` — 정상. 워커별 다른 약점
- `dissenterId` — "약점 없음" 주장 워커. evidence 직접 read

### qualityFindings
critique 자체가 unsupported일 수 있음 — `--factual true` 권장.

### 합성
- 모든 critical/high severity dedupe·rank
- evidence 강한 medium 보존
- 약점 dependency 표시 (A 해결하면 B?)
- 마지막: 채택 조건 또는 재설계 권장

수렴 강제 금지. 양립 불가 비판은 trade-off로 명시.

---

## Re-run / abort

**Re-run**
- 모든 워커가 표면 약점만 → target 텍스트 자세히 + "deeper, structural weakness only"
- 모든 워커 "약점 없음" → 거짓 합의 의심. broader pool 또는 task가 challenge 봉쇄인지 점검
- `self_judge_bias` → 다른 provider judge

**Abort**
- 2회 재실행에도 모두 "약점 없음" → target trivially correct이거나 task가 challenge 봉쇄. 사용자 escalate
- ≥2 provider 미달

---

## Edge cases

| 상황 | 행동 |
|---|---|
| 모든 워커 fail | 즉시 보고 (provider outage 또는 target 콘텐츠가 policy violation) |
| `degradation` (active < 2) | engine 거부 — narrower pool로 재실행 |
| 워커 1명만 critical, 나머지 OK | minority 우선 read. evidence 강하면 채택 (소수 critical은 보통 valid) |
| critique가 일반론으로 빠짐 | task에 target 텍스트 포함 확인 → re-run with `<target-design>` 명시 |
