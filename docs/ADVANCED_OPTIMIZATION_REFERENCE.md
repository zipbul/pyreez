# 고급 최적화 레퍼런스 — Prompting · Context · Harness

> 2026-03-26 작성. 기존 프로젝트 리서치 문서(PROMPT_ENGINEERING_REFERENCE, WORKER_PROMPTING_DEPTH, MULTI_MODEL_INTERACTION_REFERENCE, INTERACTION_TECHNIQUE_RESEARCH)에 없는 새로운 데이터만 포함.

---

## 1. Sycophancy 구조적 이해 (2025-2026)

### 1.1 Third-person framing의 정량적 효과

"I believe X"를 "A professor believes X"로 바꾸면 sycophancy 평균 **13.6% 감소**. 7개 모델 패밀리에서 일반화됨.

- 사용자 전문성 수준 주장(초보/중급/전문가)은 sycophancy에 거의 영향 없음 (4.4% 이내 변동)
- First-person framing이 third-person보다 유의하게 높은 sycophancy 유발

**pyreez 현황:** `prompts.ts`에서 "One analyst argues:" 3인칭 framing을 이미 사용 중. 연구가 이 설계를 뒷받침.

**출처:** [When Truth Is Overridden — arXiv 2508.02087](https://arxiv.org/html/2508.02087v1)

### 1.2 Sycophancy의 독립적 조향 가능성

Sycophantic agreement, praise, genuine agreement은 latent space에서 **별개의 선형 방향**으로 인코딩됨. 각각을 독립적으로 steering할 수 있다.

**시사점:** 반순응 프롬프트가 sycophantic agreement만 억제하고 genuine agreement는 보존할 수 있음 — pyreez의 accept 변형 anti-conformity 설계가 이 원리에 부합.

**출처:** [Sycophancy Is Not One Thing — OpenReview (NeurIPS 2025)](https://openreview.net/forum?id=d24zTCznJu)

### 1.3 명시적 거부 허가

"You can reject if you think there is a logical flaw" 추가 시 비논리적 요청 거부율 최대 **94%**까지 상승.

**pyreez 현황:** anti-conformity는 "변경하지 마라" (수동적 저항). 거부 허가는 "거부해도 된다" (능동적 저항). 별개의 메커니즘.

**출처:** [Sycophancy Causes and Mitigations — arXiv 2411.15287](https://arxiv.org/abs/2411.15287)

---

## 2. Confidence Calibration 최신 기법

### 2.1 SteerConf — 프롬프트 기반 방향 조절

Steering prompt로 LLM의 confidence 방향(conservative/optimistic)을 조절. 추가 학습 없이 기존 LLM에 범용 적용 가능.

**pyreez 현황:** 현재 "HIGH/MEDIUM/LOW" 3단계만 요청. 방향 조절은 미적용.

**출처:** [SteerConf — arXiv 2503.02863](https://arxiv.org/pdf/2503.02863)

### 2.2 자연어 비판 프롬프트

"Why is this confidence too high/too low?" 질문으로 ECE(Expected Calibration Error) 상당 감소. Out-of-domain에서도 효과 유지.

**출처:** [QA-Calibration — ICLR 2025](https://assets.amazon.science/6d/70/c50b2eb141d3bcf1565e62b60211/qa-calibration-of-language-model-confidence-scores.pdf)

### 2.3 Dunning-Kruger Effect in LLMs

LLM에서도 Dunning-Kruger 효과 관찰 — 능력이 낮은 영역에서 과신, 높은 영역에서 과소평가.

**pyreez 시사점:** COMMON_PLAN의 "RLHF가 자신 있는 표현 유도 → LOW 빈도 매우 낮을 것" 한계와 일치. 3단계가 실질 2단계일 수 있다는 기존 분석을 강화.

**출처:** [Dunning-Kruger in LLMs — arXiv 2603.09985](https://arxiv.org/html/2603.09985v1) (2026-03)

---

## 3. CoT 효과 감소 — 정량적 근거

### 3.1 CoT의 한계 (arXiv 2506.07142, 2025-06)

- **Non-reasoning 모델:** CoT가 평균 성능을 약간 개선하지만 variability 증가. 올바르게 답할 질문에서 오류 유발 가능.
- **Reasoning 모델 (o1, R1 등):** CoT 프롬프팅 효과 거의 없음 ("marginal, if any, gains"). 토큰/시간만 증가.
- 최신 모델은 이미 내부적으로 CoT 수행 → **외부 CoT 프롬프팅 중복.**

**pyreez 현황:** "think thoroughly" 일반 지시 사용 중 (Anthropic 권장). 수동 step-by-step 강제 안 함. 연구와 정합.

**출처:** [Prompting Science Report 2: Decreasing Value of CoT — arXiv 2506.07142](https://arxiv.org/abs/2506.07142)

### 3.2 Chain of Draft (CoD) — 토큰 효율

최소한의 정보만 담은 간결한 중간 추론. 인간의 메모/약칭 방식 모방.
CoT 대비 **7.6% 토큰으로 동등 이상 정확도**. (⚠️ 단일 소스)

**출처:** [Chain of Draft — arXiv 2502.18600](https://arxiv.org/abs/2502.18600)

---

## 4. Multi-Agent Debate 구조적 한계

### 4.1 "Can LLM Agents Really Debate?" (arXiv 2511.07784)

- **성공의 지배적 요인:** intrinsic reasoning strength(모델 자체 능력) + group diversity
- **구조적 파라미터(순서, confidence 공개 여부)는 효과 제한적**
- Majority pressure가 독립적 교정을 억제 → 집단 합의에 순응
- **Validity-aligned reasoning이 개선을 가장 강하게 예측**

**pyreez 시사점:** 이종 모델 구성(intrinsic diversity)이 technique 선택보다 중요. pyreez가 이미 이종 모델을 핵심으로 사용 — 올바른 방향.

**출처:** [Can LLM Agents Really Debate? — arXiv 2511.07784](https://arxiv.org/abs/2511.07784)

### 4.2 Confidence 공개는 기본 숨김이 안전

Multi-agent debate에서 confidence를 공개하면 **과신 cascade** 위험. 높은 confidence를 보고 다른 에이전트가 무비판적으로 수용.

**pyreez 현황:** confidence는 호스트에게만 전달, 워커 간 공유 안 함 (COMMON_PLAN 4.2). 연구와 일치.

**출처:** arXiv 2511.07784 (위와 동일)

---

## 5. 프롬프트 캐싱 최적화

### 5.1 "Don't Break the Cache" (arXiv 2601.06007, 2026-01)

500+ agent session 평가 결과:
- Cost **41-80% 절감**, TTFT **13-31% 개선**
- **Naive full-context caching은 오히려 latency 증가 가능** — strategic cache block control이 우월
- 핵심 원칙: static content를 프롬프트 상단에, dynamic content를 하단에 배치
- System prompt에 timestamp/request ID/user name 넣지 말 것

**pyreez 현황:** system message에 depth instructions + role만 배치 (상수). technique/instructions/task는 user message에. COMMON_PLAN 2.4에서 의도적으로 설계. 연구와 정합.

**출처:** [Don't Break the Cache — arXiv 2601.06007](https://arxiv.org/abs/2601.06007)

---

## 6. 모델별 프롬프트 차이 (2025-2026)

### 6.1 GPT-4.1 특성

- 이전 모델보다 지시를 더 **literal하게** 따름
- **충돌하는 지시 중 프롬프트 뒤에 나오는 것이 우선** (recency bias)
- Markdown headers(H1-H4)가 major sections에 기본 권장
- JSON은 대규모 문서 세트에서 성능 저하 — 비권장
- `<doc id='1' title='Title'>Content</doc>` 형식이 nested structure에 효과적

**출처:** [OpenAI GPT-4.1 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide)

### 6.2 Gemini 3 제약 순서

- Context/source material을 먼저, main task를 두번째로, **negative/formatting/quantitative constraints를 마지막에** 배치
- Constraint를 너무 앞에 두면 모델이 무시할 수 있음

**pyreez 시사점:** pyreez 워커 프롬프트는 모델 무관(model-agnostic) 설계. 모델별 최적화는 하지 않음 — 이종 모델 지원의 tradeoff. 현재 "host-instructions → technique → anti-conformity → confidence → context → task" 순서는 Gemini 3 권장과 대체로 일치 (constraints가 후반).

**출처:** [Google Gemini 3 Prompting Guide](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/gemini-3-prompting-guide)

### 6.3 Claude 4.5/4.6 과도한 강조 불필요

> "Where you might have said 'CRITICAL: You MUST use this tool when...', you can use more normal prompting like 'Use this tool when...'"

**pyreez 현황:** 워커 프롬프트에 CRITICAL/MUST 없음. 연구와 정합.

**출처:** [Anthropic Claude 4 Best Practices](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices)

---

## 7. Context Management 최신 패턴

### 7.1 Observation Masking > LLM Summarization (JetBrains, 정량적)

SWE-bench Verified 실험에서 추가 데이터:
- **LLM summarization은 agent를 13-15% 더 오래 실행하게 만듦** — stopping signal을 가림
- Observation masking이 5개 중 4개 설정에서 우수

기존 WORKER_PROMPTING_DEPTH 2.4는 비용 절감만 언급. **실행 시간 증가**는 새로운 데이터.

**출처:** [JetBrains Research — NeurIPS 2025](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)

### 7.2 Context Utilization 최적 범위

40-60% 범위 유지가 최적. 95%까지 차면 이미 context rot 진행 중. "Frequent intentional compaction"으로 유지.

**출처:** [HumanLayer — Skill Issue: Harness Engineering](https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents)

### 7.3 Manus 패턴: Atomic Function 제한

<20 atomic function만 유지 (Bash, filesystem, code execution). 나머지는 sandbox에 위임. Tool result는 filesystem에 저장, grep/glob으로 검색.

**출처:** [Context Engineering in Manus](https://rlancemartin.github.io/2025/10/15/manus/)

### 7.4 ACE Framework — Context as Evolving Playbook (ICLR 2026)

Context를 evolving playbook으로 취급. Generation → reflection → curation 모듈식 워크플로우.
Agent +10.6%, finance +8.6% 성능 향상. Brevity bias와 context collapse 방지.

**출처:** [ACE: Agentic Context Engineering — arXiv 2510.04618](https://arxiv.org/abs/2510.04618)

---

## 8. Structured Output 분리 기법

### 8.1 SLOT (EMNLP 2025)

Output formatting을 NL task에서 분리하는 model-agnostic 솔루션. Task performance 유지하면서 structural validity 보장.

기존 WORKER_PROMPTING_DEPTH 1.3은 "2-step approach" 일반론. SLOT은 구체적 구현 방법론.

**출처:** [SLOT: Structuring the Output of LLMs — EMNLP 2025](https://aclanthology.org/2025.emnlp-industry.32.pdf)

### 8.2 2단계 접근의 정량적 효과

Step 1: free-form thinking → Step 2: structured formatting. 정확도 **48% → 61%** (aggregation tasks).

기존 문서에서 "10-15% 저하" 수치만 있었음. **2단계 적용 시 개선 수치**는 새로운 데이터.

**출처:** [Dylan Castillo — Structured Outputs](https://dylancastillo.co/posts/say-what-you-mean-sometimes.html)

---

## 9. Instruction Hierarchy 보안 한계

### 9.1 Policy Puppetry (2025)

"Policy Puppetry" 공격이 거의 모든 frontier 모델의 instruction hierarchy를 우회할 수 있음을 발견. **Instruction hierarchy만으로는 완전한 보안 불가.**

**pyreez 시사점:** pyreez는 보안 경계가 아닌 품질 최적화 목적으로 system/user 분리 사용. 보안 문제는 해당 없음.

**출처:** [Control Illusion: Failure of Instruction Hierarchies — arXiv 2502.15851](https://arxiv.org/pdf/2502.15851)

---

## 10. Few-shot + Thinking 패턴

### 10.1 Few-shot 내 `<thinking>` 태그

Anthropic 공식: few-shot 예시에 `<thinking>` 태그를 포함하면 모델이 해당 추론 패턴을 일반화.

**pyreez 현황:** 워커 프롬프트에 few-shot 없음. 이종 모델 지원 + 토큰 효율을 위한 의도적 설계. few-shot 추가 시 system prefix가 변경되어 캐싱이 깨질 수 있음.

**출처:** [Anthropic Prompting Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/use-xml-tags)

---

## 교차검증 요약

| 주장 | 소스 수 | 판정 |
|------|:---:|:---:|
| 3인칭 framing이 sycophancy 감소 | 1 | ⚠️ 단일 소스 (단, pyreez에서 이미 사용 중) |
| Sycophantic/genuine agreement은 독립 | 1 | ⚠️ 단일 소스 |
| 명시적 거부 허가가 효과적 | 1 | ⚠️ 단일 소스 |
| CoT 효과 감소 (reasoning 모델) | 2+ | ✅ (arXiv 2506.07142 + provider consensus) |
| Intrinsic reasoning > debate structure | 2 | ✅ (arXiv 2511.07784 + ICLR 2025 MAD) |
| Static content 상단 = 캐시 최적 | 3+ | ✅ (arXiv 2601.06007 + Anthropic + OpenAI) |
| Observation masking > summarization | 1 | ⚠️ 단일 소스 (JetBrains) |
| Context utilization 40-60% 최적 | 1 | ⚠️ 단일 소스 |
| Structured output 분리가 정확도 개선 | 3+ | ✅ (CRANE + SLOT + Castillo) |
| Dunning-Kruger in LLMs | 1 | ⚠️ 단일 소스 |

---

## 참고 문헌 (이 문서에서 새로 추가된 것만)

| 논문/자료 | 날짜 | URL |
|----------|------|-----|
| When Truth Is Overridden | 2025 | https://arxiv.org/html/2508.02087v1 |
| Sycophancy Is Not One Thing | NeurIPS 2025 | https://openreview.net/forum?id=d24zTCznJu |
| Sycophancy Causes and Mitigations | 2024.11 | https://arxiv.org/abs/2411.15287 |
| SteerConf | 2025.03 | https://arxiv.org/pdf/2503.02863 |
| QA-Calibration | ICLR 2025 | Amazon Science |
| Dunning-Kruger in LLMs | 2026.03 | https://arxiv.org/html/2603.09985v1 |
| Decreasing Value of CoT | 2025.06 | https://arxiv.org/abs/2506.07142 |
| Chain of Draft | 2025.02 | https://arxiv.org/abs/2502.18600 |
| Can LLM Agents Really Debate? | 2025.11 | https://arxiv.org/abs/2511.07784 |
| Don't Break the Cache | 2026.01 | https://arxiv.org/abs/2601.06007 |
| GPT-4.1 Prompting Guide | 2025 | https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide |
| Gemini 3 Prompting Guide | 2025 | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/gemini-3-prompting-guide |
| Policy Puppetry | 2025 | https://arxiv.org/pdf/2502.15851 |
| SLOT | EMNLP 2025 | https://aclanthology.org/2025.emnlp-industry.32.pdf |
| ACE Framework | ICLR 2026 | https://arxiv.org/abs/2510.04618 |
| HumanLayer Harness Engineering | 2025 | https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents |
| Context Engineering in Manus | 2025.10 | https://rlancemartin.github.io/2025/10/15/manus/ |
