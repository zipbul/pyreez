# PLAN: 리더 폐기 + 호스트-리더 아키텍처

## 배경

논의를 통해 다음이 확정됨:

1. **리더 폐기** — 호스트(Claude Code 등)가 합성을 수행. 내부 리더 LLM 호출 제거.
2. **debate 시 구조화 요약 공유** — worker 간 전체 응답 대신 `<position>` + `<evidence>` 추출본 공유. 비용 60% 절감.
3. **acceptance 라운드** — 호스트 합성 후 worker가 accept/reject 검증. 비용 ~2.5K tokens.
4. **BT 피드백 루프** — 호스트가 worker 품질 피드백을 pyreez에 전달.
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
                                          pyreez → [Workers] → acceptance
                                            ↓
                                          Host(확정)
```

## 플로우

```
1. Diverge:    Worker A, B, C 병렬 (독립 응답)
2. Debate:     Worker A, B, C 병렬 (position+evidence 상호 공유, 반박) [선택적]
3. Host 합성:  호스트가 fact-check + 합성
4. Acceptance: Worker A, B, C 병렬 (합성 검증, accept/reject) [선택적]
5. Host 확정:  reject 사유 반영 후 최종 결과
6. Feedback:   호스트 → pyreez_scores (BT 업데이트)
```

---

## TODO

### Phase 1: 엔진 — 리더 제거

- [ ] **1.1** `DeliberateOutput` 변경 — `result: string` 제거, `workers: WorkerResponse[]` 를 1급 출력으로 승격
  - 파일: `src/deliberation/types.ts`
  - `synthesis` 관련 타입 제거 (`Synthesis`, `ConsensusMode`)
  - `DeliberateInput`에서 `leaderInstructions`, `consensus`, `leaderContributes` 제거

- [ ] **1.2** `engine.ts` — 리더 호출 로직 전체 제거
  - `parseSynthesis`, `extractJsonObject`, `stripJsonWrapping`, `stripDeliberationBlock` 삭제
  - `retryLeaderOnce` 삭제
  - `executeRound`에서 리더 호출 블록 (L386~L475) 제거
  - `Synthesis` 관련 로직 제거
  - structural validation (`validateSynthesisStructure`, `buildRetryHint`) 호출 제거
  - `Round` 결과에서 `synthesis` 필드 제거

- [ ] **1.3** `synthesis-validator.ts` 전체 삭제

- [ ] **1.4** `wire.ts` — 리더 관련 wiring 제거
  - `createDeliberateFn`에서 `leaderGenParams`, `leaderContributes`, `consensus`, `structuralTags` config 제거
  - `EngineDeps`에서 `buildLeaderMessages` 제거
  - `EngineConfig`에서 `consensus`, `leaderContributes`, `structuralTags`, `leaderGenParams` 제거

- [ ] **1.5** `prompts.ts` — 리더 프롬프트 전체 삭제
  - `LEADER_OBLIGATIONS`, `LEADER_CRITIQUE_OUTPUT`, `LEADER_DEFAULT`, `LEADER_SUFFIX` 삭제
  - `LEADER_ARTIFACT`, `LEADER_ARTIFACT_SUFFIX` 삭제
  - `DEBATE_INTERMEDIATE_LEADER` 삭제
  - `buildLeaderMessages` 함수 삭제
  - `extractSummary`는 debate 요약 공유에 재사용 → 보존

- [ ] **1.6** `team-composer.ts` — 리더 선택 로직 제거
  - `composeTeam`에서 리더 할당 제거
  - `TeamComposition`에서 `leader` 필드 제거 → workers만 남김
  - `selectTopModel`, `LEADER_DIMS`는 worker 선택에도 사용되므로 확인 후 판단

- [ ] **1.7** `shared-context.ts` — `Synthesis` 참조 제거

- [ ] **1.8** `types.ts` — `TeamRole`에서 `"leader"` 제거, `Synthesis` 인터페이스 삭제, `ConsensusMode` 삭제

### Phase 2: Debate 요약 공유 최적화

- [ ] **2.1** `prompts.ts` `buildDebateWorkerMessages` 변경
  - 현재: 타 worker 전체 응답 (`r.content`) 공유
  - 변경: `extractSummary`로 `<position>` + `<evidence>` 만 추출하여 공유
  - `<summary>` 태그가 없으면 기존 fallback (첫 3줄) 대신 `<position>` + `<evidence>` 태그 직접 추출

- [ ] **2.2** `extractSummary` → `extractDebateDigest`로 개선
  - `<position>`, `<evidence>` 태그를 직접 추출
  - 두 태그 모두 없으면 첫 3줄 fallback 유지

### Phase 3: Acceptance 라운드

- [ ] **3.1** acceptance용 worker 프롬프트 추가
  - 파일: `src/deliberation/prompts.ts`
  - `buildAcceptanceMessages(synthesis: string, originalPosition: string, task: string): ChatMessage[]`
  - 출력 스키마: `<acceptance><verdict>accept|reject</verdict><misrepresented>...</misrepresented><unresolved>...</unresolved></acceptance>`

- [ ] **3.2** `pyreez_deliberate` 도구에 acceptance 모드 추가
  - 새 파라미터: `mode: "deliberate" | "acceptance"`
  - acceptance 모드: `{ mode: "acceptance", task, synthesis, workers: [{ model, original_position }] }` → `{ workers: [{ model, verdict, misrepresented, unresolved }] }`
  - 또는 별도 도구 `pyreez_acceptance` 추가 (도구 분리가 MCP 계약상 깔끔)

### Phase 4: MCP 도구 인터페이스 정리

- [ ] **4.1** `pyreez_deliberate` 입력 스키마 정리
  - `leader_instructions` 제거
  - `consensus` 제거
  - `leader_contributes` 제거
  - `models` 의미 변경: 전체가 workers (마지막=리더 규칙 폐기)

- [ ] **4.2** `pyreez_deliberate` 출력 변경
  - `result` (리더 합성) 제거
  - `consensusReached` 제거
  - workers 응답을 역할(advocate/critic/wildcard) + 구조화 태그와 함께 반환
  - `rounds[].synthesis` 제거

- [ ] **4.3** BT 피드백 API 추가
  - `pyreez_scores`에 feedback 입력 추가: `{ feedback: { task_id, preferences: [{ winner, loser }] } }`
  - 또는 별도 도구 `pyreez_feedback` 추가

### Phase 5: 스킬 개편 (Skills 2.0)

- [ ] **5.1** `SKILL.md` 전면 개편 — Skills 2.0 기능 최대 활용
  - frontmatter:
    ```yaml
    ---
    name: pyreez
    description: Run leaderless multi-model deliberation with host-side fact verification. Use when the user asks to debate, deliberate, brainstorm, or get multi-perspective analysis on any topic.
    allowed-tools: mcp__pyreez__pyreez_deliberate mcp__pyreez__pyreez_scores mcp__pyreez__pyreez_route WebSearch WebFetch
    user-invocable: true
    argument-hint: [topic or task to deliberate]
    metadata:
      author: zipbul
      version: "2.0"
    ---
    ```
  - `allowed-tools`: pyreez MCP 도구 + 검증용 WebSearch/WebFetch 사전 승인
  - `argument-hint` + `$ARGUMENTS`: `/pyreez 이 아키텍처를 리뷰해줘` → task 자동 주입
  - `!command` 동적 컨텍스트 주입: 스킬 로드 시 사용 가능 모델 목록 자동 삽입 → pyreez_scores 호출 1회 절약
    ```markdown
    ## Available Models
    !`bun ${CLAUDE_SKILL_DIR}/scripts/available-models.ts`
    ```
  - 더미 리더 핵 제거
  - 수동 팀 구성 제거 → pyreez 자동 라우팅에 위임
  - 새 플로우: Diverge → (Debate) → Fact Verification → Host 합성 → (Acceptance) → Feedback
  - SKILL.md 본문 500줄 이하 유지 — 상세 내용은 references/로 분리
  - 의도적 미사용: `context: fork` (호스트 컨텍스트 유지 필요), `model` (유저 선택 존중)

- [ ] **5.2** `scripts/` 추가
  - `scripts/available-models.ts` — scores/models.json에서 available 모델 목록 출력 (JSON compact)
  - `scripts/health-check.ts` — pyreez MCP 서버 연결 확인 (선택적, 복잡하면 보류)

- [ ] **5.2** `references/REFERENCE.md` 분할
  - `references/REFERENCE.md` → fact-check 패턴, hallucination 가이드
  - `references/TOKENS.md` → 토큰 예산 가이드 (리더 비용 제거, acceptance 추가)
  - `references/TEMPLATES.md` → worker instruction 템플릿 (현재 REFERENCE.md에서 분리)
  - 메인 SKILL.md에서 `See [reference](references/REFERENCE.md)` 형태로 참조 → 필요할 때만 로드

- [ ] **5.3** 더미 리더 + 수동 팀 구성 관련 내용 전체 삭제

### Phase 6: 단위 테스트

- [ ] **6.1** 기존 리더 관련 테스트 제거/수정
- [ ] **6.2** workers_only 모드 테스트 추가
- [ ] **6.3** debate 요약 공유 테스트 (전체 공유 → digest 공유)
- [ ] **6.4** acceptance 라운드 테스트
- [ ] **6.5** BT 피드백 API 테스트
- [ ] **6.6** 전체 typecheck 통과 확인

### Phase 7: A/B 평가 (Skills 2.0 내장 Evals + A/B 비교 활용)

리더 제거 자체는 A/B 불필요 (SKILL.md가 이미 더미 리더로 호스트 합성 중, 동일 품질).
새로 도입하는 두 변경은 품질 영향이 불확실하므로 측정 필수.

Skills 2.0의 내장 eval/A/B 인프라를 활용. 커스텀 스크립트 작성 불필요.

- [ ] **7.1** 평가용 태스크셋 구성
  - 도메인 혼합: CODING 3개, ARCHITECTURE 3개, REVIEW 2개, IDEATION 2개 = 10개
  - 태스크당 난이도 moderate 이상 (simple은 deliberation 불필요)
  - 재현 가능: seed 고정, 동일 모델 팀

- [ ] **7.2** 스킬 변형 2개 작성 (A/B용)
  - `pyreez-digest/SKILL.md` — debate 시 position+evidence만 공유 (Treatment A)
  - `pyreez-acceptance/SKILL.md` — acceptance 라운드 포함 (Treatment B)
  - 기존 `pyreez/SKILL.md` — Control (현재 방식, 리더 제거만 적용)

- [ ] **7.3** Skills 2.0 Evals 정의
  - 각 태스크에 대해 expected output criteria 정의 (정확성, 반박 구체성, 합성 품질)
  - eval pass rate + 토큰 사용량 + 소요시간을 자동 추적

- [ ] **7.4** Test A: Debate 요약공유 vs 전체공유
  - Skills 2.0 A/B 비교로 `pyreez` vs `pyreez-digest` 병렬 실행
  - 블라인드 비교: 격리된 에이전트 컨텍스트에서 동일 태스크 실행
  - 측정: eval 통과율, 반박 구체성, 토큰 사용량
  - 판정: Treatment가 Control 대비 품질 동등 이상이면 채택

- [ ] **7.5** Test B: Acceptance 라운드 유무
  - Skills 2.0 A/B 비교로 `pyreez` vs `pyreez-acceptance` 병렬 실행
  - 측정: reject 비율, 합성 오류 검출률, 최종 품질
  - 판정: reject 발생 시 품질 개선이 명확하면 채택. reject <10%면 복잡 태스크에만 선택적 적용

- [ ] **7.6** A/B 결과 기반 최종 스킬 통합
  - 채택된 변형을 메인 `pyreez/SKILL.md`에 통합
  - 미채택 변형 스킬 디렉토리 삭제

### Phase 8: 정리

- [ ] **8.1** `deliberate()` 함수의 consensus 루프 단순화 — 고정 라운드만 지원
- [ ] **8.2** 사용되지 않는 import/export 정리
- [ ] **8.3** `poll-judge.ts` — 리더 없이 동작하도록 조정 (worker 간 pairwise 비교는 유지)
- [ ] **8.4** A/B 결과에 따라 debate 요약공유 / acceptance 최종 적용 여부 결정

---

## 삭제 대상 요약

| 파일/모듈 | 조치 |
|-----------|------|
| `src/deliberation/synthesis-validator.ts` | 전체 삭제 |
| `src/deliberation/prompts.ts` — leader 프롬프트 | 삭제 (worker/debate 프롬프트 보존) |
| `src/deliberation/engine.ts` — parseSynthesis, retryLeaderOnce, 리더 호출 블록 | 삭제 |
| `src/deliberation/wire.ts` — 리더 config/wiring | 삭제 |
| `src/deliberation/types.ts` — Synthesis, ConsensusMode, leader 관련 | 삭제 |
| `src/deliberation/team-composer.ts` — 리더 선택 | 삭제 |
| `src/mcp/server.ts` — leader_instructions, consensus, leader_contributes 파라미터 | 삭제 |

## 보존 대상

| 모듈 | 이유 |
|------|------|
| worker 프롬프트 (advocate/critic/wildcard) | 그대로 사용 |
| debate worker 프롬프트 | 요약 공유 최적화 후 사용 |
| `extractSummary` → `extractDebateDigest` | debate 요약 추출에 재사용 |
| BT 스코어링 시스템 | 그대로 사용 |
| 라우팅 파이프라인 (profile → score → select) | 그대로 사용 |
| cooldown + retry (worker 레벨) | 그대로 사용 |
| PoLL judge (worker 간 pairwise) | 조정 후 사용 |

## 실행 순서

```
Phase 1 (리더 제거) → Phase 6 (단위 테스트 + typecheck)
  → Phase 2 (debate 최적화) + Phase 3 (acceptance) [병렬 가능]
  → Phase 7 (A/B 평가) ← debate/acceptance 품질 검증
  → Phase 8.4 (A/B 결과 반영)
  → Phase 4 (MCP 정리) → Phase 5 (스킬) → Phase 8 (정리)
```

- Phase 1이 가장 크고 위험.
- Phase 2, 3은 구현 후 바로 A/B 평가(Phase 7)로 검증. 평가 통과 전까지 기본 모드에서 비활성.
- Phase 5(스킬)는 엔진 변경 + A/B 확정 후 마지막에 반영.
