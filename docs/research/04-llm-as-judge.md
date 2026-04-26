# 04. LLM-as-Judge — pyreez convergence-judge / evaluation_scoring / acceptance 근거

작성: 2026-04-25
범위: pyreez의 judge 사용 (convergence-judge, evaluation_scoring, acceptance, alignment-classifier)의 정당화 + bias mitigation

---

## 1. LLM judge의 인간 정합성 baseline

### 출처
- **Zheng et al., NeurIPS 2023 Datasets and Benchmarks Track**, "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena"
  - URL: https://papers.nips.cc/paper_files/paper/2023/hash/91f18a1287b398d378ef22505bf41832-Abstract-Datasets_and_Benchmarks.html
  - 저자: Lianmin Zheng 외 (LMSYS / UC Berkeley / CMU 등)
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- "Strong LLM judges like **GPT-4 can match both controlled and crowdsourced human preferences well, achieving over 80% agreement**, the same level of agreement between humans"
- benchmark: **MT-bench** (multi-turn 80 questions, 3K expert votes), **Chatbot Arena** (30K crowd preferences)
- "examines the usage and limitations of LLM-as-a-judge, including **position, verbosity, and self-enhancement biases**, as well as limited reasoning ability"

### pyreez 적용
- LLM judge가 인간과 ~80% pairwise agreement = human-human ceiling. 즉 강한 judge는 충분히 신뢰 가능
- **단** 4 bias mitigation 필수 (position, verbosity, self-enhancement, limited reasoning)
- pyreez convergence-judge.ts, alignment-classifier.ts 정당화

### 한계
- MT-Bench는 multi-turn chatbot. pyreez deliberation 환경과 직접 동일 아님
- 80% agreement는 GPT-4 기준 — 다른 judge model (Claude, Gemini)에서 정확히 동일 보장 안 됨

---

## 2. Pairwise > Absolute scoring

### 출처
- **Zheng et al., NeurIPS 2023** (위와 동일)
- **arxiv 2406.07791**, IJCNLP 2025, "Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge"
  - URL: https://aclanthology.org/2025.ijcnlp-long.18/
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- **Zheng 2023**: pairwise preference framework가 main validation method. absolute score는 secondary
- **IJCNLP 2025**: "evaluates position bias in LLM judges across **pairwise and list-wise comparison settings**, introducing three metrics: **repetition stability, position consistency, and preference fairness**"
- "experiments with **12 LLM judges across MTBench and DevBench, covering 22 tasks and approximately 40 solution-generating models, resulting in over 100,000 evaluation instances**"

### pyreez 적용
- evaluation_scoring 출력에서 pairwise를 primary, absolute rubric을 secondary diagnostic
- P0 quality DV는 pairwise agreement ≥ 75% (인간 anchor 대비)로 설정
- **단순 position-swap만으론 부족** — IJCNLP 2025의 3 metric 모두 측정

### 한계
- IJCNLP 2025의 3 metric 정확한 정의는 원전 본문 참조 필요. 본 문서는 metric 명만 인용.

---

## 3. Position Bias의 심각도

### 출처
- **arxiv 2406.07791 / IJCNLP 2025** (위와 동일)
- 보조: blog by Andrey Chauzov, "Mitigating positional bias in LLM-as-a-judge"
  - URL: https://avchauzov.github.io/blog/2025/llm-judge-position-bias-swapping/
  - 등급: [industry-blog] (참고용)

### 논문이 직접 말한 것
- "judge models selecting the **first response in 68% of comparisons**, even when human annotators clearly prefer the second option"
- "common mitigation is to **swap the two responses to cancel out the effect**"
- "position consistent" vs "position bias observed" distinction
- "position bias is **weakly influenced by the length of prompt components but significantly impacted by the quality gap between solutions**"

### pyreez 적용
- 모든 judge call에 position-swap 강제 (= 2 calls per pairwise comparison)
- evaluation_scoring, acceptance 모두 적용
- 품질 차이가 큰 candidate 비교에서 position bias가 더 심각 — pyreez처럼 다양한 강도의 worker output을 비교할 때 특히 주의

### 한계
- 68% 첫 응답 선호는 12 judges 평균. 모델별 변동 큼
- IJCNLP 2025는 비교적 새 venue — replication 필요

---

## 4. G-Eval: Form-filling CoT 평가

### 출처
- **Liu et al., EMNLP 2023**, "G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment"
  - URL: https://aclanthology.org/2023.emnlp-main.153/
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- framework: "Task Introduction and Evaluation Criteria → LLM이 detailed Evaluation Steps CoT 생성 → 그 prompt + CoT로 NLG 평가 in form-filling paradigm"
- 결과: "G-Eval with GPT-4 as the backbone model achieves a **Spearman correlation of 0.514 with human on summarization task**, outperforming all previous methods by a large margin"

### pyreez 적용
- evaluation_scoring 출력 형식 (verdict + score) 부분 근거
- prompts.ts의 EVALUATION_SCORING_SYSTEM에 form-filling 구조 반영 가치
- **5축 합산 시**: G-Eval의 ρ 0.514는 single axis(coherence). 5축 평균이 단순 합산이면 per-axis reliability 무너짐 — [§5 LLM-RUBRIC] 참조

### 한계
- summarization 도메인. deliberation evaluation에 직접 일반화 안 됨
- ρ 0.514는 SOTA 상한선 → P0 gate를 ρ ≥ 0.6으로 잡으면 G-Eval 능가 요구 → 비현실

---

## 5. LLM-RUBRIC: Multidimensional + Calibrated

### 출처
- **ACL 2024 long**, "LLM-RUBRIC: A Multidimensional, Calibrated Approach"
  - URL: https://aclanthology.org/2024.acl-long.745/
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- multidimensional rubric은 **per-axis calibration 필수**
- 단순 평균은 per-axis reliability 무너뜨림 (averaging hides noise)
- 신뢰도 낮은 axis가 composite score 오염

### pyreez 적용
- evaluation_scoring 5축 평가 시 각 축 독립 inter-rater agreement 측정
- agreement < 0.6인 축은 composite에서 drop
- 단순 5축 평균 점수를 P0 gate로 쓰지 마라

### 한계
- LLM-RUBRIC의 정확한 calibration method는 원전 참조 필요

---

## 6. Anthropic 2026 RCAF Structure

### 출처
- **Anthropic 2026 official prompting guide**
  - URL (judge-as-prompt): https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
  - 등급: [official-doc]

### 공식 문서가 말한 것
- 평가 prompt 권장 구조: **RCAF**
  - **R**ole — judge의 역할 정의
  - **C**ontext — rubric을 context로
  - **A**ction — 구체 scoring action
  - **F**ormat — strict output format
- 4 biases (must mitigate by design): **position, verbosity, self-preference, authority**
- "rubrics는 **human policy language → machine-checkable rewards 다리**"

### pyreez 적용
- evaluation_scoring system prompt를 RCAF 구조로 audit
- prompts.ts의 EVALUATION_SCORING_SYSTEM (line 477-496)이 RCAF 충족하는지 확인

### 한계
- Anthropic 공식 문서. 다른 모델에서 동일 구조 우월 보장 안 됨

---

## 7. Self-enhancement bias

### 출처
- **Zheng et al., NeurIPS 2023** (위 §1)

### 논문이 직접 말한 것
- LLM judges show preference for outputs from same model family (self-enhancement)
- GPT-4 judge는 GPT-4 worker 응답을 favor

### pyreez 적용
- pyreez `inspect`의 `self_judge_bias` 경고 이미 구현 — judge family가 worker family와 겹치면 알림
- evaluation_scoring + acceptance에서 judge는 worker pool에 없는 family에서 선택
- prompts.ts:91 (`formatOtherPositions`)의 3인칭 framing은 self-enhancement 차단 보조

### 한계
- self-enhancement 정확한 magnitude는 model family별로 다름

---

## 8. Item Response Theory + Calibration-based bias correction (2025-2026)

### 출처
- 2025-2026 LLM-as-judge 후속 연구 (web search 결과)
- 정확한 paper 출처는 search에서 메타 보고만 확인

### 메타 보고 (검증 필요)
- "the newest methodological frontier is **bias-corrected and psychometric judge evaluation**, with two 2025–2026 lines of work proposing **calibration-based bias correction and confidence intervals**, and **applying item response theory to the judges themselves**"

### pyreez 적용
- 향후 검토 가치. 현 phase에서는 우선순위 낮음

### 한계
- 정확한 출처 미확인 — search 메타 인용 단계. 실제 논문 venue/저자 확정 후 사용

---

## 9. 호스트 가이드 결론

### task / criteria / subject 분리
- evaluation_scoring 사용 시 `--task` (컨텍스트), `--criteria` (≤5 axes), `--subject` (그대로 박기) 분리 강제

### criteria 작성
- 5축 이하 (G-Eval, LLM-RUBRIC)
- 각 축은 operationalizable
- 채점 워커 풀에 채점 대상 작성자 포함 금지 (self-enhancement)

### judge 호출 (코드 변경 phase)
- pairwise primary, absolute secondary
- position-swap 강제 (각 비교 = 2 calls)
- IJCNLP 2025 3 metric 적용 (repetition stability, position consistency, preference fairness)
- judge family != worker family

### P0 quality DV
- Pairwise agreement ≥ 75% with position-swap on n ≥ 50 (G-Eval ρ 0.514 + MT-Bench 80% baseline 사이)
