# 유사 서비스 카탈로그

> pyreez("이종 모델 합의 기반 숙의 인프라")와 기능적으로 겹치거나 비교 가능한 서비스 목록.
> 각 서비스의 심층 분석 보고서는 `docs/reports/<service>.md`에 별도 작성.
>
> **분류 기준** — pyreez의 3대 핵심 역량과의 교차점:
> - **D** = Deliberation (멀티모델 숙의/합의)
> - **R** = Routing/Selection (모델 라우팅/선택)
> - **E** = Evaluation (모델 평가/벤치마킹)

---

## A. 멀티모델 숙의 · 합의 (Deliberation / Consensus)

### MoA (Mixture of Agents)
- **주체**: Together AI
- **GitHub**: `togethercomputer/MoA` — ★ 2.9k
- **논문**: arXiv:2406.04692
- **핵심**: 레이어(layer) 기반 다중 LLM 합성. 각 레이어의 에이전트들이 이전 레이어 전체 출력을 auxiliary information으로 받아 응답을 생성하고, 최종 aggregator가 종합. AlpacaEval 2.0에서 GPT-4 Omni(57.5%)를 넘는 65.1% 달성.
- **pyreez 관련 역량**: D
- **보고서**: [reports/moa.md](reports/moa.md)

### Multiagent Debate
- **주체**: MIT / Google Research
- **GitHub**: `composable-models/llm_multiagent_debate`
- **논문**: arXiv:2305.14325
- **핵심**: 여러 LLM 인스턴스가 동일 질문에 대해 각자 응답 → 상호 응답을 참고하여 수정 → 수 라운드 반복 후 합의 수렴. 사실적 정확성(factual accuracy) 및 수학 추론 향상 확인.
- **pyreez 관련 역량**: D
- **보고서**: [reports/multiagent-debate.md](reports/multiagent-debate.md)

---

## B. 모델 라우팅 · 선택 (Model Routing / Selection)

### Not Diamond
- **주체**: Not Diamond Inc. (상용)
- **GitHub**: `Not-Diamond/notdiamond-python` — ★ 90 (archived, 2025.12)
- **핵심**: ML 기반 모델 라우터. 3개 제품군 — (1) Intelligent Routing: 입력별 최적 모델을 초저지연으로 예측, (2) Prompt Optimization: 프롬프트 템플릿 자동 최적화, (3) Agent Optimization: 멀티스텝 워크플로 자가개선. IBM, OpenRouter, HuggingFace, Notion 등 고객. SOC-2 / ISO 27001.
- **pyreez 관련 역량**: R, E
- **보고서**: [reports/not-diamond.md](reports/not-diamond.md)

### RouteLLM
- **주체**: LMSYS (UC Berkeley)
- **GitHub**: `lm-sys/RouteLLM` — ★ 4.6k
- **논문**: arXiv:2406.18665
- **핵심**: 강한 모델(고비용) ↔ 약한 모델(저비용) 간 이진 라우팅 프레임워크. 4개 내장 라우터 — (1) `mf`: 선호 데이터 기반 행렬 분해, (2) `sw_ranking`: 가중 Elo 계산, (3) `bert`: BERT 분류기, (4) `causal_llm`: LLM 기반 분류기. 비용 최대 85% 절감, GPT-4 성능 95% 유지.
- **pyreez 관련 역량**: R, E
- **보고서**: [reports/routellm.md](reports/routellm.md)

### OpenRouter
- **주체**: OpenRouter Inc. (상용)
- **URL**: openrouter.ai
- **핵심**: (1) Provider Routing — 가격/처리량/지연 시간 기반 프로바이더 로드밸런싱, percentile 기반 성능 임계값, 양자화 필터링. (2) Auto Router (`openrouter/auto`) — Not Diamond 기반 프롬프트 분석 → 최적 모델 선택. 인프라 수준의 라우팅이며 콘텐츠 인식 모델 선택은 아님.
- **pyreez 관련 역량**: R
- **보고서**: [reports/openrouter.md](reports/openrouter.md)

### Martian
- **주체**: Martian (withmartian.com)
- **상태**: ⚠️ **서비스 종료 확인** — 웹사이트(withmartian.com) 및 GitHub(withmartian/llm-router) 모두 404. 이전에 지능형 LLM 라우터를 제공했으나 2025년 이전 폐쇄된 것으로 추정.
- **보고서**: 없음 (서비스 종료)

### Unify.ai
- **주체**: Unify AI Ltd. (YC / Microsoft M12 투자)
- **URL**: unify.ai
- **상태**: ⚠️ **피봇 확인** — 원래 LLM 라우팅/벤치마크 서비스였으나 현재 "Hire AI — Not APIs"로 AI 어시스턴트 서비스로 전환. GitHub SDK 레포(unifyai/unify) 404.
- **보고서**: 없음 (서비스 피봇)

---

## C. LLM 게이트웨이 (Gateway)

### TensorZero
- **주체**: TensorZero Inc. ($7.3M seed, FirstMark/Bessemer)
- **GitHub**: `tensorzero/tensorzero` — ★ 11k
- **기술스택**: Rust, <1ms p99 지연, 10k+ QPS
- **핵심**: 산업용 LLM 애플리케이션을 위한 오픈소스 통합 스택. 5개 영역 통합 — (1) Gateway: 모든 주요 프로바이더 통합 API, (2) Observability: 추론/피드백 DB 저장, UI, (3) Optimization: SFT/RLHF/프롬프트 엔지니어링/DICL, (4) Evaluation: 휴리스틱 + LLM 심사위원, (5) Experimentation: 적응형 A/B 테스트. TensorZero Autopilot(유료)은 자동 AI 엔지니어.
- **pyreez 관련 역량**: R, E
- **보고서**: [reports/tensorzero.md](reports/tensorzero.md)

### Portkey AI Gateway
- **주체**: Portkey Inc. (Series A $15M)
- **GitHub**: `Portkey-AI/gateway` — ★ 10.7k
- **기술스택**: TypeScript, <1ms 지연, 122KB
- **핵심**: 200+ LLM / 45+ 프로바이더 통합. 핵심 기능 — (1) Reliable Routing: 폴백, 자동 재시도, 로드밸런싱, 타임아웃. (2) Guardrails: 40+ 사전 구축 가드레일. (3) Cost Management: 스마트 캐싱(단순/시맨틱), 사용량 분석. (4) MCP Gateway: MCP 서버 중앙 관리(인증, 접근 제어, 관측성). SOC2/HIPAA/GDPR.
- **pyreez 관련 역량**: R
- **보고서**: [reports/portkey.md](reports/portkey.md)

### LiteLLM
- **주체**: BerriAI (YC W23)
- **GitHub**: `BerriAI/litellm` — ★ 36.8k
- **핵심**: 100+ LLM을 OpenAI 형식으로 통합 호출. (1) Python SDK: 직접 통합, Router(재시도/폴백), 비용 추적. (2) Proxy Server(AI Gateway): 중앙 서비스, 가상 키, 멀티테넌트 비용 관리, 가드레일, 캐싱. 8ms P95 지연. Stripe, Google ADK, Netflix, OpenAI Agents SDK 등이 채택.
- **pyreez 관련 역량**: R
- **보고서**: [reports/litellm.md](reports/litellm.md)

---

## D. 멀티에이전트 프레임워크 (Multi-Agent Framework)

### AutoGen
- **주체**: Microsoft
- **GitHub**: `microsoft/autogen` — ★ 54.8k
- **기술스택**: Python / C# / TypeScript
- **핵심**: 멀티에이전트 AI 애플리케이션 프레임워크. 3개 계층 — (1) Core API: 메시지 패싱, 이벤트 기반 에이전트, 로컬/분산 런타임. (2) AgentChat API: 고수준 2-에이전트 채팅, 그룹 채팅 패턴. (3) Extensions API: MCP, OpenAI Assistant, Docker 코드 실행 등. AutoGen Studio(노코드 GUI) + AutoGen Bench(벤치마크). Magentic-One (SOTA 멀티에이전트 팀). ⚠️ Microsoft Agent Framework로 이관 공지.
- **pyreez 관련 역량**: D (부분)
- **보고서**: [reports/autogen.md](reports/autogen.md)

### CrewAI
- **주체**: CrewAI Inc.
- **GitHub**: `crewAIInc/crewAI` — ★ 44.6k
- **기술스택**: Python (100% 독립, LangChain 무의존)
- **핵심**: 역할 기반 자율 AI 에이전트 오케스트레이션. 2개 핵심 메커니즘 — (1) Crews: 에이전트 팀의 자율적 의사결정, 동적 태스크 위임, 역할/목표/전문성 정의. (2) Flows: 이벤트 기반 워크플로, 상태 관리, 조건 분기(`@start`/`@listen`/`@router`). Process 유형: sequential / hierarchical. AMP Suite: 제어 플레인, 트레이싱, 관측성, 보안.
- **pyreez 관련 역량**: D (부분)
- **보고서**: [reports/crewai.md](reports/crewai.md)

### LangGraph
- **주체**: LangChain Inc.
- **GitHub**: `langchain-ai/langgraph` — ★ 25.1k
- **기술스택**: Python (Pregel / Apache Beam 영감)
- **핵심**: 장기 실행, 상태 기반 에이전트를 위한 저수준 오케스트레이션 프레임워크. 핵심 특징 — (1) Durable Execution: 실패 시에도 자동 복원. (2) Human-in-the-loop: 실행 중 에이전트 상태 검사/수정. (3) Comprehensive Memory: 단기 작업 메모리 + 장기 영구 메모리. (4) LangSmith 연동 디버깅. (5) Production-ready 배포. Klarna, Replit, Elastic 등 채택. 프롬프트나 아키텍처를 추상화하지 않음.
- **pyreez 관련 역량**: — (오케스트레이션 전용)
- **보고서**: [reports/langgraph.md](reports/langgraph.md)

---

## E. 모델 최적화 · 평가 (Optimization / Evaluation)

### DSPy
- **주체**: Stanford NLP
- **GitHub**: `stanfordnlp/dspy` — ★ 32.4k
- **논문**: arXiv:2310.03714
- **핵심**: "Programming — not prompting — LMs." 선언적 프레임워크로 모듈러 AI 소프트웨어 구성. (1) Modules: 입출력 시그니처 기반 LM 동작 기술 (Predict, ChainOfThought, ReAct 등). (2) Optimizers: 퓨샷 예제 합성(BootstrapRS), 프롬프트 진화(GEPA, MIPROv2), LM 가중치 파인튜닝(BootstrapFinetune). 프롬프트 문자열 대신 구조화된 코드로 AI 시스템 구성. 250+ 기여자, Stanford/CMU/MIT 연구진.
- **pyreez 관련 역량**: E (부분)
- **보고서**: [reports/dspy.md](reports/dspy.md)

### Chatbot Arena / LMSYS
- **주체**: LMSYS (UC Berkeley)
- **GitHub**: `lm-sys/FastChat` — ★ 39.4k
- **논문**: arXiv:2403.04132, arXiv:2306.05685
- **URL**: arena.ai (구 lmarena.ai)
- **핵심**: 크라우드소싱 기반 LLM 평가 플랫폼. (1) Battle Mode: 익명 2개 모델 응답을 나란히 비교, 사용자가 승자 선택. (2) Elo Rating: 1.5M+ 인간 투표로 온라인 Elo 리더보드 산출. (3) MT-Bench: 멀티턴 오픈엔드 질문 세트, GPT-4를 심사위원으로 자동 평가. 70+ LLM, 10M+ 채팅 요청 처리. FastChat으로 구동 (모델 서빙/학습/평가 오픈 플랫폼).
- **pyreez 관련 역량**: E
- **보고서**: [reports/chatbot-arena.md](reports/chatbot-arena.md)

---

## 비교 매트릭스

| 서비스 | D 숙의 | R 라우팅 | E 평가 | 오픈소스 | GitHub ★ | 언어 |
|---|:---:|:---:|:---:|:---:|---:|---|
| **pyreez** | ✅ | ✅ | ✅ | ✅ | — | TypeScript/Bun |
| MoA | ✅ | — | — | ✅ | 2.9k | Python |
| Multiagent Debate | ✅ | — | — | ✅ | — | Python |
| Not Diamond | — | ✅ | ✅ | ⚠️ archived | 90 | Python |
| RouteLLM | — | ✅ | ✅ | ✅ | 4.6k | Python |
| OpenRouter | — | ✅ | — | — | — | 상용 |
| TensorZero | — | ✅ | ✅ | ✅ | 11k | Rust |
| Portkey | — | ✅ | — | ✅ | 10.7k | TypeScript |
| LiteLLM | — | ✅ | — | ✅ | 36.8k | Python |
| AutoGen | △ | — | — | ✅ | 54.8k | Python |
| CrewAI | △ | — | — | ✅ | 44.6k | Python |
| LangGraph | — | — | — | ✅ | 25.1k | Python |
| DSPy | — | — | △ | ✅ | 32.4k | Python |
| Chatbot Arena | — | — | ✅ | ✅ | 39.4k | Python |

> **△** = 부분적/간접적으로 해당 역량 보유

### pyreez의 고유 위치

위 14개 서비스 중 **D(숙의) + R(라우팅) + E(평가) 3개 역량을 모두 하나의 패키지로 통합하는 서비스는 pyreez가 유일**하다.

- MoA/Multiagent Debate는 숙의(D)만 제공하며, 모델 선택(R)이나 평가(E) 기능이 없다.
- Not Diamond/RouteLLM은 라우팅(R)에 특화되어 있으나 숙의(D) 없이 단일 모델 응답만 반환한다.
- TensorZero는 R+E를 통합하지만 멀티모델 숙의(D)는 제공하지 않는다.
- AutoGen/CrewAI는 멀티에이전트 오케스트레이션이지만, 이종 LLM 간 구조화된 합의 프로토콜(Producer→Reviewers→Leader)이 아닌 범용 대화/태스크 위임이다.
- DSPy는 프롬프트 최적화에 집중하며, 런타임 멀티모델 숙의가 아닌 컴파일 타임 최적화다.

pyreez는 **MCP 프로토콜로 노출되는 이종 모델 숙의 인프라**로, 위 서비스들 중 가장 가까운 것은 MoA(숙의 구조)와 RouteLLM(라우팅 알고리즘)의 결합이지만, Bradley-Terry 14차원 점수 체계와 Producer→Reviewers→Leader 합의 루프라는 독자적 아키텍처를 갖는다.
