# REMAIN_1: 코드베이스 이슈 및 수정 계획

## TODO 1. `scoring`/`chatFn` MCP 서버 미주입 [치명]

**파일**: `src/index.ts:209-216`
**현상**: `PyreezMcpServer` 생성 시 `scoring`과 `chatFn`이 전달되지 않아 `pyreez_feedback`와 `pyreez_acceptance` 툴이 항상 에러 반환.
**검증**: `server.ts:689` — `if (!this.scoring)` → `"feedback not available"`, `server.ts:641` — `if (!this.chatFn)` → `"acceptance not available"`

**수정안**:
```typescript
// src/index.ts — PyreezMcpServer 생성부
const server = new PyreezMcpServer({
  mcpServer,
  registry,
  deliberateFn,
  deliberationStore,
  runLogger,
  engine,
  scoring,                                                          // 추가
  chatFn: (model, messages, params) => chatAdapter(model, messages, params),  // 추가
});
```

---

## TODO 2. DivergeSynthProtocol이 미구성 프로바이더 모델 사용 [높음]

**파일**: `src/index.ts:140`, `src/axis/wrappers.ts:500-508`, `src/axis/wrappers.ts:549-551`
**현상**: `DivergeSynthProtocol`에 raw `registry`가 전달됨. 팀 패딩(`wrappers.ts:502`)과 retry(`wrappers.ts:551`)에서 API 키 미구성 프로바이더의 모델이 선택되어 chat 실패.

**수정안**: `DivergeSynthProtocol`에 전체 registry 대신 필터된 registry 전달.
```typescript
// src/index.ts:140 — 변경
const deliberation = new DivergeSynthProtocol({
  maxRounds: 1,
  registry: filteredRegistry as unknown as ModelRegistry,  // filteredRegistry 사용
  cooldown: sharedCooldown,
});
```

단, `filteredRegistry`는 현재 `{ getAll, getAvailable, getById }` 인터페이스. `DivergeSynthProtocol`이 `ModelRegistry` 타입을 요구하므로, registry 의존성을 인터페이스로 변경 필요:
```typescript
// src/axis/wrappers.ts — DivergeSynthProtocolOptions
readonly registry?: {
  getAvailable(): ModelInfo[];
  getById(id: string): ModelInfo | undefined;
};
```

---

## TODO 3. Cooldown 프로바이더 전파 누락 [높음]

**파일**: `src/deliberation/cooldown.ts:113-131`
**현상**: `addProvider()`가 `entries` 맵에 이미 존재하는 모델만 쿨다운. 같은 프로바이더의 미등록 모델은 쿨다운 안 됨.

**수정안**: 프로바이더 레벨 쿨다운 Set 별도 관리.
```typescript
// cooldown.ts — createCooldownManager 내부에 추가
const cooledProviders = new Map<string, number>(); // provider → cooldownUntil

// addProvider 수정
addProvider(modelId: string, reason: string, ttlMs?: number): void {
  const provider = extractProvider(modelId);
  const effectiveTtl = ttlMs ?? ERROR_TYPE_TTL.rate_limit;
  cooledProviders.set(provider, Date.now() + effectiveTtl);
  // 기존 entries 순회 로직 유지 (이미 등록된 모델도 개별 쿨다운)
  for (const [id] of entries) { ... }
  this.add(modelId, reason, "rate_limit", ttlMs);
},

// isOnCooldown 수정
isOnCooldown(modelId: string): boolean {
  // 개별 모델 체크 (기존)
  const entry = entries.get(modelId);
  if (entry && Date.now() < entry.cooldownUntil) return true;
  if (entry && Date.now() >= entry.cooldownUntil) entries.delete(modelId);
  // 프로바이더 레벨 체크 (신규)
  const provider = extractProvider(modelId);
  const until = cooledProviders.get(provider);
  if (until != null && Date.now() < until) return true;
  if (until != null) cooledProviders.delete(provider);
  return false;
},

// getCooledDownIds에서도 cooledProviders 만료 정리 추가
getCooledDownIds(): ReadonlySet<string> {
  const now = Date.now();
  // 기존 entries 정리 (그대로)
  ...
  // cooledProviders 만료 정리
  for (const [provider, until] of cooledProviders) {
    if (now >= until) cooledProviders.delete(provider);
  }
  return active;
},

// getEntry()에서도 프로바이더 레벨 확인 추가 필요
```

---

## TODO 4. 0개 모델로 서버 시작 가능 [중간]

**파일**: `src/index.ts:133`
**현상**: `filterModelsByProviders()` 반환값의 `warnings`가 무시됨. `modelIds = []`이어도 서버 시작 → 모든 MCP 호출이 런타임 실패.

**수정안**:
```typescript
// src/index.ts:133 — 변경
const { modelIds, warnings } = filterModelsByProviders(registry, providers);
for (const w of warnings) console.warn(`[pyreez] ${w}`);
if (modelIds.length === 0) {
  console.error("[pyreez] No models available. Check API keys and scores/models.json.");
  process.exit(1);
}
```

---

## TODO 5. 프로바이더 다양성 상실 경고 없음 [중간]

**파일**: `src/deliberation/engine.ts:343` (return 직전), `src/axis/wrappers.ts:554-563`
**현상**: retry 후 팀이 단일 프로바이더 모델만으로 구성되어도 경고 없음. deliberation 결과에 다양성 상태 정보 없음.

**수정안**: `DeliberateOutput`에 `warnings` 필드 추가.
```typescript
// src/deliberation/types.ts — DeliberateOutput에 추가
warnings?: string[];

// src/deliberation/engine.ts — deliberate() 함수 마지막, return 직전
const providers = new Set(modelsUsed(ctx).map(id => id.split("/")[0]));
const warnings: string[] = [];
if (providers.size < 2 && modelsUsed(ctx).length >= 2) {
  warnings.push(`provider_diversity_low: ${providers.size} provider(s) — minimum 2 recommended`);
}

return {
  ...output,
  ...(warnings.length > 0 ? { warnings } : {}),
};
```

---

## TODO 6. Debate 프롬프트 XML 이스케이프 없음 [중간]

**파일**: `src/deliberation/prompts.ts:256`
**현상**: 워커 LLM 응답이 XML 템플릿에 이스케이프 없이 삽입. `</worker>` 포함 응답 시 구조 붕괴.

**수정안**: XML 특수문자 이스케이프 헬퍼 추가.
```typescript
// src/deliberation/prompts.ts — 헬퍼 추가
function escapeXmlContent(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 256행 수정
.map((r) => `<worker role="${r.role ?? "worker"}">\n${escapeXmlContent(extractDebateDigest(r.content))}\n</worker>`)
```

**주의**: `extractDebateDigest`가 `<position>`, `<evidence>` 태그를 추출하므로, 이스케이프는 digest 결과에 적용해야 함. 올바른 접근: digest를 plain text로 변환 후 `escapeXmlContent` 적용.
```typescript
// extractDebateDigest에서 태그 제거 후 plain text 반환하도록 변경
function extractDebateDigest(content: string): string {
  const position = content.match(/<position>([\s\S]*?)<\/position>/);
  const evidence = content.match(/<evidence>([\s\S]*?)<\/evidence>/);
  if (position?.[1] || evidence?.[1]) {
    const parts: string[] = [];
    if (position?.[1]) parts.push(`Position: ${position[1].trim()}`);
    if (evidence?.[1]) parts.push(`Evidence: ${evidence[1].trim()}`);
    return parts.join("\n");
  }
  return content.split("\n").slice(0, 3).join("\n").trim();
}

// 256행: plain text digest + escapeXmlContent 이중 적용
.map((r) => `<worker role="${r.role ?? "worker"}">\n${escapeXmlContent(extractDebateDigest(r.content))}\n</worker>`)
```
`extractDebateDigest`는 `prompts.ts:256`에서만 호출되므로 plain text 변환으로 인한 하위 호환성 문제 없음.

---

## TODO 7. Acceptance 전체 실패 시 빈 성공 응답 [중간]

**파일**: `src/mcp/server.ts:667-675`
**현상**: `Promise.allSettled` 결과가 전부 rejected이면 `workers: []`가 성공으로 반환됨. 호스트가 "검증 통과"와 "전원 실패"를 구분 불가.

**수정안**:
```typescript
// server.ts — handleAcceptance 내, workers 생성 후
const failed = results.filter((r) => r.status === "rejected");
if (workers.length === 0 && failed.length > 0) {
  return this.errorResult(JSON.stringify({
    error: `All ${failed.length} acceptance check(s) failed`,
    failedModels: args.workers.map(w => w.model),
  }));
}
```

---

## TODO 8. 통합 테스트 부재 [중간]

**현상**: 855개 테스트 전부 mock 기반. 실제 LLM 프로바이더 호출 0건.

**수정안**: `test/integration/` 디렉토리에 환경변수 기반 스모크 테스트 추가.
```typescript
// test/integration/smoke.test.ts
import { describe, it, expect } from "bun:test";

const HAS_KEY = !!Bun.env.PYREEZ_XAI_KEY || !!Bun.env.PYREEZ_GOOGLE_API_KEY;

describe.skipIf(!HAS_KEY)("smoke: provider connectivity", () => {
  it("should complete a single-model chat call", async () => {
    // 최소 1개 프로바이더로 실제 chat 호출
    // 응답 존재 + 토큰 > 0 검증
  });

  it("should complete a 2-model deliberation", async () => {
    // 2개 모델 deliberation → roundsExecuted >= 1
  });
});
```

---

## TODO 9. Report 모듈 미사용 + leaderId 잔재 [낮음]

**파일**: `src/report/types.ts:36`, `src/report/reporter.ts`, `src/report/file-reporter.ts`
**현상**: `CallRecord.leaderId` 필드, `ContextMetrics.estimatedWaste` 주석의 "Team Leader" 표현, `InMemoryReporter`, `FileReporter` 전부 프로덕션 미사용.

**수정안**: 두 가지 선택지.
- **A) 삭제**: `reporter.ts`, `file-reporter.ts` 삭제. `types.ts`에서 `CallRecord`, `Reporter`, `ModelSummary`, `ReportSummary` 제거. `FileIO`, `ContextMetrics`만 유지 (RunLogger가 FileIO 사용).
- **B) 활성화**: `leaderId` 제거, "Team Leader" 주석 수정 후 deliberation 결과를 `FileReporter`로 기록하도록 연결.

**권장**: A (삭제). 필요 시 git에서 복원 가능.

---

## TODO 10. extractProvider 중복 정의 [낮음]

**파일**: `src/deliberation/cooldown.ts:74-76`, `src/deliberation/team-composer.ts:66-72`
**현상**: 동일 로직이 두 파일에 독립 정의. `split` vs `indexOf` 미묘한 구현 차이.

**수정안**: 공통 유틸로 추출.
```typescript
// src/deliberation/provider-util.ts (신규)
export function extractProvider(modelId: string): string {
  const idx = modelId.indexOf("/");
  return idx === -1 ? modelId : modelId.slice(0, idx);
}

// cooldown.ts, team-composer.ts에서 import 변경
```

---

## TODO 11. Debate retry 시 퇴장 워커 컨텍스트 잔존 [낮음]

**파일**: `src/deliberation/engine.ts:277-282`
**현상**: retry로 팀 교체 후, 이전 라운드의 퇴장 워커 응답이 새 SharedContext에 보존. 새 워커가 debate 모드에서 알 수 없는 모델의 응답을 참조.

**수정안**: debate 모드에서 retry 시 이전 라운드 보존하지 않음.
```typescript
// engine.ts — retry 블록 내
const previousRounds = cfg.protocol === "debate" ? [] : [...ctx.rounds];
ctx = createSharedContext(input.task, currentTeam, input.taskNature);
for (const prevRound of previousRounds) {
  ctx = addRound(ctx, prevRound);
}
```
diverge-synth 모드에서는 이전 라운드가 프롬프트에 포함되지 않으므로 보존해도 무방.
