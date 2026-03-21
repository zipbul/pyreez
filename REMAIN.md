# REMAIN — 잔여 이슈

## 2. Debate 자동 다운그레이드

debate가 유지 불가능할 때 (min_viable 미달 또는 단일 provider) diverge-synth로 자동 전환. 현재는 검증 없이 debate를 그대로 실행하고 사후 경고만 출력.

- provider 다양성 임계값 미달 시 debate→diverge-synth 다운그레이드
- debate 비용 절약 + 결과 품질 기대치 명확 전달

**파일**: `src/deliberation/wire.ts`, `src/deliberation/engine.ts`

## 3. Multi-turn Socratic 워커

워커가 single-turn이 아닌 multi-turn으로 자기 하위 질문을 반복 생성+답변하여 추론 깊이를 극대화. Socratic recursive questioning이 CoT보다 robust하다는 연구 근거 (EMNLP, 교차 검증).

- engine이 워커별 multi-turn 대화를 지원해야 함 (현재 single chat call)
- 종료 조건 필요 (수렴 감지 또는 최대 턴 수)
- 비용/지연 트레이드오프 검토 필요

**파일**: `src/deliberation/engine.ts`, `src/deliberation/prompts.ts`
