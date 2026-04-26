# 06. Persona/Role — pyreez가 role 부여 안 하는 결정의 근거

작성: 2026-04-25

---

## 1. Personas in System Prompts Don't Help (대규모 실증)

### 출처
- **Zheng et al., EMNLP 2024 Findings**, "When 'A Helpful Assistant' Is Not Really Helpful: Personas in System Prompts Do Not Improve Performances of Large Language Models"
  - URL: https://aclanthology.org/2024.findings-emnlp.888/
  - 등급: [peer-reviewed] (Findings)

### 논문이 직접 말한 것
- methodology: "**162 roles covering 6 types of interpersonal relationships and 8 domains of expertise**"
- subjects: "**4 popular families of LLMs and 2,410 factual questions**"
- 주요 결과: "**adding personas in system prompts does not improve model performance** across a range of questions compared to the control setting where no persona is added, despite ChatGPT using 'You are a helpful assistant' as part of its default system prompt"
- 부수: "the gender, type, and domain of the persona can all influence the resulting prediction accuracies"
- 운영: "while aggregating results from the best persona for each question significantly improves prediction accuracy, **automatically identifying the best persona is challenging, with predictions often performing no better than random selection**"

### pyreez 적용
- prompts.ts에서 worker에 persona/role 부여 안 하는 결정의 직접 근거
- prompts.ts:7 주석: *"No role differentiation: diversity from heterogeneous models, not assigned roles"* — 본 논문과 정합
- 호스트가 task에 "you are a [domain] expert" 박지 마라
- best-persona-per-question은 효과 있으나 **자동 선택 불가** → pyreez처럼 task 다양성이 큰 환경에서 persona 자동화는 비현실

### 한계
- factual question 도메인 평가. multi-agent debate 환경에서 ChatEval [§3]은 다른 결론 — reconcile 필요

---

## 2. ChatEval: Diverse role prompts (multi-agent evaluation)

### 출처
- **Chan et al., ICLR 2024**, "ChatEval"
  - URL: https://openreview.net/forum?id=FQepisCUWu
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- "**diverse role prompts (different personas) are essential in the multi-agent debate process**"
- "**utilizing the same role description in the prompts can lead to a degradation in performance**"
- multi-agent referee team이 evaluator로서 인간 alignment 우월

### pyreez 적용
- ChatEval ↔ Zheng EMNLP 2024 Findings 외형상 모순
- **Reconcile**:
  - Zheng 2024는 single-model factual QA — persona가 fact를 surface 못 함
  - ChatEval은 multi-agent debate — 동질 agent의 같은 role은 perspective collapse 유발
  - 즉 persona는 **agent differentiation** 목적일 때만 유용 (factual enhancement 목적 X)
- pyreez: heterogeneous model이 자연 differentiation 제공 → persona 불필요
- **단** model pool homogeneous (>50% same family)면 lens injection으로 differentiation 보충

### 한계
- ChatEval은 evaluator setup. pyreez worker setup과 정확히 동일 아님

---

## 3. Persona는 Double-Edged Sword

### 출처
- **arxiv 2408.08631 (preprint)**, IJCNLP 2025에 게재로 추정
  - URL (arxiv): https://arxiv.org/abs/2408.08631
  - URL (proceedings): https://aclanthology.org/2025.findings-ijcnlp.51.pdf
  - 등급: [peer-reviewed] (IJCNLP 2025 Findings)

### 논문이 직접 말한 것
- "persona is a **double-edged sword** … case (a) shows that an LLM without a persona can sometimes outperform one with a persona, while case (b) highlights the effectiveness of role-playing persona when properly aligned with the given instance"
- AQuA dataset: "**15.75% of questions answered correctly without persona were answered incorrectly when persona added**"
- 즉 persona 추가가 정답률 직접 떨어뜨림

### pyreez 적용
- task에 persona 박지 마라 (Zheng 2024 + 본 연구 일관)
- pyreez DIVERSITY_LENSES는 "identity persona"가 아닌 "analytical frame" — 다른 mechanism (Persona는 누구인지, lens는 어떻게 보는지)
- 그러나 lens도 **factual task에서는 noise** 가능성 — ablation 필요

### 한계
- 단일 dataset (AQuA) 결과. 일반화 시 주의

---

## 4. Heterogeneous Model Pool > Identity Persona

### 출처
- **arxiv 2603.27404 (preprint)**, "Heterogeneous Debate Engine"
  - URL: https://arxiv.org/html/2603.27404v1
  - 등급: [preprint]

### 논문이 직접 말한 것
- "Testing architectural heterogeneity for resilience: The heterogeneous system, with its **ArCo = 1.00 across all tests**, showed flawless performance, in contrast to the homogeneous one with **ArCo = 0.06**"
- 즉 모델 자체 다양성이 압도적으로 robust

### pyreez 적용
- pyreez의 model heterogeneity 강제 결정의 근거
- prompts.ts:7-8 주석: *"diversity from heterogeneous models, not assigned roles"* + 본 연구 정합

### 한계
- [preprint]. 단일 metric (ArCo) — 일반화 주의

---

## 5. DIVERSITY_LENSES의 위치

### pyreez 현 구현
- prompts.ts:148-156: 7 lenses (practical constraints, long-term consequences, risk/failure modes, contrarian, first principles, human factors, empirical evidence)
- shared_convergence R1 + R2 per-worker injection (workerIndex % 7)
- adversarial_debate에서는 **제거됨** (prompts.ts:295 주석: "heterogeneous models already provide perspective diversity. Assigning per-worker stances conflated two variables (model × question), and frame-rejecting lenses (3 of 7) produced outputs the synthesis/acceptance pipeline could not handle.")

### 정당화
- shared_convergence R1: 워커가 독립 작성 → 다양성 시드 필요
- adversarial_debate: R2+ 자체가 challenge 구조 → 추가 lens 불필요

### 한계
- shared_convergence 적용 효과는 ablation 미수행
- ChatEval 정신은 retain (multi-agent에서 differentiation 필요), Zheng 2024 우려는 partially addressed (lens는 identity persona 아님)
- 현 결정: **measurement-pending**. P0 ablation으로 결정.

---

## 6. 호스트 가이드 결론

### task에 박지 말 것
- "you are a [domain] expert" — Zheng 2024 Findings 직접 위배
- "as a [role]" — 동일
- "imagine you are X" — 동일

### 코드 변경 (별도)
- DIVERSITY_LENSES 유지 vs 제거 vs 조건부 — P0 ablation으로 결정
- 결정 기준:
  - pool homogeneity (>50% same family) → inject
  - factual/reasoning task → suppress (Zheng 2024)
  - open-ended/evaluative task → inject (ChatEval)
- 두 조건 OR로 적용 후 측정
