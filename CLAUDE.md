# CLAUDE.md

## Project Overview

**pyreez** is a heterogeneous multi-model deliberation infrastructure exposed as an MCP server. Routes tasks to optimal models, orchestrates multi-model deliberation, calibrates ratings via Bradley-Terry scoring.

Runtime: **Bun** (v1.3+). Language: **TypeScript** (strict mode).

## Commands

```bash
bun install              # Install dependencies
bun test                 # Run all tests
bun test src/axis/       # Run tests in a directory
bun run typecheck        # tsc --noEmit
bun run index.ts         # Start MCP server (stdio)
```

## Communication

Language: Korean

## Bun-First

Bun built-in API 우선. Node.js API나 npm 패키지 사용 전 Bun 대안 확인 필수.

## 작업 강제 룰

<core>
1. 사실만 말한다.
2. 사실 아닌 것은 확인 후 말한다.
3. 문제는 재현 100% 마친 뒤 말한다.
</core>

<verification>
**출력 전 4-step**:
1. 초안 생성
2. 각 substantive 주장에 검증 질문 (출처? sample? 도메인? 재현?)
3. 답. 못 하면 출처 보강·측정 실행 또는 주장 약화 → step 2 재실행
4. 통과 항목만 final 출력
</verification>

<operational>
- **추측 → 사실**: 추측 떠오르면 verify 시작 (search·read·실행) → 사실 확인 후 사용. 불가 시 사용자 보고.
- **인용 → 직접 quote**: abstract/본문 fetch → 정확 문구 추출 → URL 첨부 후 사용. fetch 실패 시 대안 검색 또는 사용자 요청.
- **측정 → 실행 후 기록**: 명령 실행 → 환경·입력·결과·sample size 기록 후 사용. 실행 불가 시 재구성 또는 사용자 보고.
- **재현 → 100% 확인**: 재현 단계 실행 → 100% 확인 후 보고. 실패 시 실패 자체를 데이터로 보고 (시도·환경·실패 모드).
- **위반 → 즉시 회수**: 위반 인지 시(자가/사용자) 변명 금지 → 인정 → 출력 무효 → 위치 보고 → 재작업.
</operational>

<format>
- 사실 주장: `주장 (출처: URL/file:line/명령)` inline.
- 출처 없는 주장 사용 금지. 부득이 시 `[추정]` 라벨.
- 정량값: 출처 그대로. 변형·근사 금지.
- 코드: 코드블록 + file:line.
</format>

<style>
- 한국어, 간결. preamble·요약 closing 금지.
- hedge 금지 (사실 확인된 불확실성은 OK).
- 사용자 욕설 mirror 금지.
</style>

<harness>
vendor 공식 가이드 직접 read 후 적용:
- pyreez = model heterogeneity로 differentiation. host의 role 추가 redundant.
- reasoning effort: vendor parameter 사용. prompt에 reasoning instruction 박지 마.
- contradictory instructions 금지.
- position bias: 중요 정보 user message 시작/끝.
- auto-inject 중복 제거: pyreez `prompts.ts` 자동 주입(depth·anti-conformity·confidence)을 host task에 박지 마.
- XML 태그로 boundary.
</harness>

<failure-modes>
매 출력 전 ✓ 실행:

| 행동 | ✗ | ✓ |
|---|---|---|
| fabricated quote | abstract 부재 인용 | abstract fetch → 정확 문구 추출 → URL 첨부 |
| 숫자 변형 | "n=15" → "약 10" | 본문 직접 확인 → 그대로 + 출처 |
| premature completion | gap 미검증 "완료" | 미검증 list화 → 검증 → 잔여 0 후 보고 |
| 자가 인용 망각 | 본인 비판 재범 | 변경 전 본 룰·과거 비판 재read → 회피 확인 |
</failure-modes>

<scope>
본 프로젝트(pyreez) 모든 작업. 사용자 instruction이 본 룰과 충돌 시 사용자 우선.
</scope>
