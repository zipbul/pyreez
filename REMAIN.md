# REMAIN — 미확정 사항 및 잔여 이슈

## 1. Debate 최소 성공 워커 수 미적용

**현상**: debate 라운드에서 워커 1개만 성공해도 라운드가 완료 처리됨. 라운드 2에서 "상호 반박"할 대상이 1개뿐이므로 debate의 가치(다양한 관점 충돌)가 없음. diverge-synth와 동일한 결과를 debate 비용으로 얻는 꼴.

**실측**: 2026-03-17 monorepo vs polyrepo deliberation — 라운드 1에서 5개 워커 중 4개 실패(Google 429 ×2, local 미설치, Anthropic degenerate). 1개 응답만으로 라운드 완료 후 라운드 2 진행.

**파일**: `src/deliberation/engine.ts` — `executeRound`에서 전원 실패만 체크, 최소 성공 수 없음.

**권장안**: debate 프로토콜에 최소 성공 워커 수(예: 2) 적용. 미달 시 retry 또는 diverge-synth로 자동 전환.

## 2. 프로바이더 다양성 부재 시 debate 가치 없음

**현상**: 실패한 모델 교체 후 팀이 단일 프로바이더(xAI)로만 구성됨. warnings 필드가 추가됐지만, 단일 프로바이더 debate는 훈련 편향이 겹쳐 다양한 시각 확보 불가.

**실측**: 위와 동일 세션. Google/Anthropic/local 모두 탈락, xAI 3개 모델만 남음.

**권장안**: warnings를 넘어서, 프로바이더 다양성이 임계값 미달이면 protocol을 debate→diverge-synth로 자동 다운그레이드. debate 비용을 절약하고 결과 품질 기대치를 호스트에 명확히 전달.

## 3. 워크플로우 도구 매핑 (미확정)

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

## 4. zipbul 생태계 전체 맵

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

## 5. 미적용 고급 기능

| 기능 | 상태 | 메모 |
|------|------|------|
| Agent Teams | 실험적 | 병렬 협업. 토큰 비용 높음. 대기 |
| Skill `context: fork` | 안정 | 숙의 스킬을 격리된 서브에이전트에서 실행 |
| Agent SDK | 안정 | CI/CD 자동화, 배치 작업용 |
| Skill `!command` 동적 주입 | 안정 | 스킬 실행 시 라이브 데이터 주입 |
| Plugin 마켓플레이스 | 안정 | 배포 채널. zipbul 프레임워크 완성 후 고려 |
