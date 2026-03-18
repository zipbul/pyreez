# 프롬프트 · 컨텍스트 · 하네스 엔지니어링 레퍼런스

> 2026-03-18 작성. 모든 항목은 출처가 명시된 검증된 사실만 포함.

---

## Part A — 학술 연구 기반

### A1. Lost in the Middle: U자형 위치 편향

LLM은 입력의 **시작과 끝에 더 높은 주의(attention)를 할당**하고, 중간에 위치한 정보를 놓친다.

- 답이 포함된 문서를 20개 문서 중 1번째에서 10번째로 이동시키면 정확도 **30%+ 하락** (GPT-3.5, GPT-4, Claude 1.3, LLaMA-2에서 모두 관찰)
- 기술적 원인: Rotary Position Embedding(RoPE)의 dot product가 멀리 떨어진 토큰 간에 자연 감쇠
- **완화**: 가장 중요한 정보를 프롬프트의 **시작 또는 끝**에 배치. 쿼리를 끝에 놓으면 응답 품질 최대 30% 개선

> 출처: Liu et al., "Lost in the Middle: How Language Models Use Long Contexts" (2023); "Found in the Middle: Calibrating Positional Attention Bias" ([arxiv 2406.16008](https://arxiv.org/abs/2406.16008))

**스킬 작성 시사점**: 핵심 지시(Phase 완료 조건, 절대 건너뛰면 안 되는 단계)는 프롬프트 **시작 또는 끝**에 배치. 중간에 매몰되면 누락 확률 상승.

---

### A2. SIFo: 순차 지시 준수 벤치마크

순차적으로 의존하는 지시들의 준수를 측정하는 벤치마크. 4개 태스크(텍스트 수정, QA, 수학, 보안 규칙)로 구성.

**핵심 발견:**
- **모든 모델이 순차 지시에서 고전함**. GPT-4도 2번째 지시부터 유의미한 성능 하락
- 지시 수가 늘수록 **단조 감소(monotonic decline)**
- 실패 모드 1 — **정보 혼합(Information Blending)**: 개별 지시의 세부사항이 서로 오염
- 실패 모드 2 — **사전 지식 할루시네이션**: 명시적 지시 대신 학습 데이터의 연관성에 의존
- 더 크고 새로운 모델이 유의미하게 우수하나, 여전히 불충분

> 출처: Chen et al., "The SIFo Benchmark: Investigating the Sequential Instruction Following Ability of Large Language Models" (EMNLP 2024 Findings, [arxiv 2406.19999](https://arxiv.org/abs/2406.19999))

**스킬 작성 시사점**: 다단계 워크플로우에서 지시가 많아질수록 후반 지시의 누락률이 올라간다. 각 단계를 **독립적으로 검증 가능한 단위**로 분리하고, 단계 간 의존성을 명시하는 것이 중요.

---

### A3. The Instruction Gap

LLM의 명시적 지시 준수 능력과 실제 성능 사이의 격차를 분석.

**핵심 발견:**
- **위치 편향**: 뒤에 배치된 지시는 더 자주 무시됨
- **지시 현저성(salience)**: 명시적 포맷팅(대문자, 마커)이 준수를 개선
- **구조적 분리**: 지시와 콘텐츠 사이의 명확한 구분이 효과적
- **지시 반복**: 긴 프롬프트에서 핵심 지시를 반복하면 준수율 20-35% 회복
- **구조화된 템플릿**: 준수율 약 25% 개선

> 출처: "The Instruction Gap: LLMs get lost in Following Instructions" ([arxiv 2601.03269](https://arxiv.org/abs/2601.03269), 2026)

**스킬 작성 시사점**: 핵심 규칙("acceptance 전에 유저에게 출력하지 마라")을 프롬프트 내에서 **반복 배치**하는 것이 효과적. 지시와 배경 설명을 XML 태그로 구분하면 파싱 정확도 상승.

---

### A4. Instruction Hierarchy: 지시 우선순위

시스템 메시지 > 유저 메시지 > 제3자 콘텐츠의 3단계 우선순위 체계.

**방법론:**
- **Context Synthesis** (정렬된 지시): 복합 요청을 분해하여 다른 계층에 배치, 원래 응답 재현하도록 훈련
- **Context Ignorance** (충돌 지시): 하위 계층 지시가 없었던 것처럼 응답하도록 훈련

**핵심 결과:**
- 시스템 프롬프트 추출 방어 63% 향상
- 훈련 중 본 적 없는 공격 유형에도 일반화
- **충돌 시**: 하위 계층 지시를 무시하거나 거부

> 출처: Wallace et al., "The Instruction Hierarchy: Training LLMs to Prioritize Privileged Instructions" (OpenAI, [arxiv 2404.13208](https://arxiv.org/abs/2404.13208), ICLR 2025)

**스킬 작성 시사점**: Claude Code에서 SKILL.md는 user message로 전달되므로 시스템 프롬프트보다 낮은 우선순위. 시스템 프롬프트의 "be concise" 지시와 스킬의 "상세히 출력하라" 지시가 충돌하면, **시스템 프롬프트가 이길 가능성이 높다**. 이것이 Phase 3 누락의 구조적 원인일 수 있다.

---

### A5. Metacognitive Prompting (MP)

인간의 내성적 추론 과정을 LLM 프롬프팅에 적용. SKILL.md의 합성 프로세스가 이 연구에 기반.

**5단계 프레임워크:**
1. 입력 텍스트 이해
2. 예비 판단
3. 예비 분석에 대한 **비판적 평가**
4. 추론이 수반된 **최종 결정**
5. 전체 과정에 대한 **신뢰도 평가**

**핵심 결과:**
- 10개 NLU 데이터셋에서 기존 프롬프팅 방법 대비 일관적 우위
- GPT-4, GPT-3.5, PaLM2, Llama2에서 모두 효과 확인
- Zero-shot과 5-shot 모두에서 효과적

> 출처: Wang & Zhao, "Metacognitive Prompting Improves Understanding in Large Language Models" (NAACL 2024, [ACL Anthology](https://aclanthology.org/2024.naacl-long.106/), [arxiv 2308.05342](https://arxiv.org/abs/2308.05342))

---

### A6. LLM이 지시를 건너뛰는 원인 종합

여러 연구에서 확인된 원인:

| 원인 | 메커니즘 | 출처 |
|------|---------|------|
| 제한된 주의 범위 | 주의 메커니즘이 긴 입력에서 약화, 후반 지시에 초점 감소 | SIFo, Instruction Gap |
| 토큰 처리 제약 | 고정 토큰 한도 초과 시 절단 | Unite.AI 종합 |
| 학습 데이터 편향 | 단순 지시가 훈련 데이터에 압도적으로 많아 복잡한 다단계를 회피 | SIFo, Unite.AI |
| 정보 희석 | 프롬프트가 길거나 반복적이면 주의가 분산 | Lost in the Middle |
| 출력 복잡성 | 여러 지시가 충돌하면 부분적/모호한 답변 생성 | SIFo |

**연구에서 확인된 완화 기법:**

| 기법 | 효과 | 출처 |
|------|------|------|
| 태스크를 작은 단위로 분리 | 주의 희석 방지 | Unite.AI, SIFo |
| 명시적 포맷팅 (번호, 불릿) | 개별 항목 인식률 향상 | Instruction Gap |
| 핵심 지시 반복 | 준수율 20-35% 회복 | Instruction Gap |
| Chain-of-Thought | 단계별 순차 처리 유도 | SIFo, Unite.AI |
| 별도 프롬프트로 분리 | 건너뛰기 위험 제거 (느리지만 확실) | Unite.AI |
| "모든 단계를 완료하라" 명시 | 중요성 신호 강화 | Unite.AI |

---

## Part B — 하네스 엔지니어링

### B1. 하네스 엔지니어링 정의

> "AI 에이전트를 감싸는 인프라, 제약, 피드백 루프를 설계하는 학문"

4가지 핵심 메커니즘:
- **Constraining**: 에이전트가 할 수 있는 것의 경계 (아키텍처 제약, 의존성 규칙)
- **Informing**: 에이전트에게 목적 전달 (컨텍스트 엔지니어링, 문서)
- **Verifying**: 올바른 실행 확인 (테스트, 린팅, CI)
- **Correcting**: 실수 수정 (피드백 루프, 자기 수정)

> 출처: [NxCode, "Harness Engineering: The Complete Guide"](https://www.nxcode.io/resources/news/harness-engineering-complete-guide-ai-agent-codex-2026) (2026)

---

### B2. 성능 근거

- LangChain: 하네스만 변경하여 Terminal Bench 2.0에서 52.8% → 66.5% (모델 변경 없이 Top 30 → Top 5)
- OpenAI: 5개월간 100만+ 줄 코드, 수동 작성 0줄. 하네스가 전체 품질을 제어

> 출처: NxCode (2026), 위와 동일

---

### B3. 미들웨어 패턴 (LangChain)

```
Agent Request
→ LocalContextMiddleware (코드베이스 매핑)
→ LoopDetectionMiddleware (반복 방지)
→ ReasoningSandwichMiddleware (계산 최적화)
→ PreCompletionChecklistMiddleware (검증 강제)
→ Agent Response
```

**PreCompletionChecklistMiddleware**가 핵심: 에이전트가 응답 제출 전에 체크리스트를 강제 실행. 이것이 Phase 건너뛰기 문제의 하네스 레벨 해결책.

> 출처: NxCode (2026)

---

### B4. OpenDev 터미널 에이전트 아키텍처

2026년 발표된 AI 코딩 에이전트 설계 논문에서 확인된 패턴:

**ReAct 루프 6단계:**
1. 사전 검사 + 압축
2. 사고(thinking)
3. 자기 비판(self-critique)
4. 행동(action) — LLM 호출
5. 도구 실행 — 승인 체크 포함
6. 후처리 — 반복 or 종료 결정

**이벤트 기반 리마인더:**
- 단일 시스템 프롬프트만으로는 장기 세션에서 지시 준수 유지 불가
- 특정 조건(반복 실패, 컨텍스트 한도 접근, 모드 전환) 감지 시 **맥락 인식 리마인더 주입**
- `role: user`로 주입하여 시스템 안내와 대화 이력을 구분

**5단계 Progressive Compaction:**
1. 보존 윈도우 밖의 가장 오래된 메시지 제거
2. 오래된 에피소드 메모리 요약
3. 비핵심 관찰 제거
4. 토큰 예산 기반 절단
5. 예산 초과 시 공격적 가지치기

**핵심 교훈:**
- "제약이 솔루션 공간을 좁혀 에이전트를 더 생산적으로 만든다"
- "에이전트에게 좋은 코드를 쓰라고 말하는 대신, 좋은 코드의 모양을 기계적으로 강제하라"
- Plan Mode에서는 쓰기 도구를 스키마에서 **아예 제거** — "LLM이 사용할 수 없는 도구 정의를 보지 않으면, 쓰기 시도 자체가 불가능"

> 출처: "Building AI Coding Agents for the Terminal: Scaffolding, Harness, Context Engineering, and Lessons Learned" ([arxiv 2603.05344](https://arxiv.org/abs/2603.05344), 2026)

---

### B5. 컨텍스트 엔지니어링

> "컨텍스트에 접근할 수 없는 것은 존재하지 않는다. Google Docs, Slack 스레드, 사람 머릿속의 지식은 시스템에 보이지 않는다. 레포지토리가 유일한 진실의 원천이어야 한다."

- **Static Context**: 레포 문서, CLAUDE.md, 설계 문서 (린터로 검증)
- **Dynamic Context**: 관찰 데이터 (로그, 메트릭), 디렉토리 구조, CI/CD 상태
- **Context Offloading**: 정보를 LLM 컨텍스트 외부에 저장. 코딩 에이전트가 `plan.md` 파일을 만들어 작업하면서 업데이트하는 것이 대표적 예시

> 출처: NxCode (2026); Simon Willison, "Context Engineering" (2025-2026, [simonwillison.net](https://simonwillison.net/tags/context-engineering/))

---

### B6. 가드레일 3계층

| 계층 | 메커니즘 | 예시 |
|------|---------|------|
| **결정적 린터** | 규칙 기반 자동 검증 | 아키텍처 의존성 위반 감지 |
| **LLM 감사자** | 에이전트가 다른 에이전트의 코드 리뷰 | 설계 원칙 준수 확인 |
| **구조적 테스트** | ArchUnit 유사, AI 생성 코드용 | 패턴 강제, 의존성 감사 |

> 출처: NxCode (2026)

---

## Part C — Anthropic 공식 프롬프트 엔지니어링 (검증 완료)

### C1. 핵심 원칙

| 원칙 | 설명 | 출처 |
|------|------|------|
| 명확성과 직접성 | "프롬프트를 최소한의 맥락만 아는 동료에게 보여줘라. 그들이 혼란스러우면 Claude도 혼란스럽다" | Anthropic Best Practices |
| 맥락/동기 부여 | "절대 말줄임표 쓰지 마라" → "TTS 엔진이 읽을 것이므로 말줄임표를 쓰지 마라. 발음 방법을 모른다" | 동일 |
| XML 태그 구조화 | 지시/컨텍스트/예시/입력을 각자의 태그로 감싸면 오해석 감소 | 동일 |
| Few-shot 예시 | 3-5개, `<example>` 태그로 감싸, 관련성·다양성·구조화 | 동일 |
| 긍정형 지시 | "마크다운 쓰지 마라" → "매끄러운 산문 문단으로 작성하라" | 동일 |
| Long context 배치 | 긴 데이터는 상단, 쿼리/지시는 하단. 쿼리를 끝에 놓으면 품질 최대 30% 향상 | 동일 |

> 출처: [Anthropic, "Prompting best practices"](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/claude-prompting-best-practices)

### C2. Claude 4.6 특성 (공식 확인)

| 특성 | 공식 문구 |
|------|----------|
| 시스템 프롬프트 민감도 증가 | "Claude Opus 4.5 and Claude Opus 4.6 are also more responsive to the system prompt than previous models. If your prompts were designed to reduce undertriggering on tools or skills, these models may now overtrigger. The fix is to dial back any aggressive language." |
| 간결한 스타일 | "More direct and grounded... Less verbose: May skip detailed summaries for efficiency unless prompted otherwise" |
| Prefill 지원 중단 | "Starting with Claude 4.6 models, prefilled responses on the last assistant turn are no longer supported" |
| 과도한 탐색 | "Claude Opus 4.6 does significantly more upfront exploration than previous models" |
| 서브에이전트 과다 사용 | "Claude Opus 4.6 has a strong predilection for subagents and may spawn them in situations where a simpler, direct approach would suffice" |
| 과잉 엔지니어링 | "Claude Opus 4.5 and Claude Opus 4.6 have a tendency to overengineer" |

> 출처: 동일 (Anthropic Best Practices)

### C3. 자기 검증

> "Before you finish, verify your answer against [test criteria]. This catches errors reliably, especially for coding and math."

### C4. CoT 가이던스

> "Prefer general instructions over prescriptive steps. A prompt like 'think thoroughly' often produces better reasoning than a hand-written step-by-step plan. Claude's reasoning frequently exceeds what a human would prescribe."

> "Multishot examples work with thinking. Use `<thinking>` tags inside your few-shot examples to show Claude the reasoning pattern."

> 출처: 동일

---

## Part D — Claude Code 시스템 프롬프트 작성 패턴 분석

이 대화의 시스템 프롬프트에서 직접 관찰한 작성 패턴.

### D1. 섹션 구조

```
# 대주제 (Role, System, Doing tasks, Using your tools, Tone and style...)
 ## 소주제 (있으면)
  - 불릿 포인트로 규칙 나열
  - 각 규칙은 한 문장 또는 짧은 문단
```

### D2. 지시 어휘 패턴

| 패턴 | 예시 (시스템 프롬프트 원문) | 의미 |
|------|---------------------------|------|
| `IMPORTANT:` 접두사 | "IMPORTANT: Assist with authorized security testing..." | 절대적 제약 |
| `Prefer X over Y` | "Prefer editing existing files to creating a new one" | 강한 선호, 예외 허용 |
| `Reserve X for Y` | "Reserve using the Bash exclusively for system commands" | 용도 제한 |
| `Do NOT` | "Do NOT use the Bash to run commands when a relevant dedicated tool is provided" | 명시적 금지 |
| `When X, Y` | "When referencing specific functions... include the pattern file_path:line_number" | 조건부 규칙 |
| `If X, do Y. Otherwise Z` | "If they are available... Check that all the required parameters..." | 분기 규칙 |
| 동사형 시작 | "Lead with the answer or action, not the reasoning" | 직접적 행동 지시 |

### D3. "What Not To Do" 패턴

시스템 프롬프트의 "Output efficiency" 섹션:
```
Focus text output on:
- Decisions that need the user's input
- High-level status updates at natural milestones
- Errors or blockers that change the plan
```

**패턴**: "하지 마라"보다 "이것에 집중하라"로 표현. 부정형 최소화.

### D4. 예시 배치

시스템 프롬프트에서 예시는 `<example>` 태그 안에 배치:

```xml
<example>
user: "Please write a function that checks if a number is prime"
assistant: I'm going to use the Write tool...
<commentary>
Since a significant piece of code was written...
</commentary>
</example>
```

- `<commentary>` 태그로 예시의 의도를 설명
- 예시가 지시 바로 뒤에 배치되어 맥락 유지

### D5. 도구 설명 패턴

```
- Tool description: 한 문장 설명
- Usage notes: 불릿 리스트로 사용 조건
- IMPORTANT/CRITICAL: 키 제약만
```

### D6. 간결성 지시의 구체적 어휘

```
"Go straight to the point"
"Be extra concise"
"Lead with the answer or action, not the reasoning"
"Skip filler words, preamble, and unnecessary transitions"
"If you can say it in one sentence, don't use three"
```

이 어휘들이 스킬 내부의 "상세히 출력하라" 지시와 **직접 충돌**한다.

---

## Part E — Claude Code 플랫폼 기법 (공식 문서)

상세 내용은 공식 문서 링크 참조. 여기서는 스킬/규칙 작성에 직접 필요한 핵심만 기록.

### E1. 지시문 전달 계층

| 계층 | 전달 방식 | 강제력 | 공식 문서 |
|------|----------|--------|----------|
| 시스템 프롬프트 | system message | 하드 | 내장, 수정 불가 |
| `--append-system-prompt` | system message 추가 | 하드 | [CLI Reference](https://code.claude.com/docs/en/cli-reference) |
| CLAUDE.md | user message | 소프트 | [Memory](https://code.claude.com/docs/en/memory) |
| Rules | user message | 소프트 | [Memory](https://code.claude.com/docs/en/memory) |
| Skills | user message (on-demand) | 소프트 | [Skills](https://code.claude.com/docs/en/skills) |
| **Hooks** | **도구 이벤트에 셸/HTTP/LLM 실행** | **결정적** | [Hooks](https://code.claude.com/docs/en/hooks) |

> "CLAUDE.md content is delivered as a user message after the system prompt, not as part of the system prompt itself. Claude reads it and tries to follow it, but there's no guarantee of strict compliance."
> — [Claude Code Memory 문서](https://code.claude.com/docs/en/memory)

### E2. Hooks — 유일한 결정적 강제

| 이벤트 | 차단 가능 | 핵심 용도 |
|--------|----------|----------|
| `PreToolUse` | exit 2 또는 `permissionDecision: "deny"` | 도구 실행 전 게이트 |
| `PostToolUse` | `decision: "block"` | 실행 후 검증/피드백 주입 |
| `Stop` | exit 2 | **응답 종료 전 품질 게이트** |
| `UserPromptSubmit` | exit 2 | 프롬프트 검증, 컨텍스트 주입 |

핸들러 유형: `command` (셸), `http`, `prompt` (Haiku LLM), `agent` (도구 접근 가능한 서브에이전트)

> 공식 문서: [Hooks](https://code.claude.com/docs/en/hooks)

### E3. 스킬 3단계 지연 로딩

1. **메타데이터** (세션 시작): description만 ~100 토큰
2. **본문** (호출 시): SKILL.md 전체
3. **지원 파일** (on-demand): Claude가 Read로 직접 열 때만

> 공식 문서: [Skills](https://code.claude.com/docs/en/skills)

### E4. 경로 스코프 Rules

```yaml
---
paths:
  - "src/api/**/*.ts"
---
```

매칭 파일을 **읽을 때만** 로드. 전역 규칙보다 컨텍스트 효율적.

> 공식 문서: [Memory](https://code.claude.com/docs/en/memory)

---

## Part F — 이 프로젝트에서 관찰된 사실

### F1. 도구 호출 게이트 vs 텍스트 단계

이번 실행에서 관찰:
- **도구 호출 기반 단계** (deliberate, accept, feedback): **전부 준수**
- **순수 텍스트 단계** (Phase 1, 2, 3): Phase 3 완전 누락, Phase 1 불완전

### F2. 반복 패턴

| 대화 | 건너뛴 단계 | 공통 패턴 |
|------|-----------|----------|
| 이전 (메모리 기록) | Validate | 결과물 생성 → 빨리 보고하려는 모멘텀 → 후속 검증 누락 |
| 이번 | Phase 3 (Reflect) | 합성 초안 생성 → acceptance로 빨리 넘어가려는 모멘텀 → 반성 단계 누락 |

### F3. IMPROVE_DELIBERATION.md 항목 4와의 관계

항목 4 "Acceptance/Feedback 실행 강제"는 효과가 있었다 (이번 실행에서 둘 다 지켜짐). 그러나 같은 논리가 **synthesize 내부 Phase에는 적용되지 않음** — 이것이 현재 갭.

---

## Part G — 프롬프트 템플릿 구조 패턴 (연구 기반)

> 출처: Zheng et al., "From Prompts to Templates: A Systematic Prompt Template Analysis for Real-world LLM Apps" ([arxiv 2504.02052](https://arxiv.org/abs/2504.02052), 2025)

### G1. 효과적인 템플릿 컴포넌트 순서

실제 LLM 앱 프롬프트 템플릿을 체계적으로 분석한 결과, 가장 빈번한 컴포넌트 배치 순서:

```
1. Profile/Role        (87% 확률로 첫 번째)
2. Directive            (65% 확률로 첫 번째 또는 두 번째)
3. Context + Workflows  (일관된 쌍)
4. Output Format/Style + Constraints  (유연한 내부 순서)
5. Examples             (~20% 템플릿에서 마지막)
```

### G2. 지시 스타일

> "90% 이상의 directive가 instruction style(명령형)로 작성됨" — 질문형보다 명령형이 효과적.

### G3. 제약 전략

개발자들이 가장 많이 쓰는 제약 유형은 **배제 제약(exclusion constraints)** (전체의 46%):
- 정확성/관련성 (할루시네이션 방지)
- 미지에 대한 명확성 (추측 방지)
- 출력 제어 (중복 감소)
- 기술적 제한

**정량적 결과**: 긍정 지시에 배제 제약을 결합하면 형식 준수율이 극적으로 향상. LLaMA3에서 "JSON 외 다른 출력을 하지 마라" 추가 시 준수율 40% → 100%.

### G4. 입력 데이터 배치

> "Knowledge Input을 task instruction **앞에** 배치하면 역순보다 우수. LLaMA에서 Content-following +0.91 향상."

이것은 A1(Lost in the Middle)의 "긴 데이터는 상단에" 원칙과 일치.

### G5. 속성 명세의 상세도

JSON 출력 요구 시 상세도에 따른 형식 준수 점수:

| 패턴 | 점수 (5점 만점) |
|------|---------------|
| JSON 스키마만 | 3.09 |
| JSON + 속성 이름 | 4.66 |
| JSON + 이름 + 설명 | 4.90 |

**시사점**: 출력 포맷을 요구할 때 "이 형식으로 출력하라"보다 "이 필드명과 설명을 가진 형식으로 출력하라"가 훨씬 효과적.

---

## Part H — 스킬 작성 규칙 (Anthropic 공식 + 연구 종합)

### H1. 워크플로우 체크리스트 패턴

Anthropic 공식 스킬 작성 가이드에서 명시한 다단계 워크플로우 패턴:

> "Break complex operations into clear, sequential steps. For particularly complex workflows, provide a checklist that Claude can copy into its response and check off as it progresses."

```markdown
Copy this checklist and track your progress:

Task Progress:
- [ ] Step 1: Analyze (run analyze.py)
- [ ] Step 2: Create mapping (edit fields.json)
- [ ] Step 3: Validate mapping (run validate.py)
- [ ] Step 4: Execute (run fill.py)
- [ ] Step 5: Verify output (run verify.py)
```

> "Clear steps prevent Claude from skipping critical validation. The checklist helps both Claude and you track progress through multi-step workflows."

> 출처: [Anthropic Skill Authoring Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

### H2. 피드백 루프 패턴

> "Common pattern: Run validator → fix errors → repeat. This pattern greatly improves output quality."

```markdown
1. 편집 수행
2. 즉시 검증: python validate.py
3. 검증 실패 시:
   - 에러 메시지 검토
   - 수정
   - 다시 검증
4. 검증 통과할 때만 진행
```

> 출처: 동일

### H3. 자유도 매칭

| 자유도 | 사용 시점 | 형태 |
|--------|----------|------|
| **높음** | 여러 접근이 유효, 맥락에 따라 결정 | 텍스트 지시 |
| **중간** | 선호 패턴이 있지만 변형 허용 | 의사코드, 파라미터가 있는 스크립트 |
| **낮음** | 작업이 취약하고 일관성이 핵심 | 구체적 스크립트, 수정 불가 명시 |

> 비유: "좁은 다리 + 절벽" (낮은 자유도) vs "장애물 없는 넓은 들판" (높은 자유도)

> 출처: 동일

### H4. 검증 가능한 중간 산출물

> "When Claude performs complex, open-ended tasks, it can make mistakes. The 'plan-validate-execute' pattern catches errors early by having Claude first create a plan in a structured format, then validate that plan with a script before executing it."

**패턴**: analyze → **계획 파일 생성** → **계획 검증** → 실행 → 확인

**왜 효과적인가:**
- 오류를 일찍 잡음
- 기계 검증 가능
- 원본을 건드리지 않고 계획 반복
- 에러 메시지가 구체적 문제를 가리킴

> 출처: 동일

### H5. 간결성 원칙

> "The context window is a public good. Your Skill shares the context window with everything else Claude needs to know."
>
> "Only add context Claude doesn't already have. Challenge each piece of information:
> - 'Does Claude really need this explanation?'
> - 'Can I assume Claude knows this?'
> - 'Does this paragraph justify its token cost?'"

SKILL.md 본문은 **500줄 미만**. 초과 시 지원 파일로 분리.

> 출처: 동일

### H6. 참조 깊이 제한

> "Keep references one level deep from SKILL.md. All reference files should link directly from SKILL.md."

```
❌ SKILL.md → advanced.md → details.md → 실제 정보
✅ SKILL.md → advanced.md (직접)
   SKILL.md → reference.md (직접)
   SKILL.md → examples.md (직접)
```

100줄 초과 참조 파일은 상단에 목차(TOC)를 포함해야 Claude가 부분 읽기 시에도 전체 범위를 파악.

> 출처: 동일

---

## Part I — Before/After: 연구 발견을 스킬 작성에 적용

### I1. 핵심 지시의 위치 (A1 + A3 + G4 적용)

**Before** (핵심 지시가 중간에 매몰):
```markdown
## Metacognitive Synthesis Process

### Phase 1 — Comprehend each worker
For each worker, identify: ...

### Phase 2 — Evaluate and ground
...

### Phase 3 — Reflect before finalizing
Answer before presenting:
- What am I most uncertain about, and why?
...
```

**After** (핵심 지시를 시작과 끝에 반복 배치):
```markdown
## Metacognitive Synthesis Process

CRITICAL GATE: Phase 3 (Reflect)를 완료하지 않으면 acceptance를 호출할 수 없다.

### Phase 1 — Comprehend each worker
...

### Phase 2 — Evaluate and ground
...

### Phase 3 — Reflect before finalizing
...

REMINDER: Phase 3의 세 질문에 각각 구체적 변경사항을 식별한 후에만 acceptance로 진행하라.
```

**근거**: Instruction Gap [4]에서 핵심 지시 반복이 준수율 20-35% 회복. Lost in the Middle [1]에서 시작/끝 배치가 주의 확보에 효과적.

### I2. 강제 출력 템플릿 (G5 + H1 적용)

**Before** (자유 서술):
```markdown
For each worker, identify:
- Unique contribution no other worker provides.
- Most unexpected claim.
- What your synthesis loses if this worker is removed.
```

**After** (속성명 + 설명이 있는 템플릿):
```markdown
Phase 1 분석을 아래 형식으로 출력하라. 모든 필드를 채울 것.

### Worker: [모델명]
- **unique_contribution**: 다른 워커가 제공하지 않는 이 워커만의 고유 기여
- **most_unexpected_claim**: 가장 예상하지 못한 주장 (한 문장)
- **loss_if_removed**: 이 워커를 제거하면 합성이 구체적으로 잃는 것

(워커 수만큼 반복)
```

**근거**: 템플릿 연구 [16]에서 "속성명 + 설명"이 형식 준수 점수 3.09 → 4.90. Anthropic 공식 [17]에서 체크리스트 패턴이 단계 건너뛰기 방지.

### I3. 배제 제약 결합 (G3 적용)

**Before** (긍정 지시만):
```markdown
Workers disagree → determine which has stronger evidence.
```

**After** (긍정 + 배제 결합):
```markdown
Workers disagree → determine which has stronger evidence.
Do not present both positions as parallel options (Path A / Path B).
Choose the position with stronger evidence and adopt it as the synthesis direction.
```

**근거**: 템플릿 연구 [16]에서 긍정 지시 + 배제 제약 결합 시 LLaMA 준수율 40% → 100%.

### I4. Stop Hook으로 Phase 완료 강제 (B4 + E2 적용)

현재 스킬의 Phase 1/2/3은 순수 텍스트 지시라서 건너뛰기에 취약하다 (F1에서 관찰). Stop hook을 사용하면 **응답 종료 전에 품질 게이트**를 건다.

**설정** (`.claude/settings.json`):
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "다음은 Claude의 마지막 응답이다: $ARGUMENTS. 이 응답이 pyreez 스킬의 deliberation 합성 과정의 일부라면, Phase 1 (각 워커별 unique_contribution, most_unexpected_claim, loss_if_removed), Phase 2 (검증 라벨 [x]/[ ]), Phase 3 (세 가지 반성 질문 + 구체적 변경사항)이 모두 포함되어 있는지 확인하라. 누락된 Phase가 있으면 {\"decision\": \"block\", \"reason\": \"Phase N 미완료\"} 를 반환하라. deliberation이 아니거나 모든 Phase가 완료되었으면 빈 JSON을 반환하라.",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

**동작**: Claude가 합성 응답을 끝내려 할 때 → prompt hook이 Haiku에게 Phase 완료 여부 검증 → 미완료 시 exit 2로 차단 → Claude가 stderr 피드백을 받고 계속 작업.

**근거**: OpenDev 논문 [7]의 이벤트 기반 리마인더 패턴. Claude Code 공식 문서 [14]의 Stop hook 차단 메커니즘. NxCode [8]의 PreCompletionChecklistMiddleware 패턴.

**주의**: Stop hook의 `stop_hook_active` 필드를 체크하여 무한 루프를 방지해야 함 ([14] 참조).

---

## 출처 색인

### 학술 논문

| ID | 논문 | 발표 |
|----|------|------|
| [1] | Liu et al., "Lost in the Middle" | 2023 |
| [2] | "Found in the Middle: Calibrating Positional Attention Bias" | [arxiv 2406.16008](https://arxiv.org/abs/2406.16008) |
| [3] | Chen et al., "The SIFo Benchmark" | EMNLP 2024, [arxiv 2406.19999](https://arxiv.org/abs/2406.19999) |
| [4] | "The Instruction Gap" | [arxiv 2601.03269](https://arxiv.org/abs/2601.03269), 2026 |
| [5] | Wallace et al., "The Instruction Hierarchy" | OpenAI, ICLR 2025, [arxiv 2404.13208](https://arxiv.org/abs/2404.13208) |
| [6] | Wang & Zhao, "Metacognitive Prompting" | NAACL 2024, [arxiv 2308.05342](https://arxiv.org/abs/2308.05342) |
| [7] | "Building AI Coding Agents for the Terminal" | [arxiv 2603.05344](https://arxiv.org/abs/2603.05344), 2026 |

### 산업 자료

| ID | 자료 | 출처 |
|----|------|------|
| [8] | "Harness Engineering: The Complete Guide" | [NxCode](https://www.nxcode.io/resources/news/harness-engineering-complete-guide-ai-agent-codex-2026), 2026 |
| [9] | "Why LLMs Skip Instructions" | [Unite.AI](https://www.unite.ai/why-large-language-models-skip-instructions-and-how-to-address-the-issue/) |
| [10] | "Context Engineering" | [Simon Willison](https://simonwillison.net/tags/context-engineering/), 2025-2026 |
| [11] | "Agents at Work: 2026 Playbook" | [Prompt Engineering Org](https://promptengineering.org/agents-at-work-the-2026-playbook-for-building-reliable-agentic-workflows/) |

### 공식 문서

| ID | 문서 | URL |
|----|------|-----|
| [12] | Anthropic Prompting Best Practices | [platform.claude.com](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/claude-prompting-best-practices) |
| [13] | Claude Code Skills | [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) |
| [14] | Claude Code Hooks | [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks) |
| [15] | Claude Code Memory | [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) |
| [16] | Zheng et al., "From Prompts to Templates" | [arxiv 2504.02052](https://arxiv.org/abs/2504.02052), 2025 |
| [17] | Anthropic Skill Authoring Best Practices | [platform.claude.com](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) |
| [18] | Claude Code Hooks Quality Gates | [Dev Genius](https://blog.devgenius.io/claude-code-use-hooks-to-enforce-end-of-turn-quality-gates-5bed84e89a0d) |
