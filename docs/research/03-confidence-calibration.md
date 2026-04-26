# 03. Confidence & Calibration — verbalized vs logprob

작성: 2026-04-25
범위: pyreez의 CONFIDENCE_AND_UNCERTAINTY 자동주입, fuser candidate prior, ConfMAD update의 근거

---

## 1. Verbalized confidence > logprobs (RLHF-LMs)

### 출처 (1세대)
- **Tian et al., EMNLP 2023**, "Just Ask for Calibration: Strategies for Eliciting Calibrated Confidence Scores from Language Models Fine-Tuned with Human Feedback"
  - URL: https://aclanthology.org/2023.emnlp-main.330/
  - 저자: Katherine Tian, Eric Mitchell, Allan Zhou, Archit Sharma, Rafael Rafailov, Huaxiu Yao, Chelsea Finn, Christopher Manning (Harvard/Stanford)
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- "For RLHF-LMs such as ChatGPT, GPT-4, and Claude, the researchers found that **verbalized confidences emitted as output tokens are typically better-calibrated than the model's conditional probabilities** on the TriviaQA, SciQ, and TruthfulQA benchmarks"
- "**often reducing the expected calibration error by a relative 50%**"

### pyreez 적용
- prompts.ts의 `CONFIDENCE_AND_UNCERTAINTY` (HIGH/MED/LOW) 자동주입의 직접 근거
- **logprob 기반 calibration 도입은 이 결과를 위배** — V3 plan의 "logprob preferred" 항목은 corpus 정반대

### 한계
- 2023 시점 RLHF-LM에 대한 실증. 2024-2026의 reasoning model (o1, Claude 4.6 thinking) 동일 결과 보장 안 됨 — [§2 후속 연구] 참조
- TriviaQA/SciQ/TruthfulQA는 factual QA. multi-agent deliberation 환경 적용 시 직접 검증 필요

---

## 2. 후속 연구 (Tian 2023이 outdated 됐는가)

### 출처
1. **QA-Calibration of Language Model Confidence Scores**, **ICLR 2025**
   - 저자: Katherine Tian (1세대 저자) 외
   - URL: https://openreview.net/ (ICLR 2025 accept)
   - PDF: https://assets.amazon.science/6d/70/c50b2eb141d3bcf1565e62b60211/qa-calibration-of-language-model-confidence-scores.pdf
   - 등급: [peer-reviewed]

2. **arxiv 2509.25532 (preprint)**, "Calibrating Verbalized Confidence with Self-Generated Distractors" (DiNCo)
   - URL: https://arxiv.org/abs/2509.25532
   - 등급: [preprint]

3. **arxiv 2503.02863 (preprint)**, "SteerConf"
   - URL: https://arxiv.org/abs/2503.02863
   - 등급: [preprint]

4. **arxiv 2510.10913 (preprint)**, "ADVICE: Answer-Dependent Verbalized Confidence Estimation"
   - URL: https://arxiv.org/abs/2510.10913
   - 등급: [preprint]

5. **arxiv 2412.14737 (preprint)**, "On Verbalized Confidence Scores for LLMs" (ETH Zurich)
   - 저자: Daniel Yang 외
   - URL: https://arxiv.org/abs/2412.14737
   - 등급: [preprint]

### 후속 논문이 직접 말한 것
- **QA-Cal ICLR 2025**: "using SOTA confidence elicitation prompts from Tian et al. (2023) compared to newer schemes, with **HS-QAB generally performing best**" — 즉 Tian 2023 method가 최신 scheme에 밀림
- **DiNCo**: "**DiNCo at 10 inference calls outperforming self-consistency at 100**" — 10× 적은 비용으로 Self-Consistency 능가
- **SteerConf**: 3 components: steering prompt + steered confidence consistency measure + steered confidence calibration
- **ADVICE**: answer-dependent (질문이 아니라 답 자체에 conditional) confidence
- **ETH 2024**: "Different prompt methods affect calibration reliability" — verbalized confidence는 prompt 방식에 민감

### pyreez 적용
- 단순 HIGH/MED/LOW → 0.9/0.6/0.3 매핑은 1세대 method
- P0 측정 후 신규 scheme (HS-QAB, DiNCo) 도입 검토
- 전제: pyreez 환경에서 verbalized confidence가 여전히 calibrated인지 ECE 측정 필요

### 한계
- 후속 4개 중 3개가 [preprint]. ICLR 2025 QA-Cal만 [peer-reviewed]
- 신규 scheme이 pyreez heterogeneous multi-model setup에서 검증된 바 없음 — single-model factual QA 위주

---

## 3. Verbalized confidence는 over-confident (caveat)

### 출처
- **arxiv 2412.14737** (위와 동일, ETH Zurich)
- 일반 calibration 문헌의 widely-known finding (Brier, ECE 측정)

### 논문이 직접 말한 것 (요약)
- LLM은 verbalized로도 **systematic over-confidence** 보임
- HIGH 라벨이 실제 정답률 90%를 의미하지 않음 — 종종 70-80%
- prompt 방식, dataset, 모델에 따라 calibration 차이 큼

### pyreez 적용
- **HIGH=0.9 매핑은 face value** — 실제 calibrated 값 아님
- P0 benchmark에서 ECE 측정 필수. ECE > 0.15면 calibration layer 추가 검토
- ConfMAD update rule에 verbalized confidence 직접 사용 시 over-confidence가 update를 잘못 가중할 위험

### 한계
- ECE 임계값(0.15)은 임의 — power analysis로 도출 안 됨

---

## 4. ConfMAD: confidence-modulated update

### 출처
- **arxiv 2601.19921 (preprint)**, "Demystifying Multi-Agent Debate"
  - 저자: Xiaochen Zhu, Caiqi Zhang 외 (Cambridge/Sheffield)
  - URL: https://arxiv.org/abs/2601.19921
  - 등급: [preprint]
  - 상태: 2026-01 arxiv submission, peer review 추정

### 논문이 직접 말한 것
- "two interventions: (i) **diversity-aware initialisation** (ii) **confidence-modulated debate protocol** in which agents express **calibrated confidence** and **condition their updates on others' confidence**"
- 이론: "confidence-modulated updates enable debate to systematically drift to the correct hypothesis"
- 실증: "across six reasoning-oriented QA benchmarks, our methods consistently outperform vanilla MAD and majority vote"

### pyreez 적용
- prompts.ts:49 ANTI_CONFORMITY에 이미 부분 반영: *"high-confidence claims with weak evidence are red flags; low-confidence claims with strong evidence deserve attention"* — 이는 워커가 타인 confidence를 weighting하라는 자연어 지시
- 정량화 검토 (P2):
  - convergence-score.ts에 confidence_dispersion 5축 추가
  - fuser candidate prior에 calibrated confidence 가중
- **calibration 통과 전 정량 가중 도입 금지** (over-confidence가 noise 증폭기)

### 한계
- DMAD는 [preprint]. 등급 격상 시 우선순위 상향
- "calibrated confidence" 구현 — verbalized (Tian 2023) + ECE 측정 + 필요시 후속 scheme

---

## 5. 호스트 가이드 결론

### task에 박을 것
- 없음 (CONFIDENCE_AND_UNCERTAINTY는 자동주입)

### task에 박지 말 것
- "indicate your confidence as HIGH/MEDIUM/LOW" — 자동주입 중복
- "verify with high probability" — 무의미한 강요

### 코드 변경 (별도 phase)
- src/synthesis/fuser.ts: HIGH/MED/LOW → numeric weight 매핑 (0.9/0.6/0.3 baseline). **logprob 기반 매핑은 [§1] 위배라 도입 금지**
- src/quality/convergence-score.ts: confidence_dispersion 5축 추가는 P0 ECE 측정 후 결정
- 신규 scheme (DiNCo, SteerConf) 도입은 corpus 후속 검증 후
