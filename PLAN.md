# PLAN: 리더 폐기 + 호스트-리더 아키텍처

## 배경

논의를 통해 다음이 확정됨:

1. **리더 폐기** — 호스트(Claude Code 등)가 합성을 수행. 내부 리더 LLM 호출 제거.
2. **debate 시 구조화 요약 공유** — worker 간 전체 응답 대신 `<position>` + `<evidence>` 추출본 공유. 비용 60% 절감.
3. **acceptance 라운드** — 호스트 합성 후 worker가 accept/reject 검증. 별도 MCP 도구 `pyreez_acceptance`로 노출.
4. **BT 피드백 루프** — 호스트가 worker 품질 피드백을 별도 도구 `pyreez_feedback`으로 전달.
5. **멀티 팀 미구현** — 호스트가 pyreez를 여러 번 호출하는 것으로 충분.
6. **.github/skills, .github/agents 삭제** — 팬텀 도구 참조 + 구 리더 플로우. 삭제 완료.

## 아키텍처 변경

```
Before:
  Host → pyreez → [Workers] → Leader(LLM) → synthesis → Host
                                ↑ 비용 40~50%, 호스트보다 낮은 품질

After:
  Host → pyreez → [Workers] → responses → Host(합성 + 검증)
                                            ↓ (필요시)
                                          pyreez_acceptance → [Workers] → acceptance
                                            ↓
                                          Host(확정)
                                            ↓
                                          pyreez_feedback → BT 업데이트
```

## 플로우

```
1. Diverge:    Worker A, B, C 병렬 (독립 응답)
2. Debate:     Worker A, B, C 병렬 (position+evidence 상호 공유, 반박) [선택적]
3. Host 합성:  호스트가 fact-check + 합성
4. Acceptance: Worker A, B, C 병렬 (합성 검증, accept/reject) [선택적]
5. Host 확정:  reject 사유 반영 후 최종 결과
6. Feedback:   호스트 → pyreez_feedback (BT 업데이트)
```

---

## TODO

### Phase 1: 리더 제거 + MCP 스키마 정리

> 리더 관련 코드 전체 제거 + MCP 입출력 동시 정리.
> 각 스텝 완료 후 `bun run typecheck` 통과 필수. 기존 테스트 수정을 동반.
> 시작 전 `git tag pre-leader-removal` 생성 (롤백 지점).

- [x] **1.1** `src/deliberation/types.ts` — 리더 관련 타입 제거
  - `TeamRole`에서 `"leader"` 제거 → `type TeamRole = "worker"`
  - `Synthesis` 인터페이스 삭제
  - `ConsensusMode` 타입 삭제
  - `TeamComposition`에서 `leader` 필드 제거 → `{ workers: readonly TeamMember[] }`
  - `DeliberateInput`에서 `leaderInstructions`, `consensus`, `leaderContributes` 제거
  - `DeliberateOutput`에서 `result: string` 제거, `consensusReached` 제거
  - `Round`에서 `synthesis?: Synthesis` 제거
  - 동반 테스트 수정: `shared-context.spec.ts`, `engine.spec.ts`, `wire.spec.ts`

- [x] **1.1b** `src/axis/types.ts` — `DeliberationResult` 리더 필드 제거
  - `result: string` 제거 (리더 합성 결과)
  - `consensusReached: boolean | null` 제거
  - `rounds[].synthesis?: string` 제거
  - `protocol` 값에서 `"leader_decides"` 의미 제거 (실제 deliberation protocol만 남김)

- [x] **1.1c** `src/axis/interfaces.ts` — `DeliberationOverrides` 리더 필드 제거
  - `consensus?: "leader_decides"` 제거
  - `leaderContributes?: boolean` 제거
  - `leaderInstructions?: string` 제거

- [x] **1.1d** `src/deliberation/store-types.ts` — `DeliberationRecord` 리더 필드 정리
  - `result: string` 제거
  - `consensusReached: boolean | null` 제거
  - `leaderInstructions?: string` 제거
  - `consensus?: string` 제거
  - `roundsSummary` 내 `synthesis?: string` 제거
  - `DeliberationQuery`에서 `consensusReached?: boolean` 제거
  - `src/deliberation/file-store.ts` — `q.consensusReached` 쿼리 필터 로직 제거
  - 동반 테스트 수정: `file-store.spec.ts`

- [x] **1.2** `engine.ts` — 리더 호출 로직 전체 제거
  - `parseSynthesis` 함수 삭제
  - `extractJsonObject`, `stripJsonWrapping`, `stripDeliberationBlock` 삭제
  - `retryLeaderOnce` 함수 삭제
  - `executeRound`에서 "2. Leader" 블록 전체 제거 (`partialRound` ~ leader synthesis return)
  - `validateSynthesisStructure`, `buildRetryHint` import 및 호출 제거
  - `EngineDeps`에서 `buildLeaderMessages` 제거
  - `EngineConfig`에서 `consensus`, `leaderContributes`, `structuralTags`, `leaderGenParams` 제거
  - `deliberate()`에서 consensus 루프 제거 → 고정 라운드만 지원
  - `deliberate()` 반환값에서 `result` (leader synthesis), `consensusReached` 제거
  - `deliberate()` retry 로직에서 `currentTeam.leader` 참조 제거 (leader 교체 → worker 교체로 통일)
  - `RoundExecutionError.role`에서 `"leader"` 제거
  - 동반 테스트 수정: `engine.spec.ts`

- [x] **1.3** `synthesis-validator.ts` + `synthesis-validator.spec.ts` 전체 삭제

- [x] **1.4** `prompts.ts` — 리더 프롬프트 전체 삭제
  - `LEADER_OBLIGATIONS`, `LEADER_CRITIQUE_OUTPUT`, `LEADER_DEFAULT`, `LEADER_SUFFIX` 삭제
  - `LEADER_ARTIFACT`, `LEADER_ARTIFACT_SUFFIX` 삭제
  - `DEBATE_INTERMEDIATE_LEADER` 삭제
  - `buildLeaderMessages` 함수 삭제
  - `extractSummary` 보존 (Phase 2에서 `extractDebateDigest`로 진화)
  - 동반 테스트 수정: `prompts.spec.ts`

- [x] **1.5** `team-composer.ts` — 리더 선택 로직 제거
  - `composeTeam`에서 리더 할당 제거 → workers만 반환
  - `TeamComposition`에서 `leader` 필드 제거
  - `LEADER_DIMS` → `SELECTION_DIMS`로 rename (worker 선택에 계속 사용)
  - `selectTopModel`은 retry 시 worker 교체에 사용 → 보존
  - 동반 테스트 수정: `team-composer.spec.ts`

- [x] **1.6** `shared-context.ts` — leader/synthesis 의존 전체 제거
  - `Synthesis` import 삭제
  - `createSharedContext`에서 `team.leader` 검증 제거
  - `isConsensusReached` 함수 삭제
  - `latestSynthesis` 함수 삭제
  - `totalLLMCalls`에서 `round.synthesis` 카운트 제거
  - `modelsUsed`에서 `round.synthesis` 추적 제거
  - module docstring 업데이트
  - 동반 테스트 수정: `shared-context.spec.ts`

- [x] **1.7** `wire.ts` — 리더 wiring 제거
  - `buildLeaderMessages` import 및 `engineDeps` 주입 제거
  - `leaderGenParams` config 제거
  - `config.consensus`, `config.leaderContributes`, `config.structuralTags` 제거
  - `composeTeam` 호출부에서 리더 관련 로직 정리
  - `deliberate()` 호출 후 반환값 매핑 업데이트 (result, consensusReached 없음)
  - 동반 테스트 수정: `wire.spec.ts`

- [x] **1.8** `server.ts` (MCP 도구) — 리더 관련 파라미터/출력 제거
  - `pyreez_deliberate` 입력 스키마에서 제거: `leader_instructions`, `consensus`, `leader_contributes`
  - `models` description 업데이트: "전체가 workers" (마지막=리더 규칙 폐기)
  - `pyreez_deliberate` description 업데이트: "consensus-based" → "multi-model"
  - 출력에서 `result`, `consensusReached`, `rounds[].synthesis` 제거
  - `handleDeliberate`에서 `leaderInstructions`, `consensus`, `leaderContributes` 전달 제거
  - auto_route 경로의 `effectiveConsensus` 제거
  - `deliberationStore.save()` 호출에서 `leaderInstructions`, `consensus` 제거
  - 동반 테스트 수정: `server.spec.ts`

- [x] **1.9** `src/axis/wrappers.ts` — `DivergeSynthProtocol` 리더 제거
  - `buildLeaderMessages` import 삭제
  - `ConsensusMode` import 삭제
  - `DivergeSynthProtocolOptions`에서 `consensus` 제거
  - 클래스 내부에서 `this.consensus` 필드 및 관련 로직 제거
  - `deps` 조립 시 `buildLeaderMessages` 주입 제거
  - `leaderGenParams` config 제거
  - `config` 조립 시 `consensus`, `leaderContributes`, `structuralTags`, `leaderGenParams` 제거
  - `buildExplicitTeam` — `leader` 할당 로직 제거 → 전체가 workers
  - `buildAutoTeam` — JUDGMENT 기반 리더 선택 제거 → 전체가 workers
  - `DeliberationResult` 매핑에서 `result`, `consensusReached` 제거
  - `team.leader` 참조 전체 제거 (team augmentation 포함)
  - module docstring 업데이트: "Workers (parallel) → Leader (synthesis)" → "Workers (parallel) → Host"
  - 동반 테스트 수정: `wrappers.spec.ts`, `role-based-protocol.spec.ts`

- [x] **1.10** `src/axis/engine.ts` — 리더 관련 출력 필드 정리
  - `consensusReached: null` 등 리더 제거 후 불필요한 필드 제거
  - 동반 테스트 수정: `src/axis/engine.spec.ts`, `learning.spec.ts`, `learning-phase6.spec.ts`

- [x] **1.11** `poll-judge.ts` — 변경 불필요 확인
  - poll-judge는 worker 응답만 평가 (leader 의존 없음)
  - `WorkerResponse` 타입만 사용 → 리더 제거 영향 없음
  - wire.ts에서 `evaluateWithPoll` 호출부만 정리 (result.modelsUsed 변경 반영)

- [x] **1.12** Verify 게이트
  - `bun run typecheck` 통과
  - `bun test` 통과
  - SKILL.md 최소 패치: 리더 관련 언급 제거 (과도기 동작 보장)

### Phase 2: Debate 요약 공유 최적화

> Phase 7 A/B 평가 전까지 feature flag로 비활성 (기존 전체 공유가 기본값).

- [x] **2.1** `extractSummary` → `extractDebateDigest` 개선
  - `<position>`, `<evidence>` 태그를 직접 추출
  - 두 태그 모두 없으면 첫 3줄 fallback 유지
  - 단위 테스트 추가

- [x] **2.2** `buildDebateWorkerMessages` 변경
  - 현재: 타 worker 전체 응답 (`r.content`) 공유
  - 변경: `extractDebateDigest`로 추출본만 공유
  - 단위 테스트 추가: digest 공유 vs 전체 공유 비교

- [x] **2.3** Verify 게이트: `bun run typecheck` + `bun test`

### Phase 3: Acceptance 라운드

> 별도 MCP 도구 `pyreez_acceptance`로 노출.
> 호스트가 합성 후 선택적으로 호출. 비용: worker당 ~800 tokens (입력 ~500 + 출력 ~300), 3 workers 기준 총 ~2.5K tokens.

- [x] **3.1** acceptance용 worker 프롬프트 추가
  - 파일: `src/deliberation/prompts.ts`
  - `buildAcceptanceMessages(synthesis: string, originalPosition: string, task: string): ChatMessage[]`
  - 출력 스키마: `<acceptance><verdict>accept|reject</verdict><misrepresented>...</misrepresented><unresolved>...</unresolved></acceptance>`
  - 단위 테스트 추가

- [x] **3.2** `pyreez_acceptance` MCP 도구 추가
  - 입력: `{ task: string, synthesis: string, workers: [{ model: string, original_position: string }] }`
  - 출력: `{ workers: [{ model: string, verdict: "accept"|"reject", misrepresented?: string, unresolved?: string }] }`
  - 단위 테스트 추가

- [x] **3.3** Verify 게이트: `bun run typecheck` + `bun test`

### Phase 4: BT 피드백 도구

- [x] **4.1** `pyreez_feedback` MCP 도구 추가
  - 입력: `{ task_id: string, preferences: [{ winner: string, loser: string }] }`
  - 출력: `{ updated: number, models: string[] }`
  - ScoringSystem.update() 호출
  - 단위 테스트 추가

- [x] **4.2** Verify 게이트: `bun run typecheck` + `bun test`

### Phase 5: 스킬 개편

> 조건부: Skills 2.0 기능 (`!command`, `argument-hint`, `allowed-tools`) 가용 여부 먼저 확인.
> 미가용 시 기존 SKILL.md 포맷 + 수동 최적화로 대체.

- [ ] **5.1** Skills 2.0 기능 가용성 검증
  - `!command` 동적 컨텍스트 주입 테스트
  - `allowed-tools` frontmatter 동작 확인
  - 미가용 시: 5.2의 frontmatter를 현재 지원 기능으로 축소

- [ ] **5.2** `SKILL.md` 전면 개편
  - frontmatter 업데이트 (가용 기능에 맞춰 조정)
  - 더미 리더 핵 제거
  - 수동 팀 구성 제거 → pyreez 자동 라우팅에 위임
  - 새 플로우: Diverge → (Debate) → Fact Verification → Host 합성 → (Acceptance) → Feedback
  - SKILL.md 본문 500줄 이하 유지

- [ ] **5.3** `scripts/available-models.ts` 추가
  - scores/models.json에서 available 모델 목록 출력 (JSON compact)

- [ ] **5.4** `references/` 분할
  - `references/REFERENCE.md` → fact-check 패턴, hallucination 가이드
  - `references/TOKENS.md` → 토큰 예산 가이드 (리더 비용 제거, acceptance 추가)
  - `references/TEMPLATES.md` → worker instruction 템플릿

### Phase 6: A/B 평가

> debate 요약 공유(Phase 2) + acceptance(Phase 3) 품질 검증.
> 리더 제거 자체는 A/B 불필요 (SKILL.md가 이미 더미 리더로 호스트 합성 중, 동일 품질).

- [ ] **6.1** 평가용 태스크셋 구성
  - 도메인 혼합: CODING 3개, ARCHITECTURE 3개, REVIEW 2개, IDEATION 2개 = 10개
  - 태스크당 난이도 moderate 이상 (simple은 deliberation 불필요)
  - 재현 가능: seed 고정, 동일 모델 팀

- [ ] **6.2** 수동 A/B 스크립트 작성
  - `scripts/eval-ab.ts` — 동일 태스크를 Control/Treatment 양쪽으로 실행, 결과 비교
  - 측정 지표: eval 통과율, 반박 구체성, 토큰 사용량, 소요시간
  - Skills 2.0 eval 인프라가 가용하면 해당 인프라 활용으로 전환

- [ ] **6.3** Test A: Debate 요약공유 vs 전체공유
  - Control: 전체 응답 공유 (Phase 2 적용 전)
  - Treatment: position+evidence digest만 공유 (Phase 2)
  - 판정: Treatment가 Control 대비 품질 동등 이상이면 채택

- [ ] **6.4** Test B: Acceptance 라운드 유무
  - Control: acceptance 없음
  - Treatment: acceptance 포함 (Phase 3)
  - 측정: reject 비율, 합성 오류 검출률, 최종 품질
  - 판정: reject 발생 시 품질 개선이 명확하면 채택. reject <10%면 복잡 태스크에만 선택적 적용

- [ ] **6.5** A/B 결과 기반 최종 결정
  - 채택된 변형을 기본 동작으로 확정
  - 미채택 변형: 코드 보존하되 기본 비활성

### Phase 7: 정리

- [ ] **7.1** 사용되지 않는 import/export 정리
- [ ] **7.2** A/B 미채택 코드 정리 (Phase 6.5 결과에 따라)
- [ ] **7.3** `extractSummary` 정리: Phase 2 채택 시 `extractDebateDigest`만 남기고 원본 삭제. 미채택 시 원본 유지 + `extractDebateDigest` 삭제.

---

## 삭제 대상 요약

| 파일/모듈 | 조치 |
|-----------|------|
| `src/deliberation/synthesis-validator.ts` + `.spec.ts` | 전체 삭제 |
| `src/deliberation/prompts.ts` — `buildLeaderMessages`, `LEADER_*` 상수 | 삭제 (worker/debate 프롬프트 보존) |
| `src/deliberation/engine.ts` — `parseSynthesis`, `retryLeaderOnce`, 리더 호출 블록, consensus 루프 | 삭제 |
| `src/deliberation/wire.ts` — `buildLeaderMessages` 주입, `leaderGenParams`, consensus/structuralTags config | 삭제 |
| `src/deliberation/types.ts` — `Synthesis`, `ConsensusMode`, `TeamComposition.leader`, `DeliberateInput.leader*` | 삭제 |
| `src/deliberation/team-composer.ts` — 리더 선택/할당 | 삭제 |
| `src/deliberation/shared-context.ts` — `isConsensusReached`, `latestSynthesis`, synthesis 관련 로직 | 삭제 |
| `src/deliberation/store-types.ts` — `result`, `consensusReached`, `leaderInstructions`, `consensus`, `roundsSummary.synthesis` | 삭제 |
| `src/axis/wrappers.ts` — `DivergeSynthProtocol` 리더 선택/주입/config, `buildLeaderMessages` | 삭제 |
| `src/axis/interfaces.ts` — `DeliberationOverrides.consensus`, `.leaderContributes`, `.leaderInstructions` | 삭제 |
| `src/axis/types.ts` — `DeliberationResult.result`, `.consensusReached`, `.rounds[].synthesis` | 삭제 |
| `src/mcp/server.ts` — `leader_instructions`, `consensus`, `leader_contributes`, `result`, `consensusReached` | 삭제 |

## 보존 대상

| 모듈 | 이유 |
|------|------|
| worker 프롬프트 (advocate/critic/wildcard) | 그대로 사용 |
| debate worker 프롬프트 | 요약 공유 최적화 후 사용 |
| `extractSummary` | Phase 2에서 `extractDebateDigest`로 진화. A/B 결과에 따라 최종 판단 |
| BT 스코어링 시스템 | 그대로 사용 |
| 라우팅 파이프라인 (profile → score → select) | 그대로 사용 |
| cooldown + retry (worker 레벨) | 그대로 사용 |
| `selectTopModel` (→ `SELECTION_DIMS`) | retry 시 worker 교체에 사용 |
| PoLL judge (worker 간 pairwise) | 변경 불필요 (leader 의존 없음) |

## 실행 순서

```
Phase 1 (리더 제거 + MCP 정리 + 테스트 수정 + typecheck)
  → Phase 2 (debate 최적화) + Phase 3 (acceptance) + Phase 4 (feedback) [병렬 가능]
  → Phase 6 (A/B 평가) ← debate/acceptance 품질 검증
  → Phase 5 (스킬 개편) ← A/B 확정 후
  → Phase 7 (정리)
```

- Phase 1이 가장 크고 위험. `git tag pre-leader-removal`로 롤백 지점 확보.
- Phase 2, 3, 4는 독립적이므로 병렬 진행 가능.
- Phase 5(스킬)는 엔진 변경 + A/B 확정 후 마지막에 반영.
- 각 Phase 끝에 Verify 게이트 (typecheck + test) 통과 필수.
