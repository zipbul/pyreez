# 상호작용 기법 연구 자료

> 2026-03-25 작성. 4개 분야 교차 조사 결과.

---

## 1. 창의성 연구 — extend/transform 검증

### 1.1 extend (기존 것에 기반 구축) — 교차검증 완료 ✅

| 프레임워크 | 대응 개념 | 출처 |
|-----------|----------|------|
| Guilford SOI | **Elaboration** — divergent production의 공식 하위 차원 | InstructionalDesign.org |
| Geneplore | **Association** — 기본 생성 프로세스 | ScienceDirect |
| Ward | **Conceptual Expansion** — 기존 개념 경계 확장 | IAFOR Journal |
| Dual Pathway (Nijstad 2010) | **Persistence pathway** — 소수 범주 깊이 탐색 | European Review of Social Psychology |
| SCAMPER | **Adapt**, **Modify** (양적 변화) | IxDF, Wikipedia |
| Boden | **Exploratory creativity** — 개념 공간 내부 탐색 | Interalia |
| EMNLP 2025 Survey | **Iterative Refinement** — 점진적 출력 개선 | arXiv 2505.21116 |
| SIGDIAL 2025 | **Reviser** 역할 | arXiv 2507.08350 |

### 1.2 transform (재구성/결합) — 교차검증 완료 ✅

| 프레임워크 | 대응 개념 | 출처 |
|-----------|----------|------|
| Geneplore | **Transformation**, **Synthesis** — 명시적 생성 프로세스 | ScienceDirect |
| Boden | **Transformational creativity** — 개념 공간 규칙 자체 변경 | Interalia |
| SCAMPER | **Substitute**, **Combine**, **Reverse/Rearrange** | IxDF, Wikipedia |
| Guilford SOI | **Flexibility** — 범주 전환 능력 | InstructionalDesign.org |
| Beaney & Kunicki 2024 | **Transforming**, **Blending**, **Integrating** | Inquiry (Tandfonline) |
| Dual Pathway (Nijstad 2010) | **Flexibility pathway** — 넓은 범주 탐색 | European Review of Social Psychology |
| Ward | **Conceptual Blending** — 두 개념 공간 혼합 | IAFOR Journal |
| EMNLP 2025 Survey | **Collaborative Synthesis** | arXiv 2505.21116 |

### 1.3 propose/extend/transform에 매핑 안 되는 창의적 연산

| 누락 범주 | 프레임워크 근거 | pyreez 처리 |
|-----------|----------------|------------|
| **Evaluate/Critique** | Guilford (Evaluation, Convergent Production), CPS, Six Hats (Black/Yellow), SIGDIAL 2025 (Critique), CHI 2026 (Idea Evaluation), ICCC 2024 (Minus) | → **challenge**로 커버 |
| **Eliminate/Reduce** | SCAMPER (Eliminate), Geneplore (Categorical Reduction) | → challenge에 흡수 가능 ("불필요한 것을 찾아라") |
| **Analogical Transfer** | Geneplore, Koestler (Bisociation) | → propose의 변형 ("다른 도메인에서 차용") |
| **Contextual Shifting** | Geneplore, SCAMPER (Put to another use) | → transform에 흡수 ("다른 맥락에 배치") |

**결론: extend와 transform은 창의성 연구에서 강력하게 교차검증됨. 누락 범주는 기존 7개에 흡수 가능.**

---

## 2. 집단 의사결정 심리학

### 2.1 7개는 적절한 수인가

| 근거 | 발견 | 출처 |
|------|------|------|
| Miller (1956) | 인간 작업기억 한계 7±2 | 심리학 기초 |
| Green & Rao (1970) | 정보 회수 최적화 6-7개 카테고리 | ScienceDirect |
| Cicchetti et al. (1985) | 평정자간 신뢰도 7개까지 최적, 초과 시 이득 미미 | ScienceDirect |
| Bales IPA | 12개 사용하지만 전문 코더용 — 참여자 선택용이 아님 | Cambridge Handbook |

**결론: 7개는 상한선이지만 수용 가능 범위. 추가 금지.**

### 2.2 단일 모드 강제 vs 모드 혼합

| 발견 | 출처 |
|------|------|
| **Authentic dissent > devil's advocate 역할극.** 역할 강제 시 "give and take"가 약해짐 | Nemeth 2001, Wiley |
| 가장 효과적인 exploratory talk는 **여러 행위가 자연스럽게 혼합**된 상태 | Mercer, Cambridge |
| **Moderate, not maximal, disagreement가 최적.** 과도한 구조적 갈등 강제는 성능 저하 | Liang MAD 2023, ICLR 2025 Blog |
| Collaboration scripts: 턴 단위 구조화는 논증 품질 향상 | Weinberger & Fischer, HAL |

**결론: 단일 모드 "강제"가 아니라 "이번 라운드의 주된 방향" 정도의 가이드가 효과적.**

### 2.3 강조(emphasis) vs 제약(constraint) — 역U자 곡선

**Acar, Tarakci & van Knippenberg (2019)**: 제약과 창의성 사이에 **inverted U-shape** 관계.

- 적당한 제약: "도전"으로 인식 → 실험과 위험 감수 동기 부여
- 과도한 제약: "통제"로 인식 → 창의성 억제

**Cromwell (2024)**: 제약의 **조합**이 중요. 한 차원 높고 다른 차원 낮은 균형 잡힌 조합이 창의성 극대화.

출처: Acar et al. 2019 (SAGE), Cromwell 2024 (SAGE), BioScience 2023

**결론: emphasis는 역U자 곡선의 최적 지점(도전). constraint는 우측 이탈 위험(통제).**

### 2.4 여러 프레임워크에서 반복 등장하나 현재 7개에 없는 모드

| 후보 | 출처 수 | 7개와의 관계 |
|------|:---:|------------|
| Synthesize/Integrate | Johnson & Johnson, Weinberger, Accountable Talk | 호스트 책임 (기존 결론 유지) |
| Qualify/Constrain | Toulmin (qualifier) | probe/challenge의 하위 행위 |
| Clarify/Paraphrase | Paul, Weinberger, Bales, ISO 24617-2 | probe에 흡수 가능 |
| Reverse Perspectives | Johnson & Johnson | 단일 소스 — 미검증 |
| Acknowledge Ambiguity | Productive Discussion Moves 2026, Mercer | 기법이 아닌 일반 원칙으로 적용 가능 |

---

## 3. 기법 강제성 vs 강조 — 핵심 발견

### 3.1 GOAL 지정 vs PROCESS 처방 (교차검증: 2소스)

| 구분 | 예시 | 효과 | 출처 |
|------|------|------|------|
| **GOAL 지정** | "Find weaknesses" | ✅ 도움 | Free-MAD 2025, DCI Mar 2026 |
| **PROCESS 처방** | "List 3 counter-arguments, rate 1-5" | ❌ 해로움 | Free-MAD 2025, DCI Mar 2026 |

Free-MAD가 제거한 건 PROCESS (합의 강제, 고정 라운드). 유지한 건 GOAL ("자신의 답이 명확히 틀린 경우에만 변경").

DCI (Mar 2026): "비루틴 태스크에서 구조화된 deliberation이 비구조화 debate보다 +0.95 향상" — 구조화 자체가 나쁜 게 아니라 구조화의 **수준**이 문제.

### 3.2 Soft emphasis > Hard constraint (교차검증: 4소스)

| 증거 | 발견 | 출처 |
|------|------|------|
| CRANE (ICML 2025) | 구조화 출력 강제 → 추론 10-15% 저하. 자유 추론 → 구조화 변환이 최적 | arXiv 2502.09061 |
| DETAIL Matters (Dec 2025) | 프롬프트 구체성에 sweet spot 존재. 과도한 동사 구체성 → CoT 정확도 하락 | arXiv 2512.02246 |
| Li & Wu (Jul 2025) | Over-control → 시뮬레이션 결과를 의도치 않게 결정 | System Dynamics Review |
| RL+LLM guidance | Hard constraint → LLM 오류에 취약. Soft constraint → 세계 지식 활용 + 유연성 | arXiv 2510.08779 |

### 3.3 DMAD 성공 메커니즘 분리 (교차검증: 3소스)

DMAD (ICLR 2025)의 forced diverse reasoning이 technique assignment를 지지하는가?

| 후속 연구 | 발견 | 출처 |
|-----------|------|------|
| DynaDebate (Jan 2026) | 핵심은 **초기 다양성 확보**이지 고정 기법 할당이 아님 | arXiv 2601.05746 |
| Amazon "Unfixing the Mental Set" (2025) | 고정 기법이 아니라 **모델별 적응적 전략** | Amazon Science |
| Demystifying MAD (Jan 2026) | 기법 자체가 아니라 **다양성 + 신뢰도 보정**이 핵심 | arXiv 2601.19921 |

**결론: pyreez가 이종 모델로 이미 초기 다양성을 확보. 기법 할당의 한계 효용은 줄어들지만, emphasis 수준의 방향 지시는 여전히 가치 있음.**

### 3.4 반순응 단독으로 martingale을 깨는가? — 불가 (교차검증: 3소스)

| 증거 | 발견 | 출처 |
|------|------|------|
| AceMAD (Mar 2026) | Standard MAD cannot improve beyond majority voting. Martingale을 깨려면 **submartingale drift** 필요 | arXiv 2603.06801 |
| Demystifying MAD (Jan 2026) | 다양성 + **calibrated confidence**가 필요 | arXiv 2601.19921 |
| CONSENSAGENT (ACL 2025) | 반순응이 아닌 **적응적 프롬프트 refinement** | ACL Anthology |

Anti-conformity가 방지하는 것: sycophantic conformity (순응)
Anti-conformity가 생성하지 못하는 것: 정답 방향으로의 체계적 drift

**Martingale을 깨려면:**
1. 초기 다양성 (이종 모델 — pyreez 보유 ✅)
2. 신뢰도 보정 (calibrated confidence — pyreez 미보유 ❌)
3. 비대칭 가중치 (정답자가 더 큰 영향력 — pyreez 미보유 ❌)

---

## 4. 협상 이론 & 교육학

### 4.1 교차검증된 누락 후보 (2소스 이상)

| 후보 | 정의 | 소스 수 | 7개와의 관계 | 판정 |
|------|------|:---:|------------|:---:|
| **Concede** | 특정 논점에 대해 부분 양보 | 3 (Pragma-dialectics, McBurney, Lewicki) | accept이 이미 "Modify your position where others present stronger evidence"로 커버 | 흡수됨 |
| **Retract** | 이전 입장 명시적 철회 | 2 (Pragma-dialectics, McBurney) | LLM에 persistent commitment 없음 | 불필요 |
| **Clarify** | 기존 진술 의미 확인 | 3 (ISO 24617-2, PACT, Pragma-dialectics) | probe에 흡수 가능 — 깊이(probe) vs 정확성(clarify) 차이는 있으나 LLM 실행에서 구분 어려움 | 흡수됨 |
| **Synthesize** | 여러 입장 통합 요약 | 2 (Accountable Talk, Constructive Controversy) | 호스트 책임 — 10+ 시스템 교차검증 완료 | 호스트 |
| **Acknowledge Ambiguity** | 불확실성/내적 갈등 인정 | 2 (Productive Discussion Moves 2026, Mercer) | 기법이 아닌 일반 원칙으로 적용 | 원칙 |

### 4.2 reframe vs transform — 동의어 확인 (교차검증: 2소스)

| 근거 | 출처 |
|------|------|
| Reframing = "changing the focus or context" = transform의 정의와 동일 | Impact Negotiation |
| "Defining the problem differently... move from positions to interests" = transform | Beyond Intractability |

### 4.3 조건부 수용 (conditional concede) — accept + propose로 분해 가능

"X를 양보하겠지만 Y가 조건이다" = accept(X에 대해) + propose(Y 조건). 별도 기법 불필요.

---

## 5. 종합 결론 — COMMON_PLAN 수정 사항

### 5.1 확정: 7개 유지, 구성 변경 없음

추가 조사 결과 7개 밖으로 빠지는 누락 기법이 없다:
- Eliminate → challenge에 흡수
- Concede → accept에 흡수 (이미 "부분 수정" 포함)
- Clarify → probe에 흡수
- Synthesize → 호스트 책임 (재확인)
- Retract → LLM 맥락에서 불필요 (재확인)
- Reframe → transform과 동의어 (확인)

7은 인지적 상한선 (Miller, Cicchetti). 추가 금지.

### 5.2 변경 필요: 기법 framing을 constraint → emphasis로

**현재 (COMMON_PLAN):**
```
challenge: "Find weaknesses, counter-examples, and errors in these positions.
            Present specific evidence for each flaw you identify."
```

**변경 후:**
```
challenge: "Focus on identifying weaknesses, counter-examples, and errors.
            Present specific evidence for each flaw. Include other relevant
            observations as they arise."
```

근거: Acar 2019 역U자형 (4소스), CRANE ICML 2025 (soft > hard), Nemeth 2001 (authentic > forced).

### 5.3 변경 필요: anti-conformity는 필요 조건이지 충분 조건이 아님

COMMON_PLAN은 반순응 보호를 "항상 적용"으로 기술. 이건 맞지만, **이것만으로 martingale을 깨지 못한다**는 점을 명시해야 함. AceMAD (Mar 2026)가 증명.

추가로 필요한 것 (후속 과제):
- 신뢰도 보정 (calibrated confidence) — AceMAD, Demystifying MAD
- 비대칭 가중치 업데이트 — AceMAD

### 5.4 추가: 불확실성 인정을 일반 원칙으로

기법이 아닌 모든 프롬프트에 적용하는 원칙:
```
"Express uncertainty where it exists. Do not force confidence on ambiguous points."
```

근거: Productive Discussion Moves 2026, Mercer exploratory talk, LLM overconfidence bias.

---

## 참고 문헌 (분야별)

### 창의성 연구

| 출처 | 날짜 | URL |
|------|------|-----|
| Boden - Creativity in a Nutshell | 2004 | https://www.interaliamag.org/articles/margaret-boden-creativity-in-a-nutshell/ |
| Geneplore Model (Finke, Ward, Smith) | 1992 | https://www.sciencedirect.com/topics/psychology/geneplore-model |
| SCAMPER | Eberle | https://en.wikipedia.org/wiki/SCAMPER |
| Guilford SOI | 1956 | https://www.instructionaldesign.org/theories/intellect/ |
| De Bono Lateral Thinking | 1967 | https://www.debonogroup.com/services/core-programs/lateral-thinking/ |
| Six Hats + LLM (ICCC 2025) | 2025 | https://computationalcreativity.net/iccc25/wp-content/uploads/papers/iccc25-liu2025creative.pdf |
| Dual Pathway (Nijstad et al.) | 2010 | https://www.tandfonline.com/doi/abs/10.1080/10463281003765323 |
| Beaney & Kunicki Integrational Creativity | 2024 | https://www.tandfonline.com/doi/full/10.1080/0020174X.2024.2389992 |
| Ward Conceptual Expansion | 1994+ | https://iafor.org/journal/iafor-journal-of-psychology-and-the-behavioral-sciences/volume-5-si/article-3/ |
| EMNLP 2025 Creativity in MAS Survey | 2025 | https://arxiv.org/abs/2505.21116 |
| CHI 2026 Human-Multi-Agent Teams | 2026 | https://arxiv.org/html/2601.13865v1 |
| SIGDIAL 2025 Research Ideation | 2025 | https://arxiv.org/abs/2507.08350 |
| ICCC 2024 Group Brainstorming + AI | 2024 | https://computationalcreativity.net/iccc24/papers/ICCC24_paper_18.pdf |

### 집단 의사결정 심리학

| 출처 | 날짜 | URL |
|------|------|-----|
| Bales IPA | 1950 | https://www.cambridge.org/core/books/abs/cambridge-handbook-of-group-interaction-analysis/ |
| Mercer Three Kinds of Talk | 2000s | https://www.structural-learning.com/post/exploratory-talk |
| Weinberger & Fischer CSCL | 2006 | https://telearn.hal.science/hal-00190643v1/document |
| Paul & Elder Socratic Questioning | 1993 | https://www.criticalthinking.org/files/SocraticQuestioning2006.pdf |
| Johnson & Johnson Constructive Controversy | 2009 | https://journals.sagepub.com/doi/10.3102/0013189X08330540 |
| Nemeth Authentic Dissent | 2001 | https://onlinelibrary.wiley.com/doi/abs/10.1002/ejsp.58 |
| Acar et al. Constraint-Creativity U-shape | 2019 | https://journals.sagepub.com/doi/full/10.1177/0149206318805832 |
| Cromwell Constraint Typology | 2024 | https://journals.sagepub.com/doi/10.1177/20413866231202031 |
| Productive Discussion Moves | Jan 2026 | https://arxiv.org/html/2601.05651 |
| Optimal Response Categories | 1999 | https://www.sciencedirect.com/science/article/abs/pii/S0001691899000505 |

### 기법 강제성 vs 강조

| 출처 | 날짜 | URL |
|------|------|-----|
| Free-MAD | Sep 2025 | https://arxiv.org/abs/2509.11035 |
| DCI: From Debate to Deliberation | Mar 2026 | https://arxiv.org/abs/2603.11781 |
| AceMAD: Breaking the Martingale | Mar 2026 | https://arxiv.org/abs/2603.06801 |
| Demystifying MAD | Jan 2026 | https://arxiv.org/abs/2601.19921 |
| CRANE (ICML 2025) | 2025 | https://arxiv.org/abs/2502.09061 |
| DETAIL Matters | Dec 2025 | https://arxiv.org/abs/2512.02246 |
| DynaDebate | Jan 2026 | https://arxiv.org/abs/2601.05746 |
| Amazon Unfixing Mental Set | 2025 | https://www.amazon.science/publications/unfixing-the-mental-set |
| DMAD (ICLR 2025) | 2025 | https://openreview.net/forum?id=t6QHYUOQL7 |
| Let It Go or Control It All | Jul 2025 | https://onlinelibrary.wiley.com/doi/10.1002/sdr.70008 |
| CONSENSAGENT (ACL 2025) | 2025 | https://aclanthology.org/2025.findings-acl.1141/ |

### 협상 이론 & 교육학

| 출처 | 날짜 | URL |
|------|------|-----|
| Pragma-Dialectics | van Eemeren | https://en.wikipedia.org/wiki/Pragma-dialectics |
| McBurney Eightfold Way | 2007 | https://www.humanities.mcmaster.ca/~hitchckd/dd.pdf |
| Measuring Negotiation Tactics | Dec 2025 | https://arxiv.org/html/2512.18292 |
| Advancing AI Negotiations | Mar 2025 | https://arxiv.org/html/2503.06416v2 |
| PACT (EMNLP 2025) | 2025 | https://arxiv.org/html/2509.11118 |
| ISO 24617-2 Dialogue Act Standard | ISO | https://www.iso.org/standard/51967.html |
| Lewicki Integrative Negotiation | — | https://faculty.ksu.edu.sa/sites/default/files/im_chapter_03_7e_lewicki_eon_2.pdf |
| Johnson & Johnson Constructive Controversy | — | https://www.beyondintractability.org/artsum/johnson-constructive |
| Michaels & O'Connor Talk Moves | — | https://keystoliteracy.com/blog/discussion-to-support-learning-part-3/ |
| EDM 2025 Talk Moves | 2025 | https://educationaldatamining.org/EDM2025/proceedings/2025.EDM.long-papers.201/ |
| Reframing in Negotiations | — | https://impactnegotiationgroup.com/insight/the-power-of-framing-and-reframing-in-negotiations/ |
| Reframing (Beyond Intractability) | — | https://www.beyondintractability.org/essay/framing |
