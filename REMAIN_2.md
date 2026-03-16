# REMAIN_2: Debate Proactive Replacement 부작용

## 현상

debate 모드에서 부분 실패(일부 워커 실패) 시 proactive replacement가 컨텍스트를 리셋하여:

1. **진단 메타데이터 소실**: `roundsExecuted`, `rounds` 배열, `totalLLMCalls`, `modelsUsed`가 마지막 라운드만 반영
2. **debate cross-examination 불가**: 교체된 워커가 이전 라운드 응답을 보지 못하므로 상호 반박이 없음. debate가 사실상 diverge-synth로 동작

## 원인

`src/deliberation/engine.ts:333-337` — debate proactive replacement에서 이전 라운드를 드롭:

```typescript
const prevRounds = cfg.protocol === "debate" ? [] : [...ctx.rounds];
ctx = createSharedContext(input.task, currentTeam, input.taskNature);
```

이유 자체는 타당: 교체된 워커가 퇴장 워커의 응답을 참조하면 혼란. 그러나 진단 데이터까지 함께 소실되는 것은 의도하지 않은 부작용.

## 영향 범위

- debate + 부분 실패(일부 워커만 실패)가 동시에 발생할 때만 트리거
- 전원 실패 시에는 retry 블록(282행)이 처리하므로 별도 경로
- diverge-synth에서는 이전 라운드를 보존하므로 문제 없음

## 수정안

두 가지 독립적인 문제를 분리:

### A. 진단 메타데이터 누적 (필수)

`accTokens`처럼 라운드 메타데이터를 별도로 누적:

```typescript
// engine.ts — deliberate() 함수 상단에 추가
let allRounds: Round[] = [];
let allLLMCalls = 0;
let allModels = new Set<string>();

// 312행 addRound 직후에 추가
allRounds.push(roundResult!.round);
allLLMCalls += roundResult!.round.responses.length + (roundResult!.round.failedWorkers?.length ?? 0);
for (const resp of roundResult!.round.responses) allModels.add(resp.model);

// 357-364행 return에서 ctx 대신 누적 데이터 사용
return {
  roundsExecuted: allRounds.length,
  totalTokens: accTokens,
  totalLLMCalls: allLLMCalls,
  modelsUsed: [...allModels],
  rounds: allRounds.map(r => ({
    number: r.number,
    responses: r.responses.map(resp => ({ model: resp.model, content: resp.content, role: resp.role })),
    ...(r.failedWorkers?.length ? { failedWorkers: r.failedWorkers } : {}),
  })),
  ...(warnings.length > 0 ? { warnings } : {}),
};
```

### B. debate cross-examination 복원 (선택)

교체된 워커에게 이전 라운드의 **성공한 응답만** 전달:

```typescript
// 333행 수정
const prevRounds = cfg.protocol === "debate"
  ? ctx.rounds.map(r => ({
      ...r,
      // 실패한 워커의 응답은 제거, 성공한 응답만 유지
      responses: r.responses.filter(resp =>
        !failedIds.has(resp.model)
      ),
    })).filter(r => r.responses.length > 0)
  : [...ctx.rounds];
```

이렇게 하면:
- 교체된 워커가 이전 성공 워커의 응답을 debate 컨텍스트로 참조 가능
- 퇴장 워커의 응답은 필터링되어 혼란 방지
- cross-examination이 부분적으로라도 작동

### C. 라운드 번호 일관성

A를 적용하면 `allRounds`에 실제 실행 순서대로 라운드가 쌓이므로, `allRounds[0].number`가 1이 아닐 수 있음 (컨텍스트 리셋 후 번호가 1로 재시작). 출력 시 `allRounds`의 인덱스 기반으로 번호를 재매기면 일관성 유지:

```typescript
rounds: allRounds.map((r, idx) => ({
  number: idx + 1,
  ...
})),
```
