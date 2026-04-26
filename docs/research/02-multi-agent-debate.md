# 02. Multi-Agent Debate (MAD) — 효과·실패·구조의 검증 근거

작성: 2026-04-25
범위: pyreez = MAD framework. 본 문서는 MAD 자체의 효과, 실패 모드, 구조적 요건을 검증된 자료로 정리

---

## 1. MAD의 기본 효과 (정당화)

### 출처
- **Du et al., ICML 2024**, "Improving Factuality and Reasoning in Language Models through Multiagent Debate"
  - URL: https://icml.cc/virtual/2024/poster/32620
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- "multiple language model instances propose and debate their individual responses and reasoning processes over multiple rounds to arrive at a common final answer"
- "significantly enhances mathematical and strategic reasoning across a number of tasks"
- "improves the factual validity of generated content, reducing fallacious answers and hallucinations"

### pyreez 적용
- pyreez 자체 존재의 1차 정당화. 단 [§2 Cemri 2025]가 조건부 효과성 지적 → 무조건 우월 아님

---

## 2. MAD의 한계와 실패 모드 (2025-2026 비판적 발견)

### 출처
- **Cemri/Pan/Yang et al., ICLR 2025 + NeurIPS 2025**, "Why Do Multi-Agent LLM Systems Fail?"
  - URL (ICLR): https://openreview.net/forum?id=wM521FqPvI
  - URL (NeurIPS): https://neurips.cc/virtual/2025/loc/san-diego/poster/121528
  - arxiv: https://arxiv.org/abs/2503.13657
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- "Despite enthusiasm for Multi-Agent LLM Systems, their performance gains on popular benchmarks are often minimal, highlighting a critical need for understanding why MAS fail"
- **MAST-Data**: 1600+ annotated traces collected across **7 popular MAS frameworks**
- **14 unique failure modes** in 3 categories:
  1. **System design issues**
  2. **Inter-agent misalignment**
  3. **Task verification**
- "**improvements in base model capabilities will be insufficient to address the full taxonomy of MAS failures; instead, good MAS design requires organizational understanding**"

### pyreez 적용
- pyreez 자체가 14 failure mode 어떤 것에 해당하는지 mapping 필요
- shared_convergence는 **inter-agent misalignment** 위험 (워커가 서로 다른 problem framing)
- "모델 강화"로 해결 안 됨 → pyreez는 prompt structure + protocol design으로 풀어야

### 한계
- 14 failure modes 정확한 리스트는 논문 본문 참조 필요. 본 문서는 카테고리만 인용.

---

## 3. Test-time scaling vs MAD: 가성비 의심

### 출처
- **arxiv 2505.22960**, "Revisiting Multi-Agent Debate as Test-Time Scaling: A Systematic Study of Conditional Effectiveness"
  - URL: https://openreview.net/forum?id=xzRGxKmeEG
  - 등급: [preprint] (review 진행 중)

### 논문이 직접 말한 것
- MAD를 **test-time computational scaling technique**로 conceptualize
- collaborative refinement + diverse exploration이 single-model self-scaling 대비 우위인지 체계 분석
- 결론: **"most MAD frameworks fail to surpass self-consistency"**
- 즉 단일 강한 모델 + Self-Consistency([Wang ICLR 2023])가 종종 MAD를 능가

### pyreez 적용
- pyreez P0 benchmark에 **"single-strong-model + self-consistency" baseline 필수 추가**
- pyreez가 이걸 못 이기면 pyreez 사용 자체가 정당화 안 됨
- **언제 pyreez 쓰면 안 되는가**: 단일 모델 + self-consistency로 풀리는 task

### 한계
- 2505.22960은 [preprint] — 향후 venue 확인 필요
- self-consistency가 더 나은 정확한 task type/조건 — 논문 원전 정밀 분석 필요

---

## 4. Heterogeneity가 MAD의 핵심 (모델 다양성)

### 출처
1. **arxiv 2603.27404 (preprint)**, "Heterogeneous Debate Engine"
   - URL: https://arxiv.org/html/2603.27404v1
   - 등급: [preprint]
2. **arxiv 2601.19921 (preprint)**, "Demystifying Multi-Agent Debate" (DMAD)
   - URL: https://arxiv.org/abs/2601.19921
   - 등급: [preprint]

### 논문이 직접 말한 것
- **Heterogeneous Debate Engine**: "heterogeneous system, with its **ArCo = 1.00 across all tests**, showed flawless performance, in contrast to the homogeneous one with **ArCo = 0.06**"
- **DMAD**: "vanilla MAD often underperforms simple majority vote despite higher computational cost"; "under homogeneous agents and uniform belief updates, debate preserves expected correctness and therefore cannot reliably improve outcomes"
- DMAD 두 mechanism 추가 권고: (1) **diversity of initial viewpoints** (2) **explicit, calibrated confidence communication**

### pyreez 적용
- 모델 풀에 ≥3 distinct family 강제
- 같은 family가 풀의 >50%면 lens 자동 inject (heterogeneity 보정)
- pyreez engine.ts의 model 선택 로직이 이걸 enforce하는지 확인 필요

### 한계
- 둘 다 [preprint]. ArCo = 1.00 vs 0.06은 단일 실험 결과 — replication 필요
- DMAD는 cambridge/sheffield 연구자, peer-review 진행 추정 (2026-01 arxiv submission)

---

## 5. Lazy Agent 문제 (워커가 dominate)

### 출처
- **OpenReview ICLR 2026**, "Unlocking the Power of Multi-Agent LLM for Reasoning: From Lazy Agents to Deliberation"
  - URL: https://openreview.net/forum?id=5J6u03ObRZ
  - 등급: [peer-reviewed-pending]

### 논문이 직접 말한 것
- "A critical limitation identified is **lazy agent behavior**, in which one agent dominates while the other contributes little, undermining collaboration and **collapsing the setup to an ineffective single agent**"
- 해결: "**verifiable reward mechanism** that encourages deliberation by allowing the reasoning agent to discard noisy outputs, consolidate instructions, and restart its reasoning process when necessary"

### pyreez 적용
- shared_convergence task에 명시 contribute 강제
- 예: "Each contribution must include at least one substantive critique of another position; agreement-only responses are insufficient"
- pyreez engine이 "agreement-only" 응답을 detect하고 re-prompt하는 mechanism 추가 가치

### 한계
- ICLR 2026 submission 단계 (proceedings 미공개) — venue 확정 시 등급 격상

---

## 6. Sycophancy in MAD (consensus가 거짓 합의)

### 출처
- **CONSENSAGENT**, ACL Findings 2025
  - URL: https://aclanthology.org/2025.findings-acl.1141/
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- "agents reinforce each other's responses instead of critically engaging with the debate"
- "multi-agent debate frameworks rely heavily on prompt engineering, which may lead to sub-optimal results"
- "multi-LLM systems' performance may be limited when using out-of-the-box LLMs with only prompt tuning"
- 해결: "**dynamically refines prompts based on agent interactions to mitigate sycophancy**"

### pyreez 적용
- pyreez `ANTI_CONFORMITY` 자동주입은 정적 — CONSENSAGENT는 동적 refinement 권고
- 향후 ANTI_CONFORMITY를 라운드별로 강도 조절하는 dynamic prompt 검토 가치
- 호스트 task에 sycophancy mitigation 명시 ("Resist agreement that lacks evidentiary support")

### 한계
- ACL Findings는 main proceedings 대비 acceptance bar 약간 낮음 — [peer-reviewed]지만 Findings 명시

---

## 7. Persuasion Attack (단일 적대적 agent의 영향력)

### 출처
- **Nature Scientific Reports 2026**, "When collaboration fails: persuasion driven adversarial influence in multi agent large language model debate"
  - URL: https://www.nature.com/articles/s41598-026-42705-7
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- "**single strategically designed adversarial agent can significantly influence group outcomes** through coherent, confident, and misleading arguments"
- "**lowering the system's overall accuracy by 10-40% while increasing consensus on incorrect answers by more than 30%**"
- "**Increasing the number of agents or debate rounds does not reliably mitigate adversarial persuasion, nor can simple prompt-based defenses**"

### pyreez 적용
- adversarial_debate에서 prompt-only defense ("be objective" 류)는 효과 없음 — 명시 금지
- structural defense 필요:
  - 외부 evidence 인용 강제 (워커가 claim마다 source 첨부)
  - cross-reference verification
  - moderator 역할이 evidential strength 가중 ([DebateCV] 권고)
- 단순 라운드/agent 늘리기는 해결책 아님 — 호스트 가이드에 명시

### 한계
- Nature Scientific Reports는 peer-reviewed지만 Nature main 대비 selectivity 낮음
- "single adversarial agent" 시나리오 — 실제 환경에서 워커가 의도적으로 적대적인 경우는 드물 수 있음. 그러나 **모델 hallucination 또는 sycophancy가 의도 없이 같은 효과** 유발 가능

---

## 8. ConfMAD (Confidence-Modulated Update)

### 출처
- **arxiv 2601.19921 (preprint)**, DMAD/ConfMAD
  - 위 §4와 동일 출처

### 논문이 직접 말한 것
- two interventions: (1) **diversity-aware initialisation** that selects a more diverse pool of candidate answers (2) **confidence-modulated debate protocol** in which agents express **calibrated confidence** and **condition their updates on others' confidence**
- "These methods consistently outperform vanilla MAD and majority vote across six reasoning-oriented QA benchmarks"
- 이론적: confidence-modulated updates enable debate to systematically drift to the correct hypothesis

### pyreez 적용
- 현 pyreez는 confidence를 텍스트로 받음 (HIGH/MED/LOW). update rule에 정량 활용 안 함
- 향후 P2 (ConfMAD 정량화):
  - convergence-score에 `confidence_dispersion` 5번째 축 추가
  - fuser candidate prior에 calibrated confidence 가중
  - ANTI_CONFORMITY에 **"high-confidence claims with weak evidence are red flags; low-confidence claims with strong evidence deserve attention"** 이미 반영 (prompts.ts:49)
- 단 calibration 필수 — [§3 Tian 2023] verbalized > logprob

### 한계
- DMAD는 [preprint]. peer-review 통과 후 등급 격상 가능
- "calibrated confidence" 자체 정의 — 모델이 verbalized HIGH/MED/LOW를 calibration 없이 그대로 쓰면 over-confidence (Tian 2023 후속 [QA-Cal ICLR 2025] 참조)

---

## 9. Sequential vs Parallel debate

### 출처
- **ACL Findings 2025**, debate typology paper
  - URL: https://preview.aclanthology.org/navbar-space/2025.findings-acl.495.pdf
  - 등급: [peer-reviewed] (Findings)

### 논문이 직접 말한 것
- **Sequential debate**: "LLM agents generate their viewpoints in turn. Each LLM agent can only obtain the viewpoints of the previous agents"
- 인용 근거: Hu et al. 2025; Brown-Cohen et al. 2023; Michael et al. 2023; Wang et al. 2025; He et al. 2024
- Parallel debate (대조): 동시 생성 후 cross-reference

### pyreez 적용
- pyreez는 parallel-only (R1 모든 워커 동시 → R2 cross-reference)
- sequential 프로토콜 신설 검토 가치 — 그러나 Liang EMNLP 2024 tit-for-tat이 parallel + cross-reference로도 유사 효과 달성 → 우선순위 낮음
- 현재 SKILL.md REJECT 항목

### 한계
- 본 문서가 인용한 논문(2025.findings-acl.495)의 정확한 결론(어느 쪽이 더 나은가)은 원전 확인 필요. 본 문서는 typology 존재만 인용.

---

## 10. ChatEval: 다양한 role prompts in multi-agent evaluation

### 출처
- **Chan et al., ICLR 2024**, "ChatEval"
  - URL: https://openreview.net/forum?id=FQepisCUWu
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- "diverse role prompts (different personas) are essential in the multi-agent debate process"
- "**utilizing the same role description in the prompts can lead to a degradation in performance**"

### pyreez 적용
- pyreez는 role/persona 부여 안 함 ([§06-persona-roles.md]의 [Zheng EMNLP 2024 Findings]가 personas don't help on factual tasks)
- 대신 model heterogeneity로 differentiation 달성
- ChatEval과의 reconcile: ChatEval은 same-model multi-agent에서 role diversity 필요. pyreez는 different-model이므로 model 자체가 diversity 제공
- **단** model pool homogeneous(>50% same family)면 lens injection으로 role-like differentiation 보충

### 한계
- ChatEval은 evaluator setup. pyreez의 worker setup과 정확히 동일하진 않음 — 일반화 시 주의
