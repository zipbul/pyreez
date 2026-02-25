# TensorZero — 심층 분석 보고서

> 서비스 카탈로그: [docs/services.md](../services.md)

## 기본 정보

| 항목 | 내용 |
|---|---|
| **이름** | TensorZero |
| **GitHub** | `tensorzero/tensorzero` — ★ 11k |
| **URL** | tensorzero.com |
| **라이선스** | Apache 2.0 (게이트웨이), 상용 (Autopilot) |
| **언어** | Rust (게이트웨이), Python (최적화) |
| **펀딩** | $7.3M Seed (Y Combinator S24) |
| **상태** | 활발한 개발 |

---

## 아키텍처 및 알고리즘

### 5-기둥(5-Pillar) 스택

TensorZero는 "데이터와 최적화를 기반으로 LLM 애플리케이션을 점진적으로 개선하는" 통합 플랫폼이다.

#### Pillar 1: Gateway (게이트웨이)

```
[클라이언트] → [TensorZero Gateway (Rust)] → [LLM 프로바이더]
                     ↓
              [ClickHouse DB]
```

- **Rust 구현**: p99 레이턴시 < 1ms (10,000+ QPS)
- 모든 추론 요청/응답을 ClickHouse에 구조화 저장
- 모델 폴백, 라우팅, 프롬프트 관리 내장
- TOML 기반 설정 (코드 생성 없이 선언적 구성)

#### Pillar 2: Observability (관측성)

- 모든 추론의 입력/출력/메타데이터를 자동 수집
- 구조화된 데이터 (JSON schema 기반)
- ClickHouse의 대규모 분석 성능 활용
- 커스텀 메트릭, 사용자 피드백 수집 지원

#### Pillar 3: Optimization (최적화)

다양한 최적화 전략을 **레시피(recipes)** 형태로 제공:

| 레시피 | 설명 |
|---|---|
| **DICL** (Dynamic In-Context Learning) | 관련 예제를 동적으로 프롬프트에 삽입 |
| **Best-of-N Sampling** | N개 응답 생성 후 최적 선택 |
| **Fine-tuning** | 수집된 데이터로 모델 파인튜닝 자동화 |
| **DPO/PPO** | 선호 학습 기반 최적화 |

**DICL (Dynamic In-Context Learning)**:
```
쿼리 → 유사한 과거 성공 사례 검색 → 프롬프트에 예제로 삽입 → LLM 호출
```
- 추가 학습 없이 성능 향상
- RAG와 유사하나 "최적화 데이터" 기반

#### Pillar 4: Evaluation (평가)

- A/B 테스트 인프라 내장
- 다중 프롬프트/모델 변형의 동시 실험
- 통계적 유의성 기반 자동 분석

#### Pillar 5: Experimentation (실험)

- 프롬프트 버전 관리
- 트래픽 분할 (Canary, Blue-Green)
- 자동 롤백

### Autopilot (유료)

```
수집된 데이터 → TensorZero Autopilot (AI 엔지니어) → 자동 최적화 → 성능 향상
```

- "자동 AI 엔지니어": 데이터를 분석하고 최적화 전략을 자동 선택/적용
- 유료 서비스 (오픈소스 게이트웨이와 분리)

---

## 기술적 특징

### Rust 성능

| 지표 | 수치 |
|---|---|
| p99 레이턴시 | < 1ms (게이트웨이 오버헤드) |
| QPS | 10,000+ |
| 메모리 | 최소 (시스템 언어) |

- LLM 호출 자체의 지연(수백ms~수초)과 비교하면 게이트웨이 오버헤드가 무시할 수 있는 수준

### 구조화된 데이터 모델

```toml
[functions.my_function]
type = "chat"
system_schema = "..."  # JSON Schema
user_schema = "..."
output_schema = "..."  # 구조화된 출력

[functions.my_function.variants.gpt4o]
type = "chat_completion"
model = "openai::gpt-4o"
```

- 함수(function) 단위로 LLM 호출을 추상화
- 입출력 스키마를 선언적으로 정의
- 여러 변형(variant)을 하나의 함수에 연결 → A/B 테스트

---

## pyreez와의 비교

| 차원 | TensorZero | pyreez |
|---|---|---|
| **게이트웨이** | ✅ 핵심 (Rust, <1ms) | ❌ (MCP 서버, 게이트웨이 아님) |
| **라우팅** | 기본 (폴백, 라운드로빈) | ✅ 12 도메인 콘텐츠 인식 라우팅 |
| **숙의** | ❌ | ✅ Producer→Reviewers→Leader |
| **최적화** | ✅ DICL, 파인튜닝, DPO, Best-of-N | ❌ |
| **모델 평가** | A/B 테스트 기반 | Bradley-Terry 14차원 |
| **관측성** | ✅ ClickHouse (핵심 기능) | ❌ |
| **실험** | ✅ 프롬프트 버전, 트래픽 분할 | ❌ |
| **언어** | Rust (게이트웨이), Python (최적화) | TypeScript (Bun) |
| **성능** | 10,000+ QPS | MCP 단일 세션 |

### 핵심 차이

TensorZero는 **"LLM 운영 플랫폼(MLOps for LLMs)"**이다. 프로덕션 트래픽을 처리하면서 데이터를 수집하고, 그 데이터로 모델/프롬프트를 자동 개선하는 **피드백 루프**가 핵심이다. pyreez는 **"단일 요청 내에서의 최적 판단"**에 초점을 맞춘다. TensorZero는 시간 축에서의 개선(temporal optimization), pyreez는 공간 축에서의 개선(spatial ensemble)이라고 볼 수 있다.

---

## 커뮤니티 반응

- **높은 관심**: 11k 스타, YC S24 배출. "LLM 운영의 미래" 평가
- **Rust 성능**: 개발자 커뮤니티에서 Rust 게이트웨이의 성능을 높이 평가
- **복잡도 우려**: ClickHouse 의존, TOML 설정의 학습 곡선이 진입 장벽
- **Autopilot 평가**: "자동 최적화" 콘셉트에 흥미는 높으나, 유료 서비스에 대한 경계도 존재
- **비교 대상**: Portkey, LiteLLM과 게이트웨이 기능 비교 빈번. "TensorZero는 최적화에 강하고, Portkey는 관리에 강하다"
- **도입 사례**: 아직 초기 단계. 대형 사례 공개는 적으나, 성장세가 빠름

---

## 요약

TensorZero는 **데이터 기반 LLM 최적화 플랫폼**으로, Rust 게이트웨이의 초저지연 성능과 DICL/파인튜닝 등 다양한 최적화 레시피가 핵심이다. "프로덕션에서 수집된 데이터로 LLM 애플리케이션을 자동 개선"하는 피드백 루프를 구현하며, pyreez의 "요청 시점 멀티모델 숙의"와는 최적화의 **시간 축(temporal)** vs **공간 축(spatial)** 차이가 있다.
