# Pyreez — 기획 확정 사항

## 프로젝트 목표

**이종 모델 합의 인프라 (Heterogeneous Model Deliberation Infrastructure).**

서로 다른 아키텍처의 LLM들이 정보를 공유하고, 피드백으로 보정하고, 합의에 도달하는 과정을 통해 단일 모델이 도달할 수 없는 품질을 추구한다. Host Agent(Claude Code, Copilot 등)의 **MCP 도구**로 동작한다.

- **핵심 가치:** 이종 모델의 사고 다양성을 교차시켜 blind spot 제거 → **합의 기반 최고 품질**
- **포지션:** MCP 서버. Host = 사용자 인터페이스, pyreez = 합의 인프라 (Orchestrator + Deliberation Engine)
- **런타임:** Bun native, TypeScript strict

### 구현 상태

513 테스트 GREEN, 1922 expect() calls. CLASSIFY→PROFILE→SELECT 라우팅 파이프라인 완성. MCP 6도구 완성 (route, ask, ask_many, scores, report, deliberate). 합의 기반 이종 모델 숙의(Deliberation) 시스템 완성. Rate Limit 재시도 + 에러 핸들링 강화 완료. 분류 정확도 벤치마크 하네스(C4) 완성. 필드테스트(MCP 직접 호출) 6/6 도구 정상 확인.

---

## 1. 설계 철학

### 확정 원리

1. **단일 에이전트의 출력을 신뢰하지 않는다** — 같은 입력에 다른 출력이 나오는 것이 에이전트의 본질. 모든 중요한 결과는 독립적 검증을 거친다.
2. **에이전트의 실수를 빨리 드러낸다** — 짧은 주기, 자기 의심 강제, 교차 검증.
3. **관점의 충돌이 품질을 만든다** — 독립 실행 후 취합이 아니라, 충돌 과정에서 밸런스.
4. **같은 입력에 다른 출력이 나오는 것을 활용한다** — 불일치 = 불확실한 영역 = 집중 검토 대상.
5. **규칙은 최소화, 강제는 구조로 한다** — 규칙이 많을수록 누락이 심해지므로 게이트로 강제.
6. **탐색의 누락을 전제하고 보완한다** — "뭘 놓쳤는가?"가 "뭘 찾았는가?"만큼 중요.
7. **비용 대비 품질을 최적화한다** — 모든 태스크에 최고 모델을 쓸 필요 없다. 태스크 특성에 맞는 최적 모델을 선택한다.
8. **능력치는 추정이 아니라 측정한다** — 모델 점수는 실사용에서 지속 갱신한다.

### 기계 특성에 대한 전제

- 에이전트는 빠르지만 누락이 많다. 장점이 아니라 보완 대상.
- 에이전트 간 합리적 의심, 설득, 합의 루프가 필요하다.
- 성격/페르소나 부여는 하지 않는다. 관점(Lens)과 역할을 부여한다.
- 인간 조직론에서 검증된 원리(애자일의 문제 드러내기, 스쿼드의 관점 충돌 등)는 차용한다.
- 모델마다 강점/약점이 다르다. 이를 활용한 태스크 라우팅이 핵심이다.

---

## 2. 아키텍처: 합의 기반 이종 모델 숙의 (Deliberation)

> 리서치 근거: `docs/research-frameworks.md` (11개 프레임워크 + 학술 연구 분석)

### 핵심 원리

**멀티에이전트의 가치는 "다른 사고 방식의 교차"에 있다.**

pyreez의 18개 모델은 서로 다른 아키텍처(GPT, DeepSeek, Llama, Mistral, Grok, Phi 등)에서 나왔다. 같은 코드를 보고도 GPT-4.1은 효율성을, DeepSeek-R1은 논리적 엣지 케이스를, Mistral은 구조적 일관성을 우선시한다. 이 **본질적 다양성을 교차**시키면 단일 모델의 blind spot이 제거된다.

이것은 "역할을 연기하는 다양성"(CrewAI 방식: 같은 모델에 다른 역할)이 아닌 **"아키텍처가 다른 본질적 다양성"**이며, pyreez만의 고유 경쟁력이다.

학술 근거: Du et al. (2023) "Improving Factuality and Reasoning in LLMs through Multiagent Debate" — 이종 모델 토론이 단일 모델 대비 사실 정확도와 추론 능력을 유의미하게 향상시킴. 3 라운드에서 수렴.

### 3계층 역할 정의

| 계층 | 담당자 | 구현 | 핵심 책임 |
|------|--------|------|----------|
| **Host** | Copilot / Claude Code 등 | 외부 (MCP 클라이언트) | 사용자 의도 해석 → 도구 선택 → 결과 전달 |
| **Orchestrator** | pyreez 내부 | 코드 (결정적 로직) | 팀 구성(다양성 보장) + 프로세스 관리 + 학습 라우팅 |
| **Team Leader** | LLM (고수준 모델) | 프롬프트 | 합의 판단 + 피드백 종합 + 품질 게이트 |
| **Workers** | LLMs (다양한 모델) | 프롬프트 | 생산(Producer) + 비평(Reviewer) + 정보 공유 |

#### Host (엔트리)

| 책임 | 설명 |
|------|------|
| 사용자 의도 해석 | "렉서를 구현해줘" → 코드 생성 작업 |
| 작업 복잡도 판단 | 간단한 질문 → `pyreez_ask`, 품질 중요 → `pyreez_deliberate` |
| 결과 전달 | 합의 결과 + 숙의 과정 요약을 사용자에게 전달 |
| 중재(Escalation) | Leader가 합의 실패 시 사용자에게 판단 요청 |

Host가 **하지 않는 것**: 팀 구성 결정, 합의 판단, 직접 코드 생산/리뷰

#### Orchestrator

| 책임 | 설명 |
|------|------|
| 작업 분류 | `classify` 시스템으로 task type 결정 |
| 팀 구성 (Team Composition) | 라우팅 + **다양성 보장 알고리즘** |
| 프로세스 관리 | 라운드 실행 순서, 병렬 처리, 종료 조건 |
| SharedContext 관리 | 매 라운드 결과를 누적, 모든 참여자에게 전달 |
| 학습 라우팅 | 과거 성공 기록 기반으로 팀 구성 최적화 |
| 리포트 기록 | 숙의 결과를 stigmergic memory에 축적 |

**왜 코드 기반인가**: 팀 구성, 라운드 관리, 병렬 실행, 종료 조건 등은 결정적(deterministic) 로직이다. LLM에 위임하면 불확실성이 생긴다.

#### Team Leader

| 책임 | 설명 |
|------|------|
| 피드백 종합 | 모든 리뷰어의 피드백에서 합의점/쟁점 분류 |
| 충돌 식별 | 리뷰어 간 의견이 다른 부분 명시 |
| Action Items 도출 | Producer에게 "다음 수정에서 해결할 사항" 전달 |
| 합의 판단 | `approve` (합의 도달) / `continue` (진전 중) / `escalate` (Host 중재 필요) |
| 품질 게이트 | 모든 critical 이슈가 해결되었는지 최종 확인 |

**왜 LLM인가**: "리뷰어 A의 '변수 명명 불명확'과 리뷰어 B의 '변수 명명 패턴 모호'가 같은 이슈인가?" — 의미 이해 + 판단 능력이 필요하다.

**왜 고수준 모델인가**: Leader의 판단 품질 = 전체 프로세스의 품질 상한. Leader가 부정확하면 나쁜 합의를 "합의"로 판단할 수 있다.

#### Workers

| 역할 | 책임 |
|------|------|
| **Producer** | 산출물 생산 + Leader 피드백 반영 수정 |
| **Reviewer** | 지정된 관점에서 평가 + **다른 리뷰어 피드백 참조** + 이슈 분류 + 승인 여부 |

핵심: **Reviewer는 다른 Reviewer의 피드백도 볼 수 있다.** 이것이 정보 공유의 핵심.

### 팀 다양성 보장 알고리즘

Orchestrator가 팀 구성 시 **모델 다양성을 보장**하는 것이 가장 중요한 역할이다.

```
Producer:  작업 유형 최고 점수 모델      → Provider A
Reviewer1: Producer와 다른 provider     → Provider B
Reviewer2: Producer/Reviewer1과 다른    → Provider C
Leader:    reasoning 최고 + 다른 provider → Provider D
```

- 같은 provider 모델끼리 팀을 구성하면 sycophancy(아부) 위험
- GPT가 생산하고 GPT가 리뷰하면 같은 blind spot 공유
- GPT가 생산하고 DeepSeek가 리뷰하면 blind spot 교차 검출
- 최소 **3개의 서로 다른 provider/architecture**가 한 팀에 참여

### SharedContext: 정보 공유 메커니즘

모든 참여자가 **전체 숙의 이력**을 볼 수 있다. 사일로 없음. (MAS Blackboard System 패턴)

```typescript
interface SharedContext {
  task: string;                     // 원본 작업 설명
  team: TeamComposition;            // 사용된 팀 구성
  rounds: Round[];                  // 라운드별 이력 (시간순)
}

interface Round {
  number: number;
  production?: Production;          // 생산자의 산출물
  reviews: Review[];                // 리뷰어들의 피드백
  synthesis?: Synthesis;            // 리더의 종합/판단
}

interface Production {
  model: string;
  content: string;                  // 산출물 전문
  revision_notes?: string;          // "이전 피드백 중 X, Y를 반영했음"
}

interface Review {
  model: string;
  perspective: string;              // "코드 품질", "보안", "성능" 등
  issues: Issue[];                  // 발견된 이슈 목록
  approval: boolean;                // 이번 라운드에서 승인하는가?
  reasoning: string;                // 판단 근거
}

interface Issue {
  severity: "critical" | "major" | "minor" | "suggestion";
  description: string;
  location?: string;
  suggestion?: string;
}

interface Synthesis {
  model: string;
  consensus_status: "reached" | "progressing" | "stalled";
  key_agreements: string[];         // 합의된 사항
  key_disagreements: string[];      // 미합의 사항
  action_items: string[];           // 다음 라운드에서 해결할 사항
  decision: "continue" | "approve" | "escalate";
}
```

정보 공유 방식:
- Round 2에서 Reviewer B는 **Reviewer C의 Round 1 피드백을 볼 수 있다**
- → "C가 보안 이슈를 지적했는데, 추가로 이런 보안 엣지 케이스도 있음" (보강)
- → "C의 성능 지적에 동의하지 않음. 이 패턴은 O(n)이 아니라 O(1)임" (건설적 반박)
- → 이 교차 검증이 **단일 모델이 발견할 수 없는 이슈를 잡아낸다**

### Deliberation 프로세스 흐름

```
Round 0 (선택적: Best-of-N):
  N개 모델로 독립 생산 → Leader가 최적 초기 산출물 선택
                    ↓
Round 1: 초기 생산 + 독립 리뷰
  Producer(M1) ──────────→ 산출물 A1
  Reviewer(M2) ──(병렬)──→ 피드백 F_B1  (A1 기반)
  Reviewer(M3) ──(병렬)──→ 피드백 F_C1  (A1 기반)
  Leader(M4) ─────────────→ 종합 S1 → "continue" + action_items
                    ↓
Round 2: 정보 공유 기반 수정 + 재리뷰
  Producer(M1) ──────────→ 산출물 A2 (A1 + S1 반영)
  Reviewer(M2) ──(병렬)──→ 피드백 F_B2 (A2 + 전체 이력 기반)
  Reviewer(M3) ──(병렬)──→ 피드백 F_C2 (A2 + 전체 이력 기반)
  Leader(M4) ─────────────→ 종합 S2 → "approve" / "continue"
                    ↓
...반복 (최대 max_rounds)...
                    ↓
Final: 합의 도달 또는 최대 라운드 도달
  → Host에게 결과 + 숙의 로그 + 미해결 이슈 반환
```

LLM 호출 수: 라운드당 4회 (1 Producer + 2 Reviewer 병렬 + 1 Leader). 3라운드 = 12회.

### 구조도

```
┌────────────────────────────────────────────────┐
│                   HOST                         │
│           (Copilot / Claude Code)              │
│  사용자 의도 → 도구 선택 → 결과 전달           │
└──────────────┬─────────────────────────────────┘
               │ MCP (pyreez_deliberate, pyreez_ask, ...)
               ▼
┌────────────────────────────────────────────────┐
│              ORCHESTRATOR (코드 기반)           │
│  ┌──────────┐ ┌─────────┐ ┌────────────────┐  │
│  │Classifier│ │ Router  │ │Diversity Engine│  │
│  │(작업분류)│ │(적응라우팅)│ │(팀다양성보장)  │  │
│  └────┬─────┘ └────┬────┘ └───────┬────────┘  │
│       └────────────┼──────────────┘            │
│              ┌─────▼──────┐                    │
│              │Team Composer│                   │
│              └─────┬──────┘                    │
│              ┌─────▼─────────────────────┐     │
│              │  Deliberation Engine      │     │
│              │  SharedContext + 라운드 관리│     │
│              └─────┬─────────────────────┘     │
│              ┌─────▼──────┐                    │
│              │Report System│ (Stigmergic Mem)  │
│              └─────────────┘                    │
└──────────────┬─────────────────────────────────┘
               │ LLM API calls
               ▼
┌────────────────────────────────────────────────┐
│                TEAM (LLMs)                     │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │
│  │ Leader │ │Producer│ │Rev. A  │ │Rev. B  │  │
│  │Model A │ │Model B │ │Model C │ │Model D │  │
│  └────────┘ └────────┘ └────────┘ └────────┘  │
│  SharedContext: 모든 참여자가 전체 이력 공유    │
│  다양성: 최소 3개 다른 provider/architecture    │
└────────────────────────────────────────────────┘
```

### Host-Native Integration 전략

> 리서치 근거: `docs/research-frameworks.md` Section 13 (IDE/에이전트 생태계 확장 메커니즘)

#### 핵심 원칙: "중복 구축 금지"

Host(VS Code, Cursor, Claude Code 등)가 이미 풍부한 확장 메커니즘을 제공한다:

- **Memory/Instructions** — CLAUDE.md 6계층, copilot-instructions.md, Cursor Rules 4유형
- **Agent Skills** — 오픈 표준 (agentskills.io), 모든 주요 Host 채택
- **Custom Agents** — `.claude/agents/*.md` YAML frontmatter 정의
- **Hooks** — Claude Code 17개 이벤트, 3가지 타입 (command/prompt/agent)
- **Plugins** — Claude Code Plugin 시스템 (Skills+Agents+Hooks+MCP 패키징)
- **Permissions** — Host 수준 allow/ask/deny 규칙

pyreez는 이들을 **중복 구축하지 않고 소비(consume)만** 한다.

#### pyreez의 고유 가치 (Host가 제공하지 않는 것)

| 고유 가치 | 설명 |
|----------|------|
| **이종 모델 합의 (Deliberation)** | 다른 아키텍처 모델 간 구조화된 합의 프로세스 |
| **적응형 라우팅 (Adaptive Routing)** | 21차원 능력치 기반 최적 모델 선택 |
| **Stigmergic Memory** | 숙의 결과 축적 + 학습 라우팅 |

이 3가지에 집중하고, 나머지는 Host 생태계에 올라타는 것이 최적 전략.

#### pyreez 배포 형태

| 형태 | 설명 | 호환 플랫폼 |
|------|------|------------|
| **MCP Server** (핵심) | stdio transport, 6개 도구 | 모든 MCP 호환 Host |
| **Agent Skill** | `SKILL.md`로 pyreez 사용법 전달 (Progressive Disclosure) | VS Code, Cursor, Claude Code |
| **Custom Agent** | `.github/agents/pyreez-deliberate.md` 등 | VS Code (Preview), Claude Code |
| **Plugin** (미래) | MCP + Skills + Agent 일괄 패키징 | Claude Code |

#### Host에 위임 vs 자체 구현

| 메커니즘 | 위임/자체 | 근거 |
|---------|----------|------|
| Instructions/Memory | ✅ Host | Host가 6계층 이상 메모리 제공 |
| Skills injection | ✅ Host | Agent Skills 오픈 표준으로 배포 |
| Hooks | ✅ Host | Claude Code hooks에서 MCP 호출 |
| Resume/Compaction | ✅ Host | Claude Code 자동 관리 |
| Isolation | ✅ Host | Claude Code git-worktree |
| Permissions | ✅ Host | Host 권한 체계 |
| SharedContext 영속화 | 🔧 자체 | pyreez 내부 상태 — Host가 관리하지 않음 |
| Human-in-the-loop | 🔧 자체 | Host에 escalate 신호를 보내는 프로토콜 |
| Pheromone 감쇠 | 🔧 자체 | Stigmergic Report 시간 가중치 |
| Adaptive Routing | 🔧 자체 | 이종 모델 성능 학습 |

---

### MCP 도구 (6개)

기존 5개 도구 (유지):

| 도구 | 용도 |
|------|------|
| `route` | 태스크 설명 → 최적 모델 선택 (CLASSIFY→PROFILE→SELECT) |
| `ask` | 선택된 모델에 단일 LLM 호출 (간단한 작업) |
| `ask_many` | 여러 모델에 동시 호출 (비교용) |
| `scores` | 모델 성능 데이터 조회/갱신 |
| `report` | 호출 결과 기록/조회 (stigmergic memory) |

**신규 핵심 도구:**

| 도구 | 용도 |
|------|------|
| **`deliberate`** | **합의 기반 이종 모델 숙의 — 자동 팀 구성 + 다라운드 피드백 + 합의 도달** |

#### pyreez_deliberate 인터페이스

```typescript
// 입력
interface DeliberateInput {
  task: string;                    // 작업 설명
  perspectives: string[];          // 리뷰 관점들 (최소 2개)
  // 예: ["코드 품질 + 가독성", "보안 + 에러 핸들링", "성능 + 최적화"]

  producer_instructions?: string;  // 생산자 추가 지시
  leader_instructions?: string;    // 리더 판단 기준

  team?: {                         // 미지정 시 자동 (라우팅 + 다양성 보장)
    producer?: string;
    reviewers?: string[];
    leader?: string;
  };

  max_rounds?: number;             // 기본 3
  consensus?: "all_approve" | "majority" | "leader_decides";
  initial_candidates?: number;     // Round 0 Best-of-N (기본 1 = 스킵)
  include_history?: boolean;       // stigmergic memory에서 관련 이력 포함 (기본 true)
}

// 출력
interface DeliberateOutput {
  result: string;                  // 최종 합의 산출물
  rounds_executed: number;
  consensus_reached: boolean;
  final_approvals: {
    model: string;
    approved: boolean;
    remaining_issues: string[];
  }[];
  deliberation_log: SharedContext; // 전체 숙의 이력
  total_tokens: number;
  total_llm_calls: number;
  models_used: string[];
}
```

### Host의 도구 선택 가이드

| 작업 특성 | 도구 | 예시 |
|----------|------|------|
| 간단한 질문/변환 | `pyreez_ask` | 로그 분석, 간단한 QA |
| 다중 모델 비교 | `pyreez_ask_many` | 접근법 비교, 벤치마크 |
| **품질이 중요한 작업** | **`pyreez_deliberate`** | 프로덕션 코드 생성, 아키텍처 설계, 보안 검토 |

### MCP 전송

- stdio
- 진행 보고: MCP notification 한 줄 상태 (컨텍스트 최소화)
- 결과 반환: JSON 구조화 데이터

### 시스템 경계

- **Host Agent (VSCode Copilot / Claude Code)** — 사용자 인터페이스 + MCP 클라이언트
- **pyreez** — Bun 프로세스, MCP 서버, Orchestrator + Deliberation Engine + 라우팅 인프라
- **GitHub Models API** — LLM 프로바이더 (18개 모델)

---

## 3~8. 구현 완료 사양 (코드 참조)

> Section 3~8은 구현 완료되어 코드가 정본(source of truth)이다.
> 과거 PLAN 내용은 git 이력에서 확인 가능 (`bd38ce1` 등).

| 사양 | 코드 위치 | 요약 |
|------|----------|------|
| 태스크 분류 체계 (12 도메인, 62 유형) | `src/classify/` | 규칙 + LLM 하이브리드 분류기 |
| 능력치 모델 (5 카테고리, 21차원) | `src/model/`, `src/profile/` | Domain Default → TaskType Override |
| 모델 레지스트리 (18개 모델) | `scores/models.json` | GitHub Models API, 21차원 × 18모델 점수 |
| 라우팅 파이프라인 | `src/router/` | CLASSIFY → PROFILE → SELECT |
| LLM 클라이언트 | `src/llm/` | GitHub Models API, plain HTTP fetch |
| 기술 스택 | `package.json`, `tsconfig.json` | Bun, TypeScript strict, MCP stdio |


## 9. 구현 로드맵

### Phase A: 라우팅 기반 (✅ 완료)

| 단위 | 내용 | 상태 |
|---|---|---|
| A1 | 타입 시스템 (TaskDomain, TaskType, 21 CapabilityDimension) | ✅ |
| A2 | ModelRegistry (18모델, JSON 기반, 21차원 점수) | ✅ |
| A3 | Classifier (규칙 + LLM 하이브리드) | ✅ |
| A4 | Profiler (Domain Default → TaskType Override, 21차원) | ✅ |
| A5 | Selector (HARD FILTER → COMPOSITE → CE → BUDGET → FALLBACK) | ✅ |
| A6 | Router 통합 (CLASSIFY→PROFILE→SELECT 파이프라인) | ✅ |
| A7 | LLM Client (GitHub Models API, OpenAI 호환) | ✅ |
| A8 | MCP Server 기본 (stdio transport) | ✅ |

### Phase B: 아키텍처 전환

| 단위 | 내용 | 상태 |
|---|---|---|
| B1 | Agent/FeatureTeam 제거 (레거시 MVP 코드) | ✅ |
| B2 | MCP 도구 5개 등록 (route, ask, ask_many, scores, report) | ✅ |
| B3 | Report 모듈 (호출 기록, 비용 추적) | ✅ |
| B4 | Score 갱신 워크플로우 — FileReporter 영속화 + CallRecord 확장(context/team) + summary 모드 | ✅ |

### Phase C: 고도화

| 단위 | 내용 | 상태 |
|---|---|---|
| C1 | 레이트 리밋 관리 (GitHub API 한도 대응) | ✅ |
| C2 | 에러 핸들링 강화 (Phase별 재시도/폴백) | ✅ |
| C3 | 로깅/모니터링 (실행 아카이브) | ✅ |
| C4 | Classification 사전 검증 (분류 모델 정확도 벤치마크) | ✅ |
| C5 | `<think>` 태그 전역 적용 (ask/ask_many 응답에도 stripThinkTags) | ✅ |
| C6 | `scores` 도구 `top` 파라미터 추가 (정렬 + 슬라이스) | ✅ |

### Phase D: 합의 기반 숙의 (Deliberation)

> 리서치: `docs/research-frameworks.md` (11개 프레임워크 분석)
> 설계: Section 2 (합의 기반 이종 모델 숙의)

| 단위 | 내용 | 상태 |
|---|---|---|
| D1 | SharedContext 타입 시스템 (Round, Production, Review, Synthesis) | ✅ |
| D2 | Team Composer (Diversity Engine — provider 기반 다양성 보장) | ✅ |
| D3 | Deliberation Engine (라운드 실행, 병렬 리뷰, 종료 조건) | ✅ |
| D4 | 프롬프트 엔지니어링 (Producer/Reviewer/Leader 프롬프트 구성) | ✅ |
| D5 | MCP `deliberate` 도구 등록 + 통합 | ✅ |
| D6 | Adaptive Routing (학습 라우팅 — 과거 성공 조합 가중치) | ✅ (프레임) / ❌ (활성화) |
| D7 | Stigmergic Report 확장 (query action — 과거 숙의 결과 검색) | ✅ |
| D8 | Deliberation E2E 통합 테스트 | ✅ |
| D9 | Host-Native Integration — SKILL.md 배포, Custom Agent 정의 (`.github/skills/`, `.github/agents/`) | ✅ |

### Phase E: 차기 작업 (필드테스트 발견 사항)

> 2026-02-23 필드테스트에서 발견된 문제 및 개선 항목.

| 단위 | 내용 | 상태 |
|---|---|---|
| E1 | D6 Activation — `ReportBasedAdaptiveWeight` 구현 (report.record 데이터 기반 compositeScore 부스트 자동 계산) | ✅ → F6 흡수 |
| E2 | Critical 태스크 라우팅 개선 — 비용효율(CE) 편향 보정. complex/critical 태스크에 최소 모델 등급(capability threshold) 제약 추가 | ✅ → F3 흡수 |
| E3 | Confidence 보정 메커니즘 — 현재 전 모델 confidence=0.3 고정. 실사용 record 데이터 기반으로 신뢰도 자동 갱신 | ✅ → F1 흡수 |

#### 필드테스트 발견 사항 (2026-02-23)

| 관찰 | 내용 | 대응 |
|------|------|------|
| 비용효율 편향 | complex/critical 보안 리뷰(SECURITY_REVIEW)에 GPT-4.1 nano가 선택됨. CE 우선 알고리즘이 고능력 모델을 필요로 하는 태스크에 저비용 모델 과도 선호 | E2로 대응 |
| confidence 고정 | 전 모델 confidence 값이 0.3으로 초기값에 고정. 점수 신뢰도 반영 안 됨 | E3로 대응 |
| D6 미활성 | AdaptiveWeightProvider 프레임만 존재. nullAdaptiveWeight = 항상 boost 0. 학습 라우팅 미작동 | E1로 대응 |

### Phase F: 점수 체계 혁신 + 벤치마크 시스템 (Scoring & Evaluation Overhaul)

> **근본 문제:** 378개 점수가 전부 인간 추정치(dataPoints=0, confidence=0.3). 측정 없는 시스템에서 스케일/가중치 조정은 무의미. CE-first 정렬이 비용을 품질 위에 배치.
>
> **학술 근거:** 16개 논문/프레임워크 교차 검증 완료. 모든 핵심 설계가 학계 SOTA와 일치 확인.

#### 핵심 전환: 0-10 정수 → Bradley-Terry Dimensional Rating

현재 `ModelCapabilities`의 0-10 정수 스케일을 BT(Bradley-Terry) 레이팅으로 교체한다.

| 현재 | 전환 후 |
|---|---|
| `score: number` (0-10 정수) | `DimensionRating { mu, sigma, comparisons }` |
| `confidence: number` (0.0-1.0, 전부 0.3 고정) | sigma가 자연스럽게 신뢰도 표현 (비교 많을수록 sigma↓) |
| `dataPoints: number` (전부 0) | `comparisons: number` (실측 쌍대비교 횟수) |
| 가중합 `Σ(score × weight)` | BT coefficient 기반 모델 강도 순위 |

근거: LMSYS Chatbot Arena (arXiv:2403.04132) — MLE 기반 BT estimation, Bootstrap CI. Arena-Hard (arXiv:2406.11939) — 동일 방법론, 98.6% human correlation.

#### F 로드맵

| 단위 | 내용 | 의존 | 상태 |
|---|---|---|---|
| F1 | **BT Dimensional Rating** — `DimensionRating { mu, sigma, comparisons }` 타입 도입. `ModelCapabilities` 0-10 → BT mu/sigma 전환. `compositeScore` BT 기반 재설계. `scores/models.json` 스키마 마이그레이션 | — | ✅ |
| F2 | **Benchmark Anchoring** — 공개 벤치마크(Open LLM Leaderboard 6종 + HumanEval+ + SWE-bench) 결과 수집 → 18모델 초기 BT mu 설정. 인간 추정치 대체 | F1 | ✅ |
| F3 | **2-Track Selection** — criticality 기반 분기: critical/high → quality-first, low/medium → cost-first. CE-first 편향 해소. E2 흡수 | F1 | ✅ |
| F4 | **Preference Router** — RouteLLM Matrix Factorization 방식. deliberation에서 수집된 preference data로 쿼리→모델 라우팅 학습 | F1, F8 | ✅ |
| F5 | **MoE Dimension Gating** — ArmoRM 방식 MoE로 태스크별 차원 가중치 자동 결정. 수동 weight 관리 제거 | F1, F8 | ✅ |
| F6 | **Adaptive Weight (Cascade)** — FrugalGPT LLM Cascade. 쿼리별 모델 조합 학습. Confidence Gate 기반 에스컬레이션. E1 흡수 | F1, F8 | ✅ |
| F7 | **Calibration Loop** — 실사용 결과 → BT 레이팅 자동 갱신. sigma 수렴 모니터링. 이상치 탐지 | F1, F8 | ✅ |
| F8 | **Evaluation Suite** — 4-Layer 벤치마크 시스템 (아래 상세). 프롬프트 셋 + LLM-as-Judge + Pairwise Comparison 파이프라인 | F1 | ✅ |
| F9 | **모델 확장** — Opus 4.6, Gemini 3.1 Pro, GPT 5.3 등 누락 모델 추가. F2 앵커링 즉시 적용 | F1, F2 | ✅ |
| F10 | **LLM-as-Judge Pipeline** — MT-Bench/Arena-Hard 방식 자동 평가. Position swap, 5-outcome scoring, length bias 보정 | F8 | ✅ |

의존 그래프:
```
F1 ──→ F2 ──→ F9
 │       │
 │       └──→ F8 ──→ F4, F5, F6, F7, F10
 │             │
 └──→ F3      └──→ F10
```

**착수 순서:** F1 → F2 → F8 → F3 → F10 → F7 → F4/F5/F6 → F9

#### F8 상세: 4-Layer Evaluation Suite

> 학술 근거: Arena-Hard BenchBuilder (arXiv:2406.11939), WildBench (arXiv:2406.04770), MixEval (arXiv:2406.06565), LiveBench (arXiv:2406.19314), HELM (arXiv:2211.09110), IFEval (arXiv:2311.07911)

**Layer 1: 공개 벤치마크 앵커 수집** (F2 연동)

| 벤치마크 | 평가 대상 | pyreez 차원 매핑 |
|---|---|---|
| IFEval | 지시 따르기 | L1(자연어이해), L3(지시따르기) |
| BBH (23 subtasks) | 추론, 알고리즘 | C1(논리추론), C2(분석) |
| MATH Level 5 | 수학 | C3(수학연산) |
| GPQA | 전문 지식 QA | C4(도메인전문성) |
| MuSR | 장문 복합 추론 | C1(논리추론), C6(맥락처리) |
| MMLU-PRO (10 choices) | 다분야 지식 | C4(도메인전문성) |
| HumanEval Plus | 코드 생성 | T1(코드생성) |
| SWE-bench Verified | 실제 이슈 해결 | T1(코드생성), T3(디버깅) |

**Layer 2: pyreez 도메인 맞춤 프롬프트 셋** (Arena-Hard BenchBuilder 방법론)

프롬프트 설계 기준 — Arena-Hard 7 Key Criteria:
1. Specificity — 구체적 출력 명세
2. Domain Knowledge — 도메인 전문성 요구
3. Complexity — 다단계 추론/변수
4. Problem-Solving — 능동적 문제해결
5. Creativity — 창의적 접근
6. Technical Accuracy — 기술적 정확성
7. Real-world Application — 실세계 적용

프롬프트 셋 구조:
```
12 도메인 × 3 난이도(simple/moderate/complex) × 최소 3 프롬프트 = 108+

각 프롬프트에는:
- 7 Key Criteria 점수 (0-7)
- Task-specific checklist (WildBench 방법론 — 자동 생성 평가 기준)
- 기대 출력 형태
- 해당 차원 매핑 (21차원 중 어떤 것을 측정하는지)
```

난이도 분포 (Arena-Hard 분석 기반, 높은 점수 = 높은 separability):
| 난이도 | 7-Criteria 목표 | 목적 |
|---|---|---|
| simple | 1-3점 | 바닥 성능 확인 (모든 모델 pass 기대) |
| moderate | 4-5점 | 중간 모델 분리 |
| complex | 6-7점 | 최상위 모델만 유의미 차이 |

**Layer 3: Pairwise Comparison 기반 BT 갱신** (Arena-Hard + Chatbot Arena 방법론)

| 단계 | 내용 |
|---|---|
| 기준 모델 설정 | 가장 강한 모델(예: o3)을 anchor |
| 응답 수집 | 모든 모델에 동일 프롬프트, 응답 수집 |
| Pairwise 평가 | LLM-as-Judge가 5-outcome: A≫B, A>B, A≈B, B>A, B≫A |
| Position swap | 같은 쌍을 순서 바꿔 2회 평가 (편향 방지) |
| BT 계산 | A≫B, B≫A = 강한 신호. A>B, B>A = 약한 신호. MLE → BT coefficient |
| 신뢰도 | Bootstrap 100회 → 95% CI |

**Layer 4: 동적 갱신** (LiveBench + WildBench 방법론)

| 메커니즘 | 내용 |
|---|---|
| 월간 프롬프트 갱신 | 최신 기술 이슈 반영, 오염 방지 |
| 실사용 로그 수확 | MCP 호출 로그에서 고품질 프롬프트 자동 수집 |
| 객관적 정답 우선 | 코딩/수학은 자동 검증, 개방형만 LLM judge |
| 한국어 IFEval | 25 verifiable instruction types 한국어 버전 |

#### 리서치 레퍼런스

| # | 논문/프레임워크 | 핵심 기여 | pyreez 적용 |
|---|---|---|---|
| R1 | Chatbot Arena BT Model (arXiv:2403.04132) | MLE 기반 BT rating, Bootstrap CI | F1 — 점수 체계 |
| R2 | Arena-Hard BenchBuilder (arXiv:2406.11939) | 7 Key Criteria 프롬프트 큐레이션, 98.6% human correlation | F8 Layer 2, F10 |
| R3 | RouteLLM (arXiv:2406.18665) | Matrix Factorization Router, 75% cost reduction | F4 — Preference Router |
| R4 | FrugalGPT (arXiv:2305.05176) | LLM Cascade, 98% cost reduction | F6 — Cascade |
| R5 | ArmoRM (arXiv:2406.12845) | MoE Reward Model, RewardBench SOTA | F5 — MoE Gating |
| R6 | RouterBench (arXiv:2403.12031) | 405K inference outcomes, Pareto frontier | F4 — 평가 프레임워크 |
| R7 | Hybrid LLM (arXiv:2404.14618, ICLR 2024) | Query difficulty routing, dynamic quality threshold | F3 — 2-Track |
| R8 | WildBench (arXiv:2406.04770) | Task-specific checklists, Pearson 0.98 | F8 Layer 2 |
| R9 | MixEval (arXiv:2406.06565, NeurIPS 2024) | Real-world distribution matching, 0.96 correlation | F8 Layer 1 |
| R10 | LiveBench (arXiv:2406.19314, ICLR 2025) | Contamination-free monthly update, objective scoring | F8 Layer 4 |
| R11 | HELM (arXiv:2211.09110) | 7 metrics × 42 scenarios holistic evaluation | F8 다차원 설계 |
| R12 | MT-Bench (arXiv:2306.05685, NeurIPS 2023) | LLM-as-Judge, 80% human agreement, multi-turn | F10 — Judge |
| R13 | IFEval (arXiv:2311.07911) | 25 verifiable instruction types, objective metrics | F8 Layer 2 한국어 |
| R14 | AlpacaEval LC (arXiv:2404.04475, COLM 2024) | Length bias correction via GLM, Spearman 0.98 | F10 편향 보정 |
| R15 | Open LLM Leaderboard (HuggingFace) | IFEval+BBH+MATH+GPQA+MuSR+MMLU-PRO 표준 | F2 — 앵커 |
| R16 | Elo Uncovered (arXiv:2311.17295) | K factor sensitivity, reliability axioms | F1 — rating 설계 |

---

## 10. 설계 검토 — 미해결 논의 (Design Review)

> 결정이 확정되면 `결정: 미확정` → `결정: (선택)` 으로 갱신.
> ~~취소선~~은 폐기된 항목.

### 확정 완료

---

#### DR-001: Phase 간 컨텍스트 전달 전략

- **결정:** ✅ 확정 — Phase 1-3은 구조화 타입 전환 (ClassifyResult → TaskRequirement → RouteResult). pyreez 내부 Phase 간에는 타입만 전달하므로 컨텍스트 폭발 없음. 팀간 컨텍스트는 Handoff Packet (Section 2) 으로 관리.

---

#### DR-003: 에이전트 간 소통 프로토콜

- **결정:** ✅ 확정 (v2) — SharedContext 기반 정보 공유. 모든 참여자가 전체 숙의 이력을 공유하는 Blackboard System 패턴. 기존 Handoff Packet 방식에서 전환.
- **v1 (폐기):** Handoff Packet `{ summary, artifacts, requirements }` — 중앙 집중식으로 상호 피드백 부재.

---

#### DR-004: MVP → v2 마이그레이션 전략

- **결정:** ✅ v2 타입 선행 — Agent/FeatureTeam (레거시 MVP) 제거 예정. v2 타입 시스템 위에 새 MCP 도구 구축. Phase B에서 수행.

---

#### DR-006: Provider 폴백 체인

- **결정:** ✅ GitHub Only — 단일 프로바이더. Docker/Ollama 제거됨. 폴백 체인 불필요.

---

#### DR-019: MCP Tool 확장

- **결정:** ✅ 6개 도구 (v2) — `route`, `ask`, `ask_many`, `scores`, `report`, **`deliberate`** (합의 기반 숙의).
- **v1 (반영):** 5개 도구 — `route`, `ask`, `ask_many`, `scores`, `report`. Phase A-B에서 구현 완료.

---

### 폐기

---

#### ~~DR-008: DAG 에러 전파 전략~~

- **폐기 사유:** DAG 실행이 pyreez 범위에서 제거됨. Orchestrator(Host)가 실행 흐름 관리.

---

#### ~~DR-018: Bayesian EMA α 감쇠 스케줄~~

- **폐기 사유:** 수학적 자동 점수 갱신 폐기. Orchestrator가 매 호출 후 AI 판단으로 갱신 여부 결정. scores/models.json 직접 수정 → commit.
- **대체 설계:** 2-Layer 평가 — Team Leader(1차 quality) + Orchestrator(2차 갱신 판단). CallRecord에 context metrics + team metadata 포함. FileReporter로 `.pyreez/reports/{date}.jsonl` 영속화.

---

### 미확정

---

#### DR-002: 예산(Budget) 설정 방식

- **문제:** 예산이 없으면 SELECT의 Budget-Aware 로직이 작동 불가.

| Option | 설명 |
|---|---|
| A | 3-tier 예산 — 요청당($1), 일일($10), 월간($100) |
| B | 요청당 예산만 — 기본 $1, override 가능 |
| C | 자동 예산 — complexity에서 산출 (simple=$0.10, moderate=$0.50, complex=$2.00) |

**결정:** ✅ 확정

---

#### DR-005: 파이프라인 레벨 에러 핸들링

- **문제:** CLASSIFY 오분류 시 전체 파이프라인 잘못된 방향.

| Option | 설명 |
|---|---|
| A | Fail-fast + 1회 재시도 |
| B | 분류 검증 게이트 (규칙 기반 교차 검증) |
| C | Checkpoint 복구 |

**결정:** ✅ 확정

---

#### DR-007: 레이트 리밋 관리

- **문제:** GitHub API 무료 티어 (Low 15 req/min, 150 req/day).

| Option | 설명 |
|---|---|
| A | 토큰 버킷 큐잉 |
| B | 응답 헤더 기반 (`X-RateLimit-Remaining` + `Retry-After`) |
| C | 사전 예산 배분 (호출 수 계산 → 한도 비교) |

**결정:** ✅ 확정 — Option B. LLMClient에서 `Retry-After` 헤더 파싱 → `retryAfterMs` 전달. `createChatAdapter`에서 429 시 자동 재시도 (지수 백오프, 기본 maxRetries=3, baseDelay=1000ms).

---

#### DR-009: 로깅/모니터링

- **문제:** Phase별 입출력, 비용 데이터의 기록/저장 방법.

| Option | 설명 |
|---|---|
| A | 구조화 로그 (JSON stdout/file) |
| B | 실행 아카이브 (`.pyreez/runs/{timestamp}.json`) |
| C | A+B 결합 |

**결정:** ✅ 확정 — Option B. FileRunLogger가 `.pyreez/runs/{date}.jsonl`에 JSONL 아카이브 기록. 서버 logRun 래퍼가 6개 도구 핸들러를 감싸서 성공/실패/durationMs 자동 기록. fire-and-forget (로깅 실패가 도구 실행에 영향 없음).

---

#### DR-010: 성능 SLA

- **문제:** `route` 호출 최대 응답 시간.

| Option | 설명 |
|---|---|
| A | Phase별 타임아웃 — CLASSIFY 5s, PROFILE 1s, SELECT 1s |
| B | 전체 타임아웃만 — route 10s |

**결정:** ✅ 확정

---

#### DR-012: 복잡도(complexity) 판정 기준

- **문제:** `simple | moderate | complex` 의 구체적 판정 기준.

**제안:**

| 복잡도 | 조건 |
|---|---|
| simple | 단일 파일/함수, 명확한 지시, 출력 < 500 tokens |
| moderate | 2-5개 파일, 조건부 로직, 출력 500-2000 tokens |
| complex | 다중 모듈, 아키텍처 결정, 출력 > 2000 tokens or 도메인 전문성 |

**결정:** ✅ 확정 — 3단계 복합 판정. (1) 길이 기반 baseline (100자 미만 simple, 500자 미만 moderate, 이상 complex). (2) 키워드 상승 — COMPLEX_KEYWORDS (architecture, 마이크로서비스, distributed, migration 등) → 강제 complex, MODERATE_KEYWORDS (jwt, 보안, auth, database 등) → simple→moderate 상승. (3) criticality floor — high/critical 태스크는 최소 moderate.

---

#### DR-013: 중요도(criticality) 판정 기준

- **문제:** `low | medium | high | critical` 의 정의.

**제안:**

| 중요도 | 조건 |
|---|---|
| low | COMMENT_WRITE, CHANGELOG 등 보조 |
| medium | IMPLEMENT_FEATURE, REFACTOR 등 일반 |
| high | SYSTEM_DESIGN, ROOT_CAUSE 등 구조적 |
| critical | SECURITY_REVIEW, INCIDENT_RESPONSE 등 |

**결정:** ✅ 확정 — KEYWORD_RULES에서 domain×taskType 조합별 criticality 매핑으로 구현. 예: (SECURITY, SECURITY_REVIEW) → critical, (CODE, IMPLEMENT_FEATURE) → medium, (ARCHITECTURE, SYSTEM_DESIGN) → high.

---

#### DR-014: 능력치 가중치 전체 분포

- **문제:** Top-3만 명시(합계 ~0.75). 나머지 0.25의 21차원 분배.

| Option | 설명 |
|---|---|
| A | Top-N + 균등 잔여 |
| B | 21차원 전체 명시 |
| C | Top-N만 사용, 나머지 가중치=0 |

**결정:** ✅ 확정

---

#### DR-015: FALLBACK 제약 완화 순서

- **문제:** HARD FILTER 후 후보 0개일 때 어떤 제약을 어떤 순서로 완화하는지.

**제안 순서:**

1. 능력 하한선 완화 (minimum → 0)
2. 한국어 제약 완화
3. tool calling 제약 완화
4. 예산 2배까지 허용 + 경고
5. context 제약은 완화 불가
6. 여전히 0개 → 최저가 + 경고

**결정:** ✅ 확정

---

#### DR-016: 태스크 62유형 단계적 구현

- **문제:** 62개 전체를 한 번에 분류 구현하면 부담.

| Option | 설명 |
|---|---|
| A | Phase 1: 핵심 20유형 (D5+D6+D9 일부) → Phase 2: 나머지 |
| B | 도메인 단위 순차 추가 |
| C | 62유형 모두 타입 정의, 분류는 점진 정밀화 |

**결정:** ✅ 확정

---

#### DR-017: 21차원 능력치 관리 부담 경감

- **문제:** 21차원 × 18모델 = 378개 점수. 관리 부담.

| Option | 설명 |
|---|---|
| A | 핵심 5차원 자주 갱신 + 보조 16차원 분기 1회 |
| B | 태스크별 on-demand 갱신 |
| C | 전체 동일 주기 |

**결정:** ✅ 확정

---

#### DR-020: CLASSIFY 사전 검증

- **문제:** 분류 모델의 62유형 분류 능력을 실증 없이 전제.

| Option | 설명 |
|---|---|
| A | 분류 정확도만 먼저 벤치마크 |
| B | 구현과 병행 검증 |
| C | 원래 로드맵대로 나중에 검증 |

**결정:** ✅ 확정 — Option B. 구현과 병행 검증. 필드테스트에서 실사용하면서 분류 정확도와 모델 스코어링을 동시에 조정.

---

## 11. 기능 아이디어 후보 (Feature Ideas Backlog)

> 코어 구현 이후 검토할 확장 기능 후보.

---

#### FI-001: Confidence-based Escalation (자신감 기반 에스컬레이션)

- **설명:** 에이전트 출력의 confidence가 낮으면 자동으로 상위 모델이 검증/재실행
- **기대 효과:** 불필요한 검토 비용 제거 + 품질 위험 구간 자동 감지
- **우선순위:** 높음

---

#### FI-002: Prompt Cache Layer (프롬프트 캐시)

- **설명:** 동일 system prompt + 유사 입력 캐시하여 중복 LLM 호출 제거
- **우선순위:** 중간

---

#### FI-003: Dry-run Mode (드라이런)

- **설명:** LLM 호출 없이 라우팅만 실행하여 예상 비용/모델 선택 미리 표시
- **우선순위:** 높음

---

#### FI-004: Adaptive Workflow (적응형 워크플로우)

- **설명:** 출력 품질에 따라 워크플로우 동적 승격/축소
- **우선순위:** 낮음

---

#### FI-005: Learning-from-Feedback (피드백 학습)

- **설명:** Host의 accept/reject 신호 기반 모델 점수 자동 갱신
- **우선순위:** 중간

---

#### FI-006: Model Canary Testing (자동 모델 탐색)

- **설명:** 새 모델 발견 시 자동 벤치마크 → 레지스트리 등록
- **우선순위:** 낮음

---

#### FI-007: Context Budget Manager (컨텍스트 예산 관리)

- **설명:** 모델 context window 기반 관련 정보 자동 선별/압축
- **우선순위:** 높음

---

## 12. 미확정 잔여 항목

| # | 항목 | 상태 |
|---|------|------|
| E | MCP notification 실시간 표시 가능 여부 검증 | ✅ |

---

## 변경 이력

| 일자 | 내용 |
|---|---|
| 2026-02-23 | **Phase F 추가** — 점수 체계 혁신(0-10→BT Rating) + 4-Layer Evaluation Suite. 16개 논문/프레임워크 교차 검증. E1→F6, E2→F3, E3→F1 흡수. F1~F10 로드맵, 리서치 레퍼런스 R1~R16. |
| 2026-02-23 | C4 ✅ (분류 정확도 벤치마크 하네스 — runBenchmark, SEED_CASES 25개 12도메인). 필드테스트 완료 — MCP 6/6 도구 정상. 라우팅 비용효율 편향·confidence 고정·D6 미활성 발견. Phase E 신규 추가. 513 tests GREEN. |
| 2026-02-23 | C3/C5/C6 ✅, D6 Adaptive Routing 프레임 ✅. DR-009 확정(B), DR-020 확정(B). FileRunLogger+logRun 래퍼, stripThinkTags 전역, scores top, AdaptiveWeightProvider+nullAdaptiveWeight+compositeScore boost. 493 tests GREEN. |
| 2026-02-23 | Phase C5/C6 추가 (think 태그 전역 적용, scores top 파라미터). DR-007/012/013 확정. C1/C2 ✅. Complexity 키워드 상승, DeepSeek think strip, Rate Limit 재시도, 에러 핸들링 개선. GitHub 레포 공개 (zipbul/pyreez). 452 tests GREEN. |
| 2026-02-23 | Host-Native Integration 전략 추가 (Section 2). IDE/에이전트 생태계 리서치(10카테고리×3플랫폼) 반영. pyreez 배포 형태(MCP+Skill+Agent+Plugin) 확정. Phase D9 추가. `docs/research-frameworks.md` Section 13-14 추가. `.github/skills/`, `.github/agents/` 생성. |
| 2026-02-23 | Section 2 전면 교체: 5+1 구조 → 합의 기반 이종 모델 숙의(Deliberation). 3계층 역할(Host/Orchestrator/Leader/Workers), SharedContext, 팀 다양성 보장 알고리즘, pyreez_deliberate 도구, Deliberation 프로세스 흐름. 11개 프레임워크 리서치 근거 `docs/research-frameworks.md` 추가. Phase D 로드맵 추가. DR-003(v2), DR-019(v2) 갱신. |
| 2026-02-22 | PLAN.md 전면 개정. 5+1 아키텍처(Host=Orchestrator, pyreez=Infra) 반영. 16→21차원, 9→18모델 구현 완료 반영. Docker/Ollama 제거. Phase 5-6(COMPOSE/EXECUTE) pyreez 범위 밖으로 이동. DR 5건 확정, 2건 폐기. COMMUNICATION-PROTOCOL.md 삭제. |
