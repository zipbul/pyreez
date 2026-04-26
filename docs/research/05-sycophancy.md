# 05. Sycophancy — pyreez ANTI_CONFORMITY / 3인칭 framing / false-premise check 근거

작성: 2026-04-25

---

## 1. Sycophancy의 일반성 (SOTA 모델 잔존)

### 출처
- **Sharma et al. (Anthropic), ICLR 2024**, "Towards Understanding Sycophancy in Language Models"
  - URL: https://openreview.net/forum?id=tvhaxkMKAn
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- "**five state-of-the-art AI assistants consistently exhibit sycophancy across four varied free-form text-generation tasks**"
- "When a response matches a user's views, it is more likely to be preferred"
- "**both humans and preference models prefer convincingly-written sycophantic responses over correct ones a non-negligible fraction of the time**"
- 결론: sycophancy는 RLHF 학습에서 인간 선호 데이터로 인해 incentivized

### pyreez 적용
- `ANTI_CONFORMITY` 자동주입의 직접 근거 (prompts.ts:45-49)
- 호스트가 task에 1인칭 의견 박지 마라
- ChatEval/CONSENSAGENT 등 multi-agent 환경에서 sycophancy = consensus 거짓 합의 → pyreez deliberation 핵심 위협

### 한계
- 5 assistant 평가 — 2024 시점 모델. 2026 frontier (Claude 4.6 등)에서 동일 지속 보장 안 됨. 단 후속 연구가 지속 보고

---

## 2. Sycophancy는 multi-modal — 3종으로 분리

### 출처
- **OpenReview submission**, "Sycophancy Is Not One Thing: Causal Separation of Sycophantic Behaviors in LLMs"
  - URL: https://openreview.net/forum?id=d24zTCznJu
  - 등급: [peer-reviewed-pending]

### 논문이 직접 말한 것
- "sycophantic agreement, genuine agreement, and sycophantic praise are **distinct, independently steerable behaviors in LLMs**, with each behavior encoded along distinct linear directions in latent space and capable of being independently amplified or suppressed"

### pyreez 적용
- 현 ANTI_CONFORMITY는 단일 axis로 sycophancy 취급 — 3종 분리 무시
- 향후 ANTI_CONFORMITY를 분화 검토:
  - vs sycophantic agreement (의견 추종)
  - vs sycophantic praise (과도한 칭찬)
  - genuine agreement는 보존 (잘못된 incentive로 차단하지 마라)
- 또는 inference-time steering (DiffMean) 도입 — 단 SOTA-providers만 가능

### 한계
- OpenReview review 단계. peer-review 통과 확정 시 등급 격상

---

## 3. Social Sycophancy 정량 측정 framework

### 출처
- **OpenReview ICLR 2026 accepted**, "ELEPHANT: Measuring and understanding social sycophancy in LLMs"
  - URL: https://openreview.net/forum?id=igbRHKEiAs
  - 등급: [peer-reviewed-pending]

### 논문이 직접 말한 것 (search 결과 메타)
- social sycophancy 정량 framework 제안
- 정확한 metric은 원전 PDF 확인 필요

### pyreez 적용
- 향후 P0 benchmark에 social sycophancy axis 추가 검토
- 우선순위: ICLR 2026 proceedings 출판 후

### 한계
- 정확한 method 미확인 — 원전 확인 필요

---

## 4. Persuasion-driven Adversarial Influence (multi-agent)

### 출처
- **Nature Scientific Reports 2026**, "When collaboration fails: persuasion driven adversarial influence in multi agent large language model debate"
  - URL: https://www.nature.com/articles/s41598-026-42705-7
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- "**single strategically designed adversarial agent can significantly influence group outcomes** through coherent, confident, and misleading arguments"
- "**lowering the system's overall accuracy by 10-40% while increasing consensus on incorrect answers by more than 30%**"
- "**Increasing the number of agents or debate rounds does not reliably mitigate adversarial persuasion, nor can simple prompt-based defenses**"

### pyreez 적용
- adversarial_debate에서 prompt-only defense ("be objective") 효과 없음 — 명시 금지
- structural defense:
  - 외부 evidence 인용 강제
  - cross-reference verification
  - moderator 역할이 evidential strength 가중
- "agent 수 늘리면 더 robust" 가정은 거짓 — 호스트 가이드에 명시

### 한계
- "single adversarial agent" 시나리오 — 의도적 adversarial이 드물 수 있으나 hallucination/sycophancy가 의도 없이 같은 효과 가능

---

## 5. 의료 도메인 sycophancy 100% compliance

### 출처
- **Nature npj Digital Medicine 2025**, "When helpfulness backfires: LLMs and the risk of false medical information due to sycophantic behavior"
  - URL: https://www.nature.com/articles/s41746-025-02008-z
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- 5 frontier LLM 평가 with prompts that misrepresent equivalent drug relationships
- "**high initial compliance (up to 100%) across all models, prioritizing helpfulness over logical consistency**"
- mitigation: "prompts allowing rejection and emphasizing factual recall improved performance"
- "**fine-tuning** improved rejection rates on illogical requests while maintaining general benchmark performance"

### pyreez 적용
- false-premise 식별 명령의 강력 근거 — 100% compliance는 critical 위협
- 의료/법률/금융 등 high-stakes 도메인에서 pyreez 사용 시:
  - task에 명시적 "reject illogical requests" 지시
  - acceptance 단계에서 외부 reviewer가 logical consistency 검증
- prompts.ts의 `HOST_INTERROGATION_SYSTEM`에 false-premise 식별 이미 부분 구현

### 한계
- 의료 도메인. 일반 도메인의 sycophancy 비율은 다름 (낮을 가능성)
- 그러나 100% compliance는 worst-case로서 호스트 가이드의 lower bound

---

## 6. Question Reframing > User Reframing (sycophancy 완화)

### 출처
- **arxiv 2602.23971 (preprint)**, "Ask don't tell: Reducing sycophancy in large language models"
  - URL: https://arxiv.org/html/2602.23971v2
  - 등급: [preprint]

### 논문이 직접 말한 것
- "statements, **epistemic certainty and I-perspective framing drive sycophancy**"
- "**question reframing greatly reduces model sycophancy**"
- "user reframing leads to small reductions"

### pyreez 적용
- task 자체를 중립 question 형태로 ("Is X true?" → "Evaluate the evidence for and against X")
- failure-condition framing이 이의 일종
- 호스트 (사용자) 발화 재구성보다 task 재구성이 더 효과적

### 한계
- [preprint] — peer-review 미확인. 사용 시 라벨 명시
- ablation은 단일 dataset 가능성 — replication 필요

---

## 7. Steering at Inference Time (DiffMean)

### 출처
- **arxiv 2411.15287 (preprint)**, "Sycophancy in Large Language Models: Causes and Mitigations"
  - URL: https://arxiv.org/abs/2411.15287
  - 등급: [preprint]

### 논문이 직접 말한 것
- mitigation 접근들: improved training data, novel fine-tuning methods, post-deployment control mechanisms, decoding strategies
- 구체: **DiffMean** — model activations를 sycophancy direction에서 steer away (no retraining required)
- automated approaches developed to monitor and modulate sycophancy at production scale

### pyreez 적용
- DiffMean은 inference-time activation steering — 모델 내부 접근 필요. API-only worker (Claude/GPT/Gemini)에서는 불가능
- pyreez는 prompt-level mitigation에 의존 가능 (ANTI_CONFORMITY)
- 향후 open-source worker (Llama, Mistral) 통합 시 검토

### 한계
- API-only 환경에서는 미적용. 본 자료는 백그라운드 컨텍스트로만

---

## 8. 호스트 가이드 결론

### task에 박을 것
- failure-condition framing (sycophancy trigger 차단)
- 명시적 "reject illogical requests if premises are false" (high-stakes)
- 중립 question 형태 (1인칭 의견 회피)

### task에 박지 말 것
- "be objective, don't agree just to please" — Nature 2026이 prompt-only defense 무력 명시
- "I think X is correct" 류 1인칭 — 2602.23971 [preprint] sycophancy trigger
- 자동주입과 중복: ANTI_CONFORMITY 류

### 코드 변경 (별도 phase)
- ANTI_CONFORMITY 3종 분화 검토 ([Sycophancy is not one thing] OpenReview)
- false-premise auto-rejection은 P0 측정 후 (FP > FN cost)
- structural defense (외부 evidence 인용 강제) 구현 검토
