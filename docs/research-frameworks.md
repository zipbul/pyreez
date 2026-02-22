# 멀티에이전트 프레임워크 리서치 종합

> 조사 일자: 2026-02-22 ~ 2026-02-23
> 목적: pyreez 합의 기반 숙의(Deliberation) 시스템 설계를 위한 기반 리서치
> 조사 대상: 11개 프레임워크/프로젝트 + 학술 연구

---

## 목차

1. [Anthropic — Building Effective Agents](#1-anthropic--building-effective-agents)
2. [CrewAI](#2-crewai)
3. [OpenAI Swarm](#3-openai-swarm)
4. [Microsoft AutoGen](#4-microsoft-autogen)
5. [Mastra](#5-mastra)
6. [LangGraph](#6-langgraph)
7. [MetaGPT](#7-metagpt)
8. [Claude Code Sub-agents](#8-claude-code-sub-agents)
9. [OpenHands (All-Hands-AI)](#9-openhands-all-hands-ai)
10. [Microsoft Semantic Kernel](#10-microsoft-semantic-kernel)
11. [Multi-Agent Systems (학술) + Stigmergy](#11-multi-agent-systems-학술--stigmergy)
12. [취합 현황 — pyreez Deliberation 설계 반영 여부](#12-취합-현황--pyreez-deliberation-설계-반영-여부)
13. [IDE/에이전트 생태계 확장 메커니즘](#13-ide에이전트-생태계-확장-메커니즘)
14. [취합 현황 업데이트 — Host-Native Integration 반영](#14-취합-현황-업데이트--host-native-integration-반영)

---

## 1. Anthropic — Building Effective Agents

### 출처

- [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) (2024)

### 핵심 개념

Anthropic은 에이전트 시스템을 **Workflows** (미리 정의된 코드 경로)와 **Agents** (LLM이 자율적으로 결정)로 구분하며, **가능한 한 단순하게 시작하라**고 권고한다.

### 5가지 워크플로우 패턴

| # | 패턴 | 설명 | 적합한 경우 |
|---|------|------|------------|
| 1 | **Prompt Chaining** | Task를 순차 단계로 분해, 각 단계 LLM 호출, 이전 출력이 다음 입력 | 자연스럽게 하위 작업으로 분해되는 경우 |
| 2 | **Routing** | 입력을 분류하고 특화된 처리로 보냄 | 입력 유형에 따라 다른 처리가 필요한 경우 |
| 3 | **Parallelization** | 동시 LLM 호출 — Sectioning(분할 후 병렬) 또는 Voting(동일 이에 대해 다수) | 속도 또는 다중 관점이 필요한 경우 |
| 4 | **Orchestrator-Workers** | 중앙 LLM이 작업을 동적으로 분해 → 워커에 위임 → 결과 종합 | 작업이 사전에 예측 불가능하게 분해되는 경우 |
| 5 | **Evaluator-Optimizer** | LLM이 생성 → 평가자 LLM이 피드백 → 루프 | 명확한 평가 기준이 있고 반복 개선이 가치 있는 경우 |

### 상세 분석

#### Prompt Chaining
```
Step 1 (LLM) → Gate → Step 2 (LLM) → Gate → Step 3 (LLM)
```
- 각 단계 사이에 프로그래밍적 gate 가능 (검증, 조건 분기)
- 단일 LLM 호출보다 latency 증가, 그러나 **각 단계가 단순하므로 정확도 상승**
- 예: 마케팅 카피 → 번역 → 톤 검증

#### Routing
```
Input → Classifier → Route A (전문가 A)
                   → Route B (전문가 B)
                   → Route C (전문가 C)
```
- pyreez의 `pyreez_route`가 정확히 이 패턴
- 분류는 LLM 또는 전통 분류기 모두 가능
- 각 라우트에 특화된 system prompt 사용 가능

#### Parallelization
```
Input → [LLM A, LLM B, LLM C] (동시) → Aggregator
```
- **Sectioning**: 하나의 작업을 독립 부분으로 나눠 병렬 처리
- **Voting**: 동일 입력에 여러 모델/프롬프트 → 다수결 또는 최선 선택
- 예: 코드 리뷰 시 보안/성능/가독성 관점을 각각 병렬로 검토

#### Orchestrator-Workers
```
Orchestrator (LLM) → 동적으로 워커 생성/관리
  ├─ Worker 1 (LLM)
  ├─ Worker 2 (LLM)
  └─ Worker N (LLM)
Orchestrator ← 결과 수집 + 종합
```
- 핵심: **작업 분해가 LLM에 의해 동적으로 결정**됨 (코드가 아님)
- LangGraph 등 프레임워크에서 `Send()` API로 구현 가능

#### Evaluator-Optimizer (가장 중요)
```
Generator (LLM) → Output → Evaluator (LLM) → Feedback
                    ↑                              │
                    └──────────────────────────────┘
                              (루프)
```
- 생성-평가 루프를 여러 라운드 반복
- 평가자는 구체적인 피드백(점수가 아닌 설명)을 제공해야 효과적
- **pyreez Deliberation의 근간이 되는 패턴** — 단, pyreez는 평가자를 **복수화**(다중 리뷰어)하고 **합의 프로세스**를 추가

### 장점

- 검증된 실용적 패턴들 (Anthropic이 실제 프로덕션에서 사용)
- 단순성 강조가 실제로 효과적
- 패턴 간 조합 가능 (Routing + Parallelization 등)

### 단점/한계

- **단일 모델 전제**: 모든 예시가 Claude만 사용. 이종 모델 조합 미고려
- **합의 프로세스 없음**: Evaluator-Optimizer는 1대1 피드백. 다중 평가자 간 합의 발전 없음
- **학습/적응 없음**: 과거 성공/실패를 다음에 반영하는 메커니즘 없음

### pyreez 반영 여부

| 요소 | 반영 | 설명 |
|------|------|------|
| Evaluator-Optimizer 루프 | ✅ | Leader의 approve/continue + Producer 수정 루프 |
| Parallelization | ✅ | Reviewer 병렬 실행 |
| Routing | ✅ | 기존 pyreez_route (이미 구현 완료) |
| Prompt Chaining | ❌ | 명시적 순차 체인 구조 미반영 |
| Orchestrator-Workers | △ | Orchestrator 개념은 있지만 **LLM 기반이 아닌 코드 기반** |

---

## 2. CrewAI

### 출처

- [CrewAI GitHub](https://github.com/crewAIInc/crewAI) (Python, 28K+ stars)
- [CrewAI Docs](https://docs.crewai.com)

### 핵심 개념

**"역할 기반 에이전트 팀 프레임워크."** 각 Agent에게 Role, Goal, Backstory를 부여하여 팀으로 묶고, 정해진 프로세스로 실행.

### 핵심 구성 요소

#### Agent 정의
```python
Agent(
    role="Senior Python Developer",
    goal="Write clean, efficient code",
    backstory="You have 10 years of experience...",
    tools=[FileWriteTool(), SearchTool()],
    llm="gpt-4",
    memory=True
)
```
- **Role**: 역할 이름 (프롬프트에 주입)
- **Goal**: 에이전트의 목표
- **Backstory**: 배경 이야기 (프롬프트 엔지니어링)
- **Tools**: 외부 도구 접근
- **Memory**: 대화 기억 (on/off)

#### Task 정의
```python
Task(
    description="Write a REST API for user management",
    expected_output="Complete Python code with tests",
    agent=developer_agent,
    context=[research_task]  # 이전 태스크 결과 참조
)
```

#### Crew (팀)
```python
Crew(
    agents=[researcher, developer, reviewer],
    tasks=[research_task, code_task, review_task],
    process=Process.sequential,  # sequential | hierarchical
    manager_llm="gpt-4",        # hierarchical일 때 매니저 LLM
    planning=True,               # Planning LLM 활성화
    planning_llm="gpt-4"
)
```

### 프로세스 모드

| 모드 | 설명 |
|------|------|
| **Sequential** | Task 순서대로 실행. 이전 Task 출력이 다음 입력으로 자동 전달 |
| **Hierarchical** | Manager가 Task 할당/재할당. 동적 위임 가능 |

### 메모리 시스템

| 유형 | 설명 | 기술 |
|------|------|------|
| Short-term | 현재 실행 내 기억 | RAG (벡터 검색) |
| Long-term | 과거 실행 결과 축적 | SQLite |
| Entity Memory | 엔티티(사람/프로젝트/기술) 기억 | RAG |

### Planning LLM

- Crew 실행 전 Planning LLM이 **실행 전략을 수립**
- "어떤 순서로, 어떤 에이전트에게, 어떤 도구를 사용해서" 계획
- 계획 결과가 각 Agent의 실행 컨텍스트로 전달

### Tools

CrewAI는 자체 Tool 생태계가 풍부:
- `FileWriteTool`, `FileReadTool` — 파일 I/O
- `SerperDevTool` — 웹 검색
- `ScrapeWebsiteTool` — 웹 스크래핑
- `GithubSearchTool` — GitHub 검색
- `CodeInterpreterTool` — 코드 실행
- 커스텀 Tool 생성 가능 (`@tool` 데코레이터)

### 장점

- **직관적인 API**: Role/Goal/Backstory로 에이전트 정의가 쉬움
- **풍부한 Tool 생태계**: 즉시 사용 가능한 도구 다수
- **Planning LLM**: 실행 전 계획 수립 → 전략적 실행
- **메모리 시스템**: Short/Long/Entity 3계층 메모리
- **Python 생태계 통합**: LangChain 도구, Hugging Face 등과 호환

### 단점/한계

- **같은 모델이 역할만 다름**: `role="보안 전문가"`라 해도 같은 GPT-4가 응답. **본질적 사고 다양성이 아닌 프롬프트 다양성**
- **페르소나 의존**: Backstory가 실제 성능에 미치는 영향은 제한적 (엔지니어링 맛이 강함)
- **합의 프로세스 없음**: Hierarchical이어도 Manager가 일방적으로 결정. 에이전트 간 토론/합의 구조 없음
- **Python only**: TypeScript 지원 없음
- **Heavyweight**: 프레임워크 규모가 크고 의존성이 많음

### pyreez 반영 여부

| 요소 | 반영 | 설명 |
|------|------|------|
| 역할 기반 팀 구성 | ✅ | Producer/Reviewer/Leader 역할 분리 |
| Planning LLM | △ | Orchestrator가 코드로 대체 (LLM이 아닌 결정적 로직) |
| Memory (Short/Long/Entity) | △ | Stigmergic Report가 Long-term 역할. Short-term/Entity 미반영 |
| Backstory/Goal/Personality | ❌ | pyreez는 "관점(perspective)"과 "지시(instructions)" 사용. 페르소나 미사용 |
| Tool 생태계 | ❌ | pyreez Workers에게 외부 도구 접근 미설계 |
| 동일 모델 역할 연기 방식 | ❌ 의도적 배제 | pyreez는 **다른 아키텍처 모델**을 사용. 이것이 핵심 차별점 |

---

## 3. OpenAI Swarm

### 출처

- [Swarm GitHub](https://github.com/openai/swarm) (experimental/educational, 20K+ stars)

### 핵심 개념

**"경량, stateless 멀티에이전트 오케스트레이션."** Agent를 함수와 handoff로 정의. 교육용이며 프로덕션 용도가 아님을 명시.

### 핵심 구성 요소

#### Agent
```python
Agent(
    name="Triage Agent",
    instructions="Determine which department can help...",
    functions=[transfer_to_sales, transfer_to_support]
)
```
- **instructions**: system prompt (문자열 또는 함수)
- **functions**: 에이전트가 호출 가능한 함수들 (tool calling)

#### Handoff
```python
def transfer_to_sales():
    """Transfer to sales department."""
    return sales_agent  # Agent 객체 반환 = handoff
```
- 함수가 Agent 객체를 반환하면 **대화가 그 에이전트로 이양**
- 이것이 Swarm의 핵심 메커니즘: **agent-to-agent handoff**

#### Routines
```
Agent = Instructions + Functions
```
- "Routine"은 system prompt + 함수 목록의 조합
- 자연어 instructions가 에이전트의 행동을 결정

#### Context Variables
```python
client.run(
    agent=triage_agent,
    messages=[{"role": "user", "content": "I want a refund"}],
    context_variables={"user_id": "123", "plan": "premium"}
)
```
- 딕셔너리 형태로 모든 에이전트에 전달
- 에이전트 함수의 인자로 주입됨

### 실행 루프

```
1. 현재 에이전트에게 messages + context_variables 전달
2. 에이전트가 function call 생성 → 함수 실행
3. 함수 결과가 Agent 객체 → handoff (에이전트 교체)
4. 함수 결과가 일반 값 → messages에 추가
5. 반복 (tool_calls 없을 때까지)
```

### 장점

- **극단적 단순성**: Agent = 함수. Handoff = 함수에서 Agent 반환. 끝
- **Stateless**: 서버 없음. `client.run()` 호출 하나로 완료
- **투명성**: 코드가 ~600줄. 전체를 이해 가능
- **교육적 가치**: 멀티에이전트의 최소 본질을 보여줌

### 단점/한계

- **Handoff only**: 피드백 루프/합의 구조 없음. A → B → C 일방향
- **단일 실행 스레드**: 병렬 에이전트 실행 불가
- **실험적**: OpenAI가 프로덕션용이 아님을 명시
- **OpenAI 종속**: OpenAI API만 사용 (이종 모델 불가)
- **메모리 없음**: 실행 간 상태 보존 없음
- **오류 복구 없음**: handoff 실패 시 재시도/폴백 구조 없음

### pyreez 반영 여부

| 요소 | 반영 | 설명 |
|------|------|------|
| Handoff 개념 | △ | SharedContext의 라운드 간 전달로 변형 |
| Stateless 실행 | ❌ | pyreez Deliberation은 상태를 누적함 (SharedContext) |
| Context Variables | △ | SharedContext가 유사한 역할 |
| 함수 기반 에이전트 정의 | ❌ | pyreez는 구조화된 팀(역할+모델+관점) |

---

## 4. Microsoft AutoGen

### 출처

- [AutoGen GitHub](https://github.com/microsoft/autogen) (Python, 45K+ stars)
- [AutoGen Docs](https://microsoft.github.io/autogen)

### 핵심 개념

**"비동기 pub/sub 기반 멀티에이전트 대화 프레임워크."** 에이전트끼리 메시지를 주고받으며 협업. GroupChat, DelegatorAgent 등 고수준 패턴 제공.

### 핵심 구성 요소

#### Agent 유형

| Agent | 설명 |
|-------|------|
| `AssistantAgent` | LLM 기반 일반 에이전트 |
| `UserProxyAgent` | 사용자 대리 (코드 실행 가능) |
| `GroupChatManager` | 그룹 채팅 관리 (발언 순서 결정) |
| `DelegatorAgent` | 작업 위임 (동적 하위 에이전트 생성) |

#### GroupChat

```python
groupchat = GroupChat(
    agents=[coder, reviewer, tester],
    messages=[],
    max_round=10,
    speaker_selection_method="auto"  # auto | round_robin | random | manual
)
```

**Speaker Selection Methods:**
- `auto`: LLM이 다음 발언자 결정 (가장 적절한 에이전트)
- `round_robin`: 순서대로
- `random`: 무작위
- `manual`: 사용자가 결정

#### DelegatorAgent

```python
DelegatorAgent(
    name="Manager",
    sub_agents=[coder, researcher, writer],
    delegation_strategy="LLM"  # LLM이 위임 결정
)
```
- 동적으로 하위 에이전트에게 작업 위임
- `asyncio.gather()`로 병렬 실행 가능

#### 비동기 메시징

```python
# Pub/sub 패턴
await agent.send(message, recipient=other_agent)
await agent.receive(message, sender=other_agent)
```
- 완전 비동기 (`asyncio` 기반)
- 에이전트 간 직접 메시지 또는 GroupChat 브로드캐스트

### Human-in-the-loop

```python
UserProxyAgent(
    human_input_mode="ALWAYS" | "TERMINATE" | "NEVER",
    code_execution_config={"work_dir": "coding"}
)
```
- `ALWAYS`: 매 턴마다 사용자 입력
- `TERMINATE`: 종료 조건 시에만
- `NEVER`: 자동 실행

### 장점

- **비동기 설계**: asyncio 기반, 진정한 병렬 에이전트 실행
- **GroupChat**: 다수 에이전트 대화에 최적화 (speaker selection 알고리즘)
- **코드 실행**: UserProxyAgent가 직접 Python/Shell 코드 실행
- **Human-in-the-loop**: 프레임워크 수준 지원
- **대규모 커뮤니티**: 45K+ stars, Microsoft 공식 지원

### 단점/한계

- **복잡한 API**: 설정이 많고 학습 곡선이 가파름
- **Python only**: TypeScript 미지원
- **디버깅 어려움**: 비동기 다수 에이전트 메시지 흐름 추적이 복잡
- **단일 모델 경향**: 이종 모델 조합을 위한 내장 메커니즘 없음
- **합의 vs 대화**: GroupChat은 "대화"이지 구조화된 "합의" 아님
- **무거움**: 의존성이 많고 설정이 복잡

### pyreez 반영 여부

| 요소 | 반영 | 설명 |
|------|------|------|
| DelegatorAgent | ✅ | Orchestrator의 팀 구성이 유사 |
| Pub/sub 비동기 | △ | 리뷰어 병렬 실행으로 일부 반영 |
| Speaker Selection | ❌ | pyreez는 역할 기반 고정 순서 (Producer→Reviewer→Leader) |
| GroupChat | ❌ | 자유 대화가 아닌 구조화된 라운드 기반 프로세스 |
| Human-in-the-loop | ❌ | 현 설계에 라운드 중간 사용자 개입 구조 없음 |
| asyncio.gather 병렬 | △ | Promise.all() 등 Bun 기반 병렬로 변환 가능 |

---

## 5. Mastra

### 출처

- [Mastra GitHub](https://github.com/mastra-ai/mastra) (TypeScript, 12K+ stars)
- [Mastra Docs](https://mastra.ai/docs)

### 핵심 개념

**"TypeScript-first AI 프레임워크."** Agents, Tools, Workflows, RAG, Evals를 통합. 특히 **sub-agent를 tool로 노출**하는 접근이 독특.

### 핵심 구성 요소

#### Agent

```typescript
const writer = new Agent({
  name: "Writer",
  instructions: "You are a technical writer...",
  model: openai("gpt-4"),
  tools: { searchTool, fileTool, subAgent: reviewerAgent.asTool() }
});
```
- `asTool()`: **다른 에이전트를 도구로 노출** — 에이전트가 다른 에이전트를 호출 가능

#### Workflow

```typescript
const workflow = new Workflow({ name: "content-pipeline" })
  .step("research", { agent: researcher })
  .then("write", { agent: writer })
  .parallel([
    { name: "review-quality", agent: qualityReviewer },
    { name: "review-security", agent: securityReviewer }
  ])
  .then("final", { agent: editor });
```
- `step()` → `then()` → `parallel()` DSL
- 순차/병렬 조합 가능

#### Evals (평가)

```typescript
const eval = new Eval({
  name: "code-quality",
  metric: (output) => { /* 0-1 점수 */ }
});
```
- 에이전트 출력 자동 평가
- 벤치마계처럼 반복 실행 + 집계

#### Syncs (데이터 동기화)

- 외부 데이터 소스를 자동 동기화
- 예: Google Drive, Notion, GitHub를 sync → RAG 벡터 DB에 저장

### 장점

- **TypeScript-first**: Bun/Node 생태계와 직접 호환
- **sub-agent = tool**: 에이전트 간 호출이 일반 도구 호출과 동일 인터페이스
- **Workflow DSL**: 순차/병렬을 직관적으로 조합
- **Evals 내장**: 품질 측정이 프레임워크에 포함
- **Syncs**: 외부 데이터 소스 통합

### 단점/한계

- **sub-agent 호출이 일방향**: A가 B를 호출할 수 있지만 B→A 피드백 루프 없음
- **합의 프로세스 없음**: Workflow는 DAG이지 deliberation이 아님
- **모델 다양성 미고려**: 에이전트별 모델 지정은 가능하지만, **다양성 보장 알고리즘** 없음
- **비교적 새로운 프로젝트**: 성숙도 면에서 CrewAI/AutoGen 대비 부족

### pyreez 반영 여부

| 요소 | 반영 | 설명 |
|------|------|------|
| Sub-agent = tool | ✅ | pyreez_deliberate가 단일 MCP 도구로 제공 |
| TypeScript 기반 | ✅ | 동일 생태계 |
| Workflow DSL | ❌ | pyreez는 DSL이 아닌 구조화된 Deliberation 프로세스 |
| Evals | △ | Leader의 합의 판단이 유사하지만 점수 기반은 아님 |
| Syncs | ❌ | 외부 데이터 소스 동기화 미설계 |

---

## 6. LangGraph

### 출처

- [LangGraph GitHub](https://github.com/langchain-ai/langgraph) (Python/JS, 10K+ stars)
- [LangGraph Docs](https://langchain-ai.github.io/langgraph/)
- 설계 영감: Google Pregel, Apache Beam

### 핵심 개념

**"LLM 어플리케이션을 위한 그래프 기반 상태 머신."** StateGraph로 노드(agent/function)와 엣지(조건부/정적)를 정의. 현재 가장 유연한 오케스트레이션 프레임워크.

### 핵심 구성 요소

#### StateGraph

```python
from langgraph.graph import StateGraph
from typing import TypedDict, Annotated
import operator

class AgentState(TypedDict):
    messages: Annotated[list, operator.add]  # 누적
    next_step: str
    feedback: Annotated[list, operator.add]   # 누적
```
- **TypedDict**로 상태를 정의
- **Annotated + operator.add**: 병렬 노드가 같은 필드에 쓸 때 **누적** (덮어쓰지 않음)

#### Nodes and Edges

```python
graph = StateGraph(AgentState)

# 노드 추가
graph.add_node("generate", generate_code)
graph.add_node("review", review_code)
graph.add_node("decide", should_continue)

# 정적 엣지
graph.add_edge("generate", "review")

# 조건부 엣지
graph.add_conditional_edges("decide", route_function, {
    "continue": "generate",
    "approve": END
})
```

#### Send API (동적 워커 생성)

```python
def assign_workers(state):
    return [
        Send("llm_call", {"section": s})
        for s in state["sections"]
    ]

graph.add_conditional_edges("orchestrator", assign_workers)
```
- **런타임에 동적으로 워커 노드 생성** — 사전에 워커 수를 모를 때 유용
- Anthropic의 Orchestrator-Workers 패턴 구현

#### Persistence / Checkpointing

```python
from langgraph.checkpoint.sqlite import SqliteSaver

memory = SqliteSaver.from_conn_string(":memory:")
graph = workflow.compile(checkpointer=memory)

# 특정 체크포인트로 복원
config = {"configurable": {"thread_id": "1", "checkpoint_id": "abc123"}}
state = graph.get_state(config)
```
- **모든 노드 실행 후 자동 체크포인트**
- 실패 시 특정 지점에서 재개 가능 (Time-travel)
- 대화 이력 영속화

#### Human-in-the-loop

```python
graph.add_node("human_review", interrupt_before=True)
```
- `interrupt_before=True`: 해당 노드 실행 전 중단 → 사용자 입력 대기
- `graph.update_state(config, {"feedback": "approved"})`: 상태 업데이트 후 재개
- **구조적으로** 사용자 개입 지점을 정의

### Evaluator-Optimizer 패턴 (공식 예시)

```python
# Evaluator node
def evaluate(state):
    response = llm.invoke(f"Review this code: {state['code']}")
    return {"feedback": [response], "approved": "APPROVED" in response}

# 조건부 엣지
graph.add_conditional_edges("evaluate", lambda s: "end" if s["approved"] else "generate")
```
- 이것이 pyreez Deliberation의 기본 뼈대와 동일

### 장점

- **최고의 유연성**: 어떤 워크플로우든 그래프로 표현 가능
- **Annotated 상태**: 병렬 노드의 상태 충돌을 우아하게 해결
- **Checkpointing**: 실패 복구, Time-travel, 디버깅
- **Human-in-the-loop**: 프레임워크 수준 지원
- **Send API**: 동적 병렬 처리
- **Python + JavaScript 모두 지원**

### 단점/한계

- **합의 프로세스 미내장**: 그래프 구조만 제공, deliberation 로직은 직접 구현 (합의/피드백 교환은 사용자가 모두 구현해야함)
- **학습 곡선**: StateGraph, Annotated, checkpoint, conditional edges 등 개념이 많음
- **오버엔지니어링 위험**: 단순한 작업에도 그래프를 정의해야
- **LangChain 종속성**: LangChain 생태계에 의존

### pyreez 반영 여부

| 요소 | 반영 | 설명 |
|------|------|------|
| 조건부 엣지 (approve/continue) | ✅ | Leader의 판단 분기 |
| Annotated 누적 상태 | ✅ | SharedContext의 라운드별 누적 |
| Send API 동적 워커 | △ | Reviewer 수 조정 가능성으로 변형 가능 |
| **Checkpointing/Persistence** | ❌ | **미취합 — 높은 가치** |
| **Human-in-the-loop** | ❌ | **미취합 — 높은 가치** |
| **Time-travel** | ❌ | 미취합 |

---

## 7. MetaGPT

### 출처

- [MetaGPT GitHub](https://github.com/geekan/MetaGPT) (Python, 50K+ stars)
- [AFlow Paper](https://arxiv.org/abs/2410.10762) — ICLR 2025 Oral

### 핵심 개념

**`Code = SOP(Team)` — "소프트웨어 회사를 시뮬레이션."** PM, Architect, Project Manager, Engineer 등의 역할을 가진 에이전트가 소프트웨어 개발 SOP(Standard Operating Procedure)를 따라 협업.

### 핵심 구성 요소

#### 역할 기반 소프트웨어 회사

```
User Requirement
  → Product Manager (요구사항 분석, PRD 작성)
  → Architect (시스템 설계, 인터페이스 정의)
  → Project Manager (작업 분해, 일정)
  → Engineer (코드 구현)
  → QA Engineer (테스트)
```
- 각 역할이 **표준화된 산출물**을 생성 (PRD, Design Doc, Task List, Code, Test)
- 이전 단계의 산출물이 다음 단계의 입력

#### SOP (Standard Operating Procedure)

- 소프트웨어 개발의 표준 절차를 에이전트 워크플로우로 인코딩
- 각 단계에서 **어떤 형식의 산출물**이 나와야 하는지 정의
- 이것이 MetaGPT의 핵심 차별점: **그냥 대화가 아닌 프로세스**

#### AFlow (Automated Agentic Workflow Generation, ICLR 2025)

- **워크플로우 자체를 자동으로 생성/최적화**
- 기본 노드(LLM 호출)를 조합하여 복잡한 워크플로우 검색
- Monte Carlo Tree Search로 워크플로우 공간 탐색
- 벤치마크에서 수동 설계 워크플로우 대비 **더 나은 성능** 달성
- 핵심 통찰: **최적 워크플로우는 작업마다 다르므로, 워크플로우 자체를 학습해야**

#### MGX (Product)

- MetaGPT를 기반으로 한 SaaS 제품
- "자연어로 소프트웨어 개발" 플랫폼

### 장점

- **SOP 기반**: 각 단계의 산출물이 표준화되어 예측 가능
- **AFlow**: 워크플로우 자동 생성 — 미래 방향
- **소프트웨어 개발 전문**: 코드 생성에 최적화된 파이프라인
- **대규모 커뮤니티**: 50K+ stars

### 단점/한계

- **소프트웨어 개발에 특화**: 범용 멀티에이전트가 아님
- **SOP 경직성**: 절차가 고정되어 유연한 적응 어려움
- **같은 모델**: 역할은 다르지만 같은 모델 사용 경향
- **피드백 루프 약함**: 순방향 파이프라인 (PM→Architect→Engineer). 역방향 피드백 구조적 지원 약함
- **합의 없음**: 의견 충돌 해소 메커니즘 없음

### pyreez 반영 여부

| 요소 | 반영 | 설명 |
|------|------|------|
| SOP 구조화 프로세스 | ✅ | 라운드별 구조화된 Producer→Reviewer→Leader |
| 표준 산출물 정의 | ✅ | SharedContext의 구조화된 데이터 (Production, Review, Synthesis) |
| **AFlow (자동 워크플로우 생성)** | ❌ | **미취합 — 매우 흥미로운 개념** |
| 소프트웨어 회사 메타포 | ❌ | pyreez는 메타포가 아닌 실제 다른 모델 사용 |

---

## 8. Claude Code Sub-agents

### 출처

- [Claude Code Docs: Sub-agents](https://docs.anthropic.com/en/docs/claude-code/sub-agents) (2025)

### 핵심 개념

**"마크다운 + YAML frontmatter로 서브에이전트를 정의."** Claude Code가 메인 에이전트로서 서브에이전트를 스폰. 매우 풍부한 기능 세트.

### 서브에이전트 정의

```markdown
---
name: security-reviewer
description: Reviews code for security vulnerabilities
model: claude-sonnet-4-20250514
tools:
  - Read
  - Grep
  - Glob
disallowedTools:
  - Write
  - Edit
permissionMode: bypassPermissions
maxTurns: 10
---

# Security Reviewer

You are a security-focused code reviewer. Your job is to:
1. Identify potential security vulnerabilities
2. Check for common attack vectors
3. Verify input validation
```

### 내장 서브에이전트

| 이름 | 모델 | 역할 | 도구 |
|------|------|------|------|
| **Explore** | Haiku (저비용) | 코드베이스 탐색, 파일 검색 | Read-only (Read, Glob, Grep) |
| **Plan** | 메인과 동일 | 작업 계획 수립 | 탐색 도구 |
| **General** | 메인과 동일 | 범용 작업 위임 | 모든 도구 |

### 실행 모드

| 모드 | 설명 | 용도 |
|------|------|------|
| **Foreground** (기본) | 블로킹 실행, 결과 대기 | 순차 작업 |
| **Background** | 비동기 실행, 병렬 가능 | 독립 병렬 작업 |

### Persistent Memory

```
~/.claude/
  MEMORY.md              # User scope (모든 프로젝트 공유)
project/
  .claude/
    MEMORY.md             # Project scope (이 프로젝트)
  .claude/local/
    MEMORY.md             # Local scope (이 머신만, gitignore)
```
- 3 스코프: User > Project > Local
- **자동 로딩**: 세션 시작 시 MEMORY.md가 컨텍스트에 자동 포함
- 에이전트가 학습한 내용을 지속적으로 축적

### Hooks

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "SubagentStart", "command": "echo 서브에이전트 시작: $TOOL_INPUT" }
    ],
    "PostToolUse": [
      { "matcher": "SubagentStop", "command": "echo 서브에이전트 종료: $TOOL_OUTPUT" }
    ],
    "Stop": [
      { "command": "echo 세션 종료" }
    ]
  }
}
```
- **PreToolUse**: 도구 실행 전 커스텀 로직
- **PostToolUse**: 도구 실행 후 커스텀 로직
- **Stop**: 세션 종료 시 커스텀 로직
- 서브에이전트 실행은 `SubagentStart`/`SubagentStop` 매처로 감지

### Skills Injection

```markdown
---
name: my-agent
skills:
  - path/to/skill1.md
  - path/to/skill2.md
---
```
- 외부 마크다운 파일을 서브에이전트 컨텍스트에 주입
- 재사용 가능한 지식/기술을 분리 관리

### Isolation (격리)

```yaml
isolation: git-worktree
```
- 서브에이전트가 **별도의 git worktree**에서 실행
- 메인 에이전트의 작업에 영향 없이 독립적으로 파일 수정 가능
- 병렬 서브에이전트 간 파일 충돌 방지

### Resume

```bash
claude --resume <session-id>
```
- 세션 중단 후 전체 컨텍스트로 재개
- **Auto-compaction**: 컨텍스트가 95%에 도달하면 자동 압축

### 제약 사항

- **"Subagents cannot spawn other subagents"** — 재귀 방지
- `Task(agent_type)` 구문으로 스폰 가능한 에이전트 타입 제한 가능

### 장점

- **선언적 정의**: YAML frontmatter로 에이전트를 선언적으로 정의
- **Persistent Memory**: 세션/프로젝트 간 학습 축적
- **Hooks**: 세밀하게 실행 흐름 제어
- **Isolation**: git worktree 기반 안전한 병렬 실행
- **Resume**: 중단 후 재개 + auto-compaction
- **실무 검증**: Anthropic이 실제 제품(Claude Code)에서 사용

### 단점/한계

- **Anthropic 독점**: Claude Code에서만 사용 가능
- **서브에이전트 간 피드백 없음**: 각 서브에이전트는 독립 실행, **서로의 결과를 볼 수 없음**
- **합의 프로세스 없음**: 서브에이전트들이 합의에 도달하는 구조 없음
- **재귀 불가**: 서브에이전트가 다른 서브에이전트를 호출할 수 없음
- **모델 다양성 제한**: Anthropic 모델만 (Claude family)

### pyreez 반영 여부

| 요소 | 반영 | 설명 |
|------|------|------|
| Background 실행 (병렬) | △ | Reviewer 병렬 실행과 유사 |
| Persistent Memory | △ | Stigmergic Report가 유사하지만 덜 정교 |
| **Hooks (Pre/Post/Stop)** | ❌ | **미취합 — 라운드 시작/종료 커스텀 로직에 유용** |
| **Isolation (git worktree)** | ❌ | **미취합 — 병렬 코드 생성 시 유용** |
| **Resume + auto-compaction** | ❌ | **미취합 — 긴 Deliberation에서 중요** |
| Skills injection | ❌ | 미취합 |
| YAML frontmatter 정의 | ❌ | pyreez는 프로그래밍적 정의 |

---

## 9. OpenHands (All-Hands-AI)

### 출처

- [OpenHands GitHub](https://github.com/All-Hands-AI/OpenHands) (Python, 50K+ stars)

### 핵심 개념

**"오픈소스 AI 소프트웨어 개발 에이전트."** 코드 작성, 명령 실행, 웹 브라우징 등을 자율적으로 수행하는 에이전트 플랫폼.

### 핵심 구성 요소

#### Agent SDK

```python
from openhands import Agent, Tool

class MyAgent(Agent):
    tools = [CodeWriteTool, BashTool, BrowseTool]

    async def step(self, observation):
        # 관찰 → 행동 결정
        action = self.llm.invoke(...)
        return action
```
- Composable: 에이전트를 조합하여 복잡한 작업 수행
- Tool: CodeWrite, Bash, Browse, FileEdit 등

#### 실행 환경

| 모드 | 설명 |
|------|------|
| CLI | `openhands run "Build a REST API"` |
| Local GUI | `openhands gui` → 웹 UI |
| Cloud | SaaS 버전 |
| Docker Sandbox | 안전한 코드 실행 환경 |

#### Composable Agents

- 여러 특화된 에이전트를 파이프라인으로 조합
- 예: `<Research Agent> → <Coding Agent> → <Testing Agent>`

### 장점

- **완전한 자율 에이전트**: 코드 작성 + 실행 + 디버깅을 자동으로
- **Docker Sandbox**: 안전한 코드 실행
- **대규모 커뮤니티**: 50K+ stars
- **실용적**: SWE-bench에서 높은 성능

### 단점/한계

- **단일 에이전트 중심**: 멀티에이전트 합의보다는 단일 에이전트의 자율성
- **Python only**: TypeScript 미지원
- **합의/협업 구조 약함**: 에이전트 간 토론이 아닌 순차 조합
- **무거운 설정**: Docker 필수

### pyreez 반영 여부

| 요소 | 반영 | 설명 |
|------|------|------|
| Agent SDK | △ | MCP 도구 기반으로 유사한 역할 |
| Composable agents | △ | 개념적으로 유사 |
| Docker Sandbox | ❌ | pyreez에는 코드 실행 환경 없음 |
| GUI/CLI | ❌ | pyreez는 MCP 서버 (Host가 UI 담당) |

---

## 10. Microsoft Semantic Kernel

### 출처

- [Semantic Kernel GitHub](https://github.com/microsoft/semantic-kernel) (C#/Python/Java, 25K+ stars)
- [Agent Architecture Docs](https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/)

### 핵심 개념

**"Agent + Thread + Orchestration."** 엔터프라이즈 AI 오케스트레이션 SDK. C# 우선이지만 Python도 지원. 5가지 실험적 오케스트레이션 패턴.

### 핵심 구성 요소

#### Agent (추상 클래스)

```csharp
ChatCompletionAgent agent = new() {
    Name = "CodeReviewer",
    Instructions = "Review code for quality and security...",
    Kernel = kernel
};
```

#### Thread (대화 상태)

```csharp
AgentThread thread = new ChatHistoryAgentThread();
// 대화 이력이 Thread에 저장됨
await agent.InvokeAsync(thread, "Review this code...");
```
- Thread = 대화 상태 컨테이너
- Agent는 stateless, 상태는 Thread에 보존

#### Orchestration Patterns (실험적)

| 패턴 | 설명 | 상태 |
|------|------|------|
| **Concurrent** | 모든 에이전트가 동시에 같은 입력 처리 | Experimental |
| **Sequential** | 에이전트가 순서대로 처리 (이전 출력 → 다음 입력) | Experimental |
| **Handoff** | 에이전트 간 동적 이양 (Swarm과 유사) | Experimental |
| **GroupChat** | 여러 에이전트가 대화 (speaker selection) | Experimental |
| **Magentic** | Magentic-One 프로토콜 (Microsoft Research) | Experimental |

#### GroupChat 상세

```csharp
var groupChat = new AgentGroupChat(coder, reviewer, tester) {
    ExecutionSettings = new() {
        SelectionStrategy = new RoundRobinSelectionStrategy(), // 순환
        // 또는 KernelFunctionSelectionStrategy (LLM이 결정)
        TerminationStrategy = new MaximumIterationTermination(10)
    }
};
```

#### Plugins + Function Calling

```csharp
kernel.Plugins.AddFromFunctions("GitTools", [
    KernelFunction.CreateFromPrompt("Read a file", ReadFile),
    KernelFunction.CreateFromPrompt("Search code", SearchCode)
]);
```
- Plugin = 도구 모음
- Agent가 Plugin의 함수를 tool calling으로 호출

#### Templating

```csharp
var template = new PromptTemplate("Review {{$code}} for {{$aspects}}");
var prompt = template.Render(new() { ["code"] = code, ["aspects"] = "security, performance" });
```
- 동적 프롬프트 생성
- 변수 바인딩으로 프롬프트 재사용

#### Declarative Spec (Coming Soon)

```yaml
type: agent
name: CodeReviewer
model: gpt-4
instructions: "Review code..."
tools:
  - FileRead
  - Search
```
- YAML/JSON으로 에이전트를 선언적으로 정의
- Claude Code의 YAML frontmatter와 유사

### 장점

- **엔터프라이즈급 설계**: Microsoft 지원, Azure 통합
- **5 오케스트레이션 패턴**: 다양한 협업 방식 실험 가능
- **Agent + Thread 분리**: 깔끔한 관심사 분리
- **Plugin 시스템**: 확장 가능한 도구 체계
- **다언어 지원**: C#, Python, Java

### 단점/한계

- **모두 Experimental**: 5개 오케스트레이션 패턴이 아직 실험 단계
- **GroupChat ≠ 합의**: 대화이지 구조화된 합의 아님
- **C# 우선**: Python/Java는 기능이 부족할 수 있음
- **무거움**: 엔터프라이즈 SDK 특유의 복잡성
- **이종 모델 조합**: 지원은 하지만 **다양성 보장 알고리즘** 없음
- **Templating이 프롬프트에 국한**: 워크플로우 자체 템플릿은 없음

### pyreez 반영 여부

| 요소 | 반영 | 설명 |
|------|------|------|
| Agent + Thread + Orchestration | ✅ | Worker + SharedContext + Orchestrator 대응 |
| GroupChat/Concurrent | △ | Reviewer 병렬이 Concurrent와 유사 |
| **Templating** | ❌ | **미취합 — 동적 프롬프트 템플릿에 유용** |
| **Plugin 시스템** | ❌ | Worker에 외부 도구 접근 미설계 |
| Declarative Spec | ❌ | pyreez는 프로그래밍적 정의 |
| Handoff 패턴 | △ | 라운드 간 정보 전달이 유사 |

---

## 11. Multi-Agent Systems (학술) + Stigmergy

### 출처

- [Wikipedia: Multi-agent system](https://en.wikipedia.org/wiki/Multi-agent_system)
- [Wikipedia: Stigmergy](https://en.wikipedia.org/wiki/Stigmergy)
- Irving et al., 2018 — "AI Safety via Debate"
- Du et al., 2023 — "Improving Factuality and Reasoning in LLMs through Multiagent Debate"

### MAS (Multi-Agent System) 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **Autonomy** | 각 에이전트가 자율적으로 행동 |
| **Local Views** | 각 에이전트는 전체가 아닌 자기 관점만 가짐 |
| **Decentralization** | 중앙 통제 없이 분산 의사결정 |

### 에이전트 간 커뮤니케이션 패턴

#### Direct Communication (직접 소통)
- Agent A → Agent B: 1:1 메시지 전달
- 장점: 명확, 빠름
- 단점: N개 에이전트 → O(N²) 연결

#### Blackboard System (칠판 시스템)
```
[Blackboard (공유 상태)]
  ↑ 읽기/쓰기
Agent A  Agent B  Agent C
```
- 공유 데이터 구조(칠판)에 모든 에이전트가 접근
- **pyreez SharedContext가 이 패턴에 해당**

#### Contract Net Protocol (입찰 기반)
```
1. Manager: "이 작업을 누가 할 수 있는가?" (Call for Proposals)
2. Agent A: "나는 이 작업을 $x에 할 수 있다" (Proposal)
3. Agent B: "나는 이 작업을 $y에 할 수 있다" (Proposal)
4. Manager: "Agent B에게 맡기겠다" (Award)
5. Agent B: 실행 → 결과 보고
```
- 에이전트가 자기 능력을 "입찰"하는 시장 메커니즘
- 최적의 에이전트 선택에 유용
- **pyreez의 라우팅이 이것의 간소화 버전** (모델이 "입찰"하지 않고 프로필 점수로 대체)

### Stigmergy (스티그머지)

```
Agent A → [환경에 흔적 남김] → Agent B가 흔적을 읽고 행동
```

**정의**: "환경에 남긴 흔적이 다음 행동을 자극하는 간접 소통 메커니즘"

- 개미의 페로몬 시스템이 대표적 예시
- 에이전트 간 **직접 소통 없이** 협업 가능
- **자기 조직화**(self-organization) 달성

#### Pheromone 시스템
- 흔적(pheromone)은 시간이 지나면 **감쇠**(evaporation)
- 성공적 경로의 pheromone은 **강화**(reinforcement)
- 이것이 자연선택적으로 **최적 경로**를 찾아냄

#### Stigmergy와 pyreez

- pyreez의 Report 시스템 = Stigmergy의 "환경"
- Report에 기록된 결과 = "흔적"
- 다음 Deliberation이 Report를 참조 = "흔적을 읽고 행동"
- Report의 오래된 데이터 감쇠 = Pheromone evaporation과 유사

### LLM Debate (Du et al., 2023)

**"Improving Factuality and Reasoning in Language Models through Multiagent Debate"**

#### 실험 설계
- 여러 LLM 인스턴스가 같은 질문에 대해 독립적으로 답변
- 각 인스턴스가 **다른 인스턴스의 답변을 읽고** 자기 답변을 수정
- 3-4 라운드 반복 후 최종 답변 선택

#### 핵심 결과
- **Factuality** (사실 정확도): 단일 에이전트 대비 유의미 향상
- **Reasoning** (추론): 수학적 추론 태스크에서 향상
- **수렴**: 대부분 3 라운드에서 수렴
- **이종 모델일수록 효과 증가**: 같은 모델보다 다른 모델이 더 효과적

#### pyreez와의 관계
- pyreez Deliberation은 이 연구의 **실용적 MCP 구현**
- 차이점: pyreez는 자유 토론이 아닌 **역할 기반 구조화 프로세스** (Producer/Reviewer/Leader)
- pyreez의 18개 이종 모델은 이 연구의 "heterogeneous debate"에 최적

### AI Safety via Debate (Irving et al., 2018)

- 두 AI가 서로의 주장을 반박하는 "토론"
- 인간 심판(judge)이 최종 판정
- 안전한 AI를 만들기 위한 메커니즘
- pyreez의 Leader = "심판" 역할

### pyreez 반영 여부

| 요소 | 반영 | 설명 |
|------|------|------|
| Blackboard System | ✅ | SharedContext = Blackboard |
| Stigmergy/환경 흔적 | ✅ | Report 시스템 = 환경에 남긴 흔적 |
| LLM Debate 패턴 | ✅ | 이종 모델 다라운드 토론 |
| **Contract Net Protocol** | ❌ | **미취합 — 모델이 직접 입찰하는 방식** |
| **Pheromone 감쇠** | ❌ | **미취합 — 시간 기반 가중치 감쇠** |
| **BDI 아키텍처** | ❌ | 미취합 |
| 자기 조직화 | △ | 학습 라우팅이 부분적으로 유사 |

---

## 12. 취합 현황 — pyreez Deliberation 설계 반영 여부

### 반영 완료 (✅)

| 요소 | 출처 | pyreez 내 위치 |
|------|------|----------------|
| Evaluator-Optimizer 루프 | Anthropic | Leader approve/continue + Producer 수정 |
| Parallelization | Anthropic | Reviewer 병렬 실행 |
| Routing | Anthropic | pyreez_route (이미 구현) |
| 역할 기반 팀 구성 | CrewAI | Producer/Reviewer/Leader |
| DelegatorAgent | AutoGen | Orchestrator 팀 구성 |
| Sub-agent = tool | Mastra | pyreez_deliberate 단일 MCP 도구 |
| 조건부 분기 | LangGraph | Leader 판단 분기 |
| 누적 상태 | LangGraph | SharedContext 라운드별 누적 |
| SOP 구조화 | MetaGPT | 라운드별 구조화 프로세스 |
| Agent+Thread+Orchestration | Semantic Kernel | Worker+SharedContext+Orchestrator |
| Blackboard System | MAS | SharedContext |
| Stigmergy | MAS | Report 시스템 (환경 흔적) |
| LLM Debate 패턴 | Du et al. | 이종 모델 다라운드 토론 |

### 미취합 — 향후 통합 검토 대상

> ⚠️ **Host-Native Integration 반영 (2026-02-23):** Section 13 리서치 결과, 아래 항목 중 다수가 Host 플랫폼에서 이미 제공됨이 확인됨. 상세 재평가는 Section 14 참조.

| 요소 | 출처 | 가치 | Host-Native | 설명 |
|------|------|------|------------|------|
| **Checkpointing/Persistence** | LangGraph | 🔴→🟡 | △ 부분 | 세션 체크포인트는 Host 제공. SharedContext 영속화만 자체 구현 |
| **Human-in-the-loop** | LangGraph, AutoGen | 🔴 유지 | ❌ | Escalation 프로토콜은 pyreez가 설계해야 |
| **Resume + auto-compaction** | Claude Code | ~~🔴~~ | ✅ Host | Claude Code가 완전 제공. pyreez 개입 불필요 |
| **Hooks (Pre/Post)** | Claude Code | ~~🟡~~ | ✅ Host | Claude Code hooks에서 pyreez MCP 호출 |
| **Isolation (git worktree)** | Claude Code | ~~🟡~~ | ✅ Host | Claude Code 서브에이전트 기능 |
| **Skills injection** | Claude Code | ~~🟡~~ | ✅ Host | Agent Skills 오픈 표준으로 배포 |
| **AFlow (자동 워크플로우 생성)** | MetaGPT | 🟡 유지 | ❌ | 워크플로우 자체를 자동 최적화 (미래 방향) |
| **Contract Net Protocol** | MAS | 🟡 유지 | ❌ | 모델이 "이 작업에 적합하다"고 입찰하는 방식 |
| **Pheromone 감쇠** | MAS/Stigmergy | 🟡 유지 | ❌ | 시간 기반 가중치 감쇠 (오래된 성공 기록 자동 약화) |
| **CrewAI Memory 3계층** | CrewAI | ~~🟡~~ | ✅ Host | Host Memory 계층(Claude Code 6계층)이 대체 |
| **Templating** | Semantic Kernel | ~~🟢~~ | ✅ Host | VS Code Prompt Files, Claude Code skills |
| **Speaker Selection** | AutoGen | 🟢 유지 | ❌ | 역할 기반 고정 순서 유지 결정 |
| **Plugin 시스템** | Semantic Kernel | ~~🟢~~ | ✅ Host | Claude Code Plugin으로 배포 |
| **Prompt Chaining** | Anthropic | 🟢 유지 | ❌ | Deliberation이 이미 체이닝 구조 |

---

## 부록: 프레임워크 비교 매트릭스

| 프레임워크 | 언어 | 이종 모델 | 합의 프로세스 | 피드백 루프 | 메모리 | 학습/적응 | Stars |
|-----------|------|----------|-------------|-----------|--------|----------|-------|
| Anthropic Patterns | 개념 | ❌ | ❌ | △ (Eval-Opt) | ❌ | ❌ | — |
| CrewAI | Python | ❌ (같은 모델) | ❌ | ❌ | ✅ (3계층) | ❌ | 28K |
| Swarm | Python | ❌ (OpenAI only) | ❌ | ❌ | ❌ | ❌ | 20K |
| AutoGen | Python | △ | ❌ | △ (GroupChat) | ❌ | ❌ | 45K |
| Mastra | TypeScript | △ | ❌ | ❌ | ❌ | ❌ | 12K |
| LangGraph | Py/JS | △ | ❌ (직접 구현) | ✅ (그래프) | ✅ (Checkpoint) | ❌ | 10K |
| MetaGPT | Python | ❌ | ❌ | △ (순방향) | ❌ | △ (AFlow) | 50K |
| Claude Code | — | ❌ (Claude only) | ❌ | ❌ | ✅ (Persistent) | ❌ | — |
| OpenHands | Python | △ | ❌ | ❌ | ❌ | ❌ | 50K |
| Semantic Kernel | C#/Py | △ | ❌ (GroupChat) | △ | ❌ | ❌ | 25K |
| **pyreez (설계)** | **TypeScript** | **✅ (18모델)** | **✅ (내장)** | **✅ (다방향)** | **△ (Report)** | **△ (학습 라우팅)** | — |

**pyreez의 고유 조합**: 이종 모델 + 합의 프로세스 내장 + 다방향 피드백 — 이 3가지를 동시에 제공하는 프레임워크는 없음.

---

## 13. IDE/에이전트 생태계 확장 메커니즘

> 조사 일자: 2026-02-23
> 목적: pyreez Host-Native Integration 전략 도출
> 조사 대상: 3개 플랫폼 (VS Code GitHub Copilot, Cursor, Claude Code) × 10개 카테고리

### 출처

- [VS Code Copilot Customization](https://code.visualstudio.com/docs/copilot/copilot-customization) (2025)
- [Cursor Rules & Skills](https://docs.cursor.com/context/rules) (2025)
- [Claude Code Docs — Hooks](https://code.claude.com/docs/en/hooks) (2025)
- [Claude Code Docs — Settings](https://code.claude.com/docs/en/settings) (2025)
- [Claude Code Docs — Sub-agents](https://code.claude.com/docs/en/sub-agents) (2025)
- [Claude Code Docs — Plugins](https://code.claude.com/docs/en/plugins) (2025)
- [Claude Code Docs — Memory](https://code.claude.com/docs/en/memory) (2025)
- [Agent Skills Specification](https://agentskills.io/specification) (2025, Anthropic-originated)
- [Agent Skills Overview](https://agentskills.io/what-are-skills) (2025)

### 조사 배경

이전 11개 프레임워크 리서치(Section 1-11)에서 **미취합 항목**으로 분류된 Skills injection, Hooks, Resume, Templating 등의 요소들이 실제로 Host 플랫폼 수준에서 이미 제공되고 있는지 확인하기 위함. 결론적으로, **Host가 이미 풍부한 확장 메커니즘을 제공**하며 pyreez가 중복 구축할 이유가 없음이 확인됨.

### 발견된 10개 확장 메커니즘 카테고리

---

#### 13.1 Memory/Instructions (메모리/지시)

에이전트에게 프로젝트/사용자 컨텍스트를 제공하는 메커니즘.

| 플랫폼 | 메커니즘 | 파일 위치 | 스코프 |
|--------|---------|----------|--------|
| **VS Code** | Instructions 파일 | `.github/copilot-instructions.md` | 프로젝트 전체 |
| | Settings 지시 | `.vscode/settings.json` (`github.copilot.chat.codeGeneration.instructions` 등) | 프로젝트/사용자 |
| **Cursor** | Rules (4 유형) | `.cursor/rules/*.mdc` | 프로젝트 |
| | Team Rules | Cursor Dashboard | 팀 (강제 적용) |
| **Claude Code** | CLAUDE.md 계층 | `CLAUDE.md`, `.claude/CLAUDE.md`, `~/.claude/CLAUDE.md` | 프로젝트/사용자 |
| | Path-specific Rules | `.claude/rules/*.md` (globs frontmatter) | 파일 패턴 |
| | Local Memory | `CLAUDE.local.md`, `.claude/local/MEMORY.md` | 로컬 (gitignore) |
| | Auto Memory | 자동 기록 | 사용자/프로젝트/로컬 |
| | Import | `@import` 구문 | 참조 |

**Cursor Rules 4 유형:**

| 유형 | 적용 조건 | 용도 |
|------|----------|------|
| Always Apply | 모든 대화에 자동 포함 | 코딩 스타일, 기본 원칙 |
| Apply Intelligently | LLM이 관련성 판단 후 포함 | 상황별 규칙 |
| Apply to Specific Files | glob 패턴 매칭 시 포함 | 파일 유형별 규칙 |
| Apply Manually | `@ruleName`으로 명시 호출 | 선택적 규칙 |

**Claude Code Memory 계층:**

```
~/.claude/CLAUDE.md              # User scope (모든 프로젝트)
project/CLAUDE.md                # Project scope (팀 공유)
project/.claude/CLAUDE.md        # Project scope (대안 위치)
project/.claude/rules/*.md       # Path-specific (파일 패턴별)
project/CLAUDE.local.md          # Local scope (gitignore)
project/.claude/local/MEMORY.md  # Auto memory (자동 기록)
```

---

#### 13.2 Agent Skills (에이전트 스킬)

**오픈 표준** (agentskills.io). Anthropic이 제안, 다수 플랫폼이 채택.

| 항목 | 내용 |
|------|------|
| **표준** | Agent Skills — `SKILL.md` 파일 포맷 |
| **핵심 개념** | Progressive Disclosure — Host가 필요할 때 스킬 내용을 점진적으로 로드 |
| **파일 형식** | 마크다운 + YAML frontmatter (`name`, `description`, `version`, `globs`) |
| **검색 경로** | `.github/skills/` (pyreez 배포 경로), `.vscode/skills/`, `.cursor/skills/`, `.claude/skills/`, `.codex/skills/` |
| **채택 플랫폼** | VS Code, Cursor, Claude Code, OpenAI Codex, Goose, Spring AI, Letta, Factory 등 |

**SKILL.md 구조:**

```markdown
---
name: my-skill
description: Short description for progressive disclosure
version: 1.0.0
globs: ["*.ts", "src/**"]
---

# Skill Name

## Overview
(Host가 먼저 읽는 부분 — 이 스킬이 무엇인지)

## Instructions
(실제 지시 사항 — 필요할 때 로드)
```

**Progressive Disclosure 패턴:**
1. Host가 `description`만 먼저 읽음
2. 현재 작업과 관련 있으면 전체 내용 로드
3. `globs`로 파일 패턴 매칭 시 자동 로드

---

#### 13.3 Custom Agents/Subagents (커스텀 에이전트)

**Claude Code가 가장 풍부한 기능 세트를 제공.**

| 플랫폼 | 메커니즘 | 정의 위치 |
|--------|---------|----------|
| **Claude Code** | Custom Agents | `.claude/agents/*.md` (YAML frontmatter) |
| **VS Code** | Custom Agents (Preview) | `.github/agents/*.md` |
| **Cursor** | — | 미지원 |

**Claude Code Custom Agent YAML frontmatter:**

```yaml
name: my-agent
description: What this agent does
model: claude-sonnet-4-20250514
tools:
  - Read
  - Grep
  - Glob
  - mcp__pyreez__route    # MCP 도구 참조 가능
disallowedTools:
  - Write
  - Edit
permissionMode: bypassPermissions  # default | bypassPermissions | plan
maxTurns: 10
skills:
  - path/to/skill.md
mcpServers:
  pyreez:
    command: bunx
    args: ["pyreez"]
hooks:
  PreToolUse:
    - matcher: Write
      command: echo "Writing file"
memory:
  scope: project           # user | project | local
background: false          # 백그라운드 실행 여부
isolation: git-worktree    # 격리 실행 (별도 worktree)
```

**내장 서브에이전트 (Claude Code):**

| 이름 | 모델 | 역할 | 도구 |
|------|------|------|------|
| Explore | Haiku (저비용) | 코드베이스 탐색 | Read-only |
| Plan | 메인과 동일 | 작업 계획 | 탐색 도구 |
| General | 메인과 동일 | 범용 위임 | 모든 도구 |

---

#### 13.4 Prompt Files/Commands (프롬프트 파일)

| 플랫폼 | 메커니즘 | 위치 | 설명 |
|--------|---------|------|------|
| **VS Code** | Prompt Files | `.github/copilot-prompts/*.prompt.md` | 재사용 가능한 프롬프트 템플릿 |
| **Claude Code** | Slash Commands | 구문 기반 (`/` prefix) | 내장 명령어 |
| **Cursor** | Prompt Files | `.cursor/prompts/` | 유사 기능 |

VS Code Prompt File은 변수 바인딩 지원:

```markdown
---
mode: agent
description: Create a React component
---

Create a React component named {{name}} in {{dir}}.
Use TypeScript and follow the project conventions.

#file:src/components/Button.tsx (참조 파일)
```

---

#### 13.5 Hooks (Lifecycle Automation)

**Claude Code가 17개 이벤트, 3가지 타입의 가장 풍부한 Hook 시스템을 제공.**

| 플랫폼 | Hook 지원 | 설명 |
|--------|----------|------|
| **Claude Code** | ✅ 17개 이벤트 | 3 타입 (command/prompt/agent) |
| **VS Code** | △ | Extension API를 통한 간접 지원 |
| **Cursor** | ❌ | 미지원 |

**Claude Code Hook 이벤트 (주요):**

| 이벤트 | 시점 | 용도 |
|--------|------|------|
| `PreToolUse` | 도구 실행 전 | 입력 검증, 승인/거부, 입력 수정 |
| `PostToolUse` | 도구 실행 후 | 결과 검증, 로깅, 후처리 |
| `Notification` | 알림 발생 시 | 외부 알림 전송 |
| `Stop` | 세션 종료 시 | 정리 작업 |
| `SubagentStart` | 서브에이전트 시작 | 서브에이전트 모니터링 |
| `SubagentStop` | 서브에이전트 종료 | 결과 후처리 |

**Hook 타입별 기능:**

| 타입 | 설명 | 반환값 |
|------|------|--------|
| `command` | 셸 명령 실행 | exit code + stdout |
| `prompt` | LLM에 프롬프트 전달 | LLM 응답 |
| `agent` | 에이전트 스폰 | 에이전트 결과 |

**Decision Control (PreToolUse):**

| 결정 | 효과 |
|------|------|
| `allow` | 도구 실행 허용 |
| `deny` | 도구 실행 거부 + 이유 전달 |
| `ask` | 사용자에게 확인 요청 |
| `block` | 완전 차단 (사유 없이) |
| `updatedInput` | 도구 입력을 수정하여 전달 |

---

#### 13.6 Tools/MCP (도구/MCP)

모든 주요 플랫폼이 MCP를 지원.

| 플랫폼 | MCP 지원 | Built-in 도구 | 설정 위치 |
|--------|---------|-------------|----------|
| **Claude Code** | ✅ | 20+ (Read, Write, Edit, Grep, Glob, Bash, ...) | `.mcp.json` |
| **VS Code** | ✅ | Chat Tools API | `.vscode/mcp.json` |
| **Cursor** | ✅ | Limited | `.cursor/mcp.json` |

**Claude Code Built-in 도구 (발췌):**

```
Read, Write, Edit, MultiEdit, Glob, Grep, Bash, TodoRead, TodoWrite,
WebFetch, NotebookRead, NotebookEdit, ScreenCapture, ...
+ Task (서브에이전트 스폰)
+ Agent Skills 도구
```

**MCP 서버 설정 (.mcp.json):**

```json
{
  "mcpServers": {
    "pyreez": {
      "command": "bunx",
      "args": ["pyreez"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

---

#### 13.7 Plugins (패키징/배포)

**Claude Code가 유일하게 완전한 Plugin 시스템을 제공.**

| 항목 | 내용 |
|------|------|
| **Manifest** | `.claude-plugin/plugin.json` |
| **패키징 단위** | Skills + Agents + Hooks + MCP + LSP + Settings 일괄 |
| **배포 채널** | GitHub/git, npm, URL, local directory |

**Plugin 디렉토리 구조:**

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # 매니페스트
├── skills/
│   └── my-skill.md          # Agent Skills
├── agents/
│   └── my-agent.md          # Custom Agents
├── hooks/
│   └── pre-commit.sh        # Hook 스크립트
├── .mcp.json                # MCP 서버 설정
├── .lsp.json                # LSP 서버 설정
└── settings.json            # 기본 설정
```

---

#### 13.8 Agent Teams (멀티에이전트)

| 플랫폼 | 상태 | 메커니즘 |
|--------|------|---------|
| **Claude Code** | Experimental | Background 서브에이전트 병렬 실행, `isolation: git-worktree` |
| **VS Code** | ❌ | 미지원 (Custom Agents는 순차) |
| **Cursor** | ❌ | 미지원 |

- Claude Code의 Background 실행 + Isolation으로 **병렬 에이전트 실행** 가능
- 단, "서브에이전트가 서브에이전트를 스폰할 수 없음" 제약
- 합의 프로세스 없음 — 이것이 **pyreez의 고유 가치**

---

#### 13.9 Security/Permissions (보안/권한)

| 플랫폼 | 메커니즘 | 세분화 수준 |
|--------|---------|-----------|
| **Claude Code** | `allow` / `ask` / `deny` 규칙 | `Tool(specifier)` 패턴 매칭 |
| **VS Code** | Extension permissions | Extension 단위 |
| **Cursor** | Rules enforcement | Rules 수준 |

**Claude Code 권한 시스템:**

```json
{
  "permissions": {
    "allow": [
      "Read",
      "Grep",
      "mcp__pyreez__route"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Write(*.env)"
    ]
  }
}
```

- `Tool(specifier)`: 도구 이름 + 인자 패턴으로 세밀한 제어
- Managed Policies: 조직 관리자가 강제하는 정책
- Sandbox: 격리된 실행 환경

---

#### 13.10 Other (기타)

| 메커니즘 | 플랫폼 | 설명 |
|---------|--------|------|
| Context Providers | VS Code | `#file`, `#selection`, `#codebase` 등 컨텍스트 참조 |
| Checkpointing | Claude Code | 자동 체크포인트 + `--resume` 재개 |
| Auto-compaction | Claude Code | 컨텍스트 95% 도달 시 자동 압축 |
| Language Model API | VS Code | 에이전트가 LLM에 직접 접근 |
| Tool Search | Claude Code | 설치된 도구를 동적으로 검색 |

---

### 플랫폼 비교 매트릭스

| 카테고리 | VS Code | Cursor | Claude Code |
|---------|---------|--------|------------|
| Memory/Instructions | ✅ (2계층) | ✅ (4유형 Rules) | ✅ (6계층 + Auto Memory) |
| Agent Skills | ✅ | ✅ | ✅ |
| Custom Agents | △ (Preview) | ❌ | ✅ (풍부한 frontmatter) |
| Prompt Files | ✅ | ✅ | △ (Slash commands) |
| Hooks | △ (Extension) | ❌ | ✅ (17이벤트, 3타입) |
| Tools/MCP | ✅ | ✅ | ✅ (20+ built-in) |
| Plugins | ❌ | ❌ | ✅ (완전한 시스템) |
| Agent Teams | ❌ | ❌ | △ (Experimental) |
| Security/Permissions | △ | △ | ✅ (Tool specifier) |
| Checkpointing | ❌ | ❌ | ✅ |

**결론: Claude Code > VS Code > Cursor** (확장 메커니즘 풍부도 순)

---

### pyreez 전략: Host-Native Integration

#### 핵심 통찰

Host(VS Code, Cursor, Claude Code 등)가 이미 풍부한 확장 메커니즘을 제공한다. Section 12에서 "미취합 — 향후 통합 검토"로 분류된 항목들 중 상당수가 **Host가 이미 제공하는 기능**이다.

| Section 12 미취합 항목 | Host 제공 여부 | pyreez 전략 |
|----------------------|-------------|------------|
| Skills injection | ✅ Agent Skills 표준 | SKILL.md로 배포, 직접 구현 불필요 |
| Hooks (Pre/Post) | ✅ Claude Code hooks | Host hooks에서 pyreez MCP 호출 |
| Resume + auto-compaction | ✅ Claude Code native | Host가 관리, pyreez 개입 불필요 |
| Templating | ✅ VS Code Prompt Files | Host 기능 활용 |
| Plugin 시스템 | ✅ Claude Code plugins | pyreez를 Plugin으로 패키징 |

#### pyreez의 고유 가치

**Host가 제공하지 않는 것 = pyreez가 제공해야 하는 것:**

1. **이종 모델 합의 (Deliberation)** — 어떤 Host도 다른 아키텍처 모델 간 합의 프로세스를 내장하지 않음
2. **적응형 라우팅 (Adaptive Routing)** — 21차원 능력치 기반 최적 모델 선택
3. **Stigmergic Memory** — 숙의 결과 축적 + 학습 라우팅

이 3가지에 집중하고, 나머지는 Host 생태계에 올라타는 것이 최적 전략.

#### pyreez 배포 형태

| 형태 | 설명 | 호환 플랫폼 |
|------|------|-----------|
| **MCP Server** (핵심) | stdio transport, 6개 도구 | 모든 MCP 호환 Host |
| **Agent Skill** | SKILL.md 파일로 pyreez 사용법 전달 | VS Code, Cursor, Claude Code |
| **Custom Agent** | `.github/agents/pyreez-deliberate.md` 등 | VS Code (Preview), Claude Code |
| **Plugin** (미래) | MCP + Skills + Agent 일괄 패키징 | Claude Code |

---

## 14. 취합 현황 업데이트 — Host-Native Integration 반영

### 미취합 항목 재평가

Section 12의 미취합 테이블을 IDE 생태계 리서치(Section 13) 결과로 재평가:

| 요소 | 출처 | 기존 가치 | 재평가 | 설명 |
|------|------|---------|--------|------|
| **Checkpointing/Persistence** | LangGraph | 🔴 높음 | 🟡→Host | Host(Claude Code)가 자동 체크포인트 제공. pyreez 내부 SharedContext 영속화만 자체 구현 |
| **Human-in-the-loop** | LangGraph, AutoGen | 🔴 높음 | 🔴 유지 | Host에 escalation하는 구조는 pyreez가 설계해야 |
| **Resume + auto-compaction** | Claude Code | 🔴 높음 | ✅ Host-Native | Claude Code가 완전 제공. pyreez 개입 불필요 |
| **Hooks (Pre/Post)** | Claude Code | 🟡 중간 | ✅ Host-Native | Claude Code hooks에서 pyreez MCP 호출로 해결 |
| **Isolation (git worktree)** | Claude Code | 🟡 중간 | ✅ Host-Native | Claude Code가 제공. 병렬 서브에이전트의 책임 |
| **Skills injection** | Claude Code | 🟡 중간 | ✅ Host-Native | Agent Skills 오픈 표준으로 배포 |
| **AFlow** | MetaGPT | 🟡 중간 | 🟡 유지 | Host가 미제공. 미래 방향으로 유지 |
| **Contract Net Protocol** | MAS | 🟡 중간 | 🟡 유지 | 모델 자기 평가 입찰 — 자체 구현 가치 있음 |
| **Pheromone 감쇠** | MAS | 🟡 중간 | 🟡 유지 | Stigmergic Report에 시간 감쇠 적용 검토 |
| **CrewAI Memory 3계층** | CrewAI | 🟡 중간 | 🟡→Host | Host Memory 계층(Claude Code 6계층)이 대체. pyreez는 Stigmergic Report만 |
| **Templating** | Semantic Kernel | 🟢 낮음 | ✅ Host-Native | VS Code Prompt Files, Claude Code skills로 해결 |
| **Speaker Selection** | AutoGen | 🟢 낮음 | 🟢 유지 | 역할 기반 고정 순서 유지 결정 |
| **Plugin 시스템** | Semantic Kernel | 🟢 낮음 | ✅ Host-Native | Claude Code Plugin으로 배포 |
| **Prompt Chaining** | Anthropic | 🟢 낮음 | 🟢 유지 | Deliberation 프로세스가 이미 체이닝 구조 |

### 정리: pyreez가 자체 구현해야 하는 것

| 항목 | 이유 |
|------|------|
| SharedContext 영속화 | 라운드별 숙의 이력 — Host가 관리하지 않는 pyreez 내부 상태 |
| Human-in-the-loop (Escalation) | Host에 escalate 신호를 보내는 프로토콜 |
| Pheromone 감쇠 | Stigmergic Report 시간 가중치 — pyreez 고유 로직 |
| Contract Net Protocol | 모델 자기 평가 입찰 — pyreez 고유 로직 |
| AFlow | 워크플로우 자동 최적화 — 미래 방향 |

### 정리: Host에 위임하는 것

| 항목 | Host 메커니즘 |
|------|-------------|
| Instructions/Memory | CLAUDE.md, copilot-instructions.md, .cursor/rules/ |
| Skills injection | Agent Skills 표준 (SKILL.md) |
| Hooks | Claude Code hooks (17 이벤트) |
| Resume/Compaction | Claude Code 자동 관리 |
| Isolation | Claude Code git-worktree |
| Templating | VS Code Prompt Files |
| Plugin 배포 | Claude Code Plugin system |
| Permissions | Host 권한 체계 |
| Checkpointing (세션) | Claude Code 자동 체크포인트 |

---

> 이 문서는 pyreez Deliberation 시스템 설계의 기반 리서치입니다.
> 마지막 갱신: 2026-02-23
