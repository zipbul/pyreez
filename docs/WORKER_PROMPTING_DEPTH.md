# Worker Prompting Depth — 사고 깊이 극대화 설계

> 최종 업데이트: 2026-03-21
> 근거 기준: 2025-2026 소스만 사용. 2024 이전 소스는 "시간 불문 원리"만 유지.

## 핵심 질문

멀티모델 구조에서, 각 워커와 호스트의 사고 깊이를 극대화하려면 프롬프팅/컨텍스트/하네스가 무엇을 해야 하는가?

---

## 1. 최신 모델 제공사 공식 가이던스 (2025-2026)

### 1.1 3사 공통 패턴 (Anthropic + OpenAI + Google 교차 검증)

| 원칙 | Anthropic (Claude 4.6) | OpenAI (GPT-5) | Google (Gemini 3) |
|------|------------------------|----------------|-------------------|
| **Over-prompting 제거** | "CRITICAL: You MUST..." → "Use this when..." | 공격적 지시가 overtriggering 유발 | 짧은 큐에서 구조를 더 잘 인식 |
| **모델이 자체 추론 깊이 조절** | Adaptive Thinking (자동 사고 깊이) | Reasoning Effort dial | 기본 온도 1.0 유지 필수 |
| **XML 태그 구조화** | 주력 권장 | 효과적 (GPT-5도 XML 지원) | XML 또는 Markdown (혼용 금지) |
| **긴 문서 상단, 질문 하단** | 30% 성능 향상 | 캐시 최적화 | 명시적 권장 |

**출처:**
- [Anthropic Claude 4 Best Practices](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices) (공식)
- [GPT-5 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide) (OpenAI Cookbook)
- [Gemini 3 Prompting Guide](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/gemini-3-prompting-guide) (Google Cloud)

### 1.2 Adaptive Thinking > 명시적 CoT

Claude 4.6의 `thinking: {type: "adaptive"}`가 수동 CoT보다 일관적으로 우수 (Anthropic 공식).
Reasoning 모델에서 "think step by step" 추가 시 성능 향상 미미(2.9%) + 레이턴시 80% 증가 (교차 검증됨).

**pyreez 시사점:** 워커 프롬프트에서 단계별 추론을 구조적으로 강제하는 것이 역효과일 수 있음. 모델의 자체 reasoning에 맡기되, **방향만 제시**하는 것이 최신 best practice.

### 1.3 구조화 출력이 추론을 방해한다 — 2-step 접근 필요

"Let Me Speak Freely?" 연구: JSON/XML 모드 강제 시 reasoning 작업에서 **10-15% 성능 저하**.

**Best practice (교차 검증됨):** 자유형식 추론 → 구조화 변환 (2-step approach).
Anthropic 공식도 동일: "thinking은 자유형식, output은 structured."

**pyreez 시사점:** 현재 `<position>/<evidence>/<concerns>/<certainty>` XML 구조를 강제하는 것이 추론 품질을 떨어뜨리고 있을 수 있음.

### 1.4 순서가 중요하다 — reasoning before answer

모델은 순차 토큰 생성. 구조화 출력에서 reasoning 필드가 answer 필드보다 앞에 와야 함.

**현재 pyreez: `<position>`이 첫 필드 = 결론을 먼저 commit → 나머지가 방어 모드로 생성. 정확히 반대.**

---

## 2. Context Engineering (2025-2026)

### 2.1 정의

Andrej Karpathy (2025.06) + Philipp Schmid (2025) + Anthropic (2025.09) 교차 검증:

> "에이전트 실패 대부분은 모델 실패가 아니라 context 실패다." — Schmid

Context engineering = 모델의 context window에 들어가는 모든 것(system prompt, tool 정의, 검색 결과, 메시지 히스토리, tool output, 상태)을 최적으로 설계하는 것.

Prompt engineering이 "어떻게 물어볼까"라면, context engineering은 "모델이 무엇에 접근할 수 있는가" 전체.

### 2.2 핵심 원칙: 최소 고신호 토큰 (Anthropic 공식)

> "Good context engineering means finding the **smallest possible set of high-signal tokens** that maximize the likelihood of some desired outcome."

더 많은 context ≠ 더 나은 추론. 무관한 정보가 "context confusion"을 유발.

**출처:** [Anthropic - Effective Context Engineering for AI Agents (2025.09.29)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

### 2.3 Lost-in-the-Middle — 아키텍처적 원인 확인 (MIT 2025)

LLM은 context 시작과 끝 정보에 과도하게 집중, 중간 정보를 무시하는 U자형 패턴.
MIT (2025.06): RoPE가 long-term decay를 유발하여 시퀀스 시작/끝 토큰을 우선시.

**pyreez 시사점:** 워커에게 보내는 메시지에서 task를 user message 끝에 배치하는 현재 구조(`prompts.ts:215`)는 올바름. 단, debate R2+에서 다른 워커 응답이 중간에 위치하면 무시될 수 있음.

**출처:** [MIT News (2025.06)](https://news.mit.edu/2025/unpacking-large-language-model-bias-0617)

### 2.4 Compaction 전략 (JetBrains NeurIPS 2025)

| 전략 | 효과 |
|------|------|
| Observation Masking (환경 관찰만 제거, 액션/추론 보존) | 비용 ~50% 감소, 성능 유의미한 저하 없음 |
| LLM Summarization (전체 압축) | masking 대비 일관된 우위 없음 |
| 조합 | 각각 대비 7-11% 추가 비용 절감 |

**pyreez 시사점:** debate R2+에서 이전 라운드 공유 시 full response 대신 digest만 공유하는 현재 방식(`extractDebateDigest`)이 compaction 원칙에 부합. 단, digest 추출이 핵심 추론을 보존하는지 검증 필요.

**출처:** [JetBrains Research (NeurIPS 2025)](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)

### 2.5 Anthropic의 에이전트 Context 4전략 (2025.09)

1. **Compaction** — 히스토리 요약 압축 후 새 window 재시작
2. **Structured Note-Taking** — window 외부에 노트 지속 기록, 필요 시 재주입
3. **Multi-Agent Architecture** — 서브에이전트가 격리된 context에서 작업, 결과만 반환
4. **Tool Result Clearing** — 오래된 tool 결과 제거

---

## 3. Harness Engineering (2025-2026)

### 3.1 Harness > Model (교차 검증됨)

동일 모델이 harness 유무에 따라 코딩 벤치마크에서 **42% vs 78%** 성공률.
**모델 자체보다 harness가 결과에 2배 더 큰 영향.**

Harness = scaffolding(첫 프롬프트 전 조립) + orchestration(이후의 모든 것).

**출처:**
- [Martin Fowler - Harness Engineering](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html) (2026)
- [OpenAI - Harness Engineering](https://openai.com/index/harness-engineering/) (2026)

### 3.2 Harness 3대 구성요소

1. **Context Engineering** — 지속적으로 강화되는 지식 베이스
2. **Architectural Constraints** — deterministic linter/structural test로 제약 모니터링
3. **Garbage Collection Agents** — 비일관성/제약 위반 주기적 탐지

### 3.3 LLM-as-Judge 바이어스 (교차 검증됨)

| 바이어스 | 규모 | 완화 전략 |
|---------|------|-----------|
| Position bias | GPT-4 40% 비일관성 | 순서 변경 평가 (A,B)+(B,A) |
| Verbosity bias | ~15% 팽창 | 길이 정규화 |
| Self-enhancement bias | 자기 모델 선호 | 다른 모델 패밀리를 판정자로 |

**pyreez 시사점:** external-evaluator가 단일 모델로 평가하면 self-enhancement + position bias 발생 가능. 팀 내 provider와 다른 provider의 모델을 evaluator로 사용하는 현재 설계(`teamProviders` 체크)는 올바른 방향.

**출처:**
- [Label Your Data (2026)](https://labelyourdata.com/articles/llm-as-a-judge)
- [Evidently AI](https://www.evidentlyai.com/llm-guide/llm-as-a-judge)
- [arXiv 2508.02994](https://arxiv.org/html/2508.02994v1)

---

## 4. 현재 프롬프트의 문제점 (코드 검증 완료)

### 4.1 Over-prompting

현재 프롬프트 예: `"Your response MUST be at least 200 characters."`, `"Structure your response. Min 200 characters, max 600 words."`

3사 공식 가이드 모두 최신 모델에서 이런 강한 지시를 완화하라고 권고. 과도한 제약이 모델의 자연스러운 reasoning을 방해.

### 4.2 출력 구조가 추론을 방해

`<position>` 먼저 → commit-then-defend 패턴 강제 (§1.4).
`max 3 points` → evidence 인위적 제한.
구조화 출력 자체가 reasoning 10-15% 저하 가능 (§1.3).

### 4.3 모델의 자체 reasoning depth를 활용 안 함

Claude 4.6의 Adaptive Thinking, GPT-5의 reasoning effort, Gemini 3의 기본 온도 1.0 — 최신 모델은 스스로 사고 깊이를 조절하는 기능이 있다. 현재 pyreez는 이를 전혀 활용하지 않고, 모든 모델에 동일한 temperature=1.0, max_tokens=2048을 적용.

### 4.4 코드에서 확인된 구체적 문제

| 문제 | 위치 | 상세 |
|------|------|------|
| R2+에서 역할 행동 지침 소실 | `prompts.ts:302-312` | R1의 역할별 행동 지침이 generic debater + anti-sycophancy로 대체 |
| 도메인 맥락 워커 부재 | `types.ts:98-103` | SharedContext에 domain 없음. evaluator에만 존재 |
| Evaluator-Worker 차원 불일치 | 전체 | `internally_consistent` guidance 0%, IDEATION `novel_perspective` 0.40인데 Advocate/Critic 가이드 없음 |
| truncated 응답 무시 | `wire.ts:95`, `engine.ts` | `finish_reason === "length"` 감지하지만 engine이 확인 안 함 |
| debate R2+ 중간 배치 | `prompts.ts:267-275` | 다른 워커 응답이 user message 중간에 위치 → Lost-in-the-Middle 효과 가능 |

---

## 5. Multi-Agent Deliberation 최신 근거

### 5.1 MAD < Self-Consistency (ICLR 2025, 교차 검증됨)

- MMLU: Self-Consistency 82.13% vs MAD 74.73%
- Multi-Persona debate는 거의 모든 데이터셋에서 underperform
- **예외: 이종 모델 조합** (GPT-4o-mini + Llama3.1-70b)은 MMLU 88.20%

**출처:** [ICLR 2025 MAD Benchmark](https://d2jud02ci9yv69.cloudfront.net/2025-04-28-mad-159/blog/mad/)

### 5.2 A-HMAD — Adaptive Heterogeneous Multi-Agent Debate (Springer 2025)

- 각 에이전트의 신뢰도 기반 합의 최적화기
- 6개 벤치마크에서 4-6% 절대 정확도 향상, 팩트 오류 30%+ 감소
- **핵심: 동질 모델 debate는 다수결 수렴. 이종 모델 조합이 효과적.**

**출처:** [Springer 2025](https://link.springer.com/article/10.1007/s44443-025-00353-3)

### 5.3 MoA Collaborativeness (ICLR 2025 Spotlight)

- 다른 모델의 답변을 참조하면 win rate 향상 — **낮은 품질의 참조도 효과적**
- Heterogeneous 응답이 동일 모델 복수 응답보다 더 큰 기여

**pyreez 시사점:** diverge-synth에서 R1 독립 응답 후 호스트가 참조하는 현재 구조는 collaborativeness를 활용. debate R2+에서 다른 워커 응답을 보여주는 것도 부합. 핵심은 **이종 모델 구성**.

---

## 6. 시간 불문 구조 원리 (수학/인지과학)

아래는 모델 세대와 무관하게 유효한 구조적 원리:

- **Condorcet Jury Theorem**: 독립 voter의 정답 확률 > 0.5이면 voter 수 증가 시 정답 수렴 (수학)
- **앙상블 loss = bias + variance - diversity** (JMLR 수학적 분해)
- **ACH**: confirmation bias 차단을 위한 반증 중심 분석 (인지과학)
- **Toulmin Model**: Claim-Grounds-Warrant-Backing-Qualifier-Rebuttal 논증 구조 (논리학)
- **Hidden Profile**: 집단 토론에서 공유 정보가 비공유 정보를 지배. 사전 불일치가 해결책 (인지과학)
- **Delphi 4 메커니즘**: 익명성, 구조화된 피드백, 반복 개선, 불일치 활용 (조직이론)

---

## 7. 설계 방향

### 7.1 즉시 적용 가능 (프롬프트 수준)

1. **Over-prompting 완화**: "MUST", "CRITICAL", 최소 글자 수 제약 제거. 간결하고 직접적인 지시로 교체.
2. **출력 구조 순서 변경**: position을 마지막으로. reasoning/analysis → position 순서.
3. **"max 3 points" 제거**: evidence 양을 모델에게 맡김.
4. **R2+에서 역할 행동 지침 복원**: 역할 이름만이 아닌 핵심 행동 규칙 유지.
5. **도메인 힌트 워커 주입**: SharedContext에 domain 추가, 역할별 도메인 맥락 제공.
6. **R2+ message 순서 최적화**: 다른 워커 응답(중간)보다 task(끝)가 더 잘 기억됨을 활용.

### 7.2 아키텍처 수준 변경

7. **2-step 출력**: 자유형식 reasoning → 구조화 변환. 또는 구조를 느슨하게 (XML 태그 가이드만 제공, 강제하지 않음).
8. **동적 max_tokens**: 도메인/역할/라운드별 차등.
9. **truncated 응답 처리**: engine에서 truncated 플래그 확인, 재시도 또는 경고.
10. **Evaluator-Worker 차원 정렬**: evaluator가 검사하는 차원에 대한 guidance를 워커에게도 제공.

### 7.3 실험으로 검증해야 하는 것

11. **구조화 출력 제거 vs 순서 변경 vs 유지**: 어느 것이 pyreez 맥락에서 최적인지 (연구는 2-step이 최선이라고 하지만, pyreez는 호스트가 파싱해야 하므로 tradeoff).
12. **Adaptive Thinking 활성화**: Claude 4.6 워커에서 adaptive thinking 사용 시 deliberation 품질 변화.
13. **debate 라운드 수 vs 독립 응답 수**: 라운드 줄이고 모델 수 늘리는 게 나은지 (MAD < SC 연구 기반).
14. **소진 압력 vs 방향 전환**: "가장 취약한 가정 하나만 명명하라" 식의 간결한 방향 전환이 깊이를 만드는지.

---

## 8. 기존 docs 감사 결과

| 문서 | 신뢰도 | 핵심 문제 |
|------|--------|-----------|
| PROMPT_ENGINEERING_REFERENCE.md | 중상 | A1/A5 (2023) 재검증 필요. Anthropic 공식 가이드(C)는 유효. OpenAI Instruction Hierarchy를 Claude에 적용한 것은 cross-vendor 추론(미검증). |
| IMPROVE_DELIBERATION.md | **낮음** | 외부 소스 0. BT scoring, pyreez_route 등 삭제된 기능 참조. 전면 재작성 필요. |
| research-frameworks.md | 중간 | 2026-02-23 시점 스냅샷. "pyreez 반영 여부" 테이블 전부 stale. 프레임워크 분석 구조는 유효. |
| VISION_WORKER_TOOLS.md | 낮음-중간 | 비용/CLI flag 등 경험적 주장에 날짜 없음. 미구현 상태 문서라 긴급도 낮음. |

**교차 모순:**
- BT scoring 참조 (SkillCell로 교체됨) — IMPROVE_DELIBERATION.md
- pyreez_route 참조 (host-driven으로 교체됨) — IMPROVE_DELIBERATION.md, research-frameworks.md
- OpenAI Instruction Hierarchy → Claude 적용 (cross-vendor 추론, 미검증) — PROMPT_ENGINEERING_REFERENCE.md

---

## 참고 문헌 (2025-2026 소스만)

### 모델 제공사 공식
- [Anthropic Claude 4 Best Practices](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices)
- [GPT-5 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide)
- [Gemini 3 Prompting Guide](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/gemini-3-prompting-guide)

### Context Engineering
- [Anthropic - Effective Context Engineering for AI Agents (2025.09)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Karpathy on Context Engineering (2025.06)](https://x.com/karpathy/status/1937902205765607626)
- [Philipp Schmid - Context Engineering (2025)](https://www.philschmid.de/context-engineering)
- [JetBrains - The Complexity Trap (NeurIPS 2025)](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)
- [ACE Framework (arXiv 2510.04618, 2025.10)](https://arxiv.org/abs/2510.04618)

### Harness Engineering
- [Martin Fowler - Harness Engineering (2026)](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html)
- [OpenAI - Harness Engineering (2026)](https://openai.com/index/harness-engineering/)
- [Anthropic - Effective Harnesses for Long-Running Agents (2025.11)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [OPENDEV (arXiv 2603.05344, 2026.03)](https://arxiv.org/abs/2603.05344)

### Multi-Agent
- [ICLR 2025 MAD Benchmark](https://d2jud02ci9yv69.cloudfront.net/2025-04-28-mad-159/blog/mad/)
- [A-HMAD (Springer 2025)](https://link.springer.com/article/10.1007/s44443-025-00353-3)
- [MoA - Mixture-of-Agents (ICLR 2025)](https://arxiv.org/abs/2406.04692)

### Evaluation
- [LLM-as-Judge Guide (2026)](https://labelyourdata.com/articles/llm-as-a-judge)
- [Evidently AI - LLM-as-a-Judge](https://www.evidentlyai.com/llm-guide/llm-as-a-judge)

### Prompt Structure
- [Position is Power (arXiv 2505.21091, 2025)](https://arxiv.org/abs/2505.21091)
- [CoT Faithfulness (arXiv 2503.08679, 2025)](https://arxiv.org/html/2503.08679v4)
- [Anthropic CoT Trust (VentureBeat 2025)](https://venturebeat.com/ai/dont-believe-reasoning-models-chains-of-thought-says-anthropic)

### Lost-in-the-Middle
- [MIT - LLM Bias Architecture (2025.06)](https://news.mit.edu/2025/unpacking-large-language-model-bias-0617)
