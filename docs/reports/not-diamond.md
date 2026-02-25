# Not Diamond — 심층 분석 보고서

> 서비스 카탈로그: [docs/services.md](../services.md)

## 기본 정보

| 항목 | 내용 |
|---|---|
| **이름** | Not Diamond |
| **주체** | Not Diamond Inc. (상용) |
| **GitHub** | `Not-Diamond/notdiamond-python` — ★ 90 (2025.12 archived) |
| **URL** | notdiamond.ai |
| **SDK** | Python, TypeScript, REST API |
| **인증** | SOC-2, ISO 27001 |
| **고객** | IBM, OpenRouter, HuggingFace, Dropbox, DoorDash, Snowflake, American Express, Notion |

---

## 제품 구성 및 알고리즘

### 1. Intelligent Routing (지능형 라우팅)

**핵심**: 입력 프롬프트를 분석하여 "어떤 LLM이 이 특정 입력에 가장 적합한가"를 초저지연으로 예측.

**알고리즘**:
- 여러 LLM을 하나의 "메타-모델(meta-model)"로 결합
- 학습 데이터: 각 모델별 성능 데이터(선호 데이터셋, 벤치마크 결과)
- 추론 시: 입력 특성을 분석 → 최적 모델 예측 → 단일 모델로 라우팅
- 비용/지연 트레이드오프 설정 가능

**특징**:
- 커스텀 라우터 학습: 자체 데이터로 라우터를 재학습 가능
- 모델 가용성에 따른 자동 폴백
- Python SDK에서 `NotDiamond()` 클래스로 간단히 사용

### 2. Prompt Optimization (프롬프트 최적화)

**핵심**: 프롬프트 템플릿을 자동으로 최적화하여 모델별 최적 성능 도출.

**접근법**:
- 기존 프롬프트를 입력받아 다양한 변형 생성
- 각 변형을 대상 모델에서 테스트
- 성능 메트릭 기반으로 최적 프롬프트 선택

### 3. Agent Optimization (에이전트 최적화)

**핵심**: 멀티스텝 AI 워크플로(에이전트)의 자가개선 알고리즘.

**접근법**:
- 에이전트의 각 스텝별 모델/프롬프트를 독립 최적화
- 워크플로 레벨의 피드백 루프로 전체 성능 최적화
- "자가개선(self-improving)" 알고리즘 적용

---

## 기술적 특징

### 라우팅 알고리즘 (추론)

```python
from notdiamond import NotDiamond
client = NotDiamond()

result, session_id, provider = client.chat.completions.create(
    messages=[{"role": "user", "content": "Write a poem about AI"}],
    model=["openai/gpt-4o", "anthropic/claude-3-opus"],
    tradeoff="cost"  # or "latency"
)
```

- **입력**: 메시지 + 후보 모델 목록 + 트레이드오프 설정
- **출력**: 최적 모델 선택 + 해당 모델의 응답
- **트레이드오프**: quality(기본), cost, latency

### OpenRouter 연동

Not Diamond은 OpenRouter의 Auto Router(`openrouter/auto`)를 구동하는 엔진이다:
- OpenRouter에서 `openrouter/auto` 모델 선택 시 Not Diamond 라우터가 작동
- Claude Sonnet 4.5, Claude Opus 4.5, GPT-5.1, Gemini 3 Pro, DeepSeek 3.2 중 선택
- 추가 비용 없음

---

## pyreez와의 비교

| 차원 | Not Diamond | pyreez |
|---|---|---|
| **라우팅** | ML 기반 메타-모델 예측 | 분류→프로파일→선택 3단계 파이프라인 |
| **숙의** | ❌ 없음 (단일 모델 응답 반환) | ✅ Producer→Reviewers→Leader 합의 |
| **평가** | 내부 벤치마크 (비공개) | Bradley-Terry 14차원 공개 점수 체계 |
| **프롬프트 최적화** | ✅ 자동 프롬프트 최적화 | ❌ |
| **에이전트 최적화** | ✅ 멀티스텝 워크플로 최적화 | ❌ |
| **커스텀 학습** | ✅ 자체 데이터로 라우터 재학습 | ❌ 사전 정의된 분류 체계 |
| **오픈소스** | ⚠️ SDK archived (2025.12) | ✅ 완전 오픈소스 |
| **MCP** | ❌ | ✅ |
| **배포** | SaaS (API) | 자체 호스팅 (MCP 서버) |

### 핵심 차이

Not Diamond은 **"최적 단일 모델을 빠르게 선택"**하는 데 초점을 맞춘 라우터인 반면, pyreez는 **"여러 모델이 함께 숙의하여 합의 도달"**하는 인프라다. Not Diamond에서는 항상 하나의 모델만 응답을 생성하지만, pyreez에서는 여러 모델이 각각 응답을 생성하고 상호 비판한 후 최종 합의에 도달한다.

---

## 현황 및 커뮤니티

- **SDK 아카이브**: Python SDK가 2025년 12월 archived. 오픈소스 개발 중단.
- **상용 서비스 지속**: notdiamond.ai 웹사이트는 운영 중이나, 핵심 가치를 OpenRouter Auto Router로 제공
- **커뮤니티 반응**: 초기 "AI 모델 라우터" 개념을 대중화한 공로 인정. 그러나 SDK 아카이브로 오픈소스 커뮤니티의 신뢰는 하락
- **경쟁 상황**: RouteLLM(무료 오픈소스)과 직접 경쟁. 상용 부분은 Portkey/TensorZero와 겹침

---

## 요약

Not Diamond은 **ML 기반 모델 라우팅의 상용 선구자**로, "입력별 최적 모델 예측"이라는 개념을 대중화했다. 프롬프트 최적화와 에이전트 최적화를 함께 제공하는 종합 "최적화 계층"을 지향했으나, SDK 아카이브와 OpenRouter 의존이 장기 독립성에 의문을 남긴다. pyreez와는 단일 모델 선택(Not Diamond) vs 멀티모델 숙의(pyreez)라는 근본적 패러다임 차이가 있다.
