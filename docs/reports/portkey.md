# Portkey AI Gateway — 심층 분석 보고서

> 서비스 카탈로그: [docs/services.md](../services.md)

## 기본 정보

| 항목 | 내용 |
|---|---|
| **이름** | Portkey AI Gateway |
| **주체** | Portkey AI (상용) |
| **GitHub** | `Portkey-AI/gateway` — ★ 10.7k |
| **URL** | portkey.ai |
| **라이선스** | MIT (게이트웨이 코어) |
| **언어** | TypeScript |
| **크기** | 122KB (게이트웨이 코어) |
| **펀딩** | Series A $15M |
| **인증** | SOC2 Type II, HIPAA, GDPR |

---

## 아키텍처 및 알고리즘

### 게이트웨이 코어 (오픈소스)

#### 라우팅 전략

200+ LLM 프로바이더를 대상으로 다양한 라우팅 전략 제공:

| 전략 | 설명 |
|---|---|
| **Fallback** | 주 모델 실패 시 자동으로 대체 모델로 전환 |
| **Load Balancing** | 가중치 기반 트래픽 분산 |
| **Retry** | 실패한 요청 자동 재시도 (지수 백오프) |
| **Conditional Routing** | 조건 기반 라우팅 (입력 길이, 비용 등) |
| **Semantic Caching** | 유사한 요청의 캐시 응답 반환 |

```typescript
// Portkey Gateway Config 예시
const config = {
  strategy: { mode: "fallback" },
  targets: [
    { provider: "openai", model: "gpt-4o", weight: 0.7 },
    { provider: "anthropic", model: "claude-sonnet-4", weight: 0.3 }
  ],
  cache: { mode: "semantic", max_age: 3600 }
};
```

#### 가드레일 (Guardrails)

40+ 내장 가드레일:
- **입력**: PII 탐지, 프롬프트 인젝션 방지, 토큰 제한
- **출력**: 할루시네이션 탐지, 유해 콘텐츠 필터, JSON 스키마 검증
- **커스텀**: 사용자 정의 가드레일 함수

#### 시맨틱 캐싱

```
요청 → 임베딩 생성 → 유사 캐시 검색 → 유사도 임계값 초과 시 캐시 반환
                                        → 미만 시 LLM 호출 후 캐시 저장
```

- 정확히 동일하지 않아도 "의미적으로 유사한" 요청에 캐시 반환
- 비용 및 지연 대폭 절감

### 엔터프라이즈 기능 (상용)

#### AI Gateway (관리형)

- Virtual Keys: 실제 API 키 노출 없이 팀별 가상 키 발급
- Rate Limiting: 팀/프로젝트별 사용량 제한
- Budget Alerts: 비용 임계값 알림
- Multi-tenant 비용 추적

#### Guardrails Hub

- 40+ 사전 구축 가드레일
- Portkey 자체 + 파트너(Patronus, Pillar, Aporia 등) 가드레일 마켓플레이스
- 체인 형태로 여러 가드레일 조합 가능

#### MCP Gateway (최근 추가)

```
[MCP 클라이언트] → [Portkey MCP Gateway] → [복수 MCP 서버]
```

- MCP 프로토콜의 게이트웨이 역할
- 여러 MCP 서버를 하나의 엔드포인트로 통합
- 접근 제어, 로깅, 모니터링 추가

#### Prompt Management

- 프롬프트 버전 관리
- 환경별 배포 (dev/staging/prod)
- A/B 테스트 지원

---

## 기술적 특징

### 초경량 설계

- **122KB**: 게이트웨이 코어가 매우 가벼움
- **Edge 배포 가능**: Cloudflare Workers, Vercel Edge 등 에지 런타임에서 실행
- **TypeScript**: 웹 생태계와 자연스러운 통합

### 통합 API

```typescript
import Portkey from 'portkey-ai';

const portkey = new Portkey({
    apiKey: "PORTKEY_API_KEY",
    config: "pc-your-config-id"
});

const response = await portkey.chat.completions.create({
    messages: [{ role: "user", content: "Hello!" }],
    model: "gpt-4o"
});
```

- OpenAI SDK 호환 API
- 기존 코드 최소 수정으로 전환 가능

---

## pyreez와의 비교

| 차원 | Portkey | pyreez |
|---|---|---|
| **게이트웨이** | ✅ 핵심 (122KB, Edge 배포) | ❌ |
| **라우팅** | 조건/가중치 기반 | 콘텐츠 인식 12 도메인 분류 |
| **숙의** | ❌ | ✅ Producer→Reviewers→Leader |
| **평가** | ❌ (관측성은 있음) | ✅ Bradley-Terry 14차원 |
| **가드레일** | ✅ 40+ 내장 | ❌ |
| **캐싱** | ✅ 시맨틱 캐싱 | ❌ |
| **키 관리** | ✅ Virtual Keys | ❌ |
| **프롬프트 관리** | ✅ | ❌ |
| **MCP** | ✅ (MCP Gateway — 다중 MCP 서버 관리) | ✅ (MCP 서버 — 직접 도구 제공) |
| **타겟** | 프로덕션 트래픽 관리 | 개발 시점 품질 최대화 |

### 핵심 차이

Portkey는 **"LLM 트래픽 관리자(traffic manager)"**다. 200+ 프로바이더로의 트래픽을 라우팅, 캐싱, 보안, 모니터링하는 **운영 계층**이다. pyreez는 **"LLM 판단 품질 최적화기"**로, 단일 요청 내에서 다수 모델의 숙의를 통해 최적 응답을 생성하는 **판단 계층**이다.

Portkey의 MCP Gateway와 pyreez의 MCP 서버는 MCP 프로토콜을 사용한다는 점에서 같은 생태계에 있으나, Portkey는 **MCP 트래픽의 관리자**, pyreez는 **MCP 도구의 제공자**라는 점에서 역할이 다르다.

---

## 커뮤니티 반응

- **엔터프라이즈 신뢰**: SOC2/HIPAA/GDPR 인증으로 규제 산업 도입 용이
- **경량성 높이 평가**: 122KB 코어가 "무거운 게이트웨이" 대비 차별점
- **가드레일 인기**: 프로덕션 환경에서의 안전장치 필요성이 높아지면서 수요 증가
- **MCP Gateway**: 2025년 MCP 생태계 확대와 함께 주목도 상승
- **비교**: TensorZero(최적화 강점) vs Portkey(관리 강점) 비교가 활발
- **우려**: 상용 기능이 핵심 가치의 대부분. 오픈소스만으로는 기능 제한적

---

## 요약

Portkey는 **LLM 프로덕션 트래픽의 엔터프라이즈급 관리 계층**으로, 초경량 게이트웨이 코어 위에 가드레일, 시맨틱 캐싱, 키 관리, MCP Gateway 등 운영 기능을 적재한다. pyreez와는 스택의 다른 계층(운영 vs 판단)에 위치하며, MCP 생태계 내에서 Portkey가 트래픽을, pyreez가 도구를 담당하는 상호 보완적 관계가 가능하다.
