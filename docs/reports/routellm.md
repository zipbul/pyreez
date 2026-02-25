# RouteLLM — 심층 분석 보고서

> 서비스 카탈로그: [docs/services.md](../services.md)

## 기본 정보

| 항목 | 내용 |
|---|---|
| **이름** | RouteLLM |
| **주체** | LMSYS (UC Berkeley) |
| **GitHub** | `lm-sys/RouteLLM` — ★ 4.6k |
| **논문** | "RouteLLM: Learning to Route LLMs with Preference Data" (arXiv:2406.18665) |
| **라이선스** | Apache 2.0 |
| **언어** | Python |

---

## 아키텍처 및 알고리즘

### 핵심 개념: 이진 라우팅

RouteLLM은 **강한 모델(expensive)** ↔ **약한 모델(cheap)** 간의 이진 라우팅 문제를 해결한다. 모든 쿼리를 강한 모델에 보내면 비용이 높고, 모든 쿼리를 약한 모델에 보내면 품질이 낮다. RouteLLM은 각 쿼리를 분석하여 "이 쿼리에 강한 모델이 필요한가?"를 판단한다.

### 4개 내장 라우터

#### 1. `mf` — Matrix Factorization (행렬 분해) ⭐ 권장

```
선호 데이터(Chatbot Arena) → 행렬 분해 → 모델-프롬프트 호환성 점수
```

- Chatbot Arena의 pairwise preference 데이터로 학습
- 사용자 프롬프트와 모델 간의 "호환성 점수"를 행렬 분해로 산출
- 임계값(threshold)과 비교하여 강한/약한 모델 결정
- **가장 균형 잡힌 성능**으로 기본 권장

#### 2. `sw_ranking` — Similarity-Weighted ELO Ranking

```
입력 프롬프트 → Arena 내 유사 프롬프트 검색 → 가중 Elo 점수 계산
```

- Chatbot Arena 데이터에서 유사 프롬프트를 찾아 해당 맥락에서의 Elo 점수 계산
- 유사도 기반 가중치로 모델별 "맥락적 Elo"를 산출
- 추론 시 임베딩 검색 필요

#### 3. `bert` — BERT 분류기

```
입력 프롬프트 → BERT 인코더 → 이진 분류 (강한/약한)
```

- preference 데이터로 BERT를 파인튜닝한 이진 분류기
- 프롬프트가 "강한 모델이 필요한 유형"인지 직접 분류
- 빠르고 단순하지만 일반화 성능은 `mf`보다 낮음

#### 4. `causal_llm` — LLM 기반 분류기

```
입력 프롬프트 → LLM에게 "이 프롬프트에 강한 모델이 필요할까?" 질문 → 확률 추출
```

- LLM 자체를 라우터로 사용
- 가장 비용이 높지만 가장 유연
- 새로운 도메인에 대한 적응력이 가장 좋음

### 비용 임계값 (Cost Threshold)

```python
# threshold 높을수록 약한 모델 비율 증가 (비용 절감)
# threshold 낮을수록 강한 모델 비율 증가 (품질 유지)
os.environ["ROUTELLM_THRESHOLD"] = "0.11593"
```

- 0.0: 모든 쿼리를 강한 모델로 (최고 품질, 최고 비용)
- 1.0: 모든 쿼리를 약한 모델로 (최저 품질, 최저 비용)
- 사용자가 품질-비용 트레이드오프를 직접 조절

### 학습 데이터

- 기본: `gpt-4-1106-preview` (강한) + `mixtral-8x7b-instruct-v0.1` (약한) 쌍으로 학습
- Chatbot Arena의 80k+ 인간 선호 데이터 활용
- 다른 모델 쌍으로도 일반화 가능 (실험적으로 확인)

---

## 성능 벤치마크

| 지표 | 결과 |
|---|---|
| 비용 절감 | 최대 **85%** (GPT-4 대비) |
| 품질 유지 | GPT-4 성능의 **95%** 유지 |
| 라우팅 정확도 | MT-Bench에서 mf 라우터의 AUC > 0.95 |

### 주요 발견

- `mf` 라우터가 전반적으로 가장 좋은 성능-비용 균형
- 비용을 50% 절감해도 성능 저하가 2-3% 미만
- MMLU, MT-Bench, GSM8K 등 다양한 벤치마크에서 일관된 결과

---

## 사용 방식

### OpenAI 호환 드롭인 교체

```python
import openai

client = openai.OpenAI(
    base_url="https://localhost:6060/v1",
    api_key="sk-..."
)

# routellm이 자동으로 라우팅
response = client.chat.completions.create(
    model="router-mf",  # mf 라우터 사용
    messages=[{"role": "user", "content": "Hello!"}]
)
```

- 기존 OpenAI SDK 코드 변경 최소화
- `model` 파라미터만 `router-mf`, `router-bert` 등으로 변경

---

## pyreez와의 비교

| 차원 | RouteLLM | pyreez |
|---|---|---|
| **라우팅 방식** | 2개 모델 간 이진 분류 | 12 도메인 × 62 태스크 다차원 분류 |
| **라우터 수** | 4개 (mf, sw_ranking, bert, causal_llm) | 1개 파이프라인 (CLASSIFY→PROFILE→SELECT) |
| **학습 데이터** | Chatbot Arena 선호 데이터 | 사전 정의된 능력 프로파일 + BT 14차원 점수 |
| **모델 수** | 2개 (강한/약한) | 21개 모델, 7개 프로바이더 |
| **숙의** | ❌ | ✅ Producer→Reviewers→Leader |
| **평가** | 간접 (선호 데이터 기반) | ✅ Bradley-Terry 14차원 |
| **비용 제어** | ✅ threshold로 직접 조절 | ❌ (품질 우선) |
| **MCP** | ❌ | ✅ |

### 핵심 차이

RouteLLM은 **"비용 최소화를 위한 이진 라우팅"**에 집중한다. "이 쿼리가 GPT-4급이 필요한가, Mixtral이면 충분한가?"라는 단일 질문에 답한다. pyreez는 **"21개 모델 중 어떤 조합이 최적인가"**와 **"선택된 모델들이 함께 숙의하여 더 나은 답을 만들 수 있는가"**라는 더 복잡한 질문에 답한다.

---

## 커뮤니티 반응

- **긍정적**: 학술적 엄밀함과 실용성의 균형이 좋다는 평가. LMSYS의 신뢰도로 빠르게 채택
- **GitHub 활동**: 4.6k 스타, 활발한 이슈/PR. 커뮤니티 기여 활발
- **한계 인식**: "이진 라우팅은 현실의 다양한 시나리오를 충분히 커버하지 못한다"는 의견. 3개 이상 모델 라우팅 요구
- **실무 사용**: LiteLLM, Portkey 등 게이트웨이에 통합되어 사용되는 사례 보고
- **대안과의 비교**: Not Diamond(상용)의 무료 오픈소스 대안으로 자주 언급

---

## 요약

RouteLLM은 **비용 효율적 LLM 라우팅의 학술적 표준**으로, Chatbot Arena 데이터를 활용한 4가지 라우팅 알고리즘을 제공한다. "강한 모델이 필요한 쿼리만 강한 모델로 보내라"는 명확한 가치를 실증했다. 그러나 이진 라우팅이라는 구조적 한계와 숙의 기능 부재로, pyreez의 다차원 모델 선택 + 멀티모델 숙의와는 패러다임이 다르다.
