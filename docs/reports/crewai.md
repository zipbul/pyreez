# CrewAI — 심층 분석 보고서

> 서비스 카탈로그: [docs/services.md](../services.md)

## 기본 정보

| 항목 | 내용 |
|---|---|
| **이름** | CrewAI |
| **주체** | CrewAI Inc. |
| **GitHub** | `crewAIInc/crewAI` — ★ 44.6k |
| **라이선스** | MIT |
| **언어** | Python (독자 구현, LangChain 비의존) |
| **유형** | 역할 기반 멀티에이전트 프레임워크 |
| **상용** | AMP Suite (엔터프라이즈) |

---

## 아키텍처 및 알고리즘

### 이중 패턴: Crews + Flows

CrewAI는 두 가지 독립적 패턴을 제공한다:

#### 패턴 1: Crews (역할 기반 에이전트 팀)

```python
from crewai import Agent, Task, Crew, Process

researcher = Agent(
    role="Senior Research Analyst",
    goal="Uncover cutting-edge developments in AI",
    backstory="You're a veteran analyst at a top tech think tank...",
    tools=[search_tool, web_tool],
    llm="openai/gpt-4o"
)

writer = Agent(
    role="Tech Content Strategist",
    goal="Craft compelling content on tech advancements",
    backstory="You're a renowned content strategist...",
    llm="anthropic/claude-sonnet-4"
)

research_task = Task(
    description="Research the latest AI trends...",
    agent=researcher,
    expected_output="A detailed report..."
)

writing_task = Task(
    description="Write a blog post based on the research...",
    agent=writer,
    expected_output="A 500-word blog post..."
)

crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    process=Process.sequential  # or Process.hierarchical
)

result = crew.kickoff()
```

**에이전트 속성**:
- `role`: 에이전트의 역할 (자연어로 설명)
- `goal`: 달성 목표
- `backstory`: 에이전트의 맥락/배경
- `tools`: 사용 가능한 도구 목록
- `llm`: 사용할 LLM
- `memory`: 장단기 기억 설정
- `delegation`: 다른 에이전트에게 위임 가능 여부

**실행 프로세스**:
| 프로세스 | 설명 |
|---|---|
| `sequential` | 태스크 순서대로 실행 |
| `hierarchical` | 매니저 에이전트가 태스크 분배/감독 |

#### 패턴 2: Flows (이벤트 드리븐 워크플로)

```python
from crewai.flow.flow import Flow, listen, start, router

class ContentFlow(Flow):
    @start()
    def classify_input(self):
        # 입력 분류
        return self.state.input_type

    @router(classify_input)
    def route_by_type(self):
        if self.state.input_type == "technical":
            return "technical_path"
        return "general_path"

    @listen("technical_path")
    def process_technical(self):
        # 기술 콘텐츠 처리
        crew = Crew(...)
        return crew.kickoff()

    @listen("general_path")
    def process_general(self):
        # 일반 콘텐츠 처리
        return "..."
```

**Flow 데코레이터**:
| 데코레이터 | 역할 |
|---|---|
| `@start()` | 플로우 진입점 |
| `@listen(method_or_event)` | 특정 메서드/이벤트 완료 시 실행 |
| `@router(method)` | 조건부 분기 (라우팅) |
| `@and_(method_a, method_b)` | 여러 메서드 모두 완료 시 실행 |
| `@or_(method_a, method_b)` | 하나 이상 완료 시 실행 |

**상태 관리**:
```python
from pydantic import BaseModel

class ProjectState(BaseModel):
    title: str = ""
    research: str = ""
    draft: str = ""
    final: str = ""
```
- Pydantic 모델로 타입 안전한 상태 관리
- 플로우 전체에서 공유되는 구조화된 상태

### Crews + Flows 조합

핵심 디자인: Flow가 **오케스트레이션**, Crew가 **실행**을 담당

```
[Flow] ──→ [Crew A: 리서치] ──→ [Flow: 결과 라우팅] ──→ [Crew B: 작문]
  ↑                                                          │
  └──────────── [State: 공유 상태] ─────────────────────────┘
```

---

## 기술적 특징

### LangChain 독립

CrewAI는 초기에 LangChain 기반이었으나, 현재는 **완전 독립** 구현:
- 자체 LLM 호출 로직
- 자체 도구 인터페이스
- 의존성 최소화

### 메모리 시스템

| 메모리 유형 | 설명 |
|---|---|
| Short-term | 현재 태스크 맥락 |
| Long-term | 과거 실행 결과 (크로스 세션) |
| Entity Memory | 엔티티(사람, 장소, 개념) 관계 |

### 도구 생태계

- 커스텀 도구 데코레이터: `@tool`
- LangChain 도구 호환
- 내장 도구: 파일 읽기/쓰기, 웹 검색, 코드 실행 등

### AMP Suite (엔터프라이즈)

- **AI Multi-Agent Platform**: 엔터프라이즈용 에이전트 배포/관리
- 모니터링 대시보드
- 사용량 추적 및 비용 관리
- 팀 협업 기능

---

## pyreez와의 비교

| 차원 | CrewAI | pyreez |
|---|---|---|
| **패러다임** | 역할 기반 에이전트 + 이벤트 워크플로 | 구조화된 멀티모델 숙의 |
| **에이전트** | ✅ 자율적 (역할, 목표, 도구) | ❌ (모델 = 순수 추론 수행자) |
| **역할** | 자연어로 동적 정의 | Producer/Reviewer/Leader 고정 |
| **숙의** | 에이전트 간 위임/대화 (비구조화) | 구조화된 합의 프로토콜 |
| **워크플로** | ✅ Flows (이벤트 기반, 라우터) | ❌ |
| **모델 선택** | ❌ (에이전트별 수동 지정) | ✅ 자동 (12 도메인 분류) |
| **모델 평가** | ❌ | ✅ Bradley-Terry 14차원 |
| **도구 사용** | ✅ (풍부한 도구 생태계) | ❌ (순수 추론) |
| **상태 관리** | ✅ Pydantic 기반 | MCP 세션 기반 |
| **MCP** | ❌ | ✅ |

### 핵심 차이

CrewAI는 **"역할을 맡은 에이전트들이 팀으로 일한다"**는 메타포를 구현한다. 각 에이전트는 명확한 역할(role), 목표(goal), 배경(backstory)을 가지며 도구를 사용하여 자율적으로 행동한다. pyreez는 **"모델들이 구조화된 프로토콜 하에 함께 판단한다"**. 에이전트의 자율성보다 합의의 구조를 중시한다.

CrewAI의 `hierarchical` 프로세스가 pyreez의 Leader 역할과 외형적으로 유사하나:
- CrewAI: 매니저가 태스크를 **분배**하고 결과를 **관리**
- pyreez: Leader가 다른 모델의 의견을 **종합하여 합의**에 도달

---

## 커뮤니티 반응

- **높은 인기**: 44.6k 스타. "가장 사용하기 쉬운 멀티에이전트 프레임워크"
- **역할 기반 설계**: 비개발자도 직관적으로 이해할 수 있는 역할(role) 개념이 인기
- **Flows 호평**: "에이전트 팀과 워크플로가 분리된 것이 실무에 적합하다"
- **LangChain 독립**: "의존성이 줄어든 것은 좋으나, 생태계 호환성에 손실"
- **AutoGen 비교**: "CrewAI: 단순/빠른 시작, AutoGen: 복잡/강력" 이분법 형성
- **한계**: "복잡한 에이전트 상호작용에서 디버깅이 어렵다", "에이전트의 자율성이 예측 불가능한 결과를 낳기도"
- **기업 도입**: AMP Suite를 통한 엔터프라이즈 채택 시도 중이나, 상세 사례는 제한적

---

## 요약

CrewAI는 **"역할 기반 AI 에이전트 팀"의 가장 접근성 높은 구현**으로, Crews(에이전트 팀)과 Flows(이벤트 워크플로)의 이중 패턴이 핵심이다. 자연어로 역할을 정의하는 직관적 인터페이스와 LangChain 독립 달성으로 빠르게 성장했다. pyreez와는 "에이전트의 자율적 행동" vs "모델의 구조화된 숙의"라는 패러다임 차이가 있으며, CrewAI는 **행동(action) 중심**, pyreez는 **판단(judgment) 중심**이다.
