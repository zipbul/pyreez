# IMPROVE.md — pyreez SKILL.md 개선 지시문

작성: 2026-04-25
대상 파일: `.claude/skills/pyreez/SKILL.md`
실행 주체: 다른 에이전트 (Claude Code 또는 인간)
근거 자료: `docs/research/` 디렉토리

---

## 0. 사용 안내

이 문서는 **pyreez SKILL.md를 어떻게 개선해야 하는지의 지시서**다. 모든 변경 항목에:
- 현재 SKILL.md 상태
- 변경 후 상태
- 근거 출처 (`docs/research/` 파일 경로 + 원전 URL/저자/venue/년도)
- fact-check 방법

다른 에이전트는 이 IMPROVE.md를 읽고:
1. 각 변경의 근거를 `docs/research/`에서 확인
2. 의심 항목은 원전 URL 직접 cross-check
3. 변경 적용 후 §10 검증 체크리스트로 자가 점검

**준수 원칙**:
- 모든 변경은 검증된 출처에 근거 — 추론 금지
- 자료 부족 영역은 "no peer-reviewed evidence, defer to measurement" 명시
- preprint 인용은 [preprint] 라벨 필수
- SKILL.md에는 출처 인용 박지 마라 (SKILL은 운영 매뉴얼이지 학술 문서 아님). 출처는 본 IMPROVE.md와 docs/research/에서만.

---

## 1. 현 SKILL.md 분석 결과

### 1.1. 잘 되어 있는 것 (KEEP)
- `Workflow` 7단계 (Reframe → Pick models → Pick protocol → Run deliberate → Inspect → Synthesize → Acceptance)
- `Reframe the task` 섹션 (failure-condition framing — 근거: docs/research/01-task-specification.md §1)
- `Protocols` 6 프로토콜 매핑 표
- `Acceptance` cap 3 (잠정 — P0 측정 후 재검토)

### 1.2. 결함 (FIX)

| # | 결함 | 영향 |
|---|---|---|
| F1 | "How to ask" 섹션 부재 — 호스트가 task/workerInstructions 어떻게 쓸지 모름 | 모든 프로토콜에 영향 |
| F2 | `## CLI` 블록이 `--worker-instructions/--criteria/--subject/--questions` 미명시 | 프로토콜별 입력 누락 |
| F3 | "pyreez 자동 주입 항목 — 호스트 중복 금지" 박스 없음 | over-prompting 유발 |
| F4 | 프로토콜별 task 작성 가이드 없음 | 호스트가 직관 의존 |
| F5 | `convergenceScore.status: "diverging"` 처리 모호 ("Treat as alarm" 무행동) | inspect 출력 해석 혼란 |
| F6 | reasoning model worker (Claude 4.6 등) 가이드 없음 | 2026 시점 outdated |
| F7 | 사용 권장/회피 조건 명시 없음 (언제 pyreez 쓰면 안 되는가) | 가성비 의심 시 무대응 |

---

## 2. 변경 지시 — 공통 규칙 섹션 추가

### 2.1. SKILL.md에 신규 섹션 추가: "## How to ask (모든 프로토콜 공통)"

**위치**: `## Reframe the task` 바로 다음

**내용**:

```markdown
## How to ask (모든 프로토콜 공통)

### task 작성 규칙
- failure-condition 형태 ("X가 틀린 시나리오를 구성하라")
- false-premise 식별 명령 박기
- 핵심 task 문장은 user message 끝, 컨텍스트는 앞
- 1인칭 의견 금지 (sycophancy trigger)
- 자동주입 항목 중복 금지 (아래 박스 참조)

### task에 박지 말 것 (pyreez 자동 주입 — 호스트 중복은 over-prompting)
- "step by step" / "think carefully" / "reason systematically"
- "consider multiple perspectives" / "다양한 관점에서"
- "indicate confidence HIGH/MED/LOW"
- "be objective" / "don't agree just to please" / "verify your facts"
- "you are an expert in X" / persona 부여

### 모델 풀 규칙
- ≥3 distinct providers (Anthropic + Google + OpenAI/xAI)
- 같은 family 비율 >50%면 lens 자동 inject
- Reasoning model worker (Claude 4.6 / Sonnet 4.6 / Opus 4.6 / GPT-5.x reasoning / Gemini 3 thinking / Grok-4 reasoning)엔 prompt에 reasoning instruction 박지 마. API parameter (`thinking.effort`)로 대체.
```

**근거**:
- failure-condition framing → `docs/research/01-task-specification.md §1` (Liang EMNLP 2024)
- false-premise → `docs/research/01-task-specification.md §2` (Sharma ICLR 2024 + Nature npj Medical 2025)
- task layout → `docs/research/01-task-specification.md §3` (Liu TACL 2024)
- 1인칭 금지 → `docs/research/01-task-specification.md §4` (arxiv 2602.23971 [preprint])
- 자동주입 중복 금지 → `docs/research/01-task-specification.md §7` (Anthropic 2026 official)
- 모델 풀 ≥3 family → `docs/research/02-multi-agent-debate.md §4` (Heterogeneous Debate Engine arxiv 2603.27404 [preprint] + DMAD arxiv 2601.19921 [preprint])
- Reasoning model 가이드 → `docs/research/08-reasoning-models-2026.md §1` (Anthropic 2026 official)
- "step by step" 금지 → 동일 출처. 직접 인용: *"telling models to think 'step by step' in 2026 is either useless or actively counterproductive"*
- persona 금지 → `docs/research/06-persona-roles.md §1` (Zheng EMNLP 2024 Findings)

**fact-check 방법**:
- Anthropic 공식 docs: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Liang EMNLP 2024: https://aclanthology.org/2024.emnlp-main.992/
- Liu TACL 2024: https://aclanthology.org/2024.tacl-1.9/
- Zheng EMNLP 2024 Findings: https://aclanthology.org/2024.findings-emnlp.888/

---

## 3. 변경 지시 — "How to ask per protocol" 섹션 추가

### 3.1. SKILL.md에 신규 1급 섹션 추가: "## How to ask per protocol"

**위치**: 위 §2 바로 다음

각 프로토콜마다 다음 6 항목:
1. 언제 사용
2. task 박을 것
3. 추가 입력 (CLI flag)
4. 모델 풀
5. 흔한 실수
6. 좋은 예 / 나쁜 예

**구체 콘텐츠는 docs/research/07-protocol-specific.md 참조**. 본 IMPROVE.md는 SKILL.md에 들어갈 운영 규칙만 명시.

#### 3.1.1. shared_convergence

```markdown
### 1. shared_convergence (입장 수렴)

**언제**: 합의된 단일 입장 + 근거가 결과물

**task에 박을 것**
- 결정 + failure condition
- evaluation axes (≤5)
- "Resist agreement that lacks evidentiary support. Surface dissent explicitly."
- "Each contribution must include at least one substantive critique of another position; agreement-only is insufficient."

**모델 풀**: ≥3 family. 같은 family 비율 검사 후 heterogeneous 강제.
```

**근거**:
- "Resist agreement..." → `docs/research/02-multi-agent-debate.md §6` (CONSENSAGENT, ACL Findings 2025, https://aclanthology.org/2025.findings-acl.1141/)
- "Each contribution must..." → `docs/research/02-multi-agent-debate.md §5` (Lazy Agent, OpenReview ICLR 2026 [peer-reviewed-pending], https://openreview.net/forum?id=5J6u03ObRZ)
- heterogeneous 강제 → §2.1 동일 출처
- evaluation axes ≤5 → `docs/research/04-llm-as-judge.md §4-5` (G-Eval ρ 0.514 single axis, LLM-RUBRIC per-axis calibration)

#### 3.1.2. adversarial_debate

```markdown
### 2. adversarial_debate (약점/실패 시나리오 발견)

**언제**: 발견된 약점 우선순위가 결과물

**task에 박을 것**
- target + attack-surface 영역 + out-of-scope
- "Each finding must cite specific evidence (code line, doc reference, reproduction step)"
- "Speculative findings labeled as such, not presented as confirmed"

**금지**
- "라운드/agent 늘리면 더 안전" 가정 — 실제 효과 없음 (Nature 2026)
- "be careful, be objective" 류 prompt-only defense — 효과 없음 (Nature 2026)

**모델 풀**: heterogeneous 강제. 동질 풀은 사실상 무효 (ArCo 0.06 vs 1.00).
```

**근거**:
- "라운드/agent 늘리기 가정 금지", "prompt-only defense 무효" → `docs/research/02-multi-agent-debate.md §7` (Nature Scientific Reports 2026, https://www.nature.com/articles/s41598-026-42705-7)
- ArCo 0.06 vs 1.00 → `docs/research/02-multi-agent-debate.md §4` (Heterogeneous Debate Engine arxiv 2603.27404 [preprint])
- "specific evidence cite" → `docs/research/02-multi-agent-debate.md §7` (structural defense 권고)
- Moderator 역할 = pyreez `acceptance` → `docs/research/07-protocol-specific.md §2.3` (DebateCV arxiv 2507.19090v4 [preprint])

#### 3.1.3. host_interrogation

```markdown
### 3. host_interrogation (구조화 질문)

**언제**: 비교 가능한 N개 모델 독립 답변이 결과물

**task vs --questions 분리 강제**
- `--task`: 컨텍스트만
- `--questions "Q1,Q2,Q3"`: 실제 질문

**questions 작성**
- 각 질문은 hidden assumption 또는 inference gap 표면화 목적
- 단순 fact 질문이면 host_interrogation 부적합 → 다른 프로토콜 또는 단일 모델 호출
- 각 질문에 "어떤 답이면 통과/실패" 판정 기준 포함
```

**근거**:
- "hidden assumption / inference gap" → `docs/research/07-protocol-specific.md §3.1` (FOR-Prompting arxiv 2510.01674 [preprint])
- "machine-executable objective" → 동일 출처

#### 3.1.4. sequential_refinement

```markdown
### 4. sequential_refinement (반복 개선)

**언제**: 점진 개선된 단일 산출물이 결과물

**task에 박을 것**
- artifact-type + requirements + initial-input
- 각 워커는 plan-act-reflect-revise 4단계 명시
- 각 변경마다 (a)뭘 바꿨고 (b)왜 바꿨는지 1줄 로그

**모델 풀**: persistent memory across workers 확인 — pyreez engine이 이전 변경 로그 + 결정 근거를 다음 워커에 전달하는지 점검 (`src/deliberation/engine.ts` 확인)
```

**근거**:
- "plan-act-reflect-revise" → `docs/research/07-protocol-specific.md §4.2` (MCP-SIM, npj AI 2025, https://www.nature.com/articles/s44387-025-00057-z)
- persistent memory → 동일 출처
- Self-Refine 일반 정당화 → `docs/research/07-protocol-specific.md §4.1` (Madaan NeurIPS 2023)

#### 3.1.5. evaluation_scoring

```markdown
### 5. evaluation_scoring (기준 채점)

**task vs --criteria vs --subject 분리 강제**

**task에 박을 것** (RCAF 구조)
- Role + rubric Context + scoring Action + strict output Format
- 4 bias mitigation 명시: position-swap, verbosity normalization, cross-family judge, no authority cue
- 5축 이하

**criteria 작성**
- 5축 이하 (per-axis calibration 필수)
- 각 축은 operationalizable ("좋다" 아닌 "TypeScript strict 통과")

**subject**: 그대로 박기. 요약·축약 금지.

**필수 적용**
- pairwise primary, rubric absolute secondary
- 채점 워커 풀에 채점 대상 작성자 포함 금지 (self-enhancement)
- position-swap 강제 (judge call마다 candidate 순서 randomize)
```

**근거**:
- RCAF → `docs/research/04-llm-as-judge.md §6` (Anthropic 2026 official, https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- 4 bias → 동일 출처 + `docs/research/04-llm-as-judge.md §1, §3, §7` (MT-Bench NeurIPS 2023, IJCNLP 2025)
- 5축 이하 → `docs/research/04-llm-as-judge.md §4` (G-Eval EMNLP 2023 ρ 0.514) + `§5` (LLM-RUBRIC ACL 2024)
- pairwise > absolute → `docs/research/04-llm-as-judge.md §2` (MT-Bench + IJCNLP 2025)
- self-enhancement → `docs/research/04-llm-as-judge.md §7` (MT-Bench NeurIPS 2023)
- position-swap → `docs/research/04-llm-as-judge.md §3` (IJCNLP 2025, https://aclanthology.org/2025.ijcnlp-long.18/)

#### 3.1.6. red_team

```markdown
### 6. red_team (공격/방어)

**task = 3-component 분리 강제**
- (a) Original Input (공격 대상 시스템 명세)
- (b) Attack Objective (공격자 목표)
- (c) Attack Guidance (공격 표면 + threat model)

**필수 항목**
- threat-model: 공격자 능력/자원/목표
- scope + out-of-scope
- authorization 컨텍스트 (legal/ethical clarity)

**모델 풀 + max-rounds**
- `--max-rounds ≥3` (단발 round는 미달)
- 라운드 간 시도된 공격 누적 (memory-based — pyreez engine 확인 필요)
```

**근거**:
- 3-component 분리 → `docs/research/07-protocol-specific.md §6.1` (PromptAttack ICLR 2024, https://openreview.net/forum?id=VVgGbB9TNV)
- 5 modules + memory → `docs/research/07-protocol-specific.md §6.2` (AutoRedTeamer ICLR 2025, https://openreview.net/forum?id=DVmn8GyjeD)
- iterative `≥3 rounds` → `docs/research/07-protocol-specific.md §6.3` (PAIR/TAP)
- authorization → corpus 직접 권고 무, ICLR/NeurIPS 적법 사용 컨텍스트 일관 가정

---

## 4. 변경 지시 — `## CLI` 블록 확장

### 4.1. 현재 SKILL.md `## CLI` 블록

```bash
bun run src/cli.ts deliberate --task "..." --models "m1,m2,m3" --protocol <p> [--max-rounds N]
bun run src/cli.ts inspect --task "..." --judge <model> --deliberate -
bun run src/cli.ts fuse --task "..." --judge <model> --candidates '[{id, content}]' [--ranking '[{id, wins, losses}]']
bun run src/cli.ts acceptance --task "..." --synthesis "..." --workers '[{model, original_position, alignment?}]'
```

### 4.2. 변경 후 (확장)

```bash
# Deliberate (모든 프로토콜 공통)
bun run src/cli.ts deliberate --task "..." --models "m1,m2,m3" --protocol <p> [--max-rounds N] [--worker-instructions "..."]

# 프로토콜별 추가 입력
# - host_interrogation:
bun run src/cli.ts deliberate --task "..." --models "..." --protocol host_interrogation --questions "Q1,Q2,Q3"
# - evaluation_scoring:
bun run src/cli.ts deliberate --task "..." --models "..." --protocol evaluation_scoring --criteria "..." --subject "..."

# Inspect (deliberate 결과 분석)
bun run src/cli.ts inspect --task "..." --judge <model> --deliberate - [--factual true]

# Fuse (synthesis 초안 생성)
bun run src/cli.ts fuse --task "..." --judge <model> --candidates '[{id, content}]' [--ranking '[{id, wins, losses}]']

# Acceptance (synthesis 검증)
bun run src/cli.ts acceptance --task "..." --synthesis "..." --workers '[{model, original_position, alignment?}]'
```

**근거**:
- `--worker-instructions` 존재 확인 → `src/cli.ts:195`
- `--questions` 존재 확인 → `src/cli.ts:204`
- `--criteria --subject` 존재 확인 → `src/cli.ts:205-206`
- `--factual true` 존재 확인 → `src/handlers.ts` (별도 검증 필요)

**fact-check 방법**:
- `bun run src/cli.ts deliberate --help` 또는 `src/cli.ts:189-216` 직접 읽기

---

## 5. 변경 지시 — "자동 주입 항목" 박스 추가

### 5.1. SKILL.md에 신규 박스: "### pyreez가 자동 주입하는 것 — 호스트 절대 중복 금지"

**위치**: §2 "How to ask" 섹션 안

**내용**:

```markdown
### pyreez가 자동 주입하는 것 — 호스트 절대 중복 금지

| 자동주입 항목 | 위치 | 호스트가 task에 박지 말 것 |
|---|---|---|
| 3rd-person framing | prompts.ts:91 | "다른 의견을 제3자처럼 봐라" |
| GLOBAL_DEPTH (factual grounding, premise rejection, verify) | prompts.ts:32 | "근거 대고", "verify facts" |
| ANTI_CONFORMITY (R2+) | prompts.ts:45 | "be objective", "휘둘리지 마라" |
| ANTI_CONFORMITY_ADVERSARIAL (adversarial R2+) | prompts.ts:51 | "steelman 후 비판", "양보해라" |
| CONFIDENCE_AND_UNCERTAINTY (HIGH/MED/LOW) | prompts.ts:58 | "indicate confidence" |
| DEPTH_EXPLORE | prompts.ts:38 | "consider multiple approaches" |
| DEPTH_REFINE (sequential_refinement) | prompts.ts:41 | "improve while preserving" |
| DIVERSITY_LENSES (shared_convergence) | prompts.ts:148 | "각 관점에서" |
```

**근거**:
- 자동주입 목록 → `docs/research/01-task-specification.md §7`
- 중복 금지 일반론 → Anthropic 2026 official, "the prompt engineering advice from 2023 is wrong for 2026's frontier models"
- 각 항목 구현 위치 → `src/deliberation/prompts.ts` 직접 read

---

## 6. 변경 지시 — `convergenceScore.status: "diverging"` 처리

### 6.1. 현재 SKILL.md `## Read inspect output` 표

```
| `convergenceScore.status: "diverging"` | Treat as alarm; rare on single-provider runs |
```

### 6.2. 변경 후

```
| `convergenceScore.status: "diverging"` | `level: "diverse"`와 동일하게 처리 — 다양성 신호 |
```

**근거**:
- 현 표현 "Treat as alarm"은 호스트 행동 명령 부재 — 잠정 결정. P0 측정 후 정확한 의미 도출 필요. 그 전에는 alias 처리가 안전.
- 자료 부족 영역 → `docs/research/09-known-gaps.md`

---

## 7. 변경 지시 — Reasoning Model 가이드 섹션 추가

### 7.1. SKILL.md에 신규 섹션: "## Reasoning model worker (2026)"

**위치**: `## How to ask per protocol` 다음

**내용**:

```markdown
## Reasoning model worker (2026)

다음 모델들은 **adaptive thinking 또는 extended thinking 내장**:
- Anthropic: Claude 4.6 / Sonnet 4.6 / Opus 4.6
- OpenAI: GPT-5.x reasoning models (o-series)
- Google: Gemini 3 thinking
- xAI: Grok-4 reasoning

### 호스트 행동
- **task에 reasoning instruction 박지 마**:
  - "step by step" / "reason carefully" / "think systematically"
  - 위 모두 reasoning model에서 useless 또는 counterproductive
- **API parameter 사용**:
  - Claude 4.6: `thinking.effort = low/medium/high/max`
  - 다른 vendor: equivalent parameter (vendor docs 확인)
- **task 구조화**:
  - 문제를 multi-step으로 frame (예: "이 분석은 (1) 수집 (2) 평가 (3) 종합 단계를 거친다")
  - reasoning trace를 더 useful하게 함
  - "step by step" 강요와 다름 — frame은 problem structure, instruction은 thinking method
```

**근거**:
- 전 항목 → `docs/research/08-reasoning-models-2026.md §1` (Anthropic 2026 official)
- 직접 인용:
  - https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
  - https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
  - https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- "step by step" counterproductive → 위 첫 URL의 직접 quote

---

## 8. 변경 지시 — "언제 pyreez 쓰면 안 되는가" 섹션 추가

### 8.1. SKILL.md에 신규 섹션: "## When NOT to use pyreez"

**위치**: `## Workflow` 바로 다음

**내용**:

```markdown
## When NOT to use pyreez

다음 경우 pyreez 사용 비권장:

1. **단일 reasoning model + extended thinking으로 풀리는 task**
   - 단순 fact 질문, 짧은 요약, single-step 추론
   - test-time compute scaling이 multi-agent overhead보다 우월할 수 있음

2. **검증된 정답이 1개인 결정**
   - 표준 답이 있는 산수, 단순 코드 스타일 결정
   - deliberation은 oversight 추가하나 정답에는 도달

3. **Real-time 응답 필요 task**
   - pyreez는 multi-round multi-worker — 수십 초 ~ 분 단위
   - 즉시 응답 필요 시 단일 모델

4. **Worker pool homogeneous (모두 같은 family)**
   - heterogeneous diversity는 pyreez 효과의 핵심
   - homogeneous면 majority vote 또는 self-consistency가 충분

5. **시스템이 self-consistency baseline을 명확히 능가하지 못한 영역**
   - 2025-2026 연구는 "most MAD frameworks fail to surpass self-consistency" 지적
   - P0 measurement로 검증된 영역에서만 사용
```

**근거**:
- §1, §2 → `docs/research/02-multi-agent-debate.md §3` (arxiv 2505.22960 [preprint])
- §3 → 일반적 시스템 특성
- §4 → `docs/research/02-multi-agent-debate.md §4` (Heterogeneous Debate Engine arxiv 2603.27404 [preprint])
- §5 → §1과 동일 출처

---

## 9. 변경 지시 — 호스트 결정 트리 추가

### 9.1. SKILL.md에 신규 섹션: "## 호스트 결정 트리 (한 장 요약)"

**위치**: 문서 끝

**내용**:

```markdown
## 호스트 결정 트리

### 1. pyreez 써야 하나?
- 단일 reasoning model + thinking으로 풀림? → 단일 모델 호출
- heterogeneous diversity가 가치 있는 multi-perspective task? → pyreez
- (When NOT to use pyreez 섹션 확인)

### 2. 어떤 프로토콜?
- 합의된 단일 입장 → shared_convergence
- 발견된 약점 리스트 → adversarial_debate
- 비교 가능한 N개 답변 → host_interrogation
- 점진 개선된 산출물 → sequential_refinement
- 점수 + 근거 → evaluation_scoring
- 공격 시나리오 → red_team

### 3. task 작성 체크
- failure-condition 형태?
- false-premise 식별 명령 박았나?
- 자동주입 항목 중복 안 했나?
- 1인칭 의견 안 박았나?
- core task 문장이 user message 끝에?

### 4. 모델 풀 체크
- ≥3 distinct family?
- Reasoning model이면 prompt에 reasoning instruction 안 박았나?
- 같은 family >50%면 lens 자동 inject 작동?

### 5. 프로토콜 추가 입력 체크
- host_interrogation: --questions 박았나?
- evaluation_scoring: --criteria + --subject 박았나?
- 다른 프로토콜: --worker-instructions 적절히 사용했나?
```

**근거**:
- 모든 항목 → 위 §2-7 종합

---

## 10. 검증 체크리스트 (다른 에이전트가 적용 후 자가 점검)

다른 에이전트가 본 IMPROVE.md를 적용한 뒤 다음을 확인:

- [ ] SKILL.md에 "How to ask (모든 프로토콜 공통)" 섹션 추가됨 (위 §2)
- [ ] task 작성 규칙 5개 항목 모두 명시 (failure-condition, false-premise, layout, no 1인칭, no 중복)
- [ ] "task에 박지 말 것" 8개 항목 명시
- [ ] "pyreez 자동 주입" 박스 8개 항목 + prompts.ts line 명시
- [ ] "How to ask per protocol" 1급 섹션 추가됨 (위 §3)
- [ ] 6 프로토콜 모두 (1)언제 (2)task 박을 것 (3)CLI 입력 (4)모델 풀 (5)금지 항목 충족
- [ ] CLI 블록 확장: `--worker-instructions`, `--criteria`, `--subject`, `--questions` 명시
- [ ] `convergenceScore.status: "diverging"` alias 처리
- [ ] "Reasoning model worker (2026)" 섹션 추가됨 (위 §7)
- [ ] "When NOT to use pyreez" 섹션 추가됨 (위 §8)
- [ ] 호스트 결정 트리 섹션 추가됨 (위 §9)
- [ ] SKILL.md 어디에도 학술 출처/인용 없음 (출처는 본 IMPROVE.md + docs/research/에만)
- [ ] 모든 변경 항목의 근거가 docs/research/ 또는 원전 URL로 추적 가능

---

## 11. 변경 후 SKILL.md 예상 구조 (참고)

```
# pyreez SKILL

(frontmatter)

## Workflow (KEEP)
## When NOT to use pyreez (NEW — §8)
## Reframe the task (KEEP)
## Protocols (KEEP)
## How to ask (모든 프로토콜 공통) (NEW — §2)
  ### task 작성 규칙
  ### task에 박지 말 것
  ### pyreez 자동 주입 항목 — 호스트 절대 중복 금지 (NEW — §5)
  ### 모델 풀 규칙
## How to ask per protocol (NEW — §3)
  ### 1. shared_convergence
  ### 2. adversarial_debate
  ### 3. host_interrogation
  ### 4. sequential_refinement
  ### 5. evaluation_scoring
  ### 6. red_team
## Reasoning model worker (2026) (NEW — §7)
## CLI (확장 — §4)
## Read inspect output (FIX — §6)
## Synthesize (KEEP)
## Acceptance (KEEP, 단 cap=3 잠정 명시)
## 호스트 결정 트리 (NEW — §9)
```

---

## 12. 변경 시 주의

1. **SKILL.md에 학술 출처 박지 마라** — SKILL은 운영 매뉴얼. 출처는 본 IMPROVE.md와 docs/research/에서만.
2. **자료 부족 영역은 "no peer-reviewed evidence, defer to measurement"로 명시** — 추정으로 메꾸지 마.
3. **Reasoning model 부분은 vendor 변화에 민감** — Anthropic adaptive thinking은 2026-04-25 시점. 분기마다 docs 재확인.
4. **본 IMPROVE.md도 잠정** — pyreez bench 실측 + 인간 expert review 거치지 않음. 본 문서의 한계는 `docs/research/09-known-gaps.md` 참조.
5. **Preprint 의존 항목**: §3.1.2 (Heterogeneous Debate Engine, DebateCV), §3.1.4 (CollabCoder), §3.1.6 (AutoRedTeamer 논문 일부). 향후 venue 확인 시 등급 격상 또는 재검토.

---

## 13. fact-check 도구

```bash
# 모든 docs/research/ 파일 목록
ls docs/research/

# 특정 출처가 docs/research/에서 인용된 위치 검색
grep -rn "Liang.*EMNLP 2024" docs/research/

# 원전 URL 검증 (curl 또는 web fetch)
curl -I https://aclanthology.org/2024.emnlp-main.992/

# pyreez 코드 line 검증
grep -n "ANTI_CONFORMITY" src/deliberation/prompts.ts
```

---

## 14. 추가 작업 (별도 트랙)

본 IMPROVE.md는 **SKILL.md 변경에만 한정**. 다음은 별도 작업:
- 코드 변경 (`src/synthesis/fuser.ts`에 confidence numeric mapping 등) — 별도 IMPLEMENT.md 또는 phase별 PR
- P0 measurement infrastructure (bench/cases.ts 인간 라벨링) — 별도 BENCH.md
- 인간 expert review — 외부 채널

본 IMPROVE.md 적용은 **코드 변경 0, SKILL.md 문서 변경만**. 즉시 ship 가능.
