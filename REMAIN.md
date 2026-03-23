# REMAIN — 잔여 이슈

## 2. Debate 자동 다운그레이드

debate가 유지 불가능할 때 (min_viable 미달 또는 단일 provider) diverge-synth로 자동 전환. 현재는 검증 없이 debate를 그대로 실행하고 사후 경고만 출력.

- provider 다양성 임계값 미달 시 debate→diverge-synth 다운그레이드
- debate 비용 절약 + 결과 품질 기대치 명확 전달

**파일**: `src/deliberation/wire.ts`, `src/deliberation/engine.ts`

## 3. claude -p --resume 최적화

세션 연속(message accumulation)은 구현됨. claude -p 전용 최적화로 `--resume session_id`를 사용하면 input 토큰을 절감할 수 있음 (서버 측 세션 유지, 새 메시지만 전송).

- `ClaudeCliProvider`에 session_id 추적 추가
- R2+에서 `--resume` 플래그로 follow-up만 전송
- 다른 provider는 현재 방식(message accumulation) 유지

**파일**: `src/llm/providers/claude-cli.ts`, `src/deliberation/engine.ts`

## 4. Multi-turn Socratic 워커

debate 라운드와 별개로, 단일 워커 내에서 engine이 후속 질문을 보내 추론을 더 밀어붙이는 기능. 현재는 프롬프트 수준에서 자기 질문(steelman solitaire)을 유도하지만, 외부 피드백으로 밀어붙이면 더 깊어질 수 있음.

- engine이 워커 응답 후 "그 결론의 전제 중 검증하지 않은 것은?" 식의 follow-up 전송
- 종료 조건: 새 정보 없음 또는 최대 턴 수
- 세션 연속 인프라(구현됨)를 활용 가능

**파일**: `src/deliberation/engine.ts`, `src/deliberation/prompts.ts`

## 5. Stop Hook 품질 게이트 (조건부)

호스트가 comprehend/evaluate/reflect 텍스트 단계를 반복적으로 건너뛰는 패턴이 관찰되면 구현. Stop hook이 응답 종료 전 checklist 항목 완료를 검사하고 미완료 시 차단. PROMPT_ENGINEERING_REFERENCE I4에 구체적 구현 포함.

- 현재는 텍스트 지시 + checklist로 관리. 충분하면 불필요.
- 반복적 단계 누락 시 `.claude/settings.json`에 Stop hook 추가.

**파일**: `.claude/settings.json`
