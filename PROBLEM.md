# pyreez 기능 문제 목록

코드 직접 읽기, 실제 실행 재현, 1차 자료(RFC·논문·공식 SDK 문서) 교차 검증으로 확정된 문제만 수록. 추측·블로그 합의만으로는 등재하지 않음.

---

## A. 코드 버그 (실행으로 재현 확인)

### B1. `config.ts:77-80` — xAI 키 없으면 시동 실패
```ts
if (Object.keys(config.providers).length === 0) {
  throw new Error("No LLM providers configured. Set PYREEZ_XAI_KEY.");
}
```
- `loadConfigFromEnv`이 `PYREEZ_XAI_KEY` 하나만 확인.
- Claude/Gemini/Codex CLI 공급자는 구독 기반(API 키 불필요)인데도, xAI 키 없으면 `cli.ts:93`의 `loadConfigFromEnv` 호출에서 throw.
- **재현**: `env -u PYREEZ_XAI_KEY bun -e '...loadConfigFromEnv()...'` → `THROW: No LLM providers configured. Set PYREEZ_XAI_KEY.`
- **영향**: CLI 전용 사용자 실행 불가.

### B2. `xai.ts:67` — truncation 감지 불가
```ts
finish_reason: result.finishReason === "stop" ? "stop" : "stop",
```
- 어떤 `finishReason` 값도 `"stop"`으로 매핑.
- `finish_reason: "length"` 감지 불가 → `createChatAdapter`의 `truncated` 플래그(wire.ts:92) 영구 false.
- **영향**: 잘린 응답을 정상으로 처리.

### B3. CLI 공급자 메시지 역할 경계 손실
- `claude-cli.ts:41-55`: user/assistant를 `[Assistant]:` 프리픽스 단일 문자열로 병합.
- `gemini-cli.ts:32-66`: system을 `${system}\n\n${prompt}`로 prompt에 재병합 → `system_instruction` 파라미터 미사용.
- `codex-cli.ts:32-46`: system·user·assistant 구분 없이 `parts.push`로 병합 → 역할 라벨 완전 소실.
- **재현**:
  ```
  CLAUDE: {"system":"SYS","prompt":"U1\n\n[Assistant]: A1\n\nU2"}
  GEMINI: {"system":"SYS","prompt":"U1\n\n[Assistant]: A1\n\nU2"}
  CODEX:  "SYS\n\nU1\n\n[Assistant]: A1\n\nU2"
  ```
- **영향**: 다중 턴/역할 기반 프롬프트 구조 붕괴. R2+ 디베이트의 `<other-positions>`·`<debate-so-far>`가 평평하게 전달됨.

---

## B. 외부 표준·1차 자료 일탈

### S1. 쿨다운 `Infinity` TTL — RFC 6585/9110 일탈
- `cooldown.ts:85`: `cooldownUntil: Infinity` — 세션 영구 배제.
- `llm/errors.ts:22-29`이 **이미 `Retry-After` 헤더를 `retryAfterMs`로 파싱**하지만 cooldown에서 사용하지 않음.
- RFC 6585 §4, RFC 9110 §10.2.3: Retry-After는 delay-seconds 또는 HTTP-date. 영구 아님.
- 업계 표준(OpenAI·Anthropic·Google 가이드): exponential backoff + jitter + Retry-After 준수.
- **영향**: 일시적 429/timeout으로도 모델이 세션 끝까지 배제됨. 자체 파싱한 retryAfterMs를 버림.

### S2. 단일 라운드 `stability=1.0` — Aragora 설계 일탈
- `inspect.ts:55-77`: 이전 라운드가 없으면 `stability=1.0` 반환.
- Aragora 원 CONVERGENCE.md: `min_rounds_before_check = 1 # don't check too early` — 체크 자체를 스킵.
- pyreez는 체크 스킵 대신 최대값을 가중합에 포함 → `computeConvergenceScore`에 0.2 구조적 inflation.
- **영향**: 단일 라운드 run에서 수렴 점수가 일관되게 부풀려짐.

### S3. 점수 정규식 파싱 — 공식 structured output API 미사용
- `engine.ts:882-884`:
  ```ts
  r.content.match(/(?:score|rating|점수|overall)\s*[:=]?\s*(\d+(?:\.\d+)?)/i)
    ?? r.content.match(/(\d+(?:\.\d+)?)\s*(?:\/\s*10|out of 10)/i)
    ?? r.content.match(/\*\*(\d+(?:\.\d+)?)\*\*\s*\/\s*10/i);
  ```
- Anthropic 공식: `output_format: {type:"json_schema"}` + `structured-outputs-2025-11-13` beta header.
- OpenAI Structured Outputs (2024-08~): 100% 스키마 준수 보장.
- pyreez는 자유형 LLM 출력에 정규식 → 포맷 일탈한 응답은 `score: undefined` → 가중평균 왜곡.

### S4. 공급자별 동시성 제어 부재
- `wire.ts:163` `MAX_WORKERS = 7` 전역 상한만 존재.
- 확립된 패턴:
  ```py
  semaphores = {"openai": Semaphore(50), "anthropic": Semaphore(20), "google": Semaphore(60)}
  buckets   = {"openai": TokenBucket(3500, 58.33), ...}
  ```
- 공급자별 RPM/TPM 상이: Anthropic 1000 RPM/4M TPM, OpenAI 3500/500K, Google 60/1.5K daily.
- **영향**: 같은 공급자 모델 여러 개가 팀에 포함되면 첫 라운드에서 동시 호출로 429 자초 → cooldown 영구 배제(S1과 결합).

### S5. 로그 페이지네이션 `slice(0, limit)` — 관측 관행 반대
- `run-logger.ts:103-105`, `file-store.ts:67-69`: 필터 후 앞부분 N개 반환.
- 파일명(yyyy-mm-dd) 오름차순 × append 순서 = **가장 오래된 N개**.
- AWS CloudWatch `GetLogEvents`: `startFromHead` 기본 false = "latest returned first".
- Elasticsearch 관례: `sort: [{@timestamp: desc}]`.
- **영향**: 디버깅 시 최근 실패를 못 보고 과거 기록부터 반환.

---

## C. 코드 관찰 사실 (재현 가능, 해석 무관)

### O1. 라우팅 pass-through — 핵심 가치 미구현
- `team-composer.ts:139-143`: `composeTeam`이 호스트 `modelIds`를 그대로 `workers`로 감쌈.
- `scoreModel`·`selectDiverseModels`는 `replenish` 정렬과 fuser 외에 deliberate 진입 경로에서 **호출되지 않음**.
- README가 광고하는 "PROFILE → SCORE → SELECT intelligent routing"은 구현되어 있지 않음.

### O2. `taskNature` dead field
- `types.ts:189` 정의, `shared-context.ts:36` 저장, `engine.ts:1148,1280` 전달.
- 그러나 `prompts.ts` 및 전 소스에서 `ctx.taskNature` 참조 **0건** (grep 확인).
- `ARTIFACT_TASKS` 세트도 `task-nature.ts`에 정의만 되고 `resolveTaskNature`는 호출처 없음.
- **영향**: 타입·상태 흐름만 존재, 실제 프롬프트 선택/분기 미연결. 삭제할지 연결할지 결단 안 됨.

### O3. Dead Levenshtein 계산 지속
- `engine.ts:1349-1353` 주석 원문: "r1Diversity ... empirical measurement ... text-distance thresholds dead in practice."
- 그럼에도 매 라운드 `computeR1Diversity`(1357), `detectMinorityDissent`, `detectConformity` 호출.
- **영향**: 저자 본인이 무용하다고 인정한 연산이 매 호출마다 수행됨.

### O4. `cross-validate.ts:62-70` 순차 await
```ts
for (const subject of responses) {
  const others = responses.filter((r) => r.id !== subject.id);
  const result = await judge(subject, others);  // 직렬
  findings.push(...);
}
```
- N개 독립 LLM judge 호출을 직렬 처리.
- `Promise.all` 또는 `Promise.allSettled`로 병렬화 가능.
- **영향**: 검증 지연 O(N) × judge latency.

### O5. `store.save` silent swallow
- `wire.ts:282-284`:
  ```ts
  } catch {
    // best-effort save — do not fail the deliberation
  }
  ```
- 저장 실패 시 로그도 메트릭도 없음.
- **영향**: 데이터 손실·분석 공백을 은폐.

---

## 검증 방법 요약

- **A. 코드 버그**: `bun -e`로 실제 실행해 입력·출력 확인.
- **B. 외부 표준 일탈**: 1차 자료 교차 검증.
  - RFC 6585/9110 원문 (IETF)
  - Aragora CONVERGENCE.md 원문 (synaptent/aragora GitHub)
  - Anthropic/OpenAI 공식 structured output 문서
  - AWS CloudWatch GetLogEvents SDK 소스
- **C. 코드 관찰 사실**: grep·직접 인용·주석 원문 제시.

## 등재 제외 사유

다음 항목은 이전 분석에서 "부자연"·"문제"로 지목했으나 검증 후 철회:

| 항목 | 철회 사유 |
|------|-----------|
| 평가 프로토콜 `temperature: 1.0` 하드코딩 | arXiv 2603.28304: 0.1/1.0이 "the most prevalent choices", lower ≠ universally better |
| sparse 고정 `groupSize=2` | Sparse-MAD 문헌상 고정 크기도 유효 변형 |
| evidence overlap citation-only | Aragora 원 정의와 동일. 상속 한계지 pyreez 결함 아님 |
| confidence 파싱 "1 LOW가 HIGH 뒤집음" | 재현 실패. standalone 토큰 regex 불일치 |
| `count>models.length` 모델 복제 | `wire.ts:205-208` 주석상 명시적 동작 |
| `ProviderName` 4개만 | `models.jsonc` 실제 4개 공급자와 일치 |
| fallback 동일 공급자 우선 | `isProviderScopedError` 분기로 합리화 |
| R2+ replenishment 미수행 | 콜드 조인 방지 합리 |

## 참고 자료

- [RFC 6585 §4 (IETF)](https://www.rfc-editor.org/rfc/rfc6585#section-4)
- [RFC 9110 §10.2.3 Retry-After](https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3)
- [synaptent/aragora CONVERGENCE.md](https://github.com/synaptent/aragora/blob/main/docs/algorithms/CONVERGENCE.md)
- [Anthropic Structured Outputs](https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs)
- [AWS CloudWatch GetLogEvents](https://github.com/aws/aws-sdk-go-v2/blob/main/service/cloudwatchlogs/api_op_GetLogEvents.go)
- [arXiv 2603.28304 — The Necessity of Setting Temperature in LLM-as-a-Judge](https://arxiv.org/pdf/2603.28304)
