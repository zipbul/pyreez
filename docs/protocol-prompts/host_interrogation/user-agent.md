# `host_interrogation` — User Agent Full Context

소비 에이전트가 `host_interrogation` 프로토콜로 deliberate를 호출할 때 컨텍스트에 로드되는 자료 verbatim merge.
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

# Part 2 — `host_interrogation` deep playbook

> 출처: `docs/protocol-prompts/host_interrogation/playbook.md`

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

