# Chatbot Arena (LMSYS) — 심층 분석 보고서

> 서비스 카탈로그: [docs/services.md](../services.md)

## 기본 정보

| 항목 | 내용 |
|---|---|
| **이름** | Chatbot Arena (구 LMSYS Chatbot Arena) |
| **주체** | LMSYS (UC Berkeley), 현재 arena.ai |
| **GitHub** | `lm-sys/FastChat` — ★ 39.4k |
| **사이트** | arena.ai (구 lmarena.ai → chat.lmsys.org) |
| **논문** | "Chatbot Arena: An Open Platform for Evaluating LLMs by Human Preference" (arXiv:2403.04132) |
| **라이선스** | Apache 2.0 (FastChat) |
| **데이터** | 1.5M+ 인간 투표, 70+ LLM |

---

## 아키텍처 및 알고리즘

### 핵심 시스템: 인간 선호 기반 LLM 평가

Chatbot Arena는 두 가지 핵심 구성요소로 이루어진다:

#### 1. Arena (온라인 배틀)

```
사용자 질문 입력 → 익명의 모델 A, B 동시 응답 → 사용자가 승자 선택
                                            → Elo 레이팅 업데이트
```

**Battle 모드**:
| 모드 | 설명 |
|---|---|
| **Side-by-Side** | 두 익명 모델이 동시 응답, 사용자가 A/B/Tie/Both Bad 선택 |
| **Direct Chat** | 단일 모델과 대화 후 평가 |
| **Vision** | 이미지가 포함된 멀티모달 배틀 |

**블라인드 평가**: 사용자는 응답 후에야 모델명을 볼 수 있어, 브랜드 바이어스를 제거

#### 2. Elo Rating System (Elo 레이팅 체계)

**Bradley-Terry 모델 기반 Elo**:

$$P(A > B) = \frac{e^{R_A / 400}}{e^{R_A / 400} + e^{R_B / 400}}$$

- $R_A$: 모델 A의 Elo 레이팅
- $P(A > B)$: A가 B를 이길 확률
- 각 배틀 결과에 따라 양 모델의 레이팅 업데이트

**확장: 다차원 Elo**:
| 카테고리 | 설명 |
|---|---|
| Overall | 전체 성능 |
| Coding | 코드 생성/디버깅 |
| Hard Prompts | 어려운 질문 |
| Math | 수학 문제 |
| Creative Writing | 창작 |
| IF (Instruction Following) | 지시 따르기 |
| Style | 문체/포맷 |
| Vision | 이미지 이해 |

### MT-Bench (Multi-Turn Benchmark)

```
[Turn 1] 질문 → 답변
    ↓
[Turn 2] 후속 질문 → 답변
    ↓
[GPT-4 Judge] 양 턴 평가 → 1-10 점수
```

- 80개 다중 턴 질문 세트
- 8개 카테고리: Writing, Roleplay, Extraction, Reasoning, Math, Coding, Knowledge, STEM
- **LLM-as-Judge**: GPT-4가 자동 평가자 역할
- 인간 평가와의 높은 상관 (> 80%)

### 통계적 기법

- **Bootstrap Elo**: 재표본추출로 신뢰 구간 산출
- **Maximum Likelihood Estimation**: Bradley-Terry 모델의 MLE로 레이팅 추정
- **Tie 처리**: Tie 결과도 모델에 반영 (약한 패배로 처리)
- **Style Control**: 문체(길이, 마크다운 사용 등)의 영향을 통계적으로 제거

---

## 기술적 특징

### 데이터 규모와 품질

| 지표 | 수치 |
|---|---|
| 총 투표 수 | 1,500,000+ |
| 등록 모델 | 70+ |
| 배틀 모드 | 5개 (text, vision, code, hard, creative) |
| 카테고리별 리더보드 | 8개 |

### FastChat 인프라

FastChat은 Arena을 구동하는 오픈소스 인프라:
- **Model Worker**: 각 LLM을 서빙하는 작업자
- **API Server**: 배틀 요청을 관리
- **Controller**: 모델 작업자를 오케스트레이션
- **Web Frontend**: Gradio 기반 UI

### 연구 영향

Chatbot Arena의 데이터가 직접 활용되는 프로젝트:
- **RouteLLM**: Arena 선호 데이터로 라우터 학습
- **Not Diamond**: Arena 데이터를 라우팅 학습에 활용 (추정)
- **학계**: 100+ 논문에서 Arena 데이터 또는 리더보드 인용

---

## pyreez와의 비교

| 차원 | Chatbot Arena | pyreez |
|---|---|---|
| **평가 방식** | 인간 pairwise 비교 | 자동 Bradley-Terry 14차원 |
| **평가 데이터** | 1.5M 크라우드소싱 투표 | 사전 정의된 모델 프로파일 |
| **평가 대상** | 70+ 모델 | 21 모델 |
| **레이팅 모델** | Elo (Bradley-Terry 기반) | Bradley-Terry 14차원 |
| **실시간성** | ❌ 오프라인 벤치마크 | ✅ 요청 시점 동적 선택 |
| **모델 선택** | ❌ (순위만 제공) | ✅ 태스크별 자동 선택 |
| **숙의** | ❌ | ✅ |
| **목적** | 모델 순위/벤치마킹 | 모델 선택/숙의/판단 |

### 핵심 차이

Chatbot Arena는 **"이 모델이 저 모델보다 전반적으로 나은가?"**라는 질문에 답하는 **오프라인 벤치마크**다. pyreez는 **"이 특정 태스크에 어떤 모델이 가장 적합한가?"**라는 질문에 **실시간으로** 답한다.

그러나 둘은 **공통의 수학적 기반**을 공유한다: Bradley-Terry 모델. Chatbot Arena는 인간 선호 데이터에서 BT 파라미터를 추출하고, pyreez는 14차원 능력 점수를 BT 모델로 표현한다. 이는 Chatbot Arena의 데이터가 pyreez의 모델 평가를 보정(calibration)하는 데 활용될 수 있음을 시사한다.

---

## 커뮤니티 반응

- **업계 표준**: "LLM 벤치마크의 금본위(gold standard)"로 인정. 거의 모든 LLM 릴리즈에서 Arena 순위 인용
- **신뢰성**: 블라인드 인간 평가 방식이 자동 벤치마크(MMLU 등)의 한계를 보완
- **비판**: "영어 중심", "프롬프트 난이도 편향", "투표자 전문성 불균일" 같은 방법론적 한계 지적
- **조작 우려**: 특정 모델 리더보드 순위를 올리기 위한 의도적 투표 가능성 논의
- **Style Control 논쟁**: 모델이 더 긴/마크다운이 많은 응답으로 승률을 높일 수 있다는 지적 → Style Control 카테고리 추가로 대응
- **데이터 공개**: 연구용 데이터 공개가 RouteLLM 등 후속 연구를 가능하게 함

---

## 요약

Chatbot Arena는 **인간 선호 기반 LLM 평가의 글로벌 표준**으로, 1.5M+ 블라인드 투표 데이터와 Bradley-Terry Elo 레이팅 체계가 핵심이다. LLM 생태계에서 "어떤 모델이 좋은가?"에 대한 가장 신뢰받는 답을 제공하며, 그 데이터가 RouteLLM 등 후속 연구의 기반이 된다. pyreez와는 Bradley-Terry 모델이라는 수학적 기반을 공유하며, Arena 데이터를 pyreez의 모델 프로파일 보정에 활용할 수 있는 시너지가 있다.
