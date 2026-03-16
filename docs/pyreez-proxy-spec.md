# pyreez-proxy — Claude Code 자동 모델 라우팅 프록시

> **상태**: 설계 문서 (미구현)
> **작성일**: 2026-03-17
> **목표**: Claude Code 사용 시 프롬프트를 LLM이 분류하여 최적 모델로 자동 라우팅

---

## 1. 문제 정의

Claude Code는 세션 내에서 모델을 자동 전환하는 기능이 없다. 사용자가 `/model haiku`나 `/model opus`로 수동 전환해야 하며, 이는 다음 문제를 야기한다:

- **비용 낭비**: 단순 질문에도 Opus가 사용됨
- **성능 낭비**: 복잡한 설계 작업에 Haiku가 사용됨
- **인지 부하**: 사용자가 매번 "이 작업에 어떤 모델이 적합한가"를 판단해야 함

## 2. 해결 방식

Claude Code와 LLM API 사이에 **HTTP 프록시**를 배치한다. 프록시는:

1. Claude Code로부터 Anthropic Messages API 요청을 수신
2. **경량 LLM(분류기)**이 프롬프트를 분석하여 domain/complexity 판정
3. pyreez의 **PROFILE→SELECT** 파이프라인으로 최적 모델 선택
4. 선택된 모델의 프로바이더 API로 요청 전달
5. 응답을 **Anthropic Messages API 형식**으로 변환하여 Claude Code에 반환

```
┌─────────────┐     Anthropic API     ┌───────────────┐      실제 API       ┌──────────────┐
│  Claude Code │ ──────────────────▶  │  pyreez-proxy │ ──────────────────▶ │  LLM Provider │
│              │ ◀──────────────────  │   :4001       │ ◀────────────────── │  (선택된 모델) │
└─────────────┘   Anthropic 형식 응답  └───────────────┘   각 프로바이더 형식  └──────────────┘
                                            │
                                     ┌──────┴──────┐
                                     │  ① 분류기    │  경량 LLM → domain, complexity
                                     │  ② profiler │  domain → 21차원 역량 요구
                                     │  ③ selector │  역량 매칭 → 최적 모델
                                     └─────────────┘
```

## 3. 컴포넌트 설계

### 3.1 HTTP 프록시 서버

**런타임**: Bun.serve()

**엔드포인트**:

| Method | Path | 설명 |
|--------|------|------|
| POST | `/v1/messages` | Anthropic Messages API 호환 (메인) |
| POST | `/v1/messages` + `stream: true` | SSE 스트리밍 응답 |
| GET | `/health` | 헬스체크 |
| GET | `/stats` | 라우팅 통계 (선택된 모델 분포, 비용 절감률) |

**설정**:

```bash
# Claude Code 연결
export ANTHROPIC_BASE_URL=http://localhost:4001
export ANTHROPIC_API_KEY=sk-ant-...   # 실제 키 (프록시가 포워딩)

# 프록시 시작
bun run proxy.ts --port 4001
```

### 3.2 프롬프트 분류기

**역할**: 프롬프트를 읽고 pyreez의 12 도메인 × complexity를 판정.

**분류기 모델 후보**:

| 모델 | 지연 | 비용/1M input | 장점 | 단점 |
|------|------|--------------|------|------|
| 로컬 Ollama (qwen2.5:3b) | ~50ms | $0 | 무료, 프라이버시 | GPU 필요 |
| Haiku | ~100ms | $0.80 | 빠름, 정확 | 매 요청 비용 |
| Gemini Flash | ~80ms | $0.075 | 초저가 | 한국어 약함 |

**분류 프롬프트**:

```
주어진 사용자 프롬프트를 분석하여 다음 JSON을 반환하라.

{
  "domain": "CODING" | "PLANNING" | "IDEATION" | "ARCHITECTURE" | "DEBUGGING" | "TESTING" | "REVIEW" | "DOCUMENTATION" | "OPERATIONS" | "RESEARCH" | "REQUIREMENTS" | "COMMUNICATION",
  "task_type": "<domain에 해당하는 구체적 태스크>",
  "complexity": "simple" | "moderate" | "complex"
}

판정 기준:
- CODING: 코드 작성, 수정, 리팩터링, 구현 지시
- PLANNING: 설계, 전략, 로드맵, 프로젝트 계획
- IDEATION: 브레인스토밍, 아이디어 생성, 옵션 탐색
- ARCHITECTURE: 시스템 설계, 모듈 구조, 데이터 모델링
- DEBUGGING: 에러 분석, 로그 분석, 버그 수정
- TESTING: 테스트 작성, 테스트 전략
- REVIEW: 코드 리뷰, 설계 검토, 보안 검토
- DOCUMENTATION: 문서 작성, 주석, 변경 로그
- OPERATIONS: 배포, CI/CD, 환경 설정
- RESEARCH: 기술 조사, 벤치마크, 트렌드 분석
- REQUIREMENTS: 요구사항 추출, 모호성 탐지
- COMMUNICATION: 요약, 설명, 번역, Q&A

complexity 판정:
- simple: 단순 질문, 짧은 코드 수정, 설명 요청
- moderate: 중간 규모 구현, 분석 필요한 작업
- complex: 대규모 설계, 멀티파일 변경, 깊은 추론 필요

사용자 프롬프트:
"""
{prompt}
"""
```

**최적화 — 2단계 분류**:

매 요청마다 LLM을 호출하면 지연이 발생한다. 이를 최소화하기 위해:

1. **규칙 기반 사전 분류 (0ms)**: 키워드 매칭으로 명확한 케이스를 즉시 분류
   - `fix`, `bug`, `error` → DEBUGGING
   - `test`, `spec` → TESTING
   - `refactor`, `implement`, `코드` → CODING
   - `plan`, `설계`, `전략` → PLANNING
2. **LLM 폴백**: 규칙으로 판정 불가 시에만 경량 LLM 호출

```typescript
function quickClassify(prompt: string): ClassifyResult | null {
  const lower = prompt.toLowerCase();
  // 키워드 기반 빠른 분류
  if (/\b(fix|bug|error|에러|오류)\b/.test(lower)) {
    return { domain: "DEBUGGING", complexity: inferComplexity(prompt) };
  }
  if (/\b(test|spec|테스트)\b/.test(lower)) {
    return { domain: "TESTING", complexity: inferComplexity(prompt) };
  }
  if (/\b(implement|refactor|코드|구현|리팩터)\b/.test(lower)) {
    return { domain: "CODING", complexity: inferComplexity(prompt) };
  }
  if (/\b(plan|설계|전략|design)\b/.test(lower)) {
    return { domain: "PLANNING", complexity: inferComplexity(prompt) };
  }
  // ... 더 많은 규칙
  return null; // LLM 폴백
}
```

### 3.3 pyreez 파이프라인 연동

분류 결과를 pyreez의 기존 인프라에 주입한다. **새로운 코드를 작성하지 않고** 기존 모듈을 재사용:

```typescript
import { DomainOverrideProfiler } from "../axis/wrappers";
import { TwoTrackCeSelector } from "../axis/wrappers";
import { BtScoringSystem } from "../axis/wrappers";

// 1. 분류 결과 → TaskClassification
const classification: TaskClassification = {
  domain: classifyResult.domain,           // 분류기 출력
  taskType: classifyResult.task_type,       // 분류기 출력
  complexity: classifyResult.complexity,    // 분류기 출력
};

// 2. PROFILE: 역량 요구사항 도출 (기존 모듈)
const requirement = await profiler.profile(classification);

// 3. SCORE: BT 점수 조회 (기존 모듈)
let scores = await scoring.getScores(modelIds);

// 4. Learning Layer: 개인화 보정 (기존 모듈)
if (learner) scores = await learner.enhance(scores, classification);

// 5. SELECT: 최적 모델 선택 (기존 모듈)
const plan = await selector.select(requirement, scores, budget);

// plan.models[0].modelId → "anthropic/claude-opus-4.6" 등
```

### 3.4 응답 포맷 변환

Claude Code는 Anthropic Messages API 형식을 기대한다. 선택된 모델이 Gemini나 DeepSeek일 때 응답을 변환해야 한다.

**Anthropic Messages API 응답 형식**:

```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "응답 내용" }],
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "end_turn",
  "usage": { "input_tokens": 100, "output_tokens": 200 }
}
```

**변환 전략**:

| 원본 프로바이더 | 변환 난이도 | 비고 |
|----------------|-----------|------|
| Anthropic (Claude) | 없음 | 원본 그대로 패스스루 |
| OpenAI 호환 (DeepSeek, Mistral, Qwen, Groq) | 낮음 | OpenAI → Anthropic 매핑 |
| Google (Gemini) | 중간 | Gemini 고유 형식 → Anthropic 매핑 |

**핵심 매핑**:

```typescript
function openaiToAnthropic(openaiRes: OpenAIChatResponse): AnthropicMessage {
  return {
    id: `msg_${crypto.randomUUID().slice(0, 12)}`,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: openaiRes.choices[0].message.content }],
    model: SPOOFED_MODEL_ID,  // Claude Code가 기대하는 모델명
    stop_reason: mapStopReason(openaiRes.choices[0].finish_reason),
    usage: {
      input_tokens: openaiRes.usage.prompt_tokens,
      output_tokens: openaiRes.usage.completion_tokens,
    },
  };
}
```

### 3.5 스트리밍 변환

Claude Code는 `stream: true` 요청 시 Anthropic SSE 형식을 기대한다.

**Anthropic SSE 이벤트 시퀀스**:

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","type":"message","role":"assistant","model":"...","usage":{"input_tokens":100}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"응답"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":200}}

event: message_stop
data: {"type":"message_stop"}
```

**OpenAI SSE → Anthropic SSE 변환**:

```typescript
async function* convertStream(
  openaiStream: AsyncIterable<OpenAIChunk>,
  meta: { messageId: string; model: string; inputTokens: number },
): AsyncIterable<AnthropicSSEEvent> {
  // 1. message_start
  yield {
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id: meta.messageId,
        type: "message",
        role: "assistant",
        model: meta.model,
        usage: { input_tokens: meta.inputTokens },
      },
    },
  };

  // 2. content_block_start
  yield {
    event: "content_block_start",
    data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  };

  // 3. delta 변환
  let outputTokens = 0;
  for await (const chunk of openaiStream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      yield {
        event: "content_block_delta",
        data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta } },
      };
    }
    if (chunk.usage?.completion_tokens) {
      outputTokens = chunk.usage.completion_tokens;
    }
  }

  // 4. 종료 시퀀스
  yield { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } };
  yield {
    event: "message_delta",
    data: { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: outputTokens } },
  };
  yield { event: "message_stop", data: { type: "message_stop" } };
}
```

## 4. 모델 스푸핑 전략

Claude Code는 응답의 `model` 필드를 확인할 수 있다. 비-Claude 모델의 응답을 Claude 모델명으로 위장해야 한다.

**접근법**: 요청의 원본 model 필드를 저장하고, 응답 시 해당 값을 그대로 반환.

```typescript
// 요청에서 원본 모델명 추출
const requestedModel = request.body.model; // "claude-sonnet-4-20250514"

// pyreez가 실제로 선택한 모델로 호출
const actualModel = plan.models[0].modelId; // "google/gemini-2.5-pro"
const response = await providerRegistry.chat({ model: actualModel, ... });

// 응답에는 원본 모델명 삽입
response.model = requestedModel; // Claude Code가 기대하는 값
```

## 5. 제약 사항 및 비호환

### 5.1 tool_use (함수 호출)

Claude Code는 Anthropic의 tool_use 프로토콜을 사용한다. 비-Claude 모델은 이 형식을 네이티브로 지원하지 않는다.

**대응**:
- **tool_use 요청 감지 시 → Anthropic 모델로 강제 라우팅**
- Claude Code의 핵심 기능(파일 읽기/쓰기, bash 실행)이 tool_use에 의존하므로 이것은 타협 불가

```typescript
function hasToolUse(request: AnthropicRequest): boolean {
  return Array.isArray(request.tools) && request.tools.length > 0;
}

// tool_use가 있으면 분류기 건너뛰고 Anthropic 직행
if (hasToolUse(request)) {
  return forwardToAnthropic(request);
}
```

### 5.2 extended thinking

Claude의 extended thinking(`thinking` 블록)은 Anthropic 전용이다. thinking이 요청된 경우에도 Anthropic 직행.

### 5.3 시스템 프롬프트 의존성

Claude Code의 시스템 프롬프트는 Claude 모델에 최적화되어 있다. 비-Claude 모델이 이 지시를 정확히 따르지 못할 수 있다.

**현실적 판단**: Claude Code 프록시의 경우 **Anthropic 모델 간 라우팅**(Haiku ↔ Sonnet ↔ Opus)이 가장 안전한 첫 번째 범위다. 크로스 프로바이더 라우팅은 2단계로 미룬다.

## 6. 구현 범위 (단계별)

### Phase 1: Anthropic 내부 라우팅 (MVP)

| 항목 | 설명 |
|------|------|
| **범위** | Haiku ↔ Sonnet ↔ Opus 자동 전환 |
| **분류기** | 규칙 기반 + Haiku LLM 폴백 |
| **포맷 변환** | 불필요 (모두 Anthropic) |
| **스트리밍** | 패스스루 (변환 불필요) |
| **tool_use** | 패스스루 (변환 불필요) |
| **구현량** | ~500 LOC |

이 단계에서 프록시는 **모델명만 재작성**하는 얇은 레이어다:

```typescript
// Claude Code가 보낸 요청
{ model: "claude-sonnet-4-20250514", messages: [...] }

// pyreez가 판단: 이 프롬프트는 simple → Haiku로 충분
// 모델명만 교체하여 Anthropic API로 포워딩
{ model: "claude-haiku-4-5-20251001", messages: [...] }

// 응답의 model 필드는 원본으로 복원
response.model = "claude-sonnet-4-20250514";
```

### Phase 2: 크로스 프로바이더 라우팅

| 항목 | 설명 |
|------|------|
| **범위** | Anthropic + Google + DeepSeek + Mistral 등 |
| **추가 구현** | 응답 포맷 변환, 스트리밍 변환 |
| **tool_use** | tool_use 시 Anthropic 강제 / 비tool_use 시 최적 모델 |
| **구현량** | ~1500 LOC 추가 |

### Phase 3: 학습 + 통계

| 항목 | 설명 |
|------|------|
| **범위** | 사용 패턴 학습, 비용 절감 대시보드 |
| **추가 구현** | Learning Layer 연동, /stats 엔드포인트 |
| **구현량** | ~500 LOC 추가 |

## 7. 파일 구조 (예상)

```
src/proxy/
├── server.ts              # Bun.serve() HTTP 프록시 메인
├── classifier.ts          # 2단계 분류기 (규칙 + LLM)
├── anthropic-compat.ts    # Anthropic Messages API 요청/응답 파싱
├── format-converter.ts    # OpenAI/Gemini → Anthropic 응답 변환
├── stream-converter.ts    # SSE 스트림 변환
├── model-spoof.ts         # 모델명 스푸핑 로직
└── stats.ts               # 라우팅 통계 수집
```

## 8. 기존 코드 재사용 목록

| 기존 모듈 | 위치 | 용도 |
|-----------|------|------|
| `DomainOverrideProfiler` | `src/axis/wrappers.ts` | domain → 21차원 역량 매핑 |
| `BtScoringSystem` | `src/axis/wrappers.ts` | 모델별 BT 점수 조회 |
| `TwoTrackCeSelector` | `src/axis/wrappers.ts` | 역량 매칭 → 모델 선택 |
| `LocalLearningLayer` | `src/axis/learning.ts` | 개인화 보정 |
| `ModelRegistry` | `src/model/registry.ts` | 모델 정보 + 비용 |
| `ProviderRegistry` | `src/llm/registry.ts` | 모델 → 프로바이더 라우팅 |
| `CooldownManager` | `src/deliberation/cooldown.ts` | 장애 모델 제외 |
| `scores/models.json` | — | 21차원 모델 점수 데이터 |

## 9. 경쟁 제품 대비 차별점

| | llmrouter | NadirClaw | **pyreez-proxy** |
|---|---|---|---|
| **분류 정밀도** | 5단계 복잡도 | 3단계 + 특수 감지 | **12 도메인 × 62 태스크 × 3 복잡도** |
| **모델 선택 근거** | YAML 수동 매핑 | 임베딩 유사도 | **21차원 BT 역량 매칭** |
| **학습** | 없음 | 없음 | **MF 기반 개인화** |
| **모델 점수** | 없음 | 없음 | **14차원 Bradley-Terry** |
| **장애 대응** | 없음 | 폴백 체인 | **Cooldown + 자동 제외** |
| **비용 최적화** | 비용 tier 고정 | 단순 임계값 | **pool-relative cost efficiency** |

## 10. 미결 사항

1. **Claude Code 내부 검증**: Claude Code가 응답의 model 필드 외에 다른 방식으로 모델을 검증하는지 확인 필요. API 키 유효성, 응답 헤더 등.
2. **멀티턴 컨텍스트**: 대화 중간에 모델이 바뀌면 이전 맥락과의 일관성 문제. 세션 내에서는 모델을 고정할지, 매 턴마다 재분류할지 정책 결정 필요.
3. **분류기 비용**: Haiku 분류기를 매 요청에 호출하면 월간 비용이 얼마인지 추정 필요. 규칙 기반 히트율이 70% 이상이면 실용적.
4. **Claude Code 버전 호환**: Claude Code 업데이트 시 API 형식 변경 가능성. Anthropic Messages API는 안정적이지만 Claude Code 고유 헤더/파라미터가 추가될 수 있음.
5. **Phase 1 한정 시 실질적 가치**: Anthropic 내부 라우팅만으로도 비용 절감 효과가 충분한지. Haiku와 Opus의 가격 차이가 62배(input 기준)이므로, 60%의 요청이 Haiku로 라우팅되면 **약 50% 비용 절감** 가능.
