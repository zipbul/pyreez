# Deliberation 품질 개선 계획

> 2026-03-17 deliberation 실행 후 회고에서 도출된 개선사항

## 배경

`micro service vs monolithic` 트렌드 비교 deliberation 실행 결과:
- 5개 provider 중 xai만 응답 (Google: quota 초과, OpenAI/DeepSeek: 미설정, Local: 모델 없음, Anthropic: degenerate)
- 단일 provider의 유사 모델 2개로 debate → 다양성 가치 상실
- Worker 할루시네이션: 구체적 수치 4건 중 2건 미확인, 1건 증거 없음
- 호스트가 acceptance/feedback 단계를 누락

## 개선 항목

---

### 1. Provider별 Proactive Healthcheck

**현재**: reactive cooldown만 존재. 호출 후 실패해야 쿨다운 등록.
**문제**: 설정 안 된 provider, quota 초과 provider에 불필요한 호출 발생. 라우터가 사용 불가 모델 선택.
**목표**: deliberation 전에 provider 가용성을 사전 검증하여 실패 호출 제거.

**Provider별 healthcheck 방식**:

| Provider 유형 | 접근 방식 | Healthcheck 방법 |
|--------------|----------|-----------------|
| API (Anthropic, Google, xAI, DeepSeek, Mistral) | HTTP API + API key | lightweight endpoint ping 또는 최소 토큰 요청 |
| Local (Ollama, Docker Model Runner, LM Studio) | Unix socket / 로컬 HTTP | 모델 목록 API (`/api/tags`, `/v1/models`) |
| CLI (claude -p) | 프로세스 실행 | dry-run 또는 version 확인 |

**설계 방향**:
- Provider 인터페이스에 `healthcheck(): Promise<HealthStatus>` 추가
- HealthStatus: `{ available: boolean, reason?: string, models?: string[] }`
- deliberation 시작 전 `healthcheck()` 결과를 cooldown manager에 주입
- 기존 reactive cooldown과 이중 안전장치 구성 (proactive 1차 → reactive 2차)

**영향 범위**: `src/llm/providers/*.ts`, `src/deliberation/cooldown.ts`, `src/deliberation/wire.ts`

**미결 사항**:
- healthcheck 빈도 (매 deliberation? 주기적 캐싱?)
- healthcheck 자체의 비용 (API 호출 시 과금 여부)
- provider별 healthcheck endpoint 표준화 가능 여부

---

### 2. 모델 다양성 기준 재설계

**현재**: `selectDiverseModels()` (`team-composer.ts`)가 provider 단위 round-robin으로 다양성 확보.
**문제**: "동일 provider = 동일 편향"이라는 가정이 틀림. 같은 provider의 다른 모델(예: grok-4 vs grok-4-fast)은 다른 아키텍처/학습 데이터를 가질 수 있고, 다른 provider의 유사 모델(예: 두 provider의 동일 오픈소스 파인튜닝)이 더 유사할 수 있음.
**목표**: provider가 아닌 모델 자체의 특성 기반 다양성 보장.

**설계 방향**:
- 모델 메타데이터에 `family` 또는 `architecture` 필드 추가 (예: `llama-3`, `gemini-2`, `gpt-5`, `claude-4`)
- 다양성 기준: provider → `family` 기반으로 변경
- 같은 family 내 변형(size, speed)은 동일 편향으로 간주
- family 정보 없는 모델은 provider를 fallback 기준으로 사용

**영향 범위**: `src/model/registry.ts`, `src/deliberation/team-composer.ts`, `scores/models.json`

**미결 사항**:
- family 분류 기준 (수동 태깅 vs 자동 추론)
- 오픈소스 모델 파인튜닝 변형의 family 판단
- family 간 거리 측정이 필요한가 (단순 "다르면 다양" vs 유사도 스펙트럼)

---

### 3. 도메인 인식형 Fact Verification (스킬 프롬프트)

**현재**: SKILL.md의 Fact Verification 섹션이 모든 도메인에 동일한 엄격한 검증 요구.
**문제**: 아이디에이션/브레인스토밍에서 창의적 발상을 불필요하게 폐기. 모든 주장을 CONFIRMED/REFUTED로 이분하면 상상력이 죽음.
**목표**: domain과 task_type에 따라 검증 전략을 분기.

**검증 수준 분류**:

| 도메인 / 태스크 | 검증 수준 | 호스트 행동 |
|----------------|----------|-----------|
| RESEARCH, REVIEW, ARCHITECTURE (사실 의존) | **엄격** | 모든 수치/사례 교차검증. 미확인 시 명시적 경고 |
| PLANNING, REQUIREMENTS (혼합) | **선택적** | 현실 제약(비용, 기한)만 검증. 비전/목표는 허용 |
| IDEATION, BRAINSTORM, COMMUNICATION (창의 의존) | **최소** | 명백한 모순만 제거. 나머지는 영감의 재료로 활용 |
| CODING, TESTING, DEBUGGING (정확성 필수) | **엄격** | API 동작, 라이브러리 호환성 등 기술적 사실 검증 |

**적용 방법**: SKILL.md의 "Fact Verification" 섹션을 도메인 분기 테이블로 교체.

**영향 범위**: `.claude/skills/pyreez/SKILL.md`

**미결 사항**:
- 호스트가 도메인을 어떻게 전달받는가 (deliberate 응답에 domain 포함?)
- 검증 수준을 사용자가 override 가능해야 하는가
- "최소 검증"에서도 제거해야 할 명백한 모순의 기준

---

### 4. Acceptance/Feedback 실행 강제

**현재**: 호스트(Claude)가 스킬 프롬프트를 읽고 자발적으로 호출해야 함. 강제 메커니즘 없음.
**문제**: 호스트가 synthesis 작성에 집중하면 후속 단계를 잊음. 텍스트 지시만으로는 워크플로우 순서 보장 불가.
**목표**: acceptance/feedback 누락을 구조적으로 방지.

**이중 접근**:

#### A. 서버 측 — 응답에 구조적 힌트 포함
deliberate 응답에 `next_required_actions` 필드 추가:
```json
{
  "rounds": [...],
  "sessionId": "...",
  "next_required_actions": [
    { "tool": "pyreez_acceptance", "reason": "synthesis 검증 필수", "skip_if": ["IDEATION", "BRAINSTORM"] },
    { "tool": "pyreez_feedback", "reason": "BT 레이팅 업데이트" }
  ]
}
```

#### B. 스킬 측 — 프롬프트 워크플로우 강화
SKILL.md에서 synthesis 출력 전 acceptance 호출을 blocking 조건으로 명시:
```
## 워크플로우 (순서 위반 금지)
1. deliberate → 2. fact-check → 3. synthesis 작성 → 4. acceptance 호출 →
5. acceptance 통과 시 → 사용자에게 출력 → 6. feedback 제출
```
"사용자에게 출력하기 전에 반드시 acceptance를 호출하라"는 문구를 synthesis 규칙 최상단에 배치.

**영향 범위**: `src/mcp/server.ts` (응답 구조), `.claude/skills/pyreez/SKILL.md` (프롬프트)

**미결 사항**:
- 서버가 session 상태를 추적해서 acceptance 없이 새 deliberation 시 경고할 것인가
- skip 조건의 판단 주체 (서버 vs 호스트)
- feedback이 필수인가 권장인가 (BT 데이터 부족 시 레이팅 품질 저하 vs 매번 강제의 부담)

---

## 구현 우선순위 제안

| 순위 | 항목 | 이유 |
|------|------|------|
| 1 | 3. 도메인 인식형 Fact Verification | 즉시 적용 가능 (프롬프트 수정만), 효과 큼 |
| 2 | 4. Acceptance/Feedback 강제 | 프롬프트 + 응답 구조 소폭 변경 |
| 3 | 2. 모델 다양성 기준 | 메타데이터 + team-composer 수정 |
| 4 | 1. Provider healthcheck | 가장 큰 변경, provider 인터페이스 확장 |

## 다음 단계

항목별 Spec → Plan → 구현 진행. 1번부터 순서대로 구체화.
