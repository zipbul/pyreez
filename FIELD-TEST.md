# FIELD-TEST.md — MCP 필드테스트 시나리오

> **용도:** 에이전트가 pyreez MCP 서버의 6개 도구를 체계적으로 검증하는 런북.
> **실행 조건:** `.env`에 `PYREEZ_GITHUB_PAT` 설정 필수. `.vscode/mcp.json`에 pyreez 서버 등록 필수.
> **실행 방법:** 에이전트가 이 문서를 읽고, 각 시나리오를 순서대로 MCP 호출하여 PASS/FAIL 판정.

---

## T1: pyreez_route — 라우팅 파이프라인 검증

CLASSIFY → PROFILE → SELECT 파이프라인 + 2-Track Selection(F3) 검증.

### T1-1: 단순 태스크 → 저비용 모델 선택

```
입력: { task: "JSON 파싱하는 유틸 함수 만들어줘" }
```

**PASS 조건:**
- `classification.complexity` = `"simple"`
- `selection.model.cost.inputPer1M` < 1.0 (저비용 모델)
- `selection.costEfficiency` > 100000

### T1-2: 복잡 태스크 → 고능력 모델 선택

```
입력: { task: "마이크로서비스 간 분산 트랜잭션을 Saga 패턴으로 설계하고, 보상 트랜잭션 실패 시 데드레터 큐 처리까지 포함한 아키텍처를 설계해줘" }
```

**PASS 조건:**
- `classification.complexity` = `"complex"` 또는 `"moderate"`
- `classification.domain` = `"DEVELOPMENT"` 또는 `"ARCHITECTURE"`

### T1-3: Critical 태스크 → Quality-first (2-Track F3)

```
입력: { task: "프로덕션 인증 시스템의 JWT 토큰 검증 로직을 구현해줘. 보안이 매우 중요함" }
```

**PASS 조건:**
- `classification.criticality` = `"critical"` 또는 `"high"`
- quality-first 트랙이면 `selection.score`가 높은 모델 선택 (nano 급 아닌 것)

### T1-4: 예산 제약

```
입력: { task: "React 컴포넌트 리팩토링해줘", budget: 0.001 }
```

**PASS 조건:**
- `selection.expectedCost` ≤ 0.001
- `selection.model`이 예산 내 모델

### T1-5: 한국어 프롬프트 분류

```
입력: { task: "PostgreSQL에서 인덱스 최적화 전략을 분석해줘" }
```

**PASS 조건:**
- `classification.domain` 존재 (빈 값 아님)
- `requirement.requiresKorean` = `true`

---

## T2: pyreez_ask — 단일 모델 호출

### T2-1: 기본 호출

```
입력: {
  model: "openai/gpt-4.1-mini",
  messages: [{ role: "user", content: "TypeScript에서 제네릭 타입의 장점 3가지를 간단히 설명해줘" }]
}
```

**PASS 조건:**
- 응답이 비어있지 않음
- 제네릭 관련 내용 포함
- `<think>` 태그 없음 (stripThinkTags 동작 확인)

### T2-2: temperature + max_tokens 파라미터

```
입력: {
  model: "openai/gpt-4.1-nano",
  messages: [{ role: "user", content: "숫자 1부터 10까지 나열해" }],
  temperature: 0,
  max_tokens: 50
}
```

**PASS 조건:**
- 응답이 짧음 (max_tokens 제약 반영)
- 숫자 나열 포함

### T2-3: 잘못된 모델 ID → 에러 핸들링

```
입력: {
  model: "nonexistent/fake-model-999",
  messages: [{ role: "user", content: "test" }]
}
```

**PASS 조건:**
- `isError: true` 또는 에러 메시지 반환
- 서버 크래시 없음

### T2-4: system 메시지 포함

```
입력: {
  model: "openai/gpt-4.1-nano",
  messages: [
    { role: "system", content: "너는 해적이야. 모든 문장을 해적 말투로 답해" },
    { role: "user", content: "오늘 날씨 어때?" }
  ]
}
```

**PASS 조건:**
- 응답에 해적 말투 또는 해적 관련 표현 포함

---

## T3: pyreez_ask_many — 다중 모델 병렬 호출

### T3-1: 3개 모델 동시 호출

```
입력: {
  models: ["openai/gpt-4.1-nano", "openai/gpt-4.1-mini", "deepseek/DeepSeek-V3-0324"],
  messages: [{ role: "user", content: "피보나치 수열의 10번째 값은?" }]
}
```

**PASS 조건:**
- 배열 길이 = 3
- 각 항목에 `model` 필드 존재
- 최소 2개 이상 응답에 "55" 포함 (정답)

### T3-2: 부분 실패 처리

```
입력: {
  models: ["openai/gpt-4.1-nano", "nonexistent/fake-model"],
  messages: [{ role: "user", content: "1+1?" }]
}
```

**PASS 조건:**
- 배열 길이 = 2
- gpt-4.1-nano 항목: `content` 존재
- fake-model 항목: `error` 필드 존재
- 서버 크래시 없음 (Promise.allSettled 동작)

### T3-3: 응답 비교 (코드 생성)

```
입력: {
  models: ["openai/gpt-4.1-mini", "deepseek/DeepSeek-V3-0324"],
  messages: [{ role: "user", content: "TypeScript로 배열에서 중복을 제거하는 함수를 작성해줘" }],
  temperature: 0
}
```

**PASS 조건:**
- 두 응답 모두 코드 블록 포함
- 두 접근법의 차이가 관찰 가능 (다른 구현 or 동일 구현)

---

## T4: pyreez_scores — 레지스트리 쿼리

### T4-1: 전체 모델 조회

```
입력: {} (파라미터 없음)
```

**PASS 조건:**
- 배열 길이 = 21 (18 기존 + 3 신규: Opus 4.6, Gemini 3.1 Pro, GPT 5.3)
- 각 모델에 `capabilities` 객체 존재
- capabilities 내 각 차원이 `{ mu, sigma, comparisons }` BT 포맷

### T4-2: 특정 모델 필터

```
입력: { model: "anthropic/claude-opus-4.6" }
```

**PASS 조건:**
- 결과 1건
- `name` = "Claude Opus 4.6"
- `capabilities.REASONING.mu` = 1000 (최고 수준)

### T4-3: 차원별 top N

```
입력: { dimension: "CODE_GENERATION", top: 5 }
```

**PASS 조건:**
- 배열 길이 = 5
- score 내림차순 정렬
- 1위 모델의 score > 최하위 모델의 score

### T4-4: 신규 모델 확인 (F9)

```
입력: { model: "google/gemini-3.1-pro" }
```

**PASS 조건:**
- 결과 1건
- `name` = "Gemini 3.1 Pro"
- capabilities에 21개 차원 모두 존재

---

## T5: pyreez_report — 기록/조회

### T5-1: 호출 결과 기록

```
입력: {
  action: "record",
  model: "openai/gpt-4.1-mini",
  task_type: "CODE_WRITE",
  quality: 8,
  latency_ms: 1200,
  tokens: { input: 150, output: 300 }
}
```

**PASS 조건:**
- `{ recorded: true }` 반환
- 에러 없음

### T5-2: 요약 조회

```
입력: { action: "summary" }
```

**PASS 조건:**
- 응답에 구조화된 요약 데이터 존재
- T5-1에서 기록한 내용 반영 (최소 1건의 record)

### T5-3: context 정보 포함 기록

```
입력: {
  action: "record",
  model: "openai/gpt-4.1",
  task_type: "ARCHITECTURE",
  quality: 9,
  latency_ms: 3500,
  tokens: { input: 500, output: 1000 },
  context: { window_size: 1048576, utilization: 0.0014 }
}
```

**PASS 조건:**
- `{ recorded: true }` 반환

### T5-4: Deliberation 결과 쿼리

```
입력: { action: "query_deliberation", query_limit: 5 }
```

**PASS 조건:**
- 배열 반환 (빈 배열도 OK — 숙의 이력 없으면)
- 에러 없음

---

## T6: pyreez_deliberate — 이종 모델 합의 E2E

> ⚠️ **비용 주의:** 라운드당 ~4 LLM 호출. 3라운드 = ~12회. 신중하게 실행.

### T6-1: 2관점 코드 리뷰 숙의

```
입력: {
  task: "TypeScript로 안전한 JWT 토큰 검증 미들웨어를 구현해줘. Express.js 기반.",
  perspectives: ["코드 품질 + 가독성", "보안 + 에러 핸들링"],
  max_rounds: 2,
  consensus: "leader_decides"
}
```

**PASS 조건:**
- `result` 필드에 코드 포함
- `rounds_executed` ≥ 1
- `consensus_reached` = true 또는 false (bool 타입)
- `models_used` 배열 길이 ≥ 3 (최소 3개 다른 모델)
- `models_used`에 최소 2개 다른 provider (팀 다양성 보장)
- `final_approvals` 배열 존재
- `total_llm_calls` ≥ 4 (최소 1라운드)
- `deliberation_log.rounds` 배열 존재

### T6-2: 3관점 아키텍처 설계 숙의

```
입력: {
  task: "Bun + TypeScript 기반 실시간 채팅 서버를 설계해줘. WebSocket, 인증, 메시지 영속화 포함.",
  perspectives: ["시스템 아키텍처", "보안 + 인증", "성능 + 확장성"],
  max_rounds: 2,
  consensus: "leader_decides"
}
```

**PASS 조건:**
- T6-1과 동일 기본 조건
- `deliberation_log.rounds[0].reviews` 길이 ≥ 3 (3 reviewer)
- 각 review에 `perspective` 필드가 입력 perspectives 중 하나

### T6-3: consensus 모드 — majority

```
입력: {
  task: "Python으로 간단한 REST API rate limiter를 구현해줘",
  perspectives: ["코드 품질", "성능"],
  max_rounds: 2,
  consensus: "majority"
}
```

**PASS 조건:**
- 정상 완료 (에러 없음)
- `consensus_reached` 필드 존재

---

## 실행 순서 및 비용 관리

| 순서 | 시나리오 | 예상 LLM 호출 | 비용 등급 |
|------|---------|-------------|----------|
| 1 | T1 (route 5건) | 0 | 무료 (로컬 로직만) |
| 2 | T4 (scores 4건) | 0 | 무료 (로컬 로직만) |
| 3 | T2 (ask 4건) | 4 | 저 |
| 4 | T3 (ask_many 3건) | ~7 | 저 |
| 5 | T5 (report 4건) | 0 | 무료 (파일 I/O만) |
| 6 | T6 (deliberate 3건) | ~24-36 | **고** |

**총 예상:** LLM 호출 ~35-47회. T6을 제외하면 ~11회.

---

## 결과 기록 형식

각 시나리오 실행 후 아래 형식으로 결과 기록:

```
### [시나리오 ID] — [PASS/FAIL]
- 입력: (요약)
- 출력: (핵심 필드만)
- 판정 근거: (PASS 조건 대조)
- 이슈: (FAIL 시 상세)
```
