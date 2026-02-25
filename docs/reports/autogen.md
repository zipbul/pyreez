# AutoGen — 심층 분석 보고서

> 서비스 카탈로그: [docs/services.md](../services.md)

## 기본 정보

| 항목 | 내용 |
|---|---|
| **이름** | AutoGen |
| **주체** | Microsoft |
| **GitHub** | `microsoft/autogen` — ★ 54.8k |
| **라이선스** | MIT (0.4+), Creative Commons (이전) |
| **언어** | Python, C#, TypeScript |
| **유형** | 멀티에이전트 프레임워크 |
| **상태** | ⚠️ Microsoft Agent Framework로 이전 중 |

---

## 아키텍처 및 알고리즘

### 3계층 아키텍처 (0.4+)

AutoGen 0.4는 근본적으로 재설계되어 3개의 명확한 계층으로 분리되었다:

#### Layer 1: Core (핵심 런타임)

```
[Agent A] ←→ [Agent Runtime] ←→ [Agent B]
                    ↕
              [Topic System]
```

- **Agent Runtime**: 에이전트 간 메시지 라우팅, 생명주기 관리
  - `SingleThreadedAgentRuntime`: 로컬 단일 스레드
  - `WorkerAgentRuntime`: gRPC 기반 분산 런타임
- **메시지 패싱**: 에이전트 간 직접 메시지(Direct Message) + 토픽 기반 브로드캐스트
- **이벤트 드리븐**: 모든 상호작용이 비동기 메시지 이벤트

```python
from autogen_core import AgentRuntime, MessageContext

class MyAgent(RoutedAgent):
    @message_handler
    async def handle_message(self, message: TextMessage, ctx: MessageContext):
        # 메시지 처리 로직
        return TextMessage(content="Response", source=self.id)
```

#### Layer 2: AgentChat (고수준 API)

```python
from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.teams import RoundRobinGroupChat

agent1 = AssistantAgent("analyst", model_client=model_client)
agent2 = AssistantAgent("critic", model_client=model_client)

team = RoundRobinGroupChat([agent1, agent2])
result = await team.run(task="Analyze this data...")
```

**팀 구조**:
| 팀 유형 | 설명 |
|---|---|
| `RoundRobinGroupChat` | 순서대로 발언 |
| `SelectorGroupChat` | LLM이 다음 발언자 선택 |
| `Swarm` | 에이전트가 핸드오프(handoff)로 다음 에이전트 결정 |
| `MagenticOneGroupChat` | Magentic-One 오케스트레이터 패턴 |

**종료 조건**:
- `MaxMessageTermination`: 최대 메시지 수
- `TextMentionTermination`: 특정 텍스트 등장 시
- `TokenUsageTermination`: 토큰 사용량 제한
- `HandoffTermination`: 특정 핸드오프 발생 시

#### Layer 3: Extensions (확장)

- **Model Clients**: OpenAI, Anthropic, Ollama, Azure 등
- **Tools**: 코드 실행, 파일 시스템, 웹 검색 등
- **Memory**: 벡터 스토어, 컨텍스트 관리

### Magentic-One (플래그십 에이전트 시스템)

```
[Orchestrator] ──→ [WebSurfer] ──→ [FileSurfer] ──→ [Coder] ──→ [Terminal]
       ↑                                                              │
       └──────────────────────────────────────────────────────────────┘
```

- **Orchestrator**: 작업을 분해하고 서브에이전트에게 할당
- **WebSurfer**: 브라우저 자동화 (Playwright 기반)
- **FileSurfer**: 로컬 파일 시스템 탐색/편집
- **Coder**: 코드 작성 전문
- **Terminal**: 명령 실행

---

## 기술적 특징

### 분산 런타임

```
[Agent A] → [gRPC] → [Host Runtime] → [gRPC] → [Agent B]
                           ↕
                    [Agent Registry]
```

- gRPC 기반 분산 에이전트 런타임
- 에이전트를 별도 프로세스/머신에서 실행
- 수평 확장 지원

### AutoGen Studio (No-Code)

- 드래그&드롭 에이전트 워크플로 설계
- 웹 기반 UI
- 실험 관리 및 결과 비교
- "코드 없이 멀티에이전트 시스템 프로토타이핑"

### 코드 실행 샌드박스

```python
from autogen_ext.code_executors import DockerCommandLineCodeExecutor

code_executor = DockerCommandLineCodeExecutor(
    image="python:3.12-slim",
    work_dir="/workspace"
)
```

- Docker 기반 안전한 코드 실행
- 에이전트가 생성한 코드를 격리된 환경에서 실행
- 파일 시스템 접근 제한

---

## pyreez와의 비교

| 차원 | AutoGen | pyreez |
|---|---|---|
| **패러다임** | 멀티에이전트 대화 | 멀티모델 숙의 |
| **에이전트** | ✅ 자율적 에이전트 (도구 사용, 코드 실행) | ❌ (모델은 도구 없는 순수 추론) |
| **숙의** | 팀 그룹챗 (비구조화) | 구조화된 Producer→Reviewers→Leader |
| **모델 선택** | ❌ (수동 지정) | ✅ CLASSIFY→PROFILE→SELECT |
| **모델 평가** | ❌ | ✅ Bradley-Terry 14차원 |
| **코드 실행** | ✅ (Docker 샌드박스) | ❌ |
| **도구 사용** | ✅ (풍부한 도구 생태계) | ❌ (순수 LLM 추론) |
| **분산** | ✅ (gRPC 런타임) | ❌ (단일 MCP 서버) |
| **프로토콜** | 독자 프로토콜 | MCP (표준) |
| **런타임** | Python | Bun/TypeScript |

### 핵심 차이

AutoGen은 **"에이전트가 자율적으로 행동한다"**는 패러다임이다. 에이전트는 도구를 사용하고, 코드를 실행하고, 파일을 읽고, 웹을 탐색한다. pyreez는 **"모델이 함께 생각한다"**는 패러다임이다. 모델은 순수하게 추론(reasoning)만 수행하며, 도구 사용이나 외부 행동 없이 최적의 판단을 내린다.

AutoGen의 `SelectorGroupChat`이 pyreez의 숙의와 외형적으로 유사하지만:
- AutoGen: "다음에 누가 말할지"를 LLM이 선택 (비구조화)
- pyreez: Producer→Reviewer→Leader 순서가 고정 (구조화된 합의 프로토콜)

---

## 커뮤니티 반응

- **높은 인지도**: 54.8k 스타. Microsoft 브랜드 파워 + 초기 진입자 이점
- **0.4 전환 혼란**: 0.2 → 0.4의 근본적 재설계로 기존 사용자 혼란. 마이그레이션 비용 높음
- **Microsoft Agent Framework 이전**: AutoGen이 더 큰 Microsoft Agent Framework에 흡수되는 과정. "프로젝트의 미래가 불확실하다"는 우려
- **경쟁**: CrewAI(단순성), LangGraph(유연성)와 3파전. "AutoGen은 가장 강력하지만 가장 복잡하다"
- **Magentic-One**: 독립적인 벤치마크 상위 성능을 보여주어 기술적 역량 입증
- **상용화 경로**: "Microsoft 생태계 내에서만 의미있다"는 의견 vs "오픈소스라 어디서든 사용 가능" 논쟁

---

## 요약

AutoGen은 **멀티에이전트 프레임워크의 선구자**로, 에이전트 간 대화를 통해 복잡한 태스크를 해결하는 패러다임을 대중화했다. 3계층 아키텍처, 분산 런타임, Magentic-One 등 기술적 깊이는 인상적이나, 0.4 재설계와 Microsoft Agent Framework 이전으로 불확실성이 존재한다. pyreez와는 "에이전트의 자율적 행동" vs "모델의 구조화된 숙의"라는 근본적 패러다임 차이가 있다.
