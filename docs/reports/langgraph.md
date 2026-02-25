# LangGraph — 심층 분석 보고서

> 서비스 카탈로그: [docs/services.md](../services.md)

## 기본 정보

| 항목 | 내용 |
|---|---|
| **이름** | LangGraph |
| **주체** | LangChain Inc. |
| **GitHub** | `langchain-ai/langgraph` — ★ 25.1k |
| **라이선스** | MIT |
| **언어** | Python, JavaScript |
| **유형** | 저수준 에이전트 오케스트레이션 프레임워크 |
| **상용** | LangGraph Platform (클라우드), LangSmith (관측성) |

---

## 아키텍처 및 알고리즘

### 핵심 개념: StateGraph (상태 그래프)

LangGraph는 에이전트를 **노드(node)와 엣지(edge)로 이루어진 상태 머신(state machine)**으로 모델링한다.

```python
from langgraph.graph import StateGraph, START, END
from typing import TypedDict, Annotated
from operator import add

class State(TypedDict):
    messages: Annotated[list, add]
    step_count: int

def agent_node(state: State):
    # LLM 호출
    response = llm.invoke(state["messages"])
    return {"messages": [response], "step_count": state["step_count"] + 1}

def tool_node(state: State):
    # 도구 실행
    result = execute_tool(state["messages"][-1])
    return {"messages": [result]}

def should_continue(state: State):
    if state["messages"][-1].tool_calls:
        return "tools"
    return END

graph = StateGraph(State)
graph.add_node("agent", agent_node)
graph.add_node("tools", tool_node)
graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
graph.add_edge("tools", "agent")

app = graph.compile()
```

### 상태 리듀서 (State Reducer)

```python
class State(TypedDict):
    messages: Annotated[list, add]      # 리스트 누적 (append)
    summary: str                         # 덮어쓰기
    count: Annotated[int, operator.add]  # 합산
```

- 각 노드가 반환하는 부분 상태(partial state)가 리듀서 함수를 통해 전체 상태에 병합
- `Annotated` 타입 힌트로 리듀서 정의
- React의 `useReducer`와 유사한 개념

### Apache Pregel / Apache Beam 영감

LangGraph의 실행 엔진은 대규모 그래프 처리 프레임워크에서 영감:
- **슈퍼스텝(superstep)**: 모든 활성 노드가 동시 실행 → 동기화 → 다음 슈퍼스텝
- **메시지 패싱**: 노드 간 상태 전달
- **체크포인트**: 각 슈퍼스텝에서 상태 스냅샷

### 핵심 기능

#### 1. 지속적 실행 (Durable Execution)

```python
from langgraph.checkpoint.memory import MemorySaver

checkpointer = MemorySaver()
app = graph.compile(checkpointer=checkpointer)

# 스레드별 독립 실행 상태
config = {"configurable": {"thread_id": "user-123"}}
result = app.invoke(input, config)
```

- 각 실행 단계를 자동 체크포인트
- 실패 시 마지막 체크포인트에서 재개
- 스레드별 독립 상태로 멀티테넌트 지원

#### 2. 인간 개입 (Human-in-the-Loop)

```python
from langgraph.graph import interrupt

def sensitive_action(state: State):
    # 인간 승인 대기
    approval = interrupt({"action": "delete_user", "user_id": state["target"]})
    if approval == "approved":
        return execute_action(state)
    return {"messages": ["Action cancelled"]}
```

- `interrupt()`: 실행을 중단하고 인간 입력 대기
- 승인/거부, 수정, 추가 정보 제공 모두 가능
- 체크포인트에서 중단 → 인간 응답 → 체크포인트에서 재개

#### 3. 메모리 시스템

| 메모리 유형 | 설명 |
|---|---|
| Thread Memory | 대화 스레드 내 단기 기억 (체크포인트 기반) |
| Cross-Thread Memory | 스레드 간 공유 장기 기억 (Store 기반) |
| Semantic Memory | 벡터 임베딩 기반 유사도 검색 |

#### 4. 서브그래프 (Sub-graphs)

```python
inner_graph = StateGraph(InnerState)
# ... inner_graph 정의 ...

outer_graph = StateGraph(OuterState)
outer_graph.add_node("inner", inner_graph.compile())
```

- 그래프 안에 그래프를 중첩
- 복잡한 워크플로를 모듈화

---

## 기술적 특징

### Functional API (최근 추가)

```python
from langgraph.func import entrypoint, task

@task
async def analyze(data: str) -> str:
    return await llm.invoke(f"Analyze: {data}")

@task
async def summarize(analysis: str) -> str:
    return await llm.invoke(f"Summarize: {analysis}")

@entrypoint(checkpointer=checkpointer)
async def workflow(data: str) -> str:
    analysis = await analyze(data)
    return await summarize(analysis)
```

- 데코레이터 기반의 간결한 API
- `@task`로 체크포인트 가능한 함수 정의
- `@entrypoint`로 워크플로 진입점 정의

### LangGraph Platform

- **LangGraph Server**: 프로덕션 배포용 서버
- **LangGraph Studio**: 비주얼 디버깅/모니터링 (데스크톱 앱)
- **LangGraph Cloud**: 관리형 클라우드 배포
- **LangSmith 통합**: 추적, 평가, 데이터셋 관리

---

## pyreez와의 비교

| 차원 | LangGraph | pyreez |
|---|---|---|
| **패러다임** | 상태 그래프 (노드+엣지) | 구조화된 숙의 프로토콜 |
| **추상화 수준** | 저수준 (빌딩 블록) | 고수준 (완성된 숙의/라우팅) |
| **유연성** | ✅ 임의의 워크플로 정의 가능 | 고정된 패턴 (Producer→Reviewers→Leader) |
| **숙의** | 그래프로 구성 가능하나 내장 아님 | ✅ 핵심 기능 |
| **모델 선택** | ❌ (수동 지정) | ✅ 12 도메인 자동 분류 |
| **체크포인트** | ✅ 핵심 기능 | ❌ |
| **인간 개입** | ✅ interrupt() | ❌ |
| **메모리** | ✅ 멀티 레벨 | MCP 세션 기반 |
| **상태 관리** | ✅ TypedDict + 리듀서 | ❌ |
| **MCP** | ❌ (LangSmith 통합) | ✅ |

### 핵심 차이

LangGraph는 **"에이전트 워크플로를 그래프로 정의하는 범용 빌딩 블록"**이다. 이론적으로 pyreez의 숙의 패턴도 LangGraph의 노드와 엣지로 구현할 수 있다. 그러나 LangGraph는 패턴을 직접 구축해야 하는 반면, pyreez는 검증된 숙의 패턴을 **즉시 사용 가능한 형태(out-of-the-box)**로 제공한다.

관계의 본질:
- LangGraph는 **플랫폼**: "무엇이든 만들 수 있다"
- pyreez는 **솔루션**: "이 특정 문제(멀티모델 숙의/선택)를 해결한다"

---

## 커뮤니티 반응

- **기술 깊이 인정**: 상태 머신 기반 설계가 "가장 엔지니어링적으로 견고한 접근"으로 평가
- **학습 곡선**: "AutoGen/CrewAI 대비 진입 장벽이 높다", "그래프 개념을 이해해야 한다"
- **유연성 높이 평가**: "제약이 가장 적다", "어떤 패턴이든 표현 가능"
- **LangChain 부정적 인식**: LangChain의 과도한 추상화에 대한 반감이 LangGraph에도 전이. "LangChain 위에 또 다른 레이어"
- **반대 의견**: "LangGraph는 LangChain과 다르다", "훨씬 더 원칙적 설계"
- **채택 패턴**: "단순한 에이전트는 CrewAI, 복잡한 워크플로는 LangGraph" 구분이 형성
- **LangGraph Platform**: 클라우드/자체호스팅 배포 옵션이 엔터프라이즈에 어필

---

## 요약

LangGraph는 **저수준 에이전트 오케스트레이션 프레임워크**로, 상태 그래프 기반의 유연한 워크플로 정의가 핵심이다. 지속적 실행, 인간 개입, 메모리 시스템 등 프로덕션 요소가 충실하며, 이론적으로 pyreez의 숙의 패턴도 구현 가능하다. 그러나 pyreez는 "멀티모델 숙의"라는 특정 문제에 대한 **즉시 사용 가능한 솔루션**을 제공하는 반면, LangGraph는 이를 직접 구축해야 하는 **범용 플랫폼**이라는 점에서 추상화 수준이 다르다.
