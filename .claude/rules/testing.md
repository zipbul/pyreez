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
| Integration | `*.test.ts` | `test/integration/` | 모듈 간 조합 |

## Runner & Doubles

- `bun:test` only. `spyOn()`, `mock()`, `mock.module()` 사용.
- Mock 전략: DI 주입 → `mock.module()` → DI 리팩토링 제안. "mocking이 어려워서" 실제 실행은 금지.
- `mock.module()`은 프로세스 전역 모듈 레지스트리를 덮어쓰고 파일 간 복원되지 않는다 — 같은 `bun test` 프로세스에서 그 모듈을 real로 쓰는 다른 파일까지 오염시킨다(실제 사고: `wire.spec.ts`가 `./engine`/`./team-composer`를 mock.module로 스텁, 복원 없이 다른 통합테스트 파일에 잔류 → 파일 배치에 따라 증상이 달라져 원인 추적이 어려웠음). `afterAll(() => mock.restore())`로도 복구 안 됨(오염된 바인딩이 import 시점에 이미 캐시됨) — 해결은 DI: SUT의 협력자를 옵션 필드로 주입 가능하게 만들고(실호출자는 기본값=real 그대로 사용), 테스트는 mock.module 없이 그 필드에 직접 fake를 넘긴다.

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
