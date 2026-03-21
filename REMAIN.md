# REMAIN — 잔여 이슈

## 1. 프롬프팅 개선

### 1-1. Acceptance Cross-worker 검증

현재 acceptance는 각 worker가 자기 입장만 검증. A가 B의 입장 왜곡을 지적하는 cross-worker 검증이 없음.

- Cross-worker 검증 (A가 B의 입장 왜곡 지적)

**파일**: `src/mcp/server.ts`, `src/deliberation/prompts.ts`

---

## 2. Debate 자동 다운그레이드

debate가 유지 불가능할 때 (min_viable 미달 또는 단일 provider) diverge-synth로 자동 전환. 현재는 검증 없이 debate를 그대로 실행하고 사후 경고만 출력.

- provider 다양성 임계값 미달 시 debate→diverge-synth 다운그레이드
- debate 비용 절약 + 결과 품질 기대치 명확 전달

**파일**: `src/deliberation/wire.ts`, `src/deliberation/engine.ts`

---

## 3. Provider 분산 강화

`team-composer.ts`의 `maxPerProvider = Math.ceil(count / 2)`. 5명 팀에서 동일 provider 3명 허용 → provider 장애 시 3명 동시 손실.

- `maxPerProvider = 1`로 강화하면 provider 장애 시 최대 1명만 손실
- 가용 provider 수가 부족할 때의 fallback 정책 필요

**파일**: `src/deliberation/team-composer.ts:399-400`

---

## 4. 워크플로우 도구 매핑 (미확정)

| 단계 | 후보 도구 | 비고 |
|------|----------|------|
| Ideate | Skill (`pyreez` 숙의) | 이미 구현됨 |
| Plan | EnterPlanMode (빌트인) | Claude Code 내장 |
| Spec | MCP (Emberdeck) | 카드 CRUD, 이미 구현됨 |
| Analyze | Rule | 매 수정 전 자동 적용 |
| Test ↔ Implement | Rule + Hook | Rule로 플로우 명시, Hook으로 검증 강제 |
| Verify | Hook (`PostToolUse(Edit)`) | 편집 후 자동 `bun test` + `bun run typecheck` |
| Commit | Rule | 기존 workflow.md |
| Ralph Loop | Rule | 완료 조건 + 반복 구간 명시 |
| No Test Tampering | Hook (`PreToolUse(Edit)`) | 테스트 파일 삭제/비활성화 차단 |
| Reflection | Custom Agent | 읽기전용 리뷰어 에이전트 |

---

## 5. zipbul 생태계 전체 맵

```
제품 레이어:  zipbul(웹 프레임워크) ← baker(검증), toolkit(유틸), cookie, helmet
도구 레이어:  firebat(품질), pyreez(숙의), emberdeck(스펙), gildash(인덱싱), playground(워크플로우CLI)
미착수:      agent-rules
```

### 부트스트래핑 순서
1. **gildash** — 가장 기반. firebat, emberdeck 둘 다 의존
2. **firebat** — 코드 리뷰 자동화
3. **emberdeck** — 컨텍스트 유지
4. **pyreez** — 어려운 판단 보조

---

## 6. 미적용 고급 기능

| 기능 | 상태 | 메모 |
|------|------|------|
| Agent Teams | 실험적 | 병렬 협업. 토큰 비용 높음. 대기 |
| Skill `context: fork` | 안정 | 숙의 스킬을 격리된 서브에이전트에서 실행 |
| Agent SDK | 안정 | CI/CD 자동화, 배치 작업용 |
| Skill `!command` 동적 주입 | 안정 | 스킬 실행 시 라이브 데이터 주입 |
| Plugin 마켓플레이스 | 안정 | 배포 채널. zipbul 프레임워크 완성 후 고려 |
