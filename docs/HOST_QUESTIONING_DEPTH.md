# Host Questioning Depth — 질문 품질이 deliberation 깊이를 결정한다

> 2026-04-08 작성. 교차검증 기준: 2소스 이상만 확정, 단일 소스는 ⚠️ 표시.

## 핵심 명제

워커 프롬프팅 기법의 천장은 이미 도달했다 (GLOBAL_DEPTH, diversity lenses, anti-conformity, sparse sharing). 다음 돌파구는 **호스트가 어떻게 질문하느냐**다. 같은 엔진, 같은 워커 기법이라도 질문이 달라지면 결과 품질이 근본적으로 바뀐다.

근거: "What agents hear is as important as what agents say" (DAR, Mar 2026). 워커가 듣는 것 = 호스트의 질문 + 다른 워커의 응답. 전자를 개선하지 않으면 후자만으로 한계.

---

## 1. 질문이 추론 품질을 바꾸는 메커니즘 — 교차검증된 증거

### 1.1 Socratic Questioning → 재귀적 사고 유도 (교차검증: 3소스)

| 연구 | 핵심 발견 | 벤치마크 | 출처 |
|------|----------|---------|------|
| **SOCRATIC QUESTIONING** (EMNLP 2023) | 하위 질문 분해 → 재귀적 사고. CoT/ToT 대비 유의미한 성능 향상 | MMLU, MATH, LogiQA | [arXiv 2305.14999](https://arxiv.org/abs/2305.14999) |
| **SoDa** (ACL Findings 2025) | Socratic teacher-student 대화로 학습 데이터 생성. 30K 예시로 1000K ScaleQuest 초과 | Math, Code | [ACL 2025.findings-acl.640](https://aclanthology.org/2025.findings-acl.640/) |
| **Socratic Method in Prompting** (ChemRxiv 2025) | 가설 정제, 증거 기반 추론, 반복적 문제 해결. CoT와 결합 시 체계적 탐구 | Chemistry | [ChemRxiv 2025](https://chemrxiv.org/engage/api-gateway/chemrxiv/assets/orp/resource/item/67a236fc6dde43c90892cf6f/original) |

**핵심 메커니즘**: CoT는 단일 경로 순차 생성 — 초반 오류가 누적. Socratic questioning은 **thinking space를 명시적으로 탐색**하며, 오류에 더 강건.

### 1.2 Critical Questions → 논증 검증 (교차검증: 2소스)

| 연구 | 핵심 발견 | 벤치마크 | 출처 |
|------|----------|---------|------|
| **CQoT** (Dec 2024) | Toulmin 논증 스키마 기반 8개 비판적 질문으로 추론 검증. 평균 +4.7% (reasoning), +5.7% (math) | MT-Bench Reasoning/Math | [arXiv 2412.15177](https://arxiv.org/abs/2412.15177) |
| **CONSENSAGENT** (ACL 2025) | 에이전트 상호작용 기반 동적 프롬프트 정제. 순응(sycophancy) 완화 | 6개 추론 벤치마크 | [ACL 2025.findings-acl.1141](https://aclanthology.org/2025.findings-acl.1141/) |

**CQoT 8개 비판적 질문** (Toulmin 스키마):
1. 데이터가 주장을 뒷받침하는가?
2. 근거(warrant)가 타당한가?
3. 반론(rebuttal)이 고려되었는가?
4. 한정어(qualifier)가 적절한가?
5. 뒷받침(backing)이 충분한가?
6. 전제가 명시적인가?
7. 논리적 비약이 없는가?
8. 대안적 설명이 검토되었는가?

### 1.3 Metacognitive Prompting → 자기 평가 루프 (교차검증: 2소스)

| 연구 | 핵심 발견 | 출처 |
|------|----------|------|
| **Metacognitive Prompting** (NAACL 2024) | 5단계 자기 평가(이해→예비판단→비판적 평가→최종 결정→신뢰도). 기존 프롬프팅 방법 일관 능가 | [arXiv 2308.05342](https://arxiv.org/abs/2308.05342) |
| **Pragmatic MP** (ACL 2025) | 메타인지 + 실용적 프롬프팅 결합. 감성 분석 SOTA | [ACL 2025.chum-1.7](https://aclanthology.org/2025.chum-1.7.pdf) |

### 1.4 수렴-다양성 트레이드오프 (교차검증: 3소스)

| 연구 | 핵심 발견 | 출처 |
|------|----------|------|
| **Consensus-Diversity Tradeoff** (EMNLP 2025) | 암묵적 합의(독립 결정 후 정보 교환)가 명시적 합의보다 효과적. **부분적 다양성 유지 → 탐색/강건성 향상** | [arXiv 2502.16565](https://arxiv.org/abs/2502.16565) |
| **Sparse MAD** (Jun 2024) | 희소 토폴로지가 더 긴 토론 유지 → 조기 수렴 방지 | [arXiv 2406.11776](https://arxiv.org/html/2406.11776v1) |
| **Free-MAD** (Sep 2025) | 합의 강제 제거 → 정답 유지율 향상 | [arXiv 2509.11035](https://arxiv.org/abs/2509.11035) |

**핵심**: 수렴 자체가 나쁜 게 아니라, **조기 수렴**이 나쁘다. 호스트의 질문이 충분한 탐색 전에 수렴을 유도하면 다양성 손실.

---

## 2. Paul & Elder의 6가지 Socratic 질문 유형

교육학에서 가장 널리 검증된 질문 분류 체계. LLM 프롬프팅 연구에서도 직접 참조됨 (SOCRATIC QUESTIONING, SoDa).

| 유형 | 목적 | 예시 |
|------|------|------|
| **1. Clarification** | 모호한 개념 명확화 | "X로 정확히 무엇을 의미하는가?" |
| **2. Probing Assumptions** | 숨겨진 전제 발굴 | "여기서 어떤 가정을 하고 있는가?" |
| **3. Probing Reasons/Evidence** | 근거 요구 | "그 주장을 뒷받침하는 증거는?" |
| **4. Viewpoints/Perspectives** | 대안적 관점 탐색 | "다른 관점에서 보면 어떻게 달라지는가?" |
| **5. Implications/Consequences** | 결론의 파급 추적 | "그 결론이 맞다면 어떤 결과가 따르는가?" |
| **6. Questions about the Question** | 메타 수준 반성 | "이 질문 자체가 올바른 질문인가?" |

**출처:** [Paul & Elder, The Thinker's Guide to Socratic Questioning (2006)](https://www.criticalthinking.org/files/SocraticQuestioning2006.pdf)

---

## 3. 호스트 범용 질문 규칙 — 매 라운드 적용

위 연구를 종합하여, 프로토콜/도메인에 무관하게 호스트가 매 라운드 적용하는 규칙.

### 규칙 1: 표면 질문을 근본 질문으로 변환하라

사용자의 질문을 그대로 워커에게 전달하지 마라. 근본 문제를 먼저 식별하라.

```
표면: "ES+CQRS를 결제에 도입할 때 복잡도 대비 이점을 분석하라"
근본: "결제 시스템에서 상태 전이 이력이 source of truth여야 하는가,
       아니면 현재 상태가 source of truth여도 충분한가?"
```

근거: Paul & Elder 유형 6 (Questions about the Question) — 질문 자체를 재검토. SOCRATIC QUESTIONING의 top-down decomposition.

### 규칙 2: 합의를 구하지 말고 조건을 구하라

"X의 장단점을 분석하라"는 수렴을 유도한다. "X가 실패하는 조건을 찾아라"는 다양성을 유도한다.

```
수렴 유도: "마이크로서비스의 장단점을 분석하라"
다양성 유도: "마이크로서비스가 모놀리스보다 나쁜 결과를 내는 구체적 조건을 찾아라"
```

근거: Consensus-Diversity Tradeoff (EMNLP 2025) — 부분적 다양성 유지가 탐색/강건성 향상. Free-MAD — 합의 강제 제거가 정답 유지율 향상.

### 규칙 3: R1 결과를 보고 빠진 관점을 찾아라

R1 응답을 받은 후, Paul & Elder 6가지 유형으로 점검:

1. 모호한 개념이 있는가? → Clarification 질문으로 R2 태스크 보강
2. 숨겨진 가정이 있는가? → Assumption probing으로 도전
3. 근거가 빠진 주장이 있는가? → Evidence 요구
4. 탐색되지 않은 관점이 있는가? → Perspective 질문 추가
5. 결론의 파급이 추적되지 않았는가? → Implication 추적 요구
6. 질문 자체가 잘못되었는가? → 태스크 리프레이밍

근거: CQoT의 반복 검증 루프 — 비판적 질문으로 추론을 검증하고, 불충분하면 재수행. Metacognitive Prompting의 5단계 자기 평가.

### 규칙 4: Evaluate/Create 수준으로 질문하라

나열(Remember), 설명(Understand), 적용(Apply)은 워커가 파라메트릭 지식으로 답하기 쉬운 질문이다. 평가(Evaluate), 창조(Create)는 워커가 자신만의 판단을 내려야 하는 질문이다.

```
Understand 수준: "CQRS 패턴을 설명하라"
Evaluate 수준:  "CQRS 도입을 정당화하려면 최소 어떤 조건이 충족되어야 하는가?"
Create 수준:    "기존 CRUD 시스템에서 CQRS 없이 ES의 핵심 이점만 얻는 설계를 제안하라"
```

근거: Bloom's Taxonomy 상위 수준이 비판적 사고를 유발. CQoT — Toulmin 스키마의 비판적 질문이 추론 품질 향상 (+4.7% reasoning, +5.7% math).

### 규칙 5: 워커에게 컨텍스트를 줘라

일반론을 피하려면 구체적 제약조건, 실제 코드, 데이터를 태스크에 포함하라.

```
일반론: "K8s 배포 전략을 설계하라"
구체적: "현재 우리 시스템은 PostgreSQL 13, 평균 응답 200ms, 피크 5000 RPS.
         DB 마이그레이션이 동반되는 배포에서 zero-downtime을 보장하는 전략을 설계하라."
```

근거: Anthropic Context Engineering — "smallest possible set of high-signal tokens that maximize desired outcome". 일반론은 low-signal 입력에서 나온다.

---

## 4. 라운드별 질문 전략

### R1: 탐색 극대화

- Evaluate/Create 수준 질문 사용 (규칙 4)
- 합의가 아닌 조건을 구하는 프레이밍 (규칙 2)
- 구체적 컨텍스트 포함 (규칙 5)
- 목적: 워커별로 최대한 다양한 초기 위치를 확보

### R2+: 빠진 관점 보강

- R1 응답을 Paul & Elder 6가지로 점검 (규칙 3)
- 가장 약한 영역에 대한 도전 질문을 worker-instructions에 추가
- 전원 동의한 결론이 있다면: "이것이 틀린 시나리오를 구성하라"
- 목적: 조기 수렴 방지, 탐색 영역 확장

### 합성 전: 자기 검증

- CQoT 8개 비판적 질문으로 합성 초안 검증
- Metacognitive 5단계: 이해 → 예비판단 → 비판적 평가 → 최종 결정 → 신뢰도
- 목적: 합성 품질 보장

---

## 5. 기존 연구와의 관계 정리

| 기존 pyreez 기법 | 역할 | 이 문서의 보완 |
|-----------------|------|--------------|
| GLOBAL_DEPTH | 워커 사고 깊이 | 호스트 질문 깊이 |
| Diversity Lenses | 워커 관점 다양성 | 호스트가 다양성을 유도하는 질문 |
| Anti-conformity | 순응 방지 | 수렴 시 도전 질문으로 다양성 회복 |
| Sparse sharing | 정보 과부하 방지 | 호스트가 R1 결과에서 빠진 관점을 식별해 보충 |
| Score anchors | 평가 보정 | 호스트가 Evaluate 수준 질문으로 판단 유도 |

**워커 기법은 "어떻게 답하느냐"를 최적화. 호스트 질문 기법은 "무엇에 답하느냐"를 최적화. 둘 다 필요.**

---

## 참고 문헌

### Socratic Questioning & 재귀적 사고

| 출처 | 날짜 | URL |
|------|------|-----|
| SOCRATIC QUESTIONING: Recursive Thinking with LLMs | EMNLP 2023 | https://arxiv.org/abs/2305.14999 |
| SoDa: Socratic Style CoT | ACL Findings 2025 | https://aclanthology.org/2025.findings-acl.640/ |
| Socratic Methods in Prompting (Chemistry) | ChemRxiv 2025 | https://chemrxiv.org/engage/api-gateway/chemrxiv/assets/orp/resource/item/67a236fc6dde43c90892cf6f/original |
| Socratic Method for Self-Discovery | Princeton NLP | https://princeton-nlp.github.io/SocraticAI/ |

### 비판적 질문 & 논증

| 출처 | 날짜 | URL |
|------|------|-----|
| CQoT: Critical-Questions-of-Thought | Dec 2024 | https://arxiv.org/abs/2412.15177 |
| Paul & Elder, Socratic Questioning Guide | 2006 | https://www.criticalthinking.org/files/SocraticQuestioning2006.pdf |
| CONSENSAGENT: Adaptive Prompt Refinement | ACL 2025 | https://aclanthology.org/2025.findings-acl.1141/ |

### 메타인지 & 자기 평가

| 출처 | 날짜 | URL |
|------|------|-----|
| Metacognitive Prompting | NAACL 2024 | https://arxiv.org/abs/2308.05342 |
| Pragmatic Metacognitive Prompting | ACL 2025 | https://aclanthology.org/2025.chum-1.7.pdf |
| Think2: Grounded Metacognitive Reasoning | Feb 2026 | https://arxiv.org/html/2602.18806 |

### 수렴-다양성 & Multi-Agent Debate

| 출처 | 날짜 | URL |
|------|------|-----|
| Consensus-Diversity Tradeoff | EMNLP 2025 | https://arxiv.org/abs/2502.16565 |
| Free-MAD | Sep 2025 | https://arxiv.org/abs/2509.11035 |
| Sparse Communication Topology | Jun 2024 | https://arxiv.org/html/2406.11776v1 |
| Self-Debate Reinforcement Learning | Jan 2026 | https://arxiv.org/abs/2601.22297 |
| A-HMAD: Adaptive Heterogeneous MAD | Springer 2025 | https://link.springer.com/article/10.1007/s44443-025-00353-3 |

### 컨텍스트 엔지니어링

| 출처 | 날짜 | URL |
|------|------|-----|
| Anthropic: Effective Context Engineering | 2025 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents |
| DAR: What agents hear matters | Mar 2026 | https://arxiv.org/html/2603.20640 |
