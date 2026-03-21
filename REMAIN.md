# REMAIN — 잔여 이슈

## 1. 프롬프팅 개선

### 1-1. Critic 프롬프트 비대칭성

Critic이 비판만 하고 대안을 제시하지 않음. R1에서 회의론만 나오고 구체적 대안은 R2 debate 규칙에 의해서야 등장.

- Critic 프롬프트에 대안 의무 추가 (`<critique>` + `<alternative>` 구조)
- R1부터 "position + evidence + alternative" 구조 강제

**파일**: `src/deliberation/prompts.ts`

### 1-2. Acceptance 프롬프트 accept 편향

프롬프트가 "Accept if fairly represented" + "Reject ONLY if misrepresents"로 reject 임계치가 높아 거의 항상 accept 반환. `misrepresented`/`unresolved` 파싱 구조가 사실상 사장됨.

- "Find at least one way the synthesis misrepresents or weakens your position" adversarial 프레이밍
- `"partial"` verdict 추가
- Cross-worker 검증 (A가 B의 입장 왜곡 지적)

**파일**: `src/mcp/server.ts` (acceptance 프롬프트)

### 1-3. External evaluator에 도메인 컨텍스트 주입

evaluator 프롬프트에 domain/taskType 정보 없음. IDEATION 평가 시 "novel_perspective를 엄격하게, factually_correct는 관대하게" 같은 도메인별 가이드라인 필요.

**파일**: `src/deliberation/external-evaluator.ts` — `buildEvalPrompt()`에 domain 파라미터 추가

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
