# 08. Reasoning Model 시대 (2025-2026) — pyreez 가정 변경

작성: 2026-04-25

---

## 1. Anthropic 2026 공식 가이드 — Adaptive Thinking

### 출처
- **Anthropic 2026 official docs**
  - URL (best-practices): https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
  - URL (extended-thinking): https://platform.claude.com/docs/en/build-with-claude/extended-thinking
  - URL (adaptive-thinking): https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
  - URL (claude-4): https://www.anthropic.com/news/claude-4
  - 등급: [official-doc]

### 공식 문서가 직접 말한 것
- **Claude 4 / Claude 4.6 series**:
  - Claude Opus 4 — "world's best coding model for complex, long-running tasks and agent workflows"
  - Claude Sonnet 4 — "delivers superior coding and reasoning"
- **Extended Thinking**:
  - "Claude does a dedicated reasoning pass before producing its visible response"
  - "generating a block of reasoning tokens and a regular response with separate token budgets"
  - "Claude Opus 4 and Sonnet 4 can use tools—like web search—during extended thinking"
- **Adaptive Thinking (2026 default for 4.6 models)**:
  - "Claude Opus 4.6 and Sonnet 4.6 ship with **adaptive thinking as the recommended mode**"
  - "you set an effort budget — **low, medium, high (default), or max**"
  - "Claude decides how much of that budget to spend on each request"
  - "low effort potentially skipping thinking entirely on simple questions"
  - "max effort running deep reasoning chains on complex problems"
- **Prompt Engineering for 2026** (직접 인용):
  - "**The prompt engineering advice from 2023 is wrong for 2026's frontier models**"
  - "**telling models to think 'step by step' in 2026 is either useless or actively counterproductive**, since frontier reasoning models already think before they answer"
  - "the new approach is to **set reasoning effort via API** (using `thinking.effort` on Claude 4.6), not via language"
  - "Extended thinking doesn't replace prompt engineering, it changes what the prompt should look like — frame the problem as multi-step and reinforce the expectation to make the trace more useful"

### pyreez 적용
- **호스트가 task에 박지 말 것**:
  - "think step by step"
  - "reason carefully"
  - "let's think this through"
  - "consider all angles before answering"
  - 위 모두 reasoning model에서 useless 또는 counterproductive
- **API parameter 사용**:
  - pyreez가 worker model의 reasoning capability 감지
  - reasoning model이면 `thinking.effort` parameter로 reasoning depth 설정
  - prompt에서 reasoning 강제 안 함
- **prompts.ts 영향**:
  - `GLOBAL_DEPTH` (factual grounding, premise rejection, verify) — **reasoning model에도 valid** (사실 검증은 reasoning과 별개)
  - `DEPTH_EXPLORE` "Consider multiple approaches before committing" — **reasoning model에서 redundant 가능성** — measurement 필요
  - `DEPTH_REFINE` "After your improvements, find the strongest argument against your changes" — adversarial refine, reasoning model에서 자체 수행 가능성 — measurement 필요

### 한계
- Anthropic 공식 = vendor 자료. OpenAI/Google/xAI에서 동일 적용 보장 안 됨
- 그러나 GPT-5, Gemini 3 thinking 모드, Grok-4 reasoning도 유사 trend 보고 (vendor 문서 cross-check 권고)

---

## 2. Reasoning Effort Budget API

### Anthropic Claude 4.6 spec
- `thinking.effort = low | medium | high | max`
- **low**: 단순 질문 시 thinking 건너뛸 수 있음
- **medium**: 일반 사용 (default)
- **high**: 복잡 문제 (default for 4.6 adaptive)
- **max**: 깊은 reasoning chain

### pyreez 적용 (구현 권고)
- `engine.ts`에서 worker model의 reasoning capability 감지 (registry 확장)
- task complexity 기반 effort budget 결정 logic:
  - 단순 fact 질문 → low
  - 일반 deliberation → high (default)
  - 복잡 multi-step (red_team, evaluation_scoring 등) → max
- pyreez `model registry`(`src/model/registry.ts`)에 `reasoning_capability` 필드 추가 검토

### 한계
- 각 vendor의 reasoning effort API가 다름 (OpenAI는 다른 parameter)
- pyreez가 vendor-agnostic abstraction 필요

---

## 3. Test-time compute scaling

### 출처
- **arxiv 2505.22960 (preprint)**, "Revisiting Multi-Agent Debate as Test-Time Scaling"
  - URL: https://openreview.net/forum?id=xzRGxKmeEG
  - 등급: [preprint]
- 보조: **arxiv 2506.12928 (preprint)**, "Scaling Test-time Compute for LLM Agents"
  - URL: https://arxiv.org/html/2506.12928v1
  - 등급: [preprint]

### 논문이 직접 말한 것
- 2505.22960: MAD를 test-time computational scaling technique로 conceptualize. **"most MAD frameworks fail to surpass self-consistency"** + 단일 강한 모델 self-scaling이 종종 우월
- 2506.12928: test-time compute scaling이 LLM agent inference performance 향상. 다양한 algorithm: parallel sampling, sequential revision, verifiers, merging methods

### pyreez 적용
- pyreez 가성비 측정 — single-strong-model + (extended thinking + self-consistency) baseline 필수
- 언제 pyreez 쓰면 안 되는가:
  - 단일 reasoning model + high effort로 풀리는 task
  - test-time compute가 multi-agent overhead 능가하는 task
- SKILL.md에 명시 가치

### 한계
- 둘 다 [preprint]. 향후 venue 확인 필요
- "self-consistency" 비교 baseline의 정확한 setup (k 값, temperature) — 원전 확인 필요

---

## 4. Multi-Agent Trap (industry 비판)

### 출처
- **Towards Data Science 2026**, "The Multi-Agent Trap"
  - URL: https://towardsdatascience.com/the-multi-agent-trap/
  - 등급: [industry-blog] (참고)

### 메타 보고
- "research from UC Berkeley and Google DeepMind reveals a counterintuitive finding: **multi-agent systems often perform worse than single agents due to coordination overhead**"

### pyreez 적용
- 보조 컨텍스트로만. 정확한 학술 출처는 별도 추적 필요
- pyreez 사용 결정 시 cost-benefit 신중히

### 한계
- 메타 인용 — 원전 확인 미수행

---

## 5. 호스트 가이드 결론

### 즉시 적용
- **task에 박지 말 것** (Anthropic 2026 직접 비판):
  - "think step by step"
  - "reason carefully"
  - "let's think this through systematically"
  - 등 reasoning instruction 류
- **task에 박을 것** (Anthropic 2026 권고):
  - 문제를 multi-step으로 frame ("이 분석은 (1) 수집 (2) 평가 (3) 종합 단계를 거쳐야 한다") — reasoning trace를 더 useful하게
  - 단순 step-by-step 강요와 다름 — frame은 problem structure, instruction은 thinking method

### 코드 변경 (별도 phase)
- pyreez `src/model/registry.ts`에 `reasoning_capability` 필드 추가
- pyreez `src/deliberation/engine.ts`에서 reasoning model 감지 → `thinking.effort` 자동 설정
- task complexity 기반 effort budget 결정 logic

### 단순 결정 트리
| Worker model | Prompt에 reasoning instruction? | API thinking.effort? |
|---|---|---|
| Claude 4.6 / Sonnet 4.6 / Opus 4.6 | ❌ 박지 마 | ✅ 사용 |
| GPT-5.x reasoning model | ❌ 박지 마 | ✅ vendor-equivalent parameter |
| Gemini 3 thinking | ❌ 박지 마 | ✅ vendor-equivalent parameter |
| Grok-4 reasoning | ❌ 박지 마 | ✅ vendor-equivalent parameter |
| 기타 non-reasoning model | △ Chain-of-Thought 일부 가능 (GLOBAL_DEPTH 유지) | N/A |
