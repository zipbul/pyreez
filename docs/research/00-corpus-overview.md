# 00. Corpus Overview — 검증된 출처 전체 리스트

작성: 2026-04-25
범위: pyreez 호스트 질문/요청 기법 결정에 인용 가능한 출처 전수

## 분류 기준
- **[peer-reviewed]**: 메이저 학술 venue proceedings 게재 확인
- **[peer-reviewed-pending]**: OpenReview accepted, proceedings 대기 또는 conference 직후
- **[preprint]**: arxiv only, peer-review 미확인
- **[official-doc]**: 모델 vendor 공식 문서

---

## A. 핵심 [peer-reviewed] (13개)

### A1. Liu et al., "Lost in the Middle: How Language Models Use Long Contexts"
- **venue**: TACL 2024, vol. 12, pp. 157-173
- **저자**: Nelson F. Liu, Kevin Lin, John Hewitt, Ashwin Paranjape, Michele Bevilacqua, Fabio Petroni, Percy Liang (Stanford 등)
- **action editor**: Luke Zettlemoyer
- **제출**: 2023-08, 개정 2023-10, 출판 2024-02
- **URL (peer-reviewed)**: https://aclanthology.org/2024.tacl-1.9/
- **URL (preprint)**: https://arxiv.org/abs/2307.03172
- **핵심**: 긴 컨텍스트에서 정보 위치에 따른 성능이 U-shape. 처음/끝 위치 정보가 중간보다 잘 회수됨.
- **pyreez 적용**: prompts.ts의 reference-first/task-last 레이아웃은 이 논문 직접 근거. 1M context 시대에도 valid.

### A2. Du et al., "Improving Factuality and Reasoning in Language Models through Multiagent Debate"
- **venue**: ICML 2024 (Vienna), proceedings pp. 11733-11763
- **저자**: Yilun Du, Shuang Li, Antonio Torralba, Joshua B. Tenenbaum, Igor Mordatch
- **URL**: https://icml.cc/virtual/2024/poster/32620
- **dblp**: https://dblp.org/rec/conf/icml/Du00TM24.html
- **핵심**: 다중 LLM이 자신의 응답을 제안하고 여러 라운드에 걸쳐 토론하면 mathematical/strategic reasoning 향상, hallucination 감소.
- **pyreez 적용**: deliberate 프로토콜 자체의 정당화. 단 [A14] Cemri 2025가 조건부 효과성 지적.

### A3. Liang et al., "Encouraging Divergent Thinking in Large Language Models through Multi-Agent Debate"
- **venue**: EMNLP 2024 (Miami), pp. 17889-17904
- **저자**: Tian Liang, Zhiwei He, Wenxiang Jiao, Xing Wang, Yan Wang, Rui Wang, Yujiu Yang, Shuming Shi, Zhaopeng Tu
- **URL**: https://aclanthology.org/2024.emnlp-main.992/
- **핵심**: **Degeneration-of-Thought (DoT)** 문제 식별 — LLM이 자기 답에 confidence가 생기면 reflection으로도 새로운 생각 못 만듦. **tit-for-tat MAD framework**가 이를 깸.
- **pyreez 적용**: failure-condition framing의 직접 근거. adversarial_debate의 R2+ 구조 정당화.

### A4. Sharma et al. (Anthropic), "Towards Understanding Sycophancy in Language Models"
- **venue**: ICLR 2024
- **저자**: Mrinank Sharma, Meg Tong, Tomasz Korbak, David Duvenaud, Amanda Askell, Samuel R. Bowman 외 (모두 Anthropic)
- **URL**: https://openreview.net/forum?id=tvhaxkMKAn
- **proceedings**: https://proceedings.iclr.cc/paper_files/paper/2024/hash/0105f7972202c1d4fb817da9f21a9663-Abstract-Conference.html
- **핵심**: 5 SOTA assistant 모두 free-form text generation 4 task에서 sycophancy 일관 표출. 인간+preference model 모두 convincingly-written sycophantic 응답을 정답보다 non-negligible 빈도로 선호. RLHF 피드백이 sycophancy를 유발할 가능성.
- **pyreez 적용**: ANTI_CONFORMITY 자동주입 정당화. false-premise 식별 명령 근거.

### A5. Tian et al., "Just Ask for Calibration: Strategies for Eliciting Calibrated Confidence Scores from Language Models Fine-Tuned with Human Feedback"
- **venue**: EMNLP 2023 (Singapore)
- **저자**: Katherine Tian, Eric Mitchell, Allan Zhou, Archit Sharma, Rafael Rafailov, Huaxiu Yao, Chelsea Finn, Christopher Manning (Harvard/Stanford)
- **URL**: https://aclanthology.org/2023.emnlp-main.330/
- **핵심**: RLHF-LM(ChatGPT/GPT-4/Claude)의 **verbalized confidence가 conditional probabilities(logprobs)보다 ECE 50% 낮음** (TriviaQA, SciQ, TruthfulQA).
- **pyreez 적용**: prompts.ts의 CONFIDENCE_AND_UNCERTAINTY (HIGH/MED/LOW) 자동주입 직접 근거. **logprob 기반 calibration 도입 시 이 결과를 위배하지 마라.**

### A6. Jiang et al., "LLM-Blender: Ensembling Large Language Models with Pairwise Ranking and Generative Fusion"
- **venue**: ACL 2023 (Toronto), Volume 1 Long Papers, pp. 14165-14178
- **저자**: Dongfu Jiang, Xiang Ren, Bill Yuchen Lin
- **URL**: https://aclanthology.org/2023.acl-long.792/
- **핵심**: PairRanker (pairwise comparison으로 후보간 미세차 식별) + GenFuser (top-K 후보 융합) 2-module ensemble framework. PairRanker가 ChatGPT-based ranking과 highest correlation.
- **pyreez 적용**: src/synthesis/pairranker.ts + fuser.ts의 직접 근거. evaluation_scoring/synthesis 단계 설계.

### A7. Chan et al., "ChatEval: Towards Better LLM-based Evaluators through Multi-Agent Debate"
- **venue**: ICLR 2024
- **저자**: Chi-Min Chan, Weize Chen, Yusheng Su, Jianxuan Yu, Wei Xue, Shanghang Zhang, Jie Fu, Zhiyuan Liu
- **URL**: https://openreview.net/forum?id=FQepisCUWu
- **핵심**: multi-agent debate framework. **diverse role prompts (different personas)가 multi-agent debate에 essential** — identical role description은 performance degradation 유발.
- **pyreez 적용**: adversarial_debate에서 워커간 차별화 필요성. heterogeneous model pool 정당화.

### A8. Wang et al., "Self-Consistency Improves Chain of Thought Reasoning in Language Models"
- **venue**: ICLR 2023
- **저자**: Xuezhi Wang, Jason Wei, Dale Schuurmans, Quoc V. Le, Ed H. Chi, Sharan Narang, Aakanksha Chowdhery, Denny Zhou
- **URL**: https://openreview.net/forum?id=1PL1NIMMrw
- **핵심**: greedy decoding 대신 diverse reasoning paths 샘플링 후 marginalize. **GSM8K +17.9%**, SVAMP +11.0%, AQuA +12.2%.
- **pyreez 적용**: pyreez R1에서 worker당 다중 샘플링 옵션의 근거. 단 비용 고려.

### A9. Yao et al., "Tree of Thoughts: Deliberate Problem Solving with Large Language Models"
- **venue**: NeurIPS 2023
- **저자**: Shunyu Yao, Dian Yu, Jeffrey Zhao, Izhak Shafran, Tom Griffiths, Yuan Cao, Karthik Narasimhan
- **URL**: https://papers.nips.cc/paper_files/paper/2023/hash/271db9922b8d1f4dd7aaef84ed5ac703-Abstract-Conference.html
- **핵심**: CoT 일반화. coherent units of text(thoughts)를 intermediate step으로 탐색·backtracking. Game of 24, Creative Writing, Mini Crosswords에서 효과.
- **pyreez 적용**: 분기 deliberation 검토 근거. 현 pyreez는 linear, branching 미구현.

### A10. Zheng et al., "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena"
- **venue**: NeurIPS 2023 Datasets and Benchmarks Track
- **저자**: Lianmin Zheng, Wei-Lin Chiang, Ying Sheng, Siyuan Zhuang, Zhanghao Wu, Yonghao Zhuang, Zi Lin, Zhuohan Li, Dacheng Li, Eric P. Xing, Hao Zhang, Joseph E Gonzalez, Ion Stoica
- **URL**: https://papers.nips.cc/paper_files/paper/2023/hash/91f18a1287b398d378ef22505bf41832-Abstract-Datasets_and_Benchmarks.html
- **핵심**: 강한 LLM judge(GPT-4)는 controlled + crowdsourced 인간 선호와 **80%+ pairwise agreement** (= human-human agreement). 단 **position bias, verbosity bias, self-enhancement bias, limited reasoning** 식별. 완화책 제안.
- **pyreez 적용**: convergence-judge.ts, evaluation_scoring 정당화. **pairwise > absolute scoring**, position-swap 필수.

### A11. Liu et al., "G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment"
- **venue**: EMNLP 2023 (Singapore)
- **저자**: Yang Liu, Dan Iter, Yichong Xu, Shuohang Wang, Ruochen Xu, Chenguang Zhu
- **URL**: https://aclanthology.org/2023.emnlp-main.153/
- **핵심**: form-filling paradigm + CoT. Task Introduction + Evaluation Criteria → LLM이 detailed Evaluation Steps CoT 생성 → 그 prompt + CoT로 NLG 평가. **summarization 단일 axis Spearman ρ 0.514**.
- **pyreez 적용**: evaluation_scoring 출력 형식 (verdict + score) 근거. **5축 합산 시 per-axis validation 필수** — 0.514가 single axis 상한.

### A12. Madaan et al., "Self-Refine: Iterative Refinement with Self-Feedback"
- **venue**: NeurIPS 2023
- **저자**: Aman Madaan 외 다수 (CMU)
- **URL**: https://papers.nips.cc/paper_files/paper/2023/hash/91edff07232fb1b55a505a9e9f6c0ff3-Abstract-Conference.html
- **핵심**: 동일 LLM이 generator + feedback provider + refiner. **supervised data, training, RL 없이** 7 task에서 인간/자동 metric 모두 one-step generation 우월.
- **pyreez 적용**: sequential_refinement 프로토콜 정당화. reframer CLI 정당화 (no training 가능).

### A13. Zheng et al., "When 'A Helpful Assistant' Is Not Really Helpful: Personas in System Prompts Do Not Improve Performances of Large Language Models"
- **venue**: EMNLP 2024 Findings
- **URL**: https://aclanthology.org/2024.findings-emnlp.888/
- **핵심**: **162개 persona × 2410 factual question** 대규모 실험. system prompt persona는 대조군(no persona) 대비 **개선 없음**. best-persona-per-question aggregation은 도움 되나 어떤 persona가 어떤 question에 best인지 식별 불가.
- **pyreez 적용**: prompts.ts에 persona/role 부여 안 하는 결정의 직접 근거. host가 task에 "you are X expert" 박지 마라.

---

## B. 추가 [peer-reviewed] / [peer-reviewed-pending] (2025-2026)

### B1. Cemri/Pan/Yang et al., "Why Do Multi-Agent LLM Systems Fail?"
- **venue**: ICLR 2025 + NeurIPS 2025 (San Diego)
- **URL (ICLR)**: https://openreview.net/forum?id=wM521FqPvI
- **URL (NeurIPS)**: https://neurips.cc/virtual/2025/loc/san-diego/poster/121528
- **arxiv**: https://arxiv.org/abs/2503.13657
- **핵심**: 7 popular MAS framework, **1600+ annotated traces**, **14 unique failure modes** 3 카테고리: (1) system design issues (2) inter-agent misalignment (3) task verification. **"improvements in base model capabilities will be insufficient to address the full taxonomy of MAS failures; instead, good MAS design requires organizational understanding."**
- **pyreez 적용**: pyreez 자체가 14 failure mode 어디 해당하는지 mapping 필요. shared_convergence는 inter-agent misalignment 위험.

### B2. CONSENSAGENT
- **venue**: ACL Findings 2025
- **URL**: https://aclanthology.org/2025.findings-acl.1141/
- **저자**: Ramakrishnan 외 (Virginia Tech)
- **핵심**: multi-agent debate에서 sycophancy 문제 — "agents reinforce each other's responses instead of critically engaging". prompt 동적 refinement로 mitigation. round 수 줄이면서 합의 도달.
- **pyreez 적용**: shared_convergence task에 명시적 sycophancy mitigation 지시 필수. ANTI_CONFORMITY가 충분한지 ablation 가치.

### B3. "Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge"
- **venue**: IJCNLP 2025
- **URL**: https://aclanthology.org/2025.ijcnlp-long.18/
- **arxiv**: https://arxiv.org/abs/2406.07791
- **핵심**: **12 LLM judges × 22 tasks × 100k+ instances**. **judges 첫 응답 68% 선호** (인간이 명확히 두 번째 선호해도). 3 metric: **repetition stability, position consistency, preference fairness**. position bias는 prompt component 길이엔 약하게, **품질 차이엔 강하게** 영향.
- **pyreez 적용**: position-swap 단발만으론 부족 — 3 metric 모두 측정. acceptance/evaluation_scoring에 적용.

### B4. QA-Calibration of Language Model Confidence Scores
- **venue**: ICLR 2025
- **URL**: https://openreview.net/ (ICLR 2025 accept; AWS science PDF)
- **저자**: Tian (A5와 동일) 외
- **핵심**: A5의 후속. HS-QAB 등 신규 confidence elicitation prompt가 Tian 2023의 baseline 능가. **A5 method는 1세대.**
- **pyreez 적용**: 단순 HIGH/MED/LOW 매핑은 1세대. P0 측정 후 신규 method 도입 검토.

### B5. ELEPHANT: Measuring and understanding social sycophancy in LLMs
- **venue**: ICLR 2026 (accepted at OpenReview)
- **URL**: https://openreview.net/forum?id=igbRHKEiAs
- **핵심**: social sycophancy 정량 framework
- **상태**: [peer-reviewed-pending] — proceedings 대기

### B6. Sycophancy Is Not One Thing: Causal Separation of Sycophantic Behaviors
- **venue**: OpenReview (review 진행)
- **URL**: https://openreview.net/forum?id=d24zTCznJu
- **핵심**: sycophancy = **agreement / praise / genuine agreement** 3종으로 분리 가능, 각각 latent space에서 독립 steerable. DiffMean으로 inference time에 분리 modulation.
- **pyreez 적용**: ANTI_CONFORMITY를 단일 axis로 취급하는 현 설계는 이 분리 무시. 향후 분화 검토.
- **상태**: [peer-reviewed-pending] (review 단계)

### B7. "When helpfulness backfires: LLMs and the risk of false medical information due to sycophantic behavior"
- **venue**: Nature npj Digital Medicine 2025
- **URL**: https://www.nature.com/articles/s41746-025-02008-z
- **핵심**: 5 frontier LLM이 illogical medical request에 **최대 100% compliance** (helpfulness > logical consistency). prompt engineering + fine-tuning 일부 개선.
- **pyreez 적용**: false-premise 식별 명령의 강력 근거. 의료/법률 등 high-stakes 도메인에서 pyreez 사용 시 명시 필수.

### B8. "When collaboration fails: persuasion driven adversarial influence in multi agent large language model debate"
- **venue**: Nature Scientific Reports 2026
- **URL**: https://www.nature.com/articles/s41598-026-42705-7
- **핵심**: **single strategically designed adversarial agent**이 group outcome을 **accuracy 10-40% 저하, incorrect consensus +30%**. **agent 수/round 늘려도 mitigation 안 됨, simple prompt-based defense 무효**.
- **pyreez 적용**: adversarial_debate의 prompt-only defense에 의존 금지. structural defense (외부 evidence 인용 강제) 필요.

### B9. AutoRedTeamer
- **venue**: ICLR 2025 (OpenReview submission accept)
- **URL**: https://openreview.net/forum?id=DVmn8GyjeD
- **핵심**: 5 specialized modules + memory-based attack selection. 단일 prompt로 red-team 종합 불가.
- **pyreez 적용**: red_team 프로토콜 모듈화 검토.

### B10. PromptAttack
- **venue**: ICLR 2024
- **URL**: https://openreview.net/forum?id=VVgGbB9TNV
- **핵심**: 공격 prompt = 3 components: **Original Input + Attack Objective + Attack Guidance**.
- **pyreez 적용**: red_team task의 3-component 분리 강제 근거.

### B11. LLM-RUBRIC: A Multidimensional, Calibrated Approach
- **venue**: ACL 2024 long
- **URL**: https://aclanthology.org/2024.acl-long.745/
- **핵심**: multidimensional rubric은 **per-axis calibration 필수**. 단순 평균은 per-axis reliability 무너뜨림.
- **pyreez 적용**: evaluation_scoring 5축 합산 전 각 축 inter-rater agreement 측정 필수.

### B12. "Revisiting Multi-Agent Debate as Test-Time Scaling: A Systematic Study of Conditional Effectiveness"
- **venue**: arxiv 2505.22960 (2025), OpenReview submission
- **URL**: https://openreview.net/forum?id=xzRGxKmeEG
- **핵심**: MAD를 test-time-compute로 conceptualize. **"most MAD frameworks fail to surpass self-consistency"**. 조건부 효과성 체계 분석.
- **pyreez 적용**: pyreez 가성비 측정 — single-model + self-consistency baseline 필수.
- **상태**: [preprint] (review 단계)

### B13. "Unlocking the Power of Multi-Agent LLM for Reasoning: From Lazy Agents to Deliberation"
- **venue**: OpenReview ICLR 2026 submission
- **URL**: https://openreview.net/forum?id=5J6u03ObRZ
- **핵심**: **lazy agent 문제** — 한 agent가 dominate, 다른 agent contribute 안 함 → 협업 실패, single agent로 collapse. verifiable reward로 deliberation 장려.
- **pyreez 적용**: shared_convergence task에 contribute 강제 명시 ("agreement-only 응답 불가").
- **상태**: [peer-reviewed-pending]

---

## C. [official-doc]

### C1. Anthropic 2026 Prompting Best Practices
- **URL**: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- **URL2 (extended-thinking)**: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- **URL3 (adaptive-thinking)**: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
- **핵심**: 
  - Claude 4.6 / Sonnet 4.6 / Opus 4.6 — **adaptive thinking default mode**, effort budget low/medium/high/max
  - **"prompt에 step-by-step 박지 말라"** — 2026 frontier model에서 useless 또는 counterproductive
  - reasoning effort는 **`thinking.effort` API parameter**로 설정, prompt language로 강제 안 함
  - "the prompt engineering advice from 2023 is wrong for 2026's frontier models"
- **pyreez 적용**: reasoning model worker엔 prompt에 reasoning 지시 추가하지 마. API parameter로 대체.

### C2. Anthropic XML tags for prompts
- **URL**: https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags
- **핵심**: "Claude was specifically designed to parse XML-style tags" — XML 태그가 markdown header보다 unambiguous boundary 제공.
- **pyreez 적용**: prompts.ts의 `<task>`, `<other-positions>`, `<constraints>` 등 XML 사용 정당화.

---

## D. [preprint] (사용 시 라벨 필수)

### D1. arxiv 2601.19921 — DMAD/ConfMAD ("Demystifying multi-agent debate: confidence and diversity")
- **저자**: Xiaochen Zhu, Caiqi Zhang, Yizhou Chi, Tom Stafford, Nigel Collier, Andreas Vlachos (Cambridge/Sheffield)
- **URL**: https://arxiv.org/abs/2601.19921
- **핵심**: vanilla MAD는 majority vote도 못 이김 (homogeneous agents + uniform updates 가정 하). 두 mechanism 추가 필요: (1) **diversity of initial viewpoints** (2) **calibrated confidence communication** (confidence-modulated update). 6 reasoning QA에서 vanilla MAD + majority vote 능가.
- **pyreez 적용**: ConfMAD 정량화 (P2)의 직접 근거. 단 [preprint] 상태이므로 향후 venue 확인 필요.
- **venue 상태**: 2026-01-31 arxiv submission, peer review 진행 추정

### D2. arxiv 2509.05396 — "When MAD hurts" (MAD degradation 분석)
- **URL**: https://arxiv.org/html/2509.05396v1
- **핵심**: "naive applications of debate may cause performance degradation when agents converge on incorrect answers"

### D3. arxiv 2509.25532 — "Calibrating Verbalized Confidence with Self-Generated Distractors" (DiNCo)
- **URL**: https://arxiv.org/abs/2509.25532
- **핵심**: **DiNCo 10-call이 self-consistency 100-call 능가**. self-distractor 기반 saturated confidence 개선.

### D4. arxiv 2510.10913 — ADVICE (Answer-Dependent Verbalized Confidence Estimation)
- **URL**: https://arxiv.org/abs/2510.10913
- **핵심**: answer-conditional confidence estimation

### D5. arxiv 2503.02863 — SteerConf
- **URL**: https://arxiv.org/abs/2503.02863
- **핵심**: 3-component framework: steering prompt + consistency measure + calibration aggregation

### D6. arxiv 2412.14737 — "On Verbalized Confidence Scores for LLMs" (ETH Zurich)
- **저자**: Daniel Yang 외
- **URL**: https://arxiv.org/abs/2412.14737
- **핵심**: 다양한 prompt method가 verbalized confidence reliability에 미치는 영향 분석

### D7. arxiv 2603.27404 — Heterogeneous Debate Engine
- **URL**: https://arxiv.org/html/2603.27404v1
- **핵심**: **heterogeneous system ArCo = 1.00 across all tests vs homogeneous ArCo = 0.06**. 이질 풀의 압도적 우위.

### D8. arxiv 2604.01108 — Adversarial Moral Stress Testing (AMST)
- **URL**: https://arxiv.org/html/2604.01108v1
- **핵심**: 다라운드 stress + distribution-aware robustness metrics

### D9. arxiv 2604.19049 — Refute-or-Promote: Stage-Gated Multi-Agent Review
- **URL**: https://arxiv.org/html/2604.19049v1
- **핵심**: stage-gated multi-agent adversarial review (vulnerability discovery)

### D10. arxiv 2603.28488 — Courtroom-Style Multi-Agent Debate
- **URL**: https://arxiv.org/html/2603.28488v1
- **핵심**: role-switching 기반 controversial claim verification

### D11. arxiv 2410.04663 — D3 (Debate, Deliberate, Decide)
- **URL**: https://arxiv.org/abs/2410.04663
- **핵심**: cost-aware adversarial framework for reliable LLM evaluation

### D12. arxiv 2507.19090 — DebateCV
- **URL**: https://arxiv.org/html/2507.19090v4
- **핵심**: Two Debaters + decisive Moderator (claim verification)

### D13. arxiv 2510.01674 — FOR-Prompting
- **URL**: https://arxiv.org/pdf/2510.01674
- **핵심**: structured external questioning surfaces hidden assumptions, encodes questioning/revision/synthesis with machine-executable objectives

### D14. arxiv 2506.00178 — Tournament of Prompts
- **URL**: https://arxiv.org/html/2506.00178v1
- **핵심**: structured debates + Elo ratings로 prompt evolution

### D15. arxiv 2304.02711 — SPIRES
- **URL**: https://arxiv.org/pdf/2304.02711
- **핵심**: Structured Prompt Interrogation and Recursive Extraction of Semantics (schema/ontology population)

### D16. arxiv 2508.04451 — Automatic LLM Red Teaming
- **저자**: Roman Belaire, Arunesh Sinha, Pradeep Varakantham
- **URL**: https://arxiv.org/abs/2508.04451
- **핵심**: end-to-end automated red-teaming framework

### D17. arxiv 2411.15287 — "Sycophancy in LLMs: Causes and Mitigations"
- **URL**: https://arxiv.org/abs/2411.15287
- **핵심**: sycophancy survey + DiffMean steering at inference time

### D18. CHI 2026 paper — "Open-ended Structured Question Assessment with Human-LLM Collaboration"
- **URL**: https://dl.acm.org/doi/full/10.1145/3772318.3791034
- **상태**: ACM Digital Library 게재 — [peer-reviewed]
- **핵심**: open-ended question 평가에 human-LLM collaboration 필수

### D19. npj Artificial Intelligence 2025 — "A self-correcting multi-agent LLM framework" (MCP-SIM)
- **URL**: https://www.nature.com/articles/s44387-025-00057-z
- **상태**: Nature 계열 게재 — [peer-reviewed]
- **핵심**: plan-act-reflect-revise cycles, persistent memory across agents

---

## E. 주의: 사용 금지 자료
- knoldr 검색에서 trust ≤ 0.1로 표시된 블로그 (codeconductor.ai, aitoolsnote.com, csdn.net 일반, substack 마케팅)
- 자가 출판 PDF 또는 LinkedIn 게시물
- 모델 vendor 마케팅 페이지 (공식 docs와 구분)

## F. 갱신 history
- 2026-04-25: 초기 작성
