---
paths:
  - "**/*.spec.ts"
  - "**/*.test.ts"
  - "test/**"
---

# Test Standards

## Priority

Integration > Unit > E2E. 모듈 간 연결이 핵심인 프로젝트. 통합 테스트를 먼저 작성하고, 복잡한 로직 격리가 필요할 때만 유닛 추가.

## Layers

| Layer | Pattern | Location | SUT |
|-------|---------|----------|-----|
| Unit | `*.spec.ts` | 소스 옆 colocated | 단일 export |
| Integration | `*.test.ts` | `test/` | 모듈 간 조합 |

## Runner & Doubles

- `bun:test` only. `spyOn()`, `mock()`, `mock.module()` 사용.
- Mock 전략: DI 주입 → `mock.module()` → DI 리팩토링 제안. "mocking이 어려워서" 실제 실행은 금지.

## Isolation

- **Unit**: 외부 의존성 전부 test-double. 실제 I/O 절대 금지 (temp dir + cleanup 포함).
- **Integration**: SUT 경계 내부는 real, 외부는 test-double. 외부 서비스(API, DB)는 항상 test-double.

## TDD 적용 기준

| 상황 | RED→GREEN |
|------|-----------|
| 버그 수정 | 필수 — 실패 재현 후 수정 |
| 새 공개 API | 필수 — 계약 먼저 정의 |
| 내부 리팩토링 | 불필요 — 기존 테스트가 가드 |
| 탐색적 코딩 | 불필요 |

## Coverage

모든 SUT 브랜치(if/else/switch/early return/throw/catch/ternary/?./??/)에 대응하는 `it`이 있어야 한다. 경계값(empty, zero, null, max) 테스트 필수.
