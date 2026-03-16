# PLAN: 개선점

## 1. Cooldown 프로바이더 전파 누락

**현상**: `cooldown.addProvider()`가 `entries` 맵에 이미 등록된 모델만 쿨다운. 같은 프로바이더의 미등록 모델은 쿨다운 안 됨.

**영향**: retry 시 `selectTopModel`이 같은 프로바이더의 쿨다운 안 된 모델을 선택 → 429 재발 → 불필요한 API 호출 1회 추가. 자기 교정되지만 비용/지연 낭비.

**권장안**: `addProvider` 호출 시 `entries` 순회 대신, 쿨다운된 프로바이더 Set을 별도 관리. `isOnCooldown`에서 모델 ID 매칭 실패 시 프로바이더 Set도 확인.

```
// cooldown.ts
const cooledProviders = new Map<string, number>(); // provider → cooldownUntil

addProvider(modelId, reason, ttlMs?) {
  const provider = extractProvider(modelId);
  cooledProviders.set(provider, Date.now() + effectiveTtl);
  this.add(modelId, reason, "rate_limit", ttlMs);
}

isOnCooldown(modelId) {
  // 기존 개별 모델 체크
  const entry = entries.get(modelId);
  if (entry && Date.now() < entry.cooldownUntil) return true;
  // 프로바이더 레벨 체크
  const provider = extractProvider(modelId);
  const until = cooledProviders.get(provider);
  return until != null && Date.now() < until;
}
```

## 2. 프로바이더 장애 시 팀 다양성 상실

**현상**: 2026-03-16 deliberation 실측 — 5개 worker 중 3개 실패 (Google 429 ×2, Anthropic degenerate). retry 후 xAI 모델 2개만 남아 프로바이더 다양성 완전 소실.

**영향**: 동일 프로바이더 모델끼리 deliberation하면 훈련 편향이 겹쳐 다양한 시각 확보 불가. deliberation의 핵심 가치(다양성) 훼손.

**권장안**: 팀 구성 결과에 최소 프로바이더 수 제약 추가. 제약 미달 시 호스트에 경고 반환 (deliberation 자체는 진행하되 `warnings` 필드로 알림).

```
// 응답에 warnings 필드 추가
{
  "modelsUsed": ["xai/grok-4", "xai/grok-4-1-fast"],
  "warnings": ["provider_diversity_low: 1 provider (minimum 2 recommended)"],
  ...
}
```

## 3. Scoring System 기본 설정 부재

**현상**: MCP 서버가 scoring system 없이 시작되면 `pyreez_feedback`가 항상 에러 반환 (`"feedback not available"`). 서버 시작 시 `BtScoringSystem` 자동 생성 없음.

**영향**: 피드백 루프 단절. BT 레이팅 개선 불가. 호스트가 에러를 받아도 원인 파악 어려움.

**권장안**: `PyreezMcpServer` 생성자에서 scoring이 미제공 시 기본 `BtScoringSystem` 자동 생성. `scores/models.json` 경로를 기본값으로.

## 4. 통합 테스트 부재

**현상**: 855개 테스트 전부 mock 기반. 실제 LLM 프로바이더 호출 테스트 0건.

**영향**: 프로바이더 API 변경, 응답 포맷 변화, rate limit 동작 등을 자동 감지 불가. 프로덕션 장애를 수동 검증에 의존.

**권장안**: `test/integration/` 디렉토리에 환경변수 기반 스모크 테스트 추가. API 키 없으면 자동 skip.

```typescript
// test/integration/smoke.test.ts
import { describe, it, expect } from "bun:test";

const HAS_KEY = !!Bun.env.PYREEZ_XAI_KEY;

describe.skipIf(!HAS_KEY)("smoke: xai provider", () => {
  it("should complete a single-model deliberation", async () => {
    // 최소 1개 프로바이더로 실제 deliberation 실행
    // 응답 구조 검증 (content 존재, 토큰 카운트 > 0)
  });
});
```

## 5. report 모듈 미사용 인프라

**현상**: `src/report/types.ts`의 `CallRecord` 인터페이스 (leaderId 필드 포함)와 `FileReporter`가 정의되어 있으나 프로덕션에서 인스턴스화 안 됨. Reporter 인프라 전체가 죽은 상태.

**영향**: 코드 크기 증가, 타입 혼란 (leaderId 같은 구시대 필드 잔존). 기능적 영향 없음.

**권장안**: Reporter 기능을 실제로 사용할 계획이 있으면 leaderId 제거 후 활성화. 계획 없으면 모듈 전체 삭제.
