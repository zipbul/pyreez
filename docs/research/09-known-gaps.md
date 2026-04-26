# 09. Known Gaps — 자료 부족 영역 (정직 라벨)

작성: 2026-04-25
범위: pyreez 호스트 질문/요청 기법 결정 중 **검증된 corpus 근거가 없거나 약한 영역** 명시. 다른 에이전트가 이 영역에서 결정하려면 (1) 추가 자료 search (2) 인간 expert review (3) pyreez bench 실측 중 하나 필요.

---

## 1. 정량 권고가 corpus에 없는 항목

### 1.1. evaluation-axes 갯수
- **현 권고**: ≤5축
- **근거**: G-Eval (single axis ρ 0.514) + LLM-RUBRIC (per-axis calibration 필수)에서 **간접 추론**
- **자료 부족**: "5축이 4축 또는 6축보다 정확히 얼마나 우월"한가의 직접 측정 없음

### 1.2. task 본문 길이
- **현 권고**: shared_convergence context 200-500단어 (이전 답변에서 내가 추정)
- **근거**: 없음. 추정.
- **자료 부족**: task 길이 vs deliberation 품질 관계 직접 측정 없음. Liu TACL 2024는 컨텍스트 위치 영향만 다룸, 길이 자체 권고 없음.

### 1.3. 라운드 수 (`--max-rounds`)
- **현 pyreez 기본**: 다양 (프로토콜별)
- **자료 부족**: optimal 라운드 수 정량 권고 없음
- **부분 근거**: Nature 2026 (라운드 늘려도 adversarial mitigation 안 됨), Cemri 2025 (14 failure modes는 라운드별 정량 X)

### 1.4. attack-surface 영역 갯수 (adversarial_debate)
- **현 권고**: 2-4개 (이전 답변 추정)
- **자료 부족**: 영역 갯수 권고 없음

### 1.5. 발견 갯수 상한 (red_team, adversarial_debate)
- **현 권고**: 5개 (이전 답변 추정)
- **자료 부족**: 갯수 상한 정량 권고 없음

### 1.6. 심각도 분류 단계 수
- **현 권고**: critical/high/medium/low 4단계 (이전 답변 추정)
- **자료 부족**: 단계 수 권고 없음. CVSS 등 외부 표준 차용 가능.

### 1.7. 질문 갯수 (host_interrogation)
- **현 권고**: ≤7개 (이전 답변 추정)
- **자료 부족**: 정량 권고 없음. FOR-Prompting는 갯수 fixed 아님.

### 1.8. 점수 스케일 (evaluation_scoring)
- **현 권고**: 0-10
- **자료 부족**: 0-10 vs 1-5 vs 0-100 비교 corpus 없음
- **부분 근거**: G-Eval은 task별 스케일 다름. MT-Bench는 1-10 사용.

### 1.9. confidence numeric mapping
- **현 권고**: HIGH=0.9 / MED=0.6 / LOW=0.3
- **근거**: 임의 mapping. Tian 2023은 verbalized 우수성만 보여줌, numeric mapping 권고 없음.
- **자료 부족**: HIGH가 실제 무슨 정답률에 calibrate 되는지 — pyreez 환경에서 ECE 측정 필요

### 1.10. 워커 순서 (sequential_refinement)
- **현 권고**: 약→강 또는 broad→specific (이전 답변 추정)
- **자료 부족**: 순서 정량 효과 측정 없음

---

## 2. pyreez 환경 직접 검증 0

### 2.1. heterogeneous multi-model deliberation
- **현 자료**: 대부분 single-model + tool, 또는 same-family multi-agent
- **pyreez 환경**: heterogeneous (Claude + GPT + Gemini + Grok)
- **자료 부족**: 정확히 동일 setup 검증 논문 없음. extrapolation에 의존.

### 2.2. 1M+ context (Claude 4.6, Gemini 3)
- **현 자료**: Liu TACL 2024는 ~32K context 평가
- **자료 부족**: 1M context에서 U-shape 동일 정도인지, position bias 변화는?

### 2.3. Reasoning model worker
- **현 자료**: Anthropic 2026 official guide만 신뢰
- **자료 부족**: reasoning model이 deliberation 환경에서 non-reasoning model 대비 정확히 얼마나 우월한지 정량 측정 없음 (3rd party 검증)

### 2.4. pyreez self-judgment bias
- **현 mitigation**: `inspect`의 `self_judge_bias` 경고
- **자료 부족**: pyreez specific self-enhancement 정도 측정 안 됨 (Zheng 2023 일반론에 의존)

---

## 3. 통계 방법론 부재

### 3.1. P0 측정의 sample size (n)
- **현 권고**: n ≥ 50 (이전 답변에서 Opus power analysis로 n=46 도출)
- **약점**: power analysis는 effect size 가정에 의존. effect size of interest가 정의 안 됨
- **자료 부족**: pyreez bench의 effect size 정의 없음

### 3.2. inter-rater reliability (라벨러 간 일치도)
- **현 가정**: 1명 라벨러 충분
- **약점**: 1명이면 그 사람 편향이 그대로
- **자료 부족**: ≥2명 라벨러 + Krippendorff α/Cohen κ 권고. corpus 직접 적용 안 함.

### 3.3. effect size 정의
- **현 권고**: pairwise agreement ≥75%
- **약점**: 무엇이 "의미있는 개선"인지 unclear
- **자료 부족**: just-noticeable-difference (JND) 측정 없음

### 3.4. 사전등록 (pre-registration)
- **현 상태**: 없음
- **권고**: OSF 또는 AsPredicted에 P0 측정 protocol 사전등록
- **자료 부족**: pyreez specific 사전등록 없음

---

## 4. ConfMAD 정량화의 chicken-and-egg

### 문제
- DMAD (arxiv 2601.19921, [preprint])는 **calibrated confidence** 사용 권고
- calibration은 isotonic/Platt 또는 검증된 verbalized 사용
- isotonic/Platt는 라벨 데이터 필요 → P0 인간 라벨링이 필요
- P0 인간 라벨링은 8-12h 인간 시간 (per ~50 cases)

### 자료 부족
- pyreez 환경의 verbalized confidence ECE 측정 없음
- "calibration 없이 verbalized 직접 매핑"이 충분한지 미검증

### 권고
- 1단계: verbalized HIGH/MED/LOW를 numeric mapping (Tian 2023 근거)
- 2단계: P0 ECE 측정. ECE > 0.15면 후속 scheme (DiNCo, SteerConf) 검토
- 3단계: ConfMAD update rule 정량화는 calibration 검증 통과 후

---

## 5. Lens decision의 corpus 모호성

### 문제
- Zheng EMNLP 2024 Findings: personas don't help on factual tasks
- ChatEval ICLR 2024: diverse role prompts essential in multi-agent debate
- pyreez DIVERSITY_LENSES: identity-persona 아닌 analytical-frame

### 자료 부족
- "analytical-frame"이 "identity-persona"와 다른 mechanism이라는 직접 corpus 검증 없음
- task type (factual vs evaluative)별 lens 효과 ablation 없음
- model homogeneity (>50% same family) 시 lens 효과 측정 없음

### 권고
- 현 결정: P0 ablation으로 결정
  - lens on/off × task type × pool homogeneity
- 결과 기반 conditional rule 도입

---

## 6. 폐기 프로토콜 고려

### Sequential debate 신설 검토
- ACL Findings 2025 typology paper가 sequential vs parallel 분류
- pyreez는 parallel-only
- **자료 부족**: sequential의 정확한 우위 조건 corpus 모호. 현재 REJECT 결정은 잠정.

### Multi-stage transition (ChatEval/AgentVerse 식)
- ChatEval: stage별 다른 prompt
- pyreez: round 번호로만 분기 (R1 vs R2+)
- **자료 부족**: explicit stage 명시 vs round 분기의 비교 측정 없음
- 현재 REJECT 결정은 잠정.

### R0 dry-run diversity selection
- DMAD diversity-aware initialisation 권고
- **자료 부족**: pyreez 환경에서 R0 dry-run의 cost-benefit 측정 없음
- 현재 DEFER 결정은 잠정.

---

## 7. Validation gap

### pyreez 자체 측정 0
- 본 문서 모든 권고는 다른 환경에서 검증된 것
- pyreez bench로 직접 측정 안 함
- 효과 크기 모름 (failure-condition framing이 pyreez에서 +5%인지 +0%인지 모름)

### 인간 expert review 0
- 통계학자 (n, ICC, 사전등록)
- LLM eval 연구자 (G-Eval, MT-Bench 메소드 깊이)
- Multi-agent 연구자 (DMAD, MAD 적용 타당성)
- Security researcher (red_team)
- 본 corpus는 위 review 모두 거치지 않음

---

## 8. Corpus 자체 한계

### Preprint 비율
- 13 [peer-reviewed] + ~20 [preprint] 또는 [peer-reviewed-pending]
- 후자는 향후 reject되거나 method 변경 가능
- 정기 (분기 1회) 갱신 필수

### Coverage gap
- 다음 토픽은 2026-04-25 시점 적게 다룸:
  - Long-context (1M+) prompt 설계
  - Vendor lock-in 우회 (vendor-agnostic abstraction)
  - 한국어 LLM (pyreez 사용자가 한국어면 추가 검색)
  - Open-source worker (Llama, Mistral) 통합
  - cost optimization (token 비용)

### Search bias
- WebSearch + knoldr 결과로 corpus 구성. **systematic literature review (PRISMA)** 안 함
- 검색식, 포함/제외 기준 명시 안 됨
- Negative results (어떤 기법이 안 작동한 조건) 의도적 검색 부족

---

## 9. 다른 에이전트가 이 문서를 사용할 때

본 문서의 모든 항목은 **검증되지 않은 영역**으로 다음 중 하나의 조치 필요:
1. **추가 자료 search**: §6, §1의 갯수/길이 권고 등
2. **pyreez bench 실측**: §2 환경 검증, §3 통계, §4 ConfMAD, §5 lens
3. **인간 expert review**: §3 통계, §7 validation gap
4. **사전등록**: §3.4

가능한 조치 없으면 **결정을 보류하거나 명시 라벨로 잠정 표시** (예: "잠정·검증 비율 30%").
