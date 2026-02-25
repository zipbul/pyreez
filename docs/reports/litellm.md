# LiteLLM — 심층 분석 보고서

> 서비스 카탈로그: [docs/services.md](../services.md)

## 기본 정보

| 항목 | 내용 |
|---|---|
| **이름** | LiteLLM |
| **주체** | BerriAI (YC W23 배출) |
| **GitHub** | `BerriAI/litellm` — ★ 36.8k |
| **라이선스** | MIT |
| **언어** | Python |
| **SDK** | Python SDK + Proxy Server (OpenAI 호환) |
| **고객** | Stripe, Netflix, OpenAI Agents SDK, Brex, Navan |

---

## 아키텍처 및 알고리즘

### 이중 모드 아키텍처

#### 1. Python SDK (직접 호출)

```python
from litellm import completion

# 모든 프로바이더를 동일한 함수로 호출
response = completion(
    model="anthropic/claude-sonnet-4",
    messages=[{"role": "user", "content": "Hello"}]
)

# OpenAI와 동일한 응답 포맷
print(response.choices[0].message.content)
```

- **100+ LLM 프로바이더**: OpenAI, Anthropic, Google, AWS Bedrock, Azure, Cohere, Replicate, HuggingFace, Ollama, vLLM 등
- **통합 API**: 모든 프로바이더를 `completion()` 하나로 호출
- **응답 포맷 통일**: 모든 프로바이더의 응답을 OpenAI 포맷으로 정규화

#### 2. Proxy Server (중앙 게이트웨이)

```
[애플리케이션 A] ─┐
[애플리케이션 B] ──┼──→ [LiteLLM Proxy] ──→ [LLM 프로바이더들]
[애플리케이션 C] ─┘         │
                          [PostgreSQL]
```

- **OpenAI 호환 서버**: 기존 OpenAI SDK 코드 무수정으로 사용
- **Virtual Keys**: 팀/프로젝트별 가상 API 키 발급
- **P95 레이턴시**: 8ms (게이트웨이 오버헤드)
- **부하 테스트**: 1500+ QPS 처리 (LiteLLM 공식 벤치마크)

### 라우팅 전략

| 전략 | 설명 |
|---|---|
| **Router** | 복수 배포(deployment) 간 라우팅 |
| **Fallbacks** | 모델/프로바이더 실패 시 자동 폴백 |
| **Load Balancing** | 가중치 기반 분산 |
| **Cooldown** | 연속 실패 모델 자동 제외 후 점진 복구 |
| **Content Policy Fallback** | content filter 오류 시 다른 모델 자동 전환 |

```yaml
# LiteLLM Proxy config.yaml
model_list:
  - model_name: gpt-4
    litellm_params:
      model: openai/gpt-4o
      api_key: sk-...
  - model_name: gpt-4
    litellm_params:
      model: azure/gpt-4-deployment
      api_key: ...
      api_base: https://...

router_settings:
  routing_strategy: "latency-based-routing"
  num_retries: 3
  fallbacks: [{"gpt-4": ["claude-sonnet"]}]
```

### 비용 추적 및 예산

```python
# Virtual Key별 예산 설정
litellm.budget_manager.create_budget(
    budget_name="team_a",
    max_budget=100.0,  # USD
    budget_duration="monthly"
)
```

- 프로바이더별 실시간 비용 계산
- 팀/프로젝트/사용자별 예산 설정
- 예산 초과 시 자동 차단 또는 저비용 모델로 폴백

### 관측성

- **지원 플랫폼**: Langfuse, Helicone, Datadog, Prometheus, OpenTelemetry
- **내장 로깅**: 요청/응답 메타데이터, 레이턴시, 비용, 토큰 수
- **커스텀 콜백**: 사용자 정의 로깅 함수 등록 가능

---

## 기술적 특징

### 프로바이더 통합 규모

100+ 프로바이더가 OpenAI SDK 호환 포맷으로 통합:

| 카테고리 | 프로바이더 (일부) |
|---|---|
| **클라우드** | OpenAI, Anthropic, Google, AWS Bedrock, Azure, GCP Vertex |
| **오픈소스 호스팅** | Together, Groq, Fireworks, DeepInfra, Anyscale |
| **로컬** | Ollama, vLLM, HuggingFace TGI, LM Studio |
| **특수** | Cohere, AI21, Replicate, Perplexity, Mistral |

### Multi-Modal 지원

- Vision (이미지 입력)
- Audio (음성 입력/출력)
- Embedding
- Image Generation
- Text-to-Speech

### OpenAI Agents SDK 통합

OpenAI Agents SDK가 LiteLLM을 공식 지원:
```python
from agents import Agent, Runner

agent = Agent(
    name="my_agent",
    model="litellm/anthropic/claude-sonnet-4",
)
```

---

## pyreez와의 비교

| 차원 | LiteLLM | pyreez |
|---|---|---|
| **프로바이더 통합** | 100+ 프로바이더 | 7개 프로바이더 (직접 호출) |
| **라우팅** | 인프라 수준 (폴백, 로드밸런싱) | 콘텐츠 인식 12 도메인 분류 |
| **숙의** | ❌ | ✅ Producer→Reviewers→Leader |
| **평가** | ❌ | ✅ Bradley-Terry 14차원 |
| **비용 관리** | ✅ 핵심 기능 (예산, 추적) | ❌ |
| **관측성** | ✅ (다중 플랫폼 연동) | ❌ |
| **Virtual Keys** | ✅ | ❌ |
| **MCP** | ❌ | ✅ |
| **언어** | Python | TypeScript (Bun) |
| **채택 규모** | 36.8k★, Fortune 500 | 개발 중 |

### 핵심 차이

LiteLLM은 **"LLM API의 JDBC(Universal Connector)"**다. 100+ 프로바이더를 하나의 통일된 인터페이스로 감싸는 것이 1차적 가치이며, 그 위에 라우팅, 비용 관리, 프록시 기능을 제공한다. pyreez는 "어떤 모델을 쓸 것인가(선택)"와 "어떻게 함께 쓸 것인가(숙의)"라는 더 상위의 전략을 담당한다.

실제로 pyreez가 LiteLLM을 LLM 호출 계층으로 사용하면, 현재 7개 프로바이더 제한을 100+로 확장할 수 있다. 이는 스택의 다른 계층에서 동작하는 **상호 보완적 관계**다.

---

## 커뮤니티 반응

- **최고 수준의 채택**: 36.8k 스타, Fortune 500 기업(Stripe, Netflix) 사용
- **"LLM의 표준 라이브러리"**: Python LLM 개발에서 사실상 표준(de facto standard)으로 평가
- **OpenAI Agents SDK 통합**: OpenAI 자체가 LiteLLM 호환을 지원하면서 위상 확립
- **프록시 성능**: 8ms P95로 프로덕션 트래픽 처리에 충분하다는 평가
- **우려**: Python 전용이라 non-Python 생태계에서는 직접 사용이 어려움
- **비교**: OpenRouter(호스팅 vs 자체 호스팅), Portkey(엔터프라이즈 기능) 비교 빈번
- **기여**: 900+ 기여자, 활발한 PR 활동. 커뮤니티 주도 프로바이더 추가

---

## 요약

LiteLLM은 **LLM 프로바이더 통합의 사실상 표준**으로, 100+ 프로바이더를 하나의 API로 추상화하는 데 가장 널리 사용되는 라이브러리다. 비용 관리, 폴백, 관측성 등 프로덕션 운영 기능도 포함한다. pyreez와는 스택의 다른 계층(인프라 vs 전략)에서 동작하며, pyreez의 LLM 호출 백엔드로 LiteLLM을 사용하는 것이 자연스러운 통합 시나리오다.
