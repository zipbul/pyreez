# 07. Protocol-Specific Research — 6 프로토콜별 검증 자료

작성: 2026-04-25
범위: pyreez의 6 프로토콜 (shared_convergence, adversarial_debate, host_interrogation, sequential_refinement, evaluation_scoring, red_team) 각각에 대한 검증 자료

---

## 1. shared_convergence (입장 수렴)

### 정의
- 결과물: 합의된 단일 입장 + 근거
- pyreez 구현: `buildSharedConvergenceR1`, `buildSharedConvergenceR2`, `buildSharedConvergenceFollowUp` (prompts.ts:162-286)

### 직접 근거 자료

#### 1.1. CONSENSAGENT (sycophancy mitigation)
- **출처**: Ramakrishnan 외, ACL Findings 2025
- **URL**: https://aclanthology.org/2025.findings-acl.1141/
- **등급**: [peer-reviewed]
- **핵심**: "agents reinforce each other's responses instead of critically engaging" → consensus가 거짓 합의로 오염. Dynamic prompt refinement로 mitigation.
- **호스트 적용**: task에 명시적 sycophancy mitigation 지시 ("Resist agreement that lacks evidentiary support. Surface dissent explicitly.")

#### 1.2. Lazy Agent 문제
- **출처**: ICLR 2026 OpenReview submission, "Unlocking the Power of Multi-Agent LLM"
- **URL**: https://openreview.net/forum?id=5J6u03ObRZ
- **등급**: [peer-reviewed-pending]
- **핵심**: "one agent dominates while the other contributes little, undermining collaboration and collapsing the setup to an ineffective single agent"
- **호스트 적용**: task에 contribute 강제 ("Each contribution must include at least one substantive critique of another position; agreement-only is insufficient")

#### 1.3. Cemri MAS Failure Modes
- **출처**: Cemri 외, ICLR 2025 + NeurIPS 2025
- **URL**: https://openreview.net/forum?id=wM521FqPvI
- **등급**: [peer-reviewed]
- **핵심**: 14 failure modes, 그중 큰 비중이 inter-agent misalignment (= consensus 실패)
- **호스트 적용**: heterogeneous model pool ≥3 family 강제, organizational design (prompt + protocol structure) 의존

### 자료 부족 영역
- evaluation-axes 갯수 권고 — corpus 무
- task 본문 길이/구조 정량 권고 — corpus 무
- 라운드 수 최적값 — Cemri 14 modes는 라운드별 정량 권고 없음

---

## 2. adversarial_debate (stress test, weakness 발견)

### 정의
- 결과물: 발견된 약점 우선순위
- pyreez 구현: `buildAdversarialDebateR1`, `buildAdversarialDebateR2`, `buildAdversarialDebateFollowUp` (prompts.ts:288-398)

### 직접 근거 자료

#### 2.1. Persuasion Adversarial Influence
- **출처**: Nature Scientific Reports 2026
- **URL**: https://www.nature.com/articles/s41598-026-42705-7
- **등급**: [peer-reviewed]
- **핵심**: single adversarial agent 정확도 10-40% 저하, incorrect consensus +30%. **agent/round 늘려도 mitigation 안 됨, simple prompt-based defense 무효**
- **호스트 적용**: 
  - "agent 늘리기" 또는 "라운드 늘리기" 가정 금지
  - prompt-only defense ("be objective" 류) 효과 없음 — 명시 금지
  - structural defense: 외부 evidence 인용 강제

#### 2.2. Heterogeneous Debate Engine
- **출처**: arxiv 2603.27404 (preprint)
- **URL**: https://arxiv.org/html/2603.27404v1
- **등급**: [preprint]
- **핵심**: heterogeneous ArCo = 1.00 vs homogeneous ArCo = 0.06 — 동질 풀은 사실상 무효
- **호스트 적용**: 모델 풀 heterogeneous 강제

#### 2.3. DebateCV (Two Debaters + Moderator)
- **출처**: arxiv 2507.19090v4 (preprint)
- **URL**: https://arxiv.org/html/2507.19090v4
- **등급**: [preprint]
- **핵심**: "Two Debaters argue opposing stances to surface subtle errors in single-agent assessments, **with a decisive Moderator required to weigh the evidential strength of conflicting arguments**"
- **호스트 적용**: pyreez `acceptance` 단계가 moderator 역할 — evidential strength 가중 필수

#### 2.4. Liang DoT + Tit-for-Tat
- **출처**: Liang 외, EMNLP 2024
- **URL**: https://aclanthology.org/2024.emnlp-main.992/
- **등급**: [peer-reviewed]
- **핵심**: tit-for-tat 구조가 DoT 문제 해결
- **호스트 적용**: pyreez R2+ 자체가 tit-for-tat 구현 — 별도 task 추가 불필요

#### 2.5. AMST (Adversarial Moral Stress Testing)
- **출처**: arxiv 2604.01108 (preprint)
- **URL**: https://arxiv.org/html/2604.01108v1
- **등급**: [preprint]
- **핵심**: distribution-aware robustness metrics + 다라운드 stress
- **호스트 적용**: red_team과 유사. adversarial_debate에서 robustness metric 도입 검토

#### 2.6. Refute-or-Promote (Stage-Gated)
- **출처**: arxiv 2604.19049 (preprint)
- **URL**: https://arxiv.org/html/2604.19049v1
- **등급**: [preprint]
- **핵심**: stage-gated multi-agent adversarial review
- **호스트 적용**: 향후 stage 명시화 검토

### 자료 부족
- attack-surface 영역 갯수 권고 — corpus 무
- 심각도 분류 단계 — corpus 무

---

## 3. host_interrogation (구조화 질문)

### 정의
- 결과물: 비교 가능한 N개 독립 답변
- pyreez 구현: `buildHostInterrogationMessages` (prompts.ts:400-436), CLI `--questions` flag

### 직접 근거 자료

#### 3.1. FOR-Prompting
- **출처**: arxiv 2510.01674 (preprint)
- **URL**: https://arxiv.org/pdf/2510.01674
- **등급**: [preprint]
- **핵심**: "structured external questioning that **surfaces hidden assumptions and closes inferential gaps**. Encodes questioning, revision, synthesis into agents with **explicit, machine-executable objectives**"
- **호스트 적용**: 
  - 각 질문이 hidden assumption 또는 inference gap 표면화 목적임을 명시
  - 단순 fact 질문은 host_interrogation 부적합 → 다른 프로토콜로
  - 각 질문에 "어떤 답이면 통과/실패" 판정 기준 포함

#### 3.2. CHI 2026 — Open-ended Structured Question Assessment
- **출처**: ACM CHI 2026 paper
- **URL**: https://dl.acm.org/doi/full/10.1145/3772318.3791034
- **등급**: [peer-reviewed]
- **핵심**: open-ended question 평가에 human-LLM collaboration 필수
- **호스트 적용**: open-ended question은 host_interrogation 후 인간 collaboration 권장

#### 3.3. SPIRES
- **출처**: arxiv 2304.02711 (preprint, schema/ontology population 도구)
- **URL**: https://arxiv.org/pdf/2304.02711
- **등급**: [preprint]
- **핵심**: Structured Prompt Interrogation and Recursive Extraction of Semantics. recursive extraction (답이 다음 질문 정의)
- **호스트 적용**: 향후 recursive interrogation 검토. 현 pyreez는 1-shot 질문 리스트.

#### 3.4. Tournament of Prompts
- **출처**: arxiv 2506.00178 (preprint)
- **URL**: https://arxiv.org/html/2506.00178v1
- **등급**: [preprint]
- **핵심**: structured debates + Elo ratings로 prompt 진화
- **호스트 적용**: 향후 prompt 자동 개선 검토. 현 우선순위 낮음.

### 자료 부족
- 질문 갯수 권고 — corpus 무 (FOR-Prompting는 fixed 갯수 X)
- 닫힌/열린 질문 비율 — corpus 무

---

## 4. sequential_refinement (반복 개선 chain)

### 정의
- 결과물: 점진 개선된 단일 산출물
- pyreez 구현: `buildSequentialRefinementMessages` (prompts.ts:440-473)

### 직접 근거 자료

#### 4.1. Self-Refine (단일 모델 self-feedback)
- **출처**: Madaan 외, NeurIPS 2023
- **URL**: https://papers.nips.cc/paper_files/paper/2023/hash/91edff07232fb1b55a505a9e9f6c0ff3-Abstract-Conference.html
- **등급**: [peer-reviewed]
- **핵심**: 동일 LLM이 generator + feedback + refiner. **supervised data, training, RL 없이** 7 task에서 인간/자동 metric 우월
- **호스트 적용**: 정당화 — pyreez sequential_refinement도 외부 reward 없이 동작
- **주의**: Self-Refine은 **단일 모델**, pyreez는 **multi-worker chain** — 직접 동치 X

#### 4.2. MCP-SIM (multi-agent self-correcting framework)
- **출처**: npj Artificial Intelligence 2025
- **URL**: https://www.nature.com/articles/s44387-025-00057-z
- **등급**: [peer-reviewed]
- **핵심**: "transforms underspecified prompts into validated simulations through **structured agent collaboration and persistent memory**, emulating expert-like reasoning via **iterative plan-act-reflect-revise cycles**"
- **호스트 적용**: 
  - task에 plan-act-reflect-revise 4단계 명시
  - persistent memory across workers — pyreez engine이 이전 변경 로그 + 결정 근거를 다음 워커에 전달하는지 확인 필요

#### 4.3. CollabCoder Plan-Code Co-Evolution
- **출처**: 2026 (web search 메타)
- **핵심**: Collaborative Decision-Making module (plan 업데이트 vs artifact 정제 결정) + Reasoning Trajectory module (historical diagnostic 누적)
- **호스트 적용**: 향후 DCM gate 추가 검토
- **주의**: 정확한 venue/저자 미확인

### 자료 부족
- 워커 순서 (약→강 vs 강→약) — corpus 무. 이전 권고는 추정.

---

## 5. evaluation_scoring (기준 채점)

### 정의
- 결과물: 점수 + 근거
- pyreez 구현: `buildEvaluationScoringMessages` (prompts.ts:475-517), CLI `--criteria --subject`

### 직접 근거 자료

#### 5.1. G-Eval (form-filling CoT)
- **출처**: Liu 외, EMNLP 2023
- **URL**: https://aclanthology.org/2023.emnlp-main.153/
- **등급**: [peer-reviewed]
- **핵심**: form-filling CoT, ρ 0.514 on summarization (single axis)
- **호스트 적용**: prompts.ts EVALUATION_SCORING_SYSTEM 출력 형식 (verdict + score) 부분 근거. ρ 0.514가 SOTA 상한 → P0 gate 설정 시 참조

#### 5.2. LLM-RUBRIC (per-axis calibration 필수)
- **출처**: ACL 2024 long
- **URL**: https://aclanthology.org/2024.acl-long.745/
- **등급**: [peer-reviewed]
- **핵심**: multidimensional rubric은 per-axis calibration 없으면 reliability 무너짐
- **호스트 적용**: 5축 평가 시 각 축 독립 inter-rater agreement 측정. <0.6 axis는 composite drop

#### 5.3. MT-Bench (pairwise primary)
- **출처**: Zheng 외, NeurIPS 2023 D&B
- **URL**: https://papers.nips.cc/paper_files/paper/2023/hash/91f18a1287b398d378ef22505bf41832-Abstract-Datasets_and_Benchmarks.html
- **등급**: [peer-reviewed]
- **핵심**: 80% pairwise agreement = human-human ceiling. **pairwise > absolute scoring**
- **호스트 적용**: pairwise primary, absolute secondary

#### 5.4. IJCNLP 2025 Position Bias
- **출처**: aclanthology.org/2025.ijcnlp-long.18
- **URL**: https://aclanthology.org/2025.ijcnlp-long.18/
- **등급**: [peer-reviewed]
- **핵심**: 12 judges × 22 tasks × 100k+ instances. 3 metrics (repetition stability, position consistency, preference fairness). **첫 응답 68% 선호**. position-swap 단발만으론 부족
- **호스트 적용**: evaluation_scoring + acceptance에 3 metric 적용

#### 5.5. Anthropic 2026 RCAF
- **출처**: Anthropic official 2026 prompting guide
- **URL**: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- **등급**: [official-doc]
- **핵심**: 평가 prompt 권장 구조 = Role + rubric Context + scoring Action + strict output Format. 4 biases (position, verbosity, self-preference, authority) mitigation은 design requirement
- **호스트 적용**: prompts.ts EVALUATION_SCORING_SYSTEM이 RCAF 충족하는지 audit

### 자료 부족
- 점수 스케일 (0-10 vs 1-5) — corpus 직접 비교 무
- subject 길이 상한 — corpus 무

---

## 6. red_team (공격/방어)

### 정의
- 결과물: 공격 시나리오 + 심각도
- pyreez 구현: `buildRedTeamGeneratorMessages`, `buildRedTeamAttackerMessages` (prompts.ts:519-580)

### 직접 근거 자료

#### 6.1. PromptAttack (3-Component 분리)
- **출처**: ICLR 2024
- **URL**: https://openreview.net/forum?id=VVgGbB9TNV
- **등급**: [peer-reviewed]
- **핵심**: 공격 prompt = **3 components: Original Input + Attack Objective + Attack Guidance**
- **호스트 적용**: red_team task에 (a)대상 입력 (b)공격 목적 (c)공격 가이드 분리 강제

#### 6.2. AutoRedTeamer (5 Modules + Memory)
- **출처**: ICLR 2025 OpenReview submission
- **URL**: https://openreview.net/forum?id=DVmn8GyjeD
- **등급**: [peer-reviewed]
- **핵심**: 5 specialized modules + memory-based attack selection. 단일 prompt로 종합 불가
- **호스트 적용**: 향후 red_team protocol 모듈화 검토. memory across rounds 추가 가치

#### 6.3. Iterative Attack (PAIR / TAP)
- **출처**: PAIR, TAP papers (search 메타 인용)
- **핵심**: "small number of adversarial iterations can efficiently yield effective jailbreak prompts"
- **호스트 적용**: red_team에서 `--max-rounds ≥3` 권고 — 단발 round 미달

#### 6.4. Automatic LLM Red Teaming
- **출처**: arxiv 2508.04451 (preprint)
- **저자**: Belaire/Sinha/Varakantham
- **URL**: https://arxiv.org/abs/2508.04451
- **등급**: [preprint]
- **핵심**: end-to-end automated red-teaming framework

#### 6.5. Learning Diverse Attacks
- **출처**: Lee 외, ICLR 2025
- **URL**: https://iclr.cc/virtual/2025
- **등급**: [peer-reviewed]
- **핵심**: 다양한 공격 학습 (robust red-teaming + safety tuning)

### 자료 부족
- 발견 갯수 상한 — corpus 무
- 심각도 분류 단계 — corpus 무

### 윤리/Authorization
- corpus 직접 권고 무. 그러나 ICLR/NeurIPS 모든 red-team 논문이 적법 사용 컨텍스트 일관 가정
- 호스트 가이드: red_team task에 authorization 컨텍스트 명시 필수 (legal/ethical clarity)
