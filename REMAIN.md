# REMAIN — 미확정 사항 및 조사 결과 보존

> 워크플로우 확정 후 아직 구현/결정하지 않은 항목들.

---

## 1. 워크플로우 단계별 도구 매핑 (미확정)

| 단계 | 후보 도구 | 비고 |
|------|----------|------|
| Ideate | Skill (`pyreez` 숙의) | 이미 구현됨 |
| Plan | EnterPlanMode (빌트인) | Claude Code 내장 |
| Spec | MCP (Emberdeck) | 카드 CRUD, 이미 구현됨 |
| Analyze | Rule | 매 수정 전 자동 적용 |
| Test ↔ Implement | Rule + Hook | Rule로 플로우 명시, Hook으로 검증 강제 |
| Verify | Hook (`PostToolUse(Edit)`) | 편집 후 자동 `bun test` + `bun run typecheck` |
| Commit | Rule | 기존 workflow.md |
| Ralph Loop | Rule | 완료 조건 + 반복 구간 명시 |
| No Test Tampering | Hook (`PreToolUse(Edit)`) | 테스트 파일 삭제/비활성화 차단 |
| Reflection | Custom Agent | 읽기전용 리뷰어 에이전트 |

---

## 2. Hook 구현 목록

### PostToolUse(Edit) → 자동 검증
- 편집 완료 후 `bun test` + `bun run typecheck` 자동 실행
- Verification-First 원칙의 기계적 강제
- 설정 위치: `.claude/settings.json` 또는 `.claude/settings.local.json`

### PreToolUse(Edit) → 테스트 삭제 방지
- 테스트 파일(*.spec.ts, *.test.ts)에서 `it.skip`, `describe.skip`, `it.todo` 추가 또는 `it`/`describe` 블록 삭제 감지 시 차단
- Beck/CodeScene 경고 대응: "AI가 테스트를 지워서 통과시키는" 패턴 방지
- Hook 타입: `command` 또는 `prompt`

---

## 3. Custom Agent 후보

### reviewer.md — 읽기전용 리뷰어
- `permissionMode: plan` (읽기 전용)
- 구현 완료 후 Reflection 용도
- 작성 세션과 분리된 검토 (Writer/Reviewer 패턴, Anthropic 권장)
- tools: Read, Glob, Grep (편집 불가)

---

## 4. Ralph Loop 적용 기준

### 적용 대상
- 완료 조건이 자동 검증 가능 (테스트 통과, 타입체크 통과, 벤치마크 수치)
- 반복적이고 범위가 큼 (마이그레이션, 대량 수정)
- 진행 상태가 파일/git에 저장 가능

### 비적용 대상
- 판단이 필요한 작업 (디자인, 아키텍처 결정)
- 범위가 작음 (버그 1개, 함수 1개)
- 컨텍스트 의존적 (탐색, 논의)

### 구현 방식
- SDK 불필요 — 워크플로우 규칙에 `[]*` 반복 구간과 완료 조건 명시
- 에이전트가 자체적으로 루프 (Claude Code가 이미 지원)
- SDK는 세션 간 컨텍스트 리셋이 필요한 장시간 작업에만 가치 (예외 케이스)

---

## 5. 조사된 베스트 프랙티스 소스 (16개)

재조사 방지용. 각 소스의 핵심 인사이트만 보존.

| # | 소스 | 핵심 인사이트 |
|---|------|-------------|
| 1 | Anthropic 공식 | 검증이 최고 레버리지. Explore→Plan→Implement→Commit. 컨텍스트 = 최중요 자원 |
| 2 | OpenAI | 단일 에이전트 먼저 최대화. 코드 퍼스트 > 그래프 퍼스트 |
| 3 | Google/Gemini | 복잡한 CoT 프롬프트 불필요 (thinking_level 파라미터). T=1.0 최적 |
| 4 | Andrew Ng | 4패턴: Reflection, Tool Use, Planning, Multi-Agent Collaboration |
| 5 | Kent Beck | TDD = AI 시대 초능력. Augmented Coding ≠ Vibe Coding. 테스트 삭제 경고 |
| 6 | Martin Fowler | Humans On the Loop (하네스 관리). Fresh context per subtask. 8가지 자율성 전략 |
| 7 | Cursor | Plan before code. Revert and refine (수정 반복 금지). 에이전트가 컨텍스트를 찾게 둬라 |
| 8 | Devin/Cognition | 67% PR merge rate. 주니어 4-8h 규모 최적. 손절 빠르게, fresh start 자주 |
| 9 | CodeScene | 코드 품질이 낮으면 에이전트 실패율 증가. 커버리지를 게이트로. AI-Ready Surface 확장 |
| 10 | Addy Osmani | Comprehension Debt 개념. 80% 문제. spec.md 먼저 (워터폴 15분). 커밋 = 세이브 포인트 |
| 11 | Simon Willison | 리뷰 안 한 코드 PR 금지. 작은 PR. AI PR 설명을 신뢰하지 마라 |
| 12 | LangChain | 57.3% 프로덕션 에이전트. 품질이 #1 장벽. 77% 멀티모델 사용 |
| 13 | Fowler ThoughtWorks | Agentic Flywheel — 에이전트가 하네스 개선을 자동 제안 |
| 14 | Agentic AI Handbook | Plan-Then-Execute, Inversion of Control, Reflection Loop, Action Trace Monitoring |
| 15 | Reliability Playbook | 구조화 출력 강제, 검증 가능한 아티팩트, 도구 사용으로 접지 (ReAct) |
| 16 | Ralph Loop | 완료 조건까지 반복. 진행 = 파일/git. 컨텍스트 = 매 반복 fresh |

---

## 6. 교차 검증된 패턴

### Tier 1 — 5개 이상 독립 소스 합의

| 패턴 | 합의 소스 |
|------|----------|
| Plan before code | Anthropic, Cursor, Osmani, Devin, Handbook, Playbook |
| 검증이 최고 레버리지 | Anthropic, Beck, CodeScene, Cursor, Devin |
| 인간 = 아키텍트/리뷰어 | Anthropic, Fowler, Osmani, Beck, Devin, CodeScene |
| 오염된 컨텍스트 → 리셋 | Anthropic, Cursor, Devin, Fowler |
| 작고 명확한 태스크 | 전원. Devin: "주니어 4-8h 규모" |

### Tier 2 — 3-4개 소스 합의

| 패턴 | 합의 소스 |
|------|----------|
| AI 출력 = 주니어 산출물 | Osmani, Devin, Anthropic |
| 타입 언어 + CI = 강제 품질 게이트 | Devin, CodeScene, Osmani, Anthropic |
| 멀티 에이전트 > 단일 메가 에이전트 | Ng, Anthropic, Fowler, LangGraph |
| 컨텍스트 관리 = 근본 제약 | Anthropic, Cursor, Devin, Fowler |
| 규칙을 머신 리더블 아티팩트로 | Anthropic, Cursor, CodeScene, Devin |

### 안티패턴 (3개 이상 합의)

| 안티패턴 | 소스 |
|---------|------|
| 리뷰 없이 PR 제출 | Willison, Osmani, Fowler |
| 수정 반복 대신 리셋 안 함 | Anthropic, Cursor, Devin |
| 테스트 삭제/비활성화 | Beck, CodeScene, Devin |
| 컨텍스트 윈도우 관리 안 함 | Anthropic, Cursor, Fowler |
| 과도한 기능 추가 | Fowler, Devin, Osmani |
| Comprehension Debt 누적 | Osmani (단독이지만 핵심 개념) |

---

## 7. Emberdeck 연동 로드맵

현재 Emberdeck v0.2 → 도구 생태계 성숙에 따라 자율성 점진 확대.

| 시점 | Analyze | Spec | Verify |
|------|---------|------|--------|
| 현재 (v0.2) | Grep/Explore 수동 | 카드 CRUD만 | 테스트/타입체크 |
| Phase 1 (v0.3) | 수동 | + acceptance 기준, 타입/우선순위 | + acceptance 검증 |
| Phase 3 (v0.5) | + drift 감지 | + 컨텍스트 팩 생성 | + drift score |
| Phase 4 (v0.6) | + pre_change_check | 동일 | + regression_guard (Firebat 연동) |
| Phase 5 (v0.7) | 동일 | + decompose, plan_implementation | 동일 |

핵심: 워크플로우 자체는 Emberdeck 밖. Emberdeck은 스펙 카드 관리만 담당.
계획문서는 일회성 — 구현 후 폐기. 영구 보존은 스펙 카드만.

---

## 8. zipbul 생태계 전체 맵

```
제품 레이어:  zipbul(웹 프레임워크) ← baker(검증), toolkit(유틸), cookie, helmet
도구 레이어:  firebat(품질), pyreez(숙의), emberdeck(스펙), gildash(인덱싱), playground(워크플로우CLI)
미착수:      agent-rules
```

### 부트스트래핑 순서 (판단)
1. **gildash** — 가장 기반. firebat, emberdeck 둘 다 의존
2. **firebat** — 코드 리뷰 자동화. 이게 되면 인간이 코드를 안 봐도 됨
3. **emberdeck** — 컨텍스트 유지. 세션 간 끊김 해결
4. **pyreez** — 어려운 판단 보조. 있으면 좋지만 없어도 자율 루프 가능

### 최소 자율 루프
gildash + firebat + 테스트/타입체크 → "기획 승인 후 자율 구현" 가능.
emberdeck은 세션이 길어질 때 필요.

---

## 9. Plugin 패키징

Pyreez를 Claude Code Plugin으로 패키징하면 설치 한 번으로 전부 세팅 가능:

```
pyreez-plugin/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── pyreez/
│       └── SKILL.md          # 숙의 스킬
├── agents/
│   └── reviewer.md           # 리뷰어 에이전트
├── hooks/
│   └── hooks.json            # 자동검증, 테스트삭제방지
├── .mcp.json                 # Pyreez MCP 서버 연결
└── settings.json             # 기본 설정
```

향후 zipbul 전체를 하나의 Plugin으로 묶는 것도 가능 (firebat + emberdeck + pyreez + gildash).

---

## 10. 미적용 고급 기능

| 기능 | 상태 | 메모 |
|------|------|------|
| Agent Teams | 실험적 (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) | 병렬 협업. 토큰 비용 높음. 대기 |
| Skill `context: fork` | 안정 | 숙의 스킬을 격리된 서브에이전트에서 실행. 컨텍스트 보호 |
| Agent SDK | 안정 | CI/CD 자동화, 배치 작업용. 현재 불필요 |
| Skill `!command` 동적 주입 | 안정 | 스킬 실행 시 라이브 데이터 주입 |
| Plugin 마켓플레이스 | 안정 | 배포 채널. zipbul 프레임워크 완성 후 고려 |
| `/loop` (Scheduled Tasks) | 안정 | 반복 프롬프트. 모니터링/폴링용 |
