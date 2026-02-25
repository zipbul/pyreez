# MoA (Mixture of Agents) — 심층 분석 보고서

> 서비스 카탈로그: [docs/services.md](../services.md)

## 기본 정보

| 항목 | 내용 |
|---|---|
| **이름** | Mixture of Agents (MoA) |
| **주체** | Together AI |
| **GitHub** | `togethercomputer/MoA` — ★ 2.9k |
| **논문** | "Mixture-of-Agents Enhances Large Language Model Capabilities" (arXiv:2406.04692) |
| **라이선스** | Apache 2.0 |
| **언어** | Python |
| **상태** | 오픈소스, 연구 프로젝트 |

---

## 아키텍처 및 알고리즘

### 핵심 개념: Collaborativeness of LLMs

MoA는 LLM의 "협업성(collaborativeness)" 현상을 기반으로 한다. 대부분의 LLM은 다른 모델의 출력을 참조 자료(auxiliary information)로 받으면 더 높은 품질의 응답을 생성하는 것이 관찰되었다. 이 현상을 체계적으로 활용한 것이 MoA 아키텍처다.

### 레이어 구조

```
[Layer 1] Agent A, Agent B, Agent C  →  각자 독립 응답 생성
    ↓ (전체 출력을 다음 레이어의 auxiliary info로 전달)
[Layer 2] Agent D, Agent E, Agent F  →  이전 레이어 출력 참조하여 응답 생성
    ↓
[Layer 3] Agent G, Agent H, Agent I  →  이전 레이어 출력 참조
    ↓
[Aggregator] 최종 종합 응답 생성
```

- **각 레이어**: 복수의 LLM 에이전트가 동일 질문에 대해 응답
- **레이어 간 전달**: 이전 레이어의 **모든** 에이전트 출력이 다음 레이어의 각 에이전트에게 auxiliary information으로 전달됨
- **Aggregator**: 마지막 레이어 출력을 종합하는 단일 LLM (보통 가장 강한 모델)

### 에이전트 역할 분류

MoA는 모델을 두 역할로 분류한다:
1. **Proposers**: 유용한 참조 자료를 제공하는 데 뛰어난 모델 (다양한 관점 생성)
2. **Aggregators**: 여러 출력을 종합하여 고품질 단일 응답을 만드는 모델

### 핵심 파라미터

| 파라미터 | 설명 | 기본값 |
|---|---|---|
| `--aggregator` | 최종 종합 모델 | `Qwen/Qwen1.5-110B-Chat` |
| `--reference_models` | 각 레이어의 참조 모델 목록 | 6개 오픈소스 모델 |
| `--rounds` | 레이어 수 | 1 |

### 알고리즘 특성

- **역할 구분 없음**: Producer/Reviewer/Leader 같은 구조화된 역할 프로토콜이 없음. 모든 에이전트가 동일 태스크 수행
- **합의 프로토콜 없음**: 투표, 점수, 명시적 동의/반대 없이 Aggregator가 단일 종합
- **단방향 흐름**: 레이어 간 피드백 루프 없음 (앞 레이어 → 뒤 레이어 단방향)
- **비용**: 에이전트 수 × 레이어 수만큼 LLM 호출 (예: 6 에이전트 × 3 레이어 = 18 호출 + 1 aggregation)

---

## 성능 벤치마크

| 벤치마크 | MoA 점수 | 비교 대상 | 비교 점수 |
|---|---|---|---|
| AlpacaEval 2.0 (LC 승률) | **65.1%** | GPT-4 Omni | 57.5% |
| MT-Bench | 9.26 | GPT-4 Turbo | 9.18 |
| FLASK | 다수 카테고리 1위 | — | — |

- 오픈소스 모델만으로 구성해도 GPT-4o 단독 성능을 초과
- 단, 지연시간은 단일 모델 대비 수배~수십배 증가

---

## pyreez와의 비교

| 차원 | MoA | pyreez |
|---|---|---|
| **숙의 구조** | 레이어 기반, Proposer→Aggregator | Producer→Reviewers→Leader 합의 루프 |
| **역할 프로토콜** | 없음 (모든 에이전트 동일 역할) | 구조화된 3-역할 시스템 |
| **합의 메커니즘** | Aggregator 단일 종합 | 명시적 합의 루프, 리뷰/비판 포함 |
| **모델 선택** | 수동 지정 | 자동 분류→프로파일링→선택 파이프라인 |
| **모델 평가** | 없음 | Bradley-Terry 14차원 점수 체계 |
| **이종 모델** | 지원 (다양한 LLM 혼합) | 지원 (7개 프로바이더, 21개 모델) |
| **런타임** | Python 스크립트 | MCP 서버 (Bun/TypeScript) |
| **프로토콜** | 없음 | MCP (표준 프로토콜) |

### 핵심 차이

MoA는 pyreez의 숙의(Deliberation) 기능과 가장 가까운 서비스이지만, **"협업"과 "합의"의 차이**가 본질적이다:
- MoA는 "여러 모델의 출력을 하나가 종합"하는 **단방향 협업**
- pyreez는 "여러 모델이 서로 비판하고 최종 합의에 도달"하는 **쌍방향 숙의**

---

## 커뮤니티 반응

- **긍정적**: 오픈소스 모델만으로 GPT-4o를 넘는 성능 달성이 큰 주목을 받음
- **우려**: 비용과 지연시간 증가가 실용성을 제한. 레이어가 늘수록 6배, 18배 호출
- **활용**: 품질이 최우선인 배치 처리 시나리오에서 주로 사용. 실시간 서비스에는 부적합하다는 평가
- **연구 영향**: "LLM 협업성" 개념이 후속 연구(Multiagent Debate, SmartGPT 등)에 영향

---

## 요약

MoA는 **멀티 LLM 합성의 학술적 증명(proof of concept)**으로, "여러 모델이 협력하면 단일 모델을 넘을 수 있다"는 것을 실증했다. 그러나 구조화된 합의 프로토콜, 모델 선택, 평가 기능이 없어 pyreez와는 목적과 깊이에서 상당한 차이가 있다.
