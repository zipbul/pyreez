# PLAN: AUDIT 잔여 수정

## 1. B2 — 단일모델 chat 실패 시 크래시 방지 [높음]

**파일**: `src/axis/engine.ts:91-92`
**현상**: `plan.models.length === 1`일 때 `this.chat()` 호출에 try-catch 없음. LLM 에러 시 `runWithTrace` 전체가 unhandled throw.
**수정**: try-catch로 감싸고 cause chain 보존하여 재throw.

## 2. G1 — temperature + top_p 동시 사용 제거 [높음]

**파일**: `src/axis/wrappers.ts:542-546`, `src/deliberation/wire.ts:234-238`
**현상**: `temperature: 1.0`과 `top_p: 0.9` 동시 지정. OpenAI 권장: 둘 중 하나만 사용.
**수정**: `top_p` 제거. temperature만 유지. 두 군데 동일 적용.

## 3. P1 — PoLL judge 응답 순서 고정 [중간]

**파일**: `src/deliberation/poll-judge.ts:172-196`
**현상**: pairwise 비교에서 `i < j` 순서 고정. 워커 응답이 항상 같은 순서로 judge에게 전달됨. judge가 첫 번째 응답에 편향될 수 있음.
**수정**: `buildPollPrompt`에서 응답 순서 셔플. pairwise 생성 로직은 점수 기반이므로 순서 무관.

## 4. Problem A — Task→Dimension 매핑 이중화 [중간]

**파일**: `src/profile/profiler.ts:164` (TASK_OVERRIDES), `src/model/calibration.ts:44` (taskToDimensions)
**현상**: 같은 개념(task → capability dimension)이 두 군데에 독립 정의. 하나에 task 추가해도 다른 곳은 모름. BT 레이팅 업데이트와 라우팅 기준이 어긋날 수 있음.
**수정**: `calibration.ts`의 `taskToDimensions()`가 `profiler.ts`의 `profileTask()` 결과에서 dimension 목록을 추출하도록 변경. `profileTask`는 TASK_OVERRIDES + DOMAIN_DEFAULTS를 합쳐서 최종 capability 목록을 반환하므로 이것이 단일 소스.

## 5. B5 — PoLL judge 1명 성공 시 median 무의미 [낮음]

**파일**: `src/deliberation/poll-judge.ts:251`
**현상**: `allJudgeScores.length === 0`만 체크. 1명 성공 시 median이 단일 값이 되어 집계 의미 없음.
**수정**: `allJudgeScores.length < MIN_JUDGES`이면 EMPTY_RESULT 반환으로 변경. best-effort이더라도 최소 신뢰도 보장.
