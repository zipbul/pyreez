# `red_team` — User Agent Full Context

소비 에이전트가 `red_team` 프로토콜로 deliberate를 호출할 때 컨텍스트에 로드되는 자료 verbatim merge.
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

# Part 2 — `red_team` deep playbook

> 출처: `docs/protocol-prompts/red_team/playbook.md`

# red_team

비대칭 역할 — `generator`가 산출물 생성, `attacker`가 공격. default 2 라운드 (gen → attack → gen 재반영). 보안 robustness·adversarial 검증용.

---

## When to use
- 보안 리뷰 — auth flow, input validation, crypto 사용, injection 방어
- prompt·LLM 출력 robustness — jailbreak·injection 저항
- API endpoint·spec의 misuse 가능성 발굴
- 공격 시나리오 + 방어 강화 한 사이클

## When to skip
- 일반 weakness 발굴 (역할 비대칭 불필요) → `adversarial_debate`
- 점수 → `evaluation_scoring`
- 합의된 입장 → `shared_convergence`
- 점진 개선 → `sequential_refinement`

---

## 입력 구조

| 필드 | 역할 |
|---|---|
| `--task` | 산출물·target 설명 |
| `roles` (API: `Record<workerIndex, "generator"\|"attacker">`) | 역할 분배 |
| `--worker-instructions` | 양 역할 동일 추가 지시 (도메인 framing 등) |

`roles` 미지정 시 기본 분배는 코드 확인 필요 (사용 전 `roles` 명시 권장).

---

## Task 작성 룰

자동 주입:
- **Generator**: depth(global only) + "Think through edge cases, failure modes, adversarial inputs" + "Anticipate how output could be attacked or misused" + "Produce strongest version. Address known weakness proactively"
- **Attacker**: depth(global only) + "Find concrete, consequential weaknesses (attack·misuse·misread·omission) — not theoretical" + "specific scenario or proof showing the harm" + severity ranking(critical>high>medium>low) + "Do not fabricate vulnerabilities" + "If robust, say so"

DEPTH_EXPLORE/REFINE **미주입**. CONFIDENCE fragment **미주입** — attacker는 severity로 신뢰도 표현.

### 1. Target·threat model 명시
공격 대상의 환경·신뢰 boundary 명시:
- "production web API, 인증된 user만 접근, but session token client-side 저장"
- "internal LLM agent, untrusted user input → tool call 가능"
- "open source library, attacker는 모든 코드 read 가능"

threat model 없으면 attacker가 비현실적 공격 fabricate.

### 2. Scope 제한
공격 범위 명시:
- "L7 attack only" / "supply chain 제외"
- "OWASP Top 10 2025 해당 항목만"
- "input validation·auth·session에 한정"

scope 없으면 attacker가 unbounded — 모든 critique를 critical로 표기하는 noise 발생.

### 3. Generator 결과물 형식 강제
`--task`는 generator가 무엇을 출력할지도 정의:
- "TypeScript 함수 + 사용 예시 + 가정 list"
- "API endpoint spec + auth flow + error handling"
- 결과물 형식 모호하면 attacker가 공격할 surface가 불분명

### 4. Severity 기준 명시
자동 주입의 severity (critical/high/medium/low) 외 도메인 정의 추가 가능:
- "critical = pre-auth RCE / data exfil 가능, high = auth 우회, medium = info disclosure, low = best practice deviation"

### 5. False positive 차단
attacker 자동 주입에 "Do not fabricate" 있으나 보강:
> "각 attack은 (a) 실행 가능 시나리오 (b) 영향 범위 (c) PoC 또는 spec·CVE·case 인용. 인용 불가능하면 제외."

### 6. 자동주입 중복 금지
- generator: "produce strongest version", "anticipate attacks", "edge case"
- attacker: "find weakness", "concrete consequential (attack·misuse·misread·omission)", "severity ranking", "do not fabricate"
- 양쪽: "no preamble", premise reject

---

## Pre-flight checklist

- [ ] threat model·scope 명시?
- [ ] generator 출력 형식 정의?
- [ ] severity 기준 도메인-구체화?
- [ ] PoC·CVE·spec 인용 강제?
- [ ] models ≥2 (engine 강제)?
- [ ] `roles` 명시 (기본 분배 의존 회피)?
- [ ] secrets·실제 prod credential 마스킹? (특히 attacker가 실제 시도 안내 가능성 — 안전 inputs only)

---

## Examples

### Bad
> "이 API 보안 검토해."

→ threat model 없음, scope 없음, 형식 없음 → attacker가 fabricate 가능.

### Good — auth flow red team
```
<context>
Production SaaS, JWT 기반 auth. token client-side localStorage 저장.
threat model: external attacker (network·browser 접근), authenticated insider, supply chain 제외.
scope: OWASP Top 10 2025 + JWT-specific (RFC 8725) 위반.
</context>

<target>
다음 auth flow를 generator가 구현. attacker가 공격 발굴.

POST /login → JWT 발급 (HS256, 24h)
Authorization: Bearer <jwt> → API 보호된 endpoint 접근
POST /refresh → 새 JWT
</target>

<output-format>
Generator: 구현 코드 + 사용 가정 + 알려진 weakness 사전 대응.
Attacker: 각 발견:
- severity (critical/high/medium/low — 도메인 정의 따름)
- 공격 시나리오 (한 문단, 실행 가능)
- evidence (CVE·RFC·case 인용)
- 방어 권장 (한 문단)
</output-format>

<severity-definitions>
critical = token 위조·session hijack·pre-auth bypass
high = post-auth privilege escalation·session fixation
medium = info disclosure·rate-limit 우회
low = best practice 미준수 (functional impact 없음)
</severity-definitions>
```

---

## `--worker-instructions`

양 역할에 동일 적용.

**Use**
- 도메인 framing — "Treat as RFC 8725 (JWT BCP) compliance"
- evidence threshold — "Reject findings without CVE·RFC·published case"
- scope 강화 — "Ignore DOS attacks below 10 req/sec"

**Skip**
- 자동주입 중복 (양 역할 모두)
- 역할별 차별 instruction 필요하면 task 안의 별도 섹션으로

---

## Models / parameters

### `--models`
- **min 2 강제** (engine)
- 권장: generator 1 + attacker ≥2 (다른 provider). attacker 다양성이 발견 다양성에 직결
- 같은 family generator + attacker는 self-judge bias 유사 — 가급적 다른 provider

### `--max-rounds`
default **2** (`wire.ts`).
| 값 | 사용 |
|---|---|
| 2 | gen → attack → gen 재반영. 일반 |
| 3-4 | 중대 보안 검토, attacker 추가 발견 라운드 |
| 1 | gen만 또는 attack만 — 비권장 (red_team 의미 약화) |

### `--count`
generator 1 + attacker N. attacker 다양화로 false negative 감소.

---

## Read output

### convergence judge 의미 약화
`inspect`의 convergence는 동일 task에 평행 응답 비교 — red_team은 비대칭이므로 무의미. inspect 사용 시 quality findings만 활용.

권장: 응답 직접 read.

### 결과 분류
- generator final 출력 = 강화된 산출물
- attacker final 출력 = 발견된 vulnerability list (severity 정렬)
- raw round별 attack 진행을 회귀 검증 — 라운드별로 새 vuln 발견 vs 동일 vuln 재서술

### 합성
- attacker의 critical/high를 dedupe·rank
- generator final이 critical/high 모두 mitigate했는지 검증
- 미해결 critical 있으면 산출물 채택 금지
- attacker가 "robust" 선언 시 confidence: 모든 attacker 동의 후 채택. 1명만 robust면 보수적으로 vuln 남았다고 가정

### False positive 검증
attacker 발견 중 다음 패턴은 의심:
- evidence·CVE 인용 없음 → 자동 주입 "do not fabricate" 위반 가능 — 무시 또는 제외
- "이 코드는 input validation 부족하다"라는 일반론 — 구체 attack scenario 없으면 무시
- severity inflation (모두 critical) — task의 severity 정의 위반

---

## Re-run / abort

**Re-run**
- attacker 모두 "robust" 선언 → false negative 의심. broader pool 또는 attacker만 다른 provider로 재실행
- attacker 발견 모두 일반론·fabricate 의심 → threat model + evidence 강제 보강
- generator가 attacker 지적 무시 → "각 attack에 대한 명시적 mitigation 표시" 강제 추가
- `self_judge_bias` (provider 겹침) → narrower pool 또는 다른 attacker provider

**Abort**
- 2회 재실행에도 attacker 발견이 fabricate 패턴 지속 → task threat model 또는 scope 근본 결함. 사용자 escalate
- generator 또는 attacker 모두 fail → policy violation 가능성, 사용자 escalate
- ≥2 provider 미달

---

## Edge cases

| 상황 | 행동 |
|---|---|
| `roles` 미지정 시 기본 분배 불명 | API 호출 시 항상 `roles` 명시 — 기본 동작 의존 회피 |
| Generator 첫 라운드 출력이 형식 violation | attacker가 공격 surface 못 잡음. 첫 라운드 출력 read 후 task 명확화하고 재실행 |
| Attacker가 generator 산출물 외 영역 공격 (off-target) | scope·threat model 명시 보강 후 재실행 |
| 모든 attacker 결과 critical만 | severity 정의 task 안에 명시. 워커가 inflate한 결과 무시 또는 제외 |
| `modelSwaps` 발생 | swap된 워커 역할 동일하게 유지되는지 확인. role drift 시 결과 폐기 |
| Sensitive content (실제 prod credential·CVE 진행 중) task에 포함됨 | task fan-out 이슈 — 모든 워커 provider가 read. 실제 secrets 절대 금지, sanitize된 fixture 사용 |

