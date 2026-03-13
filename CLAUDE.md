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

Language: Korean (한국어).

## Bun-First

Bun built-in API 우선. Node.js API나 npm 패키지 사용 전 Bun 대안 확인 필수.

## Write Gate

파일 수정 전 승인 필요. 승인 토큰: `ㅇㅇ`. Targets, Risks, Alternatives 제시 후 `ㅇㅇ` 받을 것. 승인 범위 밖 수정 시 재승인.

## Search Policy

외부 정보 기반 판단 시 2개 이상 소스 교차 검증. 단일 소스 판단 금지. 검증 실패 시 "모름" 보고.
