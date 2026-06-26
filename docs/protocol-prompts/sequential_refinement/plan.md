# sequential_refinement 정밀화 계획

Codex(GPT-5.4) + Claude(Opus 4.7) 이원 리뷰.

---

## 진짜 버그 (Critical)

### B1. Multi-round = restart fresh
- **위치**: `engine.ts:1161-1166`, `engine.ts:663`
- **문제**: 매 라운드 `executeSequentialRound` 재호출. `previousOutput`은 함수 내 로컬 변수 → 매 라운드 `undefined`에서 시작. **maxRounds=2 + chain [A,B,C] → C 출력을 이어받는 게 아니라 새 A→B→C 다시 시작.** 의도 불일치
- **변경 (a)**: maxRounds > 1 거부 — `wire.ts:227` 또는 `handlers.ts:118` 시점 validation. 단일 라운드 사용으로 명시
- **변경 (b)**: carry-over 구현 — outer scope에 `sequentialCarryOutput`, `executeSequentialRound`에 인자로 전달
- **권고**: (a). multi-round sequential 사용 사례 미정형. (b)는 측정 후 결정
- **출처**: Codex#10
- **비용**: handler validation 1줄

---

## High

### H1. 첫 워커 비대칭 + lens 부재
- **위치**: `prompts.ts:459-462`, 첫 워커가 `buildSharedConvergenceR1` 호출
- **문제**: (a) 첫 워커 `DEPTH_EXPLORE`, 이후 워커 `DEPTH_REFINE` — 두 cognitive mode 혼재. (b) lens는 maxRounds>1 + workerIndex 필요한데 호출(L461)에 둘 다 안 넘김 → playbook이 "첫 워커 lens 가능"이라고 한 게 코드와 불일치
- **변경**: 별도 `SEQUENTIAL_REFINEMENT_INITIAL_SYSTEM` 추가
  ```
  Produce the initial draft for later refinement. No preamble — lead with the draft.
  Use DEPTH_EXPLORE (consider multiple approaches, discard weakest).
  Format the draft so subsequent refiners can build on it (clear sections, no meta-commentary).
  ```
  + playbook의 lens 언급 제거
- **출처**: Codex#1, 내#1
- **비용**: 새 system constant 1개, builder 분기 1줄

### H2. CONFIDENCE 체인 일관성
- **위치**: `prompts.ts:440-448` SEQUENTIAL_REFINEMENT_SYSTEM
- **문제**: 첫 워커만 CONFIDENCE 받음 (R1 builder). 이후 워커 자동 주입 없음. parseConfidence 모든 응답에 적용 → 비대칭. host downstream 활용 불가
- **변경**: `SEQUENTIAL_REFINEMENT_SYSTEM`에 CONFIDENCE_AND_UNCERTAINTY fragment 추가
- **출처**: 내#1, 내#6
- **비용**: system 5줄

### H3. previousOutput 전체 주입 → 토큰 압력
- **위치**: `prompts.ts:466`, `engine.ts:687-689`
- **문제**: 다음 워커가 이전 출력 full content 받음. 길어질수록 자체 instruction 도달 전 dilution + cost↑
- **변경 (a, 최소)**: 그대로 두고 운영 가이드로만 명시 (워커 chain 길이 권장 ≤4)
- **변경 (b, 본질)**: `<previous-version>` 옆 `<previous-summary>` 옵션. host가 task에 "Output 1-line summary of your changes" 강제하면 다음 워커는 summary 우선 read
- **권고**: 측정 후 (b). 현재 (a) — playbook에 chain 길이 권장
- **출처**: Codex#5
- **비용**: (a) 문서 1줄, (b) prompt 구조 변경

### H4. 변경 사유 changeset 구조 강제
- **위치**: `prompts.ts:443-448`
- **문제**: "state what was wrong and why your version is better" lip-service 가능. 출력 구조 검증 없음
- **변경**: output-format 추가
  ```
  <output-format>
  Output two sections:
  <improved-version>...the refined artifact...</improved-version>
  <changeset>
  Each change: section/location | action (add/edit/remove) | what was wrong | why this is better | risk introduced (if any)
  Include "no change required" entries for areas you intentionally left alone.
  </changeset>
  </output-format>
  ```
- **출처**: Codex#6
- **비용**: 8줄. spec.ts 영향. 워커 응답 길이 ~20% 증가 추정

### H5. Acceptance "position" mismatch
- **위치**: `prompts.ts:588-608`
- **문제**: 워커는 "version"을 만들고 마지막 워커 출력만 최종. acceptance는 "your position"이 합성에 반영됐는지 검토 — sequential에선 의미 모호
- **변경**: `buildAcceptanceMessages`에 `protocol` 분기 (adversarial M6, host_intr L6과 통합)
  ```
  sequential_refinement: "Does the final artifact preserve or improve your contributed version?"
  Original Position → Your Contributed Version
  ```
- **출처**: Codex#8 + 내(공유 패턴)
- **비용**: signature 변경, prompt 분기

---

## Medium

### M1. 길이 단조 제약 완화
- **위치**: `prompts.ts:447`
- **문제**: "Shortening is not improving"가 redundancy·off-task·unsupported fluff 제거 막음. 합법적 compression 차단
- **변경**:
  ```
  // 현재
  Do not remove content, detail, or explanations unless they are factually wrong. Shortening is not improving.
  // 변경
  Do not reduce task coverage. You may remove redundancy, off-task material, or unsupported fluff if you preserve or improve correctness, clarity, and completeness.
  ```
- **출처**: Codex#2
- **비용**: 1줄 교체

### M2. workerOrder 의미 문서화
- **위치**: `types.ts:208-209`
- **문제**: workerOrder 정책 없음. 약→강? 강→약?
- **변경**: types 주석에 권고 추가
  ```
  /** Order of worker indices. Recommended: weakest/cheapest drafting model first, strongest reviewer/refiner model last for cumulative refinement. */
  ```
  + SKILL.md/playbook에 동일 가이드
- **출처**: Codex#3
- **비용**: 주석

### M3. 실패 워커 invisible — 다음 워커에 표시
- **위치**: `engine.ts:691-699`, `prompts.ts:466`
- **문제**: 워커 B fail → C가 A 출력만 받음. C는 B가 skip된 사실 모름. 품질에 영향
- **변경**: `executeSequentialRound`에서 skip 발생 시 다음 워커 prompt에 `<chain-status>Worker {i} failed/skipped; review as if one refinement pass is missing.</chain-status>` 삽입
- **출처**: Codex#4
- **비용**: engine 분기 + prompt 1줄

### M4. previousOutput 익명성
- **위치**: `prompts.ts:466`
- **문제**: 다음 워커가 누가 만든 출력인지·어떤 모델인지 모름. "trust this output" anchor 없음. self-output 인식 불가
- **변경**: `<previous-version source="prior worker — different model and approach">...</previous-version>` 또는 다른 모델임을 1줄 명시
- **출처**: 내#2
- **비용**: prefix 1줄

### M5. Output format 강제
- **위치**: SKILL.md / playbook (task 작성 가이드)
- **문제**: 결과물 format (Markdown/Code/JSON/plain) task 안에 박지 않으면 워커마다 format 변경 → 정보 손실 silent
- **변경**: playbook의 task 작성 룰에 명시 — "결과물 형식을 task 첫 단락에 강제하라. 예: 'Output as markdown only', 'Code only, no commentary'"
- **출처**: 내#3
- **비용**: 문서 1줄

### M6. "Stop refining" signal
- **위치**: `prompts.ts:443-448`
- **문제**: System이 "fix what doesn't, add what's missing"으로 변경 압력. 워커가 "더 개선 X" 판단해도 무리한 변경 유인
- **변경**: H4 changeset 구조와 통합
  ```
  If the prior version already meets all stated criteria, output it verbatim and document the "no changes required" decision in <changeset>.
  ```
- **출처**: 내#4
- **비용**: H4에 흡수

### M7. Convergence/stop signal
- **위치**: `engine.ts:1158-1159`
- **문제**: convergence 비활성 (shared_convergence 전용). sequential은 자연 stop 없음 — maxRounds까지 진행
- **변경**: B1 (maxRounds=1 강제)으로 해결. multi-round 활성화 시에만 별도 stop 필요 — 본 계획에선 보류

---

## Low

### L1. DEPTH_REFINE × SEQUENTIAL_SYSTEM 중복
- **위치**: `prompts.ts:41` + `prompts.ts:444-446`
- **변경**: H4 changeset 구조에서 reverted/omitted 항목 명시화로 통합. 별도 작업 불필요
- **출처**: Codex#11, 내#5

### L2. 단일 라운드 직렬 지연
- **위치**: `wire.ts:153`, `engine.ts:667-680`
- **변경**: 운영 caveat. chain 길이 권장 ≤4. 측정 후 결정
- **출처**: Codex#9

### L3. Changeset + regression check
- **위치**: H4 + 별도 작업
- **변경**: H4의 changeset이 1단계. 다음 단계 — host-side lightweight validator로 prev/new artifact의 task coverage·factual claims·removed sections 자동 비교. 측정 인프라 필요. 본 계획 out of scope
- **출처**: Codex#12

---

## 실행 순서

1. **B1 maxRounds=1 강제** — handler validation 1줄
2. **M1 길이 단조 완화** — 1줄 교체
3. **M2 workerOrder 문서화** — 주석
4. **M4 previousOutput source 표시** — 1줄
5. **H2 CONFIDENCE 주입** — system 5줄
6. **H1 INITIAL_SYSTEM 분리** — 새 constant + 분기
7. **M3 실패 워커 표시** — engine + prompt
8. **M5 Output format 가이드** — 문서
9. **H4 changeset 구조** — output-format 8줄. spec.ts 업데이트. M6 흡수
10. **H3 previousOutput summary 옵션** — 측정 후
11. **H5 acceptance 분기** — 다른 protocol과 통합 작업

---

## 측정 권고

- H4 적용 후 응답에 `<changeset>` 비율 ≥80%
- M1 적용 후 length 감소 발생 빈도 vs 증가 발생 빈도 균형
- H1 적용 후 첫 워커 출력의 "draft → 후속 refine 가능" 적합성 (sequential follow-up worker가 즉시 work-on 가능한지)

---

## Out of scope

- multi-round sequential 정의 (B1로 차단)
- changeset 기반 자동 regression validator (별도 작업)
- workerOrder 자동 추론 (현재 host 책임)
