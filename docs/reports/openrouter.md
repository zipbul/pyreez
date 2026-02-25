# OpenRouter — 심층 분석 보고서

> 서비스 카탈로그: [docs/services.md](../services.md)

## 기본 정보

| 항목 | 내용 |
|---|---|
| **이름** | OpenRouter |
| **주체** | OpenRouter Inc. (상용) |
| **URL** | openrouter.ai |
| **유형** | 상용 SaaS (LLM 통합 액세스 포인트) |
| **오픈소스** | ❌ (API만 제공) |

---

## 아키텍처 및 알고리즘

### 이중 라우팅 시스템

OpenRouter는 두 가지 독립적인 라우팅 메커니즘을 제공한다:

#### 1. Provider Routing (프로바이더 라우팅)

"같은 모델을 여러 프로바이더가 호스팅할 때, 어떤 프로바이더를 선택할 것인가?"

**정렬 기준** (선택 가능):
- `price` (기본): 토큰당 비용이 가장 낮은 프로바이더
- `throughput`: 토큰 처리 속도가 가장 빠른 프로바이더
- `latency`: 첫 토큰 응답 시간이 가장 짧은 프로바이더

**고급 기능**:
- **Percentile 기반 성능 임계값**: `p50`/`p75`/`p90`/`p99` 중 선택하여 "하위 X%의 프로바이더는 자동 제외"
- **Quantization 필터링**: 양자화 수준(int4, int8, fp8, fp16, bf16, unknown) 기반 필터링
- **ZDR(Zero Data Retention) 강제**: 데이터 보존 없는 프로바이더만 선택
- **프로바이더별 커스텀 헤더**: 특정 프로바이더에만 추가 설정 전달

```json
{
  "provider": {
    "sort": ["throughput"],
    "quantizations": ["fp16", "bf16"],
    "data_collection": "deny",
    "performance": {
      "percentile": "p90",
      "update_frequency": "1d"
    }
  }
}
```

#### 2. Auto Router (자동 라우터)

"어떤 모델이 이 프롬프트에 가장 적합한가?"

- `openrouter/auto` 모델명으로 호출
- **Not Diamond 라우터가 구동** (외부 서비스 의존)
- 프롬프트를 분석하여 최적 모델 자동 선택
- 추가 비용 없음 (선택된 모델의 기본 요금만)

**지원 모델 (2025 기준)**:
- Claude Sonnet 4.5, Claude Opus 4.5
- GPT-5.1
- Gemini 3 Pro
- DeepSeek 3.2

**커스터마이징**:
```json
{
  "models": ["openai/gpt-*", "anthropic/claude-*"],
  "route": "auto"
}
```
- 와일드카드 패턴으로 후보 모델 제한 가능

---

## 핵심 특징

### 프로바이더 라우팅 vs 모델 라우팅의 구분

OpenRouter의 가장 중요한 특징은 **이 두 가지가 독립적**이라는 것:

1. **사용자가 모델을 지정한 경우** (`model: "anthropic/claude-sonnet-4"`)
   → Provider Routing만 작동 (같은 모델을 호스팅하는 프로바이더 중 선택)

2. **Auto Router를 사용한 경우** (`model: "openrouter/auto"`)
   → 먼저 Not Diamond이 모델 선택 → 이후 Provider Routing이 프로바이더 선택

### 인프라 수준의 라우팅

OpenRouter의 Provider Routing은 **콘텐츠 비인식(content-agnostic)** 라우팅이다:
- 프롬프트 내용을 분석하지 않음
- 순수하게 가격/성능/가용성 기반
- 네트워크 로드밸런서에 가까운 개념

Auto Router만이 **콘텐츠 인식(content-aware)** 라우팅이며, 이는 외부(Not Diamond)에 의존한다.

---

## pyreez와의 비교

| 차원 | OpenRouter | pyreez |
|---|---|---|
| **프로바이더 라우팅** | ✅ 핵심 기능 | ❌ (프로바이더 직접 호출) |
| **모델 선택** | Not Diamond 의존 (Auto Router) | 내장 CLASSIFY→PROFILE→SELECT |
| **콘텐츠 인식** | Auto Router만 | ✅ 12 도메인, 62 태스크 분류 |
| **숙의** | ❌ | ✅ |
| **평가** | ❌ | ✅ Bradley-Terry 14차원 |
| **모델 수** | 200+ (거의 모든 상용 모델) | 21개 (선별된 검증 모델) |
| **비용 최적화** | ✅ (주요 가치) | 간접적 |
| **가용성 관리** | ✅ (폴백, 로드밸런싱) | ❌ |
| **자체 호스팅** | ❌ | ✅ (MCP 서버) |

### 핵심 차이

OpenRouter는 **LLM 액세스 인프라**다. "어떤 모델이든, 어떤 프로바이더든, 하나의 API로 접근"하는 것이 목표다. pyreez는 **LLM 활용 전략**이다. "어떤 모델을 선택하고, 어떻게 함께 사용하여 최적 결과를 얻을 것인가"가 목표다. 둘은 서로 다른 계층의 문제를 해결하며, 실제로 pyreez가 OpenRouter를 프로바이더로 사용할 수 있다.

---

## 커뮤니티 반응

- **높은 채택률**: 개인 개발자부터 기업까지 폭넓은 사용. "하나의 API 키로 모든 모델에 접근"의 편의성
- **Auto Router 평가**: "Not Diamond 기반이라 라우팅 품질은 관찰 필요", "무료라는 점이 매력적"
- **가격 투명성**: 프로바이더별 가격 비교가 명확하여 비용 의식적 사용자에게 인기
- **한계**: "프로바이더 로드밸런싱은 좋지만, 모델 선택의 지능은 부족하다"는 의견
- **경쟁**: LiteLLM(자체 호스팅), Portkey(엔터프라이즈), 직접 API 호출과 경쟁

---

## 요약

OpenRouter는 **LLM 액세스의 통합 관문(unified gateway)**으로, 프로바이더 수준의 최적화(가격, 속도, 가용성)에 탁월하다. 그러나 콘텐츠 인식 모델 선택은 Not Diamond에 외주하며, 멀티모델 숙의나 모델 평가 기능은 없다. pyreez와는 스택의 다른 계층에 위치하는 상호 보완적 서비스다.
