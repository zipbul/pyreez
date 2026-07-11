# `evaluation_scoring` — User Agent Full Context

소비 에이전트가 `evaluation_scoring` 프로토콜로 deliberate를 호출할 때 컨텍스트에 로드되는 자료 verbatim merge.
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
> finding이 **외부 사실**(DB·API 동작·버전 default·벤치마크·incident)에 걸리고 정확성이 결론을 가르면 `--web-access true` — claude·grok 워커가 소스를 fetch·검증·인용하고 peer 날조까지 잡는다(~2-3× 비용). 사실 정확성이 중요한 high-stakes에서만.
> **grok(xai)은 웹이 기본 ON이다** — no-lookup 모드에선 검증 서사·수치를 날조하는 floor가 있어 provider가 기본으로 켠다. 재현성·비용·민감 내용의 검색 유출이 문제면 `--web-access false`로 끄되, 그 모드의 grok 인용은 검증 안 된 것으로 취급하라.

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

# Part 2 — `evaluation_scoring` deep playbook

> 출처: `docs/protocol-prompts/evaluation_scoring/playbook.md`

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

