## Deliberation Resilience

**retryAfterMs 상한**
- `src/llm/client.ts`: `Retry-After` 헤더 값에 상한(30 s) 적용
- `src/deliberation/wire.ts`: `chatAdapter` 에 `maxRetryAfterMs` 옵션 전달

**retryDeps 연결**
- `src/deliberation/wire.ts`: `deliberate()` 5번째 인자 `retryDeps` 전달 (cooldown + getModels)

**Reviewer 장애 처리**
- `src/deliberation/engine.ts`: 모든 reviewer 가 실패하면 라운드 중단
- `src/deliberation/engine.ts`: reviewer 교체/승격 로직 추가