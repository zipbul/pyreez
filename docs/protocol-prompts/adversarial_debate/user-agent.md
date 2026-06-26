# `adversarial_debate` — User Agent Full Context

소비 에이전트가 `adversarial_debate` 프로토콜로 deliberate를 호출할 때 컨텍스트에 로드되는 자료 verbatim merge.
구성: (1) `.claude/skills/pyreez/SKILL.md` 전체 + (2) 해당 프로토콜 deep playbook.

**참고**: 본 파일은 종합 검토용 단일 view. 코드 블록 wrapping 없이 두 자료를 평면 병합.

---

# Part 1 — `.claude/skills/pyreez/SKILL.md`

> 출처: `.claude/skills/pyreez/SKILL.md`

---
name: pyreez
description: Run heterogeneous multi-model deliberation when a single model's opinion is insufficient. Use this skill whenever the user asks for design tradeoffs, architecture decisions, code/PR review of nontrivial changes, comparison of options, brainstorming with diverse angles, debate, stress-testing an idea, or any judgment call where missing a critical perspective is costly. Trigger even when the user does not explicitly say "deliberate" — phrases like "what do you think about X", "which is better", "review this design", "is this approach right" all qualify.
allowed-tools:
  - Bash(bun *)
  - WebSearch
  - WebFetch
user-invocable: true
argument-hint: "[topic or task to deliberate]"
---

## Workflow

1. **Classify** task → protocol (decision tree below). 복합 task면 chaining.
2. **Reframe** directional → failure-condition.
3. **Models** — `bun run src/cli.ts models`. ≥2 provider.
4. **Run** `deliberate`.
5. **Pipe** JSON → `inspect` (단, 적용 가능한 protocol만 — 아래 표).
6. **Read** inspect output via table.
7. **Acceptance** with `alignment` per worker.

---

## 1. Classify — task → protocol

### Q0. pyreez 적합 task인가?

다음은 **pyreez 호출 가치 낮음** — 단일 모델 + self-consistency가 우월:
- 단순 lookup·factual recall ("X가 뭐야?")
- 단일 정답 task (수학 계산, 사실 확인)
- 대량 분류·라벨링 자체 (rubric 설계는 pyreez로, **분류 실행은 단일 모델 + self-consistency**)
- 단순 코드 생성·요약·번역

pyreez 가치 있는 task:
- 판단·tradeoff·결정 (단일 모델 blind spot이 비싼)
- 설계·architecture·review
- 약점·실패 모드 발굴
- 다양한 관점 수집 (단일 모델로 못 함)

부적합이면 호스트가 단일 모델 호출. 적합하면 아래 Q1~Q3.

### Q1~Q3. protocol routing

| 한국어 | protocol | 사용 시점 |
|---|---|---|
| 합의 | `shared_convergence` | 단일 입장 수렴 (architecture·tradeoff·결정) |
| 논쟁 | `adversarial_debate` | 약점 발굴·stress-test·design review |
| 심문 | `host_interrogation` | 격리된 1:1 답변 수집 (가설·spec 확인·juror-style) |
| 개선 | `sequential_refinement` | 체인 누적 개선 (drafting·점진 정제) |
| 채점 | `evaluation_scoring` | score/verdict 산출 + 집계 (voting·consensus·cw) |
| 공방 | `red_team` | 비대칭 generator vs attacker (보안·adversarial) |

### Decision tree

```
Q1. 결과물이 단일 산출물(글·코드·plan)인가, 평가·판정인가, 다양한 안인가?
    ├─ 단일 산출물 누적 정제 → 개선
    ├─ score/verdict → 채점
    ├─ 격리된 다중 답변 → 심문
    └─ 평행 토론 → Q2

Q2. 의도가 수렴인가 약점 발굴인가?
    ├─ 수렴 (결정·tradeoff) → 합의
    ├─ 약점 발굴 (review·검증) → 논쟁
    └─ 비대칭 공격·방어 (security) → 공방

Q3. 위 매핑 모호 → chaining (아래 §2) 또는 합의 default
```

### Gap 보완 (workaround)

| 사용자 의도 | protocol + 설정 |
|---|---|
| **카테고리 분류·라벨링** | `evaluation_scoring` + `--aggregation voting`. verdict에 라벨, score 무시. criteria에 라벨 정의 |
| **순수 브레인스토밍** (다양화·수렴 X) | 두 옵션. trade-off로 선택. |

브레인스토밍 두 옵션:

| 옵션 | 설정 | 강점 | 약점 |
|---|---|---|---|
| A | `host_interrogation` + `--max-rounds 1` + `--questions "<prompt>"` 모든 워커에 동일 | 격리 강함 (R1·R2 cross-pollination 0), 비용 정확 N call | lens 없음 — 워커 분석 차원 자동 다양화 X |
| B | `shared_convergence` + `--max-rounds 2`. R1 응답만 채택, R2 무시 | lens 7 활성 (워커별 다른 분석 차원) | R2 비용 낭비, 격리 약함 |

> 코드 fact: `shared_convergence`의 lens는 `maxRounds > 1` 조건. brainstorming으로 `shared_convergence + maxRounds=1` 절대 금지 (lens 비활성).
> 일반 권고: 단순 발산(이름·문구 후보) → A. 분석 차원 다양화가 가치 있는 발산(전략·아이디어 generation) → B.

### Deep playbook

| protocol | 추가 자료 |
|---|---|
| `shared_convergence` | [shared-convergence.md](shared-convergence.md) — 본 표보다 우선 |
| 나머지 5개 | 본 표만 — task 작성 룰은 §3, output 해석은 §6 따른다 |

---

## 2. Chaining — 복합 task

단일 protocol 부족 시 단계별. 이전 단계 결과를 다음 단계 `--task` 또는 `--subject`로 주입.

| 복합 task | 체인 |
|---|---|
| 마이그레이션 plan | 합의 (plan 도출) → 논쟁 (plan stress-test) |
| 프로덕션 postmortem | 심문 (격리 가설 수집) → 합의 (원인 수렴) |
| 번역 N후보 best | 개선 (drafting) → 채점 (rank) |
| 보안 audit | 논쟁 (일반 weakness) → 공방 (구체 공격) |
| 중대 결정 검증 | 합의 (결정) → 공방 (결정 자체 공격) |
| 글 작성 + 평가 | 개선 (drafting) → 채점 (criteria 평가) |

> 각 단계 acceptance 거치지 않아도 됨. 최종 단계만 acceptance. 단 중간 결과 신뢰도 의심되면 단계 사이 acceptance.

---

## 3. Reframe — directional → failure-condition

Directional은 모두 동의 → debate 가치 0.

| Directional | Reframed |
|---|---|
| "X가 맞는가?" | "X가 틀린 시나리오. 구성 불가하면 왜 불가능한지 논증" |
| "X의 가치는?" | "X가 가치를 잃는 경계 조건" |
| "X 도입해야 하나?" | "X 도입이 안 하는 것보다 나쁜 조건" |

Wording: 1인칭("I think") 금지, persona("you are X") 금지. harness가 depth·anti-conformity·confidence 자동 주입 — task에 또 박지 마.

---

## 4. CLI

```bash
bun run src/cli.ts deliberate --task "..." --models "m1,m2,m3" --protocol <p> [--max-rounds N] [--worker-instructions "..."]
# protocol별 추가 입력:
#   host_interrogation:  --questions "Q1,Q2,Q3"
#   evaluation_scoring:  --criteria "..." --subject "..."
bun run src/cli.ts inspect --task "..." --judge <model> --deliberate -
# stderr·stdout 분리: `... 2>err.log >out.json`. 2>&1 금지 — JSON에 progress 섞임
bun run src/cli.ts fuse --task "..." --judge <model> --candidates '[{id, content}]' [--ranking '[...]']
bun run src/cli.ts acceptance --task "..." --synthesis "..." --workers '[{model, original_position, alignment?}]'
```

`fuse`는 synthesis DRAFT 생성 (LLM-Blender pattern). inspect 이후 출발점 필요할 때.

---

## 5. Inspect 적용 범위 (component별)

inspect는 단일 호출이지만 component 3종 (convergence judge + ranking + qualityFindings)이 각기 protocol-dependent. component별 적용 표:

| protocol | convergence.level | ranking (N≥4) | qualityFindings (`--factual true`) | 1차 read 대상 |
|---|---|---|---|---|
| 합의 | ✓ full | ✓ | ✓ | inspect 표 |
| 논쟁 | △ 수렴 안 해도 정상 (역해석) | ✓ | ✓ | 응답 + qualityFindings |
| 심문 | ✗ skip (question 섞이면 무효) | ✗ | ✓ | 응답 + qualityFindings |
| 개선 | ✗ skip | ✗ | ✓ | 마지막 워커 출력 + qualityFindings |
| 채점 | ✗ skip | ✗ | ✓ | `aggregation` + qualityFindings |
| 공방 | ✗ skip | ✗ | ✓ | gen final + attacker severity + qualityFindings |

> `qualityFindings`는 응답 본문의 unsupported/contradicted claim 검출 — protocol-independent. 모든 protocol에 `--factual true`로 opt-in 가능.
> finding이 **외부 사실**(DB·API 동작·버전 default·벤치마크·incident)에 걸리고 정확성이 결론을 가르면 `--web-access true` — claude 워커가 소스를 fetch·검증·인용하고 peer 날조까지 잡는다(anthropic 모델 한정, ~2-3× 비용). 사실 정확성이 중요한 high-stakes에서만.

---

## 6. Read inspect output (합의·논쟁만)

| field | action |
|---|---|
| `convergence.level: "high"` | 응답 먼저 verify. judge가 HIGH 과분류 경향 — 응답에 weak evidence면 reframe 후 재실행 |
| `convergence.level: "moderate"` + `dissenterId` | dissenter 응답 **먼저** read. peer-reviewed 소수의견 문헌상 dissent가 group decision 개선 |
| `convergence.level: "moderate"` no dissenter | split 명시 합성 |
| `convergence.level: "diverse"` | 보완적 framing(좋음) 또는 기본 사실 불일치(task underspec)인지 응답 read해 판별 |
| `convergence.level: "unknown"` | 응답 직접 read |
| `convergence.level: "insufficient"` | <2 응답 — worker 추가 재실행 |
| `convergenceScore.status` | composite(semantic+lexical+evidence+stability). `level`과 mismatch면 응답 직접 read |
| `ranking` (N≥4) | wins로 weight |
| `qualityFindings` | unsupported·contradicted 제거 또는 caveat |
| `host_actions` `provider_diversity_low` | caveat 또는 broader pool 재실행 |
| `host_actions` `self_judge_bias` | non-overlap provider judge로 재실행. 회피 불가 시 cross-provider judge 2개 결과(level + ranking) 일치하면 진행 |
| `convergence is HIGH — reframe task` | judge는 task 형태 검사 안 함 — task가 이미 failure-condition framing이면 무시 |

---

## 7. Synthesize

워커별 3 field:
- **unique_contribution** — 이 워커만 제공하는 것
- **most_unexpected_claim** — 가장 surprising 한 줄
- **loss_if_removed** — 이 워커 없으면 잃는 것

전 워커 gap check:
- 모호한 개념 미정의
- 누구도 안 따진 숨은 가정
- evidence 없는 주장
- 미탐색 viewpoint
- 미추적 implication
- 원 질문 자체 결함

gap 발견 → 보충 deliberate 후 진행.

워커 disagree 시 stronger case 채택 (사실 → 강 evidence, 설계 → 강 reasoning). 병렬 옵션(A/B) 제시 금지.

합성은 adopt-and-extend. verbatim copy 금지.

---

## 8. Acceptance

워커 자동 분류: `on-task` (verdict 집계) / `meta-critique` (task framing 거부, `metaCritiques`에 별도 emit, 차단 안 함). `alignment` 명시로 override 가능.

| verdict | 행동 |
|---|---|
| `accept` | 수정 불필요 |
| `partial` | `misrepresented`·`unresolved` 반영 → 재acceptance |
| `reject` | 해당 섹션 재작성 → 재acceptance |

`action_required`는 on-task 워커 partial/reject 있을 때만 emit.

revision loop ~3회 cap (호스트 휴리스틱, code 미강제). 그 이상이면 사용자에게 escalate.

---

## 9. Operational caveats

`deliberate` JSON 직접 확인 (inspect 미커버 필드):

| field | 행동 |
|---|---|
| `modelSwaps` | 요청 모델 실패·대체. 실제 `modelsUsed`가 `--models`와 다를 수 있음. vendor policy 위반 시 narrower pool 재실행 또는 결과 폐기 |
| `degradation` | team이 요청 size 미만 — 다양성 임계 미달이면 재실행 |
| `warnings: team_degraded` | 위와 동일 신호 |

전반:

- **Task fan-out**: `--task` 콘텐츠는 모든 워커 provider + judge에게 전송. secrets·internal path·고객 데이터·미공개 plan 마스킹
- **Cost order**: 1 pass (deliberate + inspect + acceptance) ≈ 1×N×R + judge + (N≥4 ranking) + (factual quality) + acceptance. N=3, R=2: ~7–10 LLM calls. 반복 시 round·count cap
- **Non-determinism**: 비-zero temp judge 분산 존재. `convergence.level`은 신호이지 verdict 아님 — §6 표대로


---

# Part 2 — `adversarial_debate` deep playbook

> 출처: `docs/protocol-prompts/adversarial_debate/playbook.md`

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

