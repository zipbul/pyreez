# `shared_convergence` — User Agent Full Context

소비 에이전트가 `shared_convergence` 프로토콜로 deliberate를 호출할 때 컨텍스트에 로드되는 자료 verbatim merge.
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

# Part 2 — `shared_convergence` deep playbook

> 출처: `.claude/skills/pyreez/shared-convergence.md`

# shared_convergence

여러 모델이 독립 분석 → 서로의 입장 보고 재평가 → 라운드 반복으로 수렴된 단일 입장 도달. heterogeneous 풀의 다양성으로 단일 모델 blind spot 보완.

---

## When to use
- valid path가 여럿인 architecture/design 결정
- 트레이드오프 평가 (X vs Y)
- 단일 모델 blind spot이 비싼 판단성 task

## When to skip
- factual lookup, 단일 강모델 + self-consistency로 동등 품질 가능 → 단일 모델
- 단순 코드 생성 → 단일 모델
- weakness 발굴 → `adversarial_debate`
- 점수 매기기 → `evaluation_scoring`
- 점진 개선 → `sequential_refinement`

---

## Task 작성 룰

pyreez가 harness(role·depth·anti-conformity·confidence·lens) 자동 주입. task는 워커가 정확히 **무엇을, 어떤 조건에서, 어떤 형식으로, 어떤 stake로 답해야 하는지**만 전달.

### 1. Failure-condition framing

| Avoid | Use |
|---|---|
| "X가 좋은가?" | "X가 실패하는 구체 조건 N가지" |
| "X와 Y 중 무엇이 낫나?" | "Y보다 X가 나쁜 결과를 내는 조건은?" |
| "X를 도입해야 하나?" | "X 도입이 도입 안 하는 것보다 나쁜 조건은?" |
| "X의 가치는?" | "X가 가치를 잃는 경계 조건은?" |

### 2. 구체 제약 + context
추상 task → 추상 답. 가능한 것 명시:

- **도메인** (환경/스택/언어), **스케일** (사용자/요청/데이터), **시간 지평** (단·장기), **팀 컨텍스트** (인원/숙련도)
- **Stake** — 이 결정이 잘못되면 무엇이 깨지나 (예: "잘못된 선택 시 6개월 마이그레이션 비용", "SLA 위반 시 계약 패널티"). 워커가 stake에 맞는 깊이로 답함
- **이미 검토한 것 / out-of-scope** — "PostgreSQL은 이미 결정. MongoDB만 평가하라" 또는 "비용 분석은 답에 포함 마라"

### 3. Verifiable 출력 형식
binary 검증 가능한 명령으로 박는다.

좋은 예: "조건을 정확히 3개 제시", "각 항목을 한 문단으로", "마지막 줄에 추천 경로 한 문장으로"
나쁜 예: "충분히 자세히 설명하라"

### 4. Lazy-agent 사전 차단
task `<output-format>` 안에 박는다:
> "각 응답은 다른 워커 입장에 대한 구체 critique를 최소 한 개 포함하라. 동의만으로는 불충분."

여러 deliberation에 같은 요구가 반복되면 `--worker-instructions`로 옮긴다 (한 곳에 두 번 박지 마).

### 5. False-premise 거부 + Misleader 방어 (high-stakes)
의료·법률·금융처럼 misleader·잘못된 전제 위험 task에 task 안에 박는다:
> "전제 중 사실이 아니거나 증명 불가, 숨은 가정이 있으면 답변 전에 식별·거부하라."
> "각 주요 주장에 외부 evidence(benchmark·official source·production case) 한 개 인용 필수."

### 6. Few-shot + negative example (복합 출력 시)
복합 출력 형식이면 task 안에 `<example>`(positive 1-2개) / `<bad-example>`(negative 1개) 태그로 박는다.
- positive: 원하는 형식·깊이
- negative: 흔한 오답 패턴 차단 (예: "이 답은 일반론으로 빠짐 — 본 컨텍스트 한정해야 함")

단순 출력에는 불필요.

### 7. 자동주입과 중복 금지
워커에 이미 들어가 있어 또 박지 마:
- HIGH/MED/LOW 표기 / "consensus 의존 마라" / "evidence ground" / "검증하라" / "여러 접근 고려" / "강한 반론" / "no preamble"
- "think step by step" / "reason carefully" / "let's think this through"
- persona ("you are X"), pyreez 자동 부여 lens(분석 차원)
- "be objective" (misleader에 무효 — §5 evidence citation 강제 사용)

---

## Task 길이와 구조

| 길이 | 형식 |
|---|---|
| ~50-150자 | plain text 한 문단 |
| ~150-400자 | XML 구조 권장 |
| >400자 | XML 필수 — 핵심을 시작·끝에 반복 (lost-in-the-middle) |

---

## Pre-flight checklist (invoke 전)

- [ ] failure-condition framing? (directional 아님)
- [ ] 도메인·스케일·시간 지평 명시?
- [ ] Stake 명시 (이 결정이 잘못되면 무엇이 깨지는가)?
- [ ] 이미 검토한 것 / out-of-scope 명시?
- [ ] 출력 형식이 verifiable? (항목 수, 구조)
- [ ] 1인칭 표현 ("I think...") 없음?
- [ ] persona 부여 ("you are X") 없음?
- [ ] 자동주입 중복 ("be objective", "indicate confidence") 없음?
- [ ] secrets/internal paths 마스킹?
- [ ] >150자면 XML 구조?
- [ ] 복합 출력이면 positive + negative example 각 1개? (옵션마다 동일 구조 반복 출력이면 negative만으로 충분)

---

## Examples

### Bad
> "Microservices 좋은가요? I think it might be good. Be objective."

→ directional, 1인칭, 자동주입 중복.

### Good — 단순
> "Bun 1.3 백엔드(DAU 10만)가 Node.js LTS보다 운영상 나쁜 결과를 내는 구체 조건 3가지. 각 조건마다 (a) 사전 신호 (b) 회피 방법을 한 문단."

### Good — 트레이드오프 평가 (XML)
```
<context>
신규 SaaS, MVP 단계, 4명 풀스택 팀, 6개월 내 출시 목표.
</context>

<question>
PostgreSQL을 default DB로 쓰는 것이 MongoDB보다 나쁜 결과를 내는 구체 조건 3가지를 식별하라. 일반론 아닌 본 컨텍스트 기준.
</question>

<output-format>
조건마다:
- 조건 설명 + 어떤 기능/스케일에서 발현되는지 (한 문단)
- PostgreSQL 한정 회피책 또는 MongoDB가 더 나은 경계 (한 문단)
마지막 줄: "PostgreSQL 권장" 또는 "MongoDB 권장" 한 문장.
</output-format>
```

### Good — 복합 도입 결정 (XML, 모든 기법 포함)
```
<context>
50인 엔지니어 팀, 5년차 Ruby on Rails monolith.
일일 트랜잭션 200만, P95 latency 400ms.
</context>

<stake>
잘못된 결정 시 12-18개월 마이그레이션 인력 비용 + 기능 출시 정체.
</stake>

<already-considered>
- 모듈화 monolith (modular monolith) — 이미 결정에서 제외됨
- 단계적 strangler pattern — 본 결정에 포함되어 있음
</already-considered>

<question>
Rails monolith → microservices 마이그레이션 자체가 6개월~2년 시점에서 monolith 유지보다 나쁜 결과를 내는 조건 3가지를 식별하라.
</question>

<output-format>
조건마다:
- 조건 설명 + 사전 식별 가능한 기술/조직 신호 (한 문단)
- 회피 또는 완화 방법 (한 문단)
</output-format>

<bad-example>
"팀 사이즈가 작으면 microservices가 어렵다" — 일반론으로 빠짐. 본 컨텍스트(50인) 기준 구체 메커니즘이어야 함.
</bad-example>

<out-of-scope>
- 비용 정량 추정 (별도 분석 진행 중)
- 특정 vendor (k8s, AWS) 추천
</out-of-scope>

<premise-check>
위 전제(인원·트래픽·latency)에 명백한 모순이 있으면 답변 전 지적.
</premise-check>
```

---

## `--worker-instructions`

전 워커 동일 추가 지시. task와 별도 필요할 때만.

**Use**
- 도메인 framing — "Treat as a Bun runtime architecture choice"
- 출력 추가 제약 — "End with one recommended path in a single sentence"
- Evidence citation 강제 — "Cite a benchmark, source, or production case for each major claim"
- Surface dissent — "If your analysis diverges from the emerging consensus, state your dissent and the specific evidence"
- Substantive critique — "Each response must include at least one specific critique of another worker's position"

**Skip**
- 자동주입 중복
- persona
- 워커 lens와 충돌하는 강한 관점 — "비용 무시하라"는 "실용 제약" lens 워커와 모순. lens-agnostic하게

---

## Models / parameters

### `--models`
- `bun run src/cli.ts models`로 가용 확인
- ≥3 distinct provider 권장 (같은 family >50%면 가치 약화)

### `--max-rounds`
| 값 | 사용 |
|---|---|
| **3** | default. lens 활성, round 2에서 수렴 시 조기 종료 가능 |
| 4-5 | contested topic, budget 여유 |
| 2 | **수렴 task에서 금지** — 조기 종료 작동 안 함, 비용 절약 0. **예외: brainstorming workaround** (SKILL.md §1) — R1 lens 활성 위해 2 사용, R2 무시 |
| 1 | **금지** — lens·anti-conformity·조기 종료 모두 비활성 |

### `--count`
- default = model 수, hard cap 7
- ≥4면 inspect에서 ranking 추가

### `--factual true` (선택)
verifiable factual claim이 포함된 task면 inspect에 quality 검증 추가. 의견·설계·예측은 false 유지.

---

## Read output

### `convergence.level`
| level | 행동 |
|---|---|
| `high` | 응답 직접 read해 evidence quality 확인. heterogeneous에서는 contested topic도 자연 high — high 자체는 sycophancy 신호 X. **HIGH의 결정적 주장은 외부 도구나 다른 모델로 cross-check** |
| `moderate` + dissenter | dissenter 응답 **먼저** read. 소수 의견이 결과 뒤집는 경우 많음. **단 두 함정 검증**: (a) judge가 stale round로 라벨하는 경우 — final round에서 dissenter가 입장 변경했는지 직접 확인 (b) dissenter가 라운드마다 입장 flip(최종 추천 옵션이 round 사이 변경)하면 incoherent — discount하고 다수 합의로 진행. prior error 정정(같은 옵션 유지 + 근거 보완)은 flip 아님 |
| `moderate` no dissenter | split 명시하며 합성 |
| `diverse` | (a) 보완적 framing — 다양성 보존하며 합성 (b) 기본 사실 불일치 — task underspec, 재구성 |
| `unknown` | 응답 직접 read |
| `insufficient` | <2 응답 — worker 추가 재실행 |

### `confidence`
HIGH/MEDIUM/LOW 자동 파싱 (한국어 `신뢰도:` 포함). 동률 시 보수적인 것. evidence 약한 HIGH는 red flag — 응답 직접 read해 검증.

### `host_actions`
- `provider_diversity_low` — caveat, 가능 시 broader pool 재실행
- `self_judge_bias` — 다른 provider judge로 inspect 재실행. 가용 provider가 모두 worker pool에 있어 회피 불가능 시 두 cross-provider judge 결과(level + ranking) 일치하면 bias 상쇄로 간주, 진행
- `convergence is HIGH — reframe task as failure-conditions question` — judge가 task 형태를 검사 안 하고 항상 emit한다. **task가 이미 failure-condition framing이면 무시**. 그 경우 HIGH 자체 해석은 위 `convergence.level: high` 행만 적용

### `convergenceScore`
`level`과 mismatch (예: `level: high`, `status: diverging`)면 응답 직접 read.
`components.evidence: 0`인데 응답에 URL·official source·production case 다수 인용되면 형식 mismatch — 응답 직접 read 우선.

---

## Synthesis (shared-convergence 한정)

high convergence:
- 공통된 핵심 입장을 backbone으로
- 각 워커의 unique nuance·예시·caveat 누적 (잃지 마)
- HIGH-confidence 결정적 주장은 외부 검증 후 채택

moderate/diverse: SKILL.md `Synthesize` 섹션의 generic 패턴 (unique_contribution / loss_if_removed / gap check) 적용.

**Acceptance skip 조건** (호스트 판단, default skip):
- 사용자가 결정·추천·단일 답만 요청, 합성문 ratify를 명시 안 함
- 다수 워커 강한 수렴 + 잔여 dissenter가 incoherent (라운드별 flip)
- acceptance 추가 비용이 결론 자체를 바꿀 가능성 없음

위 조건 미해당 시 acceptance 실행. 1-3회 cap.

---

## Re-run / abort / iterate

**Re-run**
- HIGH but 모든 워커가 evidence 없이 같은 reasoning echo → 거짓 합의
- 한 워커 응답을 다른 워커가 그대로 echo → lazy agent
- `self_judge_bias` → 다른 provider judge
- `degradation` + 가용 pool 남음

**Iterate task wording**
첫 run의 워커 응답이 원하는 방향과 멀면 재실행 전 task 재작성. 흔한 원인:
- 제약이 약해서 워커들이 다른 차원을 답함 → 도메인·스케일 추가
- 출력 형식이 모호해 응답 형태가 비교 불가 → verifiable 명령으로
- directional 잔여 → failure-condition 강화

**Abort (사용자 escalate)**
- 2회 재실행에도 HIGH on contested 지속 → task 재구성 요청
- ≥3 provider 미달
- **`<premise-check>`에 워커 다수가 task 전제(부하·인원·SLA·timeline 등 숫자/사실)를 거부**: synthesis 진행 금지. 거부된 전제를 사용자에게 보고하고 task 수정 요청. 거짓 전제 위에서 합성하면 결론 자체가 무효

---

## Edge cases

| 상황 | deliberate 출력 | 행동 |
|---|---|---|
| 모든 워커 fail | `failedWorkers` ≥ 요청 수, `responses.length: 0` | 사용자에게 즉시 보고 (provider outage 또는 task가 모든 모델 reject 트리거 — 후자는 false-premise 의심) |
| `degradation` 다수 (active < min_viable) | engine이 `TeamDegradedError` throw | 가용 모델 풀 검토 후 narrower pool로 재실행. 동일 에러 재발 시 사용자 escalate |
| `cooldown` 폭주 (다수 모델 cooldown으로 풀 고갈) | 새 deliberate 호출 시 fallback chain 짧아져 즉시 fail 또는 단일 provider만 남음 | provider auth/quota 점검. 일시적이면 시간 두고 재실행, 반복되면 사용자 escalate |
| `modelSwaps` 발생 | `modelSwaps` array에 swap 기록 | (a) task에 vendor policy 명시 + 위반 시 결과 폐기, narrower `--models` 풀로 재실행 (b) policy 미명시면 swap 진행 가능. 단 swap으로 같은 family가 워커 풀의 >50% 차지하면 broader pool로 re-run (c) swap이 same-provider 약모델 fallback(예: pro→flash)이면 결과 신뢰도 약화 caveat 명시, 가능 시 broader pool로 re-run |
| 결과 JSON에 `convergence`·`convergenceScore` 없음 (inspect 미실행) | deliberate만 호출됨 | inspect 호출 누락 — pipe해서 재해석. SKILL.md workflow 5단계 |

