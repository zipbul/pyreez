# 멀티모델 상호작용 레퍼런스

> 2026-03-25 작성. 검증된 2024-2026 소스만 포함.

## 1. 프레이밍이 모델 행동을 바꾼다

### 1.1 소스 프레이밍 바이어스 (Science Advances 2025, 교차검증됨)

동일한 콘텐츠라도 **누가 말했는지의 프레이밍**이 LLM의 처리 방식을 체계적으로 바꾼다.

> "Source framing triggers systematic bias in large language models."

**pyreez 시사점:** "One analyst argues:" vs "One analyst found:" vs "Claims to verify:" — 동사와 프레이밍이 워커의 응답 성향을 결정한다. 이건 cosmetic 차이가 아니라 행동 차이.

**출처:** [Science Advances](https://www.science.org/doi/10.1126/sciadv.adz2924)

### 1.2 워커가 듣는 것이 워커가 말하는 것만큼 중요하다 (DAR, Mar 2026)

> "What agents hear is as important as what agents say in multi-agent reasoning systems."

Diversity-Aware Retention (DAR)은 다수 의견과 가장 다른 응답을 선별하여 공유. 소수 정답이 전파되도록 함. **모든 응답을 균등 공유하는 것이 최선이 아니다.**

**출처:** [Hear Both Sides: DAR in MAD](https://arxiv.org/html/2603.20640)

### 1.3 RLHF가 순응을 유발한다 (교차검증됨: 3개 독립 소스)

> "RLHF post-training makes LLMs more sycophantic and compliant with user opinions, leading them to adopt other agents' answers, even when they may be incorrect."
> — Talk Isn't Always Cheap (ICML 2025)

> "Correct-to-incorrect transitions occur more frequently than incorrect-to-correct transitions."

**Free-MAD (Sep 2025)의 대응:** 명시적 반순응 지시 — "You may not rely on the principle of conformity." + 변경은 "clear indication that their own answer is incorrect"일 때만.

**출처:**
- [Talk Isn't Always Cheap](https://arxiv.org/html/2509.05396v1)
- [Free-MAD](https://arxiv.org/html/2509.11035v1)
- [Sparse Communication Topology](https://arxiv.org/html/2406.11776v1)

---

## 2. 상호작용 토폴로지

### 2.1 Exchange-of-Thought 4 패러다임 (EMNLP 2023)

| 패러다임 | 토폴로지 | 정보 흐름 | 통신량 |
|----------|---------|----------|--------|
| **Memory** | 버스 (전체 공유) | 모든 에이전트가 모든 추론 체인을 봄 | n² |
| **Report** | 스타 | 중앙 노드가 수집, 주변은 중앙에서만 받음 | 3n-2 |
| **Relay** | 링 | 순차적으로 다음 노드에게 전달 | 2n |
| **Debate** | 트리 | 리프 노드가 교환, 부모가 상향 집계 | 7(n-1)/2 |

**출처:** [Exchange-of-Thought](https://arxiv.org/abs/2312.01823)

### 2.2 희소 토폴로지가 오류 전파를 줄인다 (Jun 2024)

> "For more difficult questions, where most agents do not provide correct answers, an increase in the number of observed reference solutions tends to mislead the agent."

희소 연결: MATH +2% 정확도, 비용 40%+ 감소.

**pyreez 시사점:** 현재 debate는 모든 워커가 모든 응답을 봄 (Memory/버스 토폴로지). 어려운 문제에서는 선별적 공유가 더 나을 수 있다.

**출처:** [Sparse Communication Topology](https://arxiv.org/html/2406.11776v1)

### 2.3 토폴로지가 모델 선택보다 중요하다 (교차검증됨: 2개 소스)

> AdaptOrch (Feb 2026): coupling density(γ)가 최적 토폴로지를 결정. γ > 0.6이면 순차/계층, 낮으면 병렬.

> Evolving Orchestration (May 2025): RL로 학습된 오케스트레이터에서 압축과 순환 패턴이 자연 출현.

**출처:**
- [AdaptOrch](https://arxiv.org/html/2602.16873v1)
- [Evolving Orchestration](https://arxiv.org/html/2505.19591v2)

---

## 3. 역할 할당의 효과

### 3.1 태스크 관련 역할은 도움, 무관한 페르소나는 해롭다

**긍정 (Nov 2025):** 안전 평가에서 critic/defender/judge 역할 + aspect-anchoring → "reduces debate drift."

**긍정 (Dec 2025, MAR):** 페르소나별 비평가 — Verifier("call it out explicitly"), Skeptic("What if the premise is wrong?"), Logician(엄격 사양), Creative("unforeseen angles"), Meta-Reflector(메타 변경 제안) — 질적으로 다른 피드백 생성.

**부정 (Feb 2026):** 태스크 무관 페르소나 할당 시 **최대 26.2% 성능 저하**. "Role assignments introduce implicit biases and increase behavioral volatility."

**출처:**
- [Efficient LLM Safety Evaluation](https://arxiv.org/html/2511.06396v3)
- [MAR: Multi-Agent Reflexion](https://arxiv.org/html/2512.20845)
- [From Biased Chatbots to Biased Agents](https://arxiv.org/abs/2602.12285)

### 3.2 동적 역할 전환 > 고정 역할 (Jan 2026)

> "Role diversity improves argument quality and reduces repetitive patterns."

**출처:** [Dynamic Role Assignment for MAD](https://arxiv.org/pdf/2601.17152)

---

## 4. 프로덕션 프레임워크의 상호작용 제어

### 4.1 Anthropic — 오케스트레이터-워커

> "A central LLM dynamically breaks down tasks, delegates them to worker LLMs, and synthesizes their results."

서브에이전트에게 "explicit task boundaries, expected output formats, and source guidance" 제공. 없으면 "agents duplicate work, leave gaps, or fail to find necessary information."

**출처:** [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents), [Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system)

### 4.2 OpenAI Agents SDK — Manager vs Handoff

| 패턴 | 제어 | 컨텍스트 |
|------|------|---------|
| **Manager** | 중앙이 유지, 서브에이전트를 tool로 호출 | 매니저가 결과만 받음 |
| **Handoff** | 전체 대화 제어를 이전 | 전체 이전 히스토리를 받음 (`input_filter`로 필터 가능) |

**출처:** [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/multi_agent/)

### 4.3 Google ADK — 8 패턴

Sequential Pipeline, Coordinator/Dispatcher, Parallel Fan-Out/Gather, Hierarchical Decomposition, Generator-Critic, Iterative Refinement, Human-in-the-Loop, Composite.

에이전트 간 통신: `session.state` 공유 화이트보드. `description` 필드가 라우팅 결정에 사용.

**출처:** [Google ADK Multi-Agent Patterns](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/)

### 4.4 프로덕션 제어 방식 (교차검증됨)

제어는 3가지를 **모두** 사용:
1. 시스템 프롬프트 (역할, 행동 규칙)
2. 대화 구조 (누가 무엇을 보는지)
3. 명시적 모드 파라미터 (토폴로지, 역할, 제약)

**출처:**
- Anthropic: 시스템 프롬프트 + 태스크 경계
- OpenAI: input_filter + handoff 구조
- Google: session.state + description 기반 라우팅

---

## 5. 표준 MAD 프롬프트 패턴

### 5.1 일반적 프레이밍 (Du et al., ICML 2024)

```
These are the solutions to the problem from other agents:
One agent solution: {reference solution}

Using the solutions from other agents as additional information,
can you give an updated response?
```

### 5.2 Free-MAD 반순응 프레이밍 (Sep 2025)

```
Carefully assess the discrepancies between your own answers and those from peers.
Change your belief only if there is a clear indication that your own answer is incorrect,
rather than aiming to reach consensus with others.
You may not rely on the principle of conformity.
```

### 5.3 MAR 페르소나별 프레이밍 (Dec 2025)

| 페르소나 | 프롬프트 핵심 |
|----------|-------------|
| Verifier | "call it out explicitly" when reasoning lacks support |
| Skeptic | "What if the premise is wrong?" |
| Logician | rejects "vague matches, implied meanings" |
| Creative | "Propose unforeseen angles" |
| Meta-Reflector | "meta-changes: different prompting style, more memory" |

---

## 6. 교차검증 요약

| 주장 | 소스 수 | 판정 |
|------|:---:|:---:|
| MAD가 Self-Consistency를 일관적으로 이기지 못함 | 2 | ✅ |
| RLHF 순응이 debate 품질을 저하 | 3 | ✅ |
| 오케스트레이터-워커가 프로덕션 지배 패턴 | 4 | ✅ |
| 토폴로지 > 모델 선택 | 2 | ✅ |
| 태스크 관련 역할은 긍정, 무관 역할은 부정 | 3 | ✅ |
| 소스 프레이밍이 행동을 바꿈 | 1 | ⚠️ 단일 소스 |
| 희소 토폴로지가 오류 전파 감소 | 1 | ⚠️ 단일 소스 |
| 동적 역할 > 고정 역할 | 1 | ⚠️ 단일 소스 |
| 프로덕션 ~70% 오케스트레이터-워커 | 1 | ⚠️ 단일 소스 |

---

## 참고 문헌

| 논문/문서 | 날짜 | URL |
|----------|------|-----|
| Talk Isn't Always Cheap | ICML 2025 | https://arxiv.org/html/2509.05396v1 |
| Free-MAD | Sep 2025 | https://arxiv.org/html/2509.11035v1 |
| Hear Both Sides (DAR) | Mar 2026 | https://arxiv.org/html/2603.20640 |
| Sparse Communication Topology | Jun 2024 | https://arxiv.org/html/2406.11776v1 |
| Source Framing Bias | Science Advances 2025 | https://www.science.org/doi/10.1126/sciadv.adz2924 |
| Exchange-of-Thought | EMNLP 2023 | https://arxiv.org/abs/2312.01823 |
| AdaptOrch | Feb 2026 | https://arxiv.org/html/2602.16873v1 |
| Evolving Orchestration | May 2025 | https://arxiv.org/html/2505.19591v2 |
| Safety Evaluation via MAD | Nov 2025 | https://arxiv.org/html/2511.06396v3 |
| MAR: Multi-Agent Reflexion | Dec 2025 | https://arxiv.org/html/2512.20845 |
| Dynamic Role Assignment | Jan 2026 | https://arxiv.org/pdf/2601.17152 |
| Biased Chatbots to Biased Agents | Feb 2026 | https://arxiv.org/abs/2602.12285 |
| Multi-Agent Collaboration Survey | Jan 2025 | https://arxiv.org/abs/2501.06322 |
| Structure Matters | Mar 2026 | https://arxiv.org/html/2603.00774v1 |
| Agentic AI Taxonomy | Jan 2026 | https://arxiv.org/html/2601.12560v1 |
| Beyond Self-Talk Survey | Feb 2025 | https://arxiv.org/html/2502.14321v1 |
| Anthropic Building Effective Agents | 2025 | https://www.anthropic.com/research/building-effective-agents |
| Anthropic Multi-Agent Research | 2025 | https://www.anthropic.com/engineering/multi-agent-research-system |
| OpenAI Agents SDK | Mar 2025 | https://openai.github.io/openai-agents-python/multi_agent/ |
| Google ADK Patterns | 2025 | https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/ |
| Google A2A Protocol | Apr 2025 | https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/ |
