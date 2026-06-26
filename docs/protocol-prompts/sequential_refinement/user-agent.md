# `sequential_refinement` — User Agent Full Context

소비 에이전트가 `sequential_refinement` 프로토콜로 deliberate를 호출할 때 컨텍스트에 로드되는 자료 verbatim merge.
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

# Part 2 — `sequential_refinement` deep playbook

> 출처: `docs/protocol-prompts/sequential_refinement/playbook.md`

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

