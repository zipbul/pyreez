# REMAIN_3: Debate 품질 이슈

## 1. Debate 최소 성공 워커 수 미적용

**현상**: debate 라운드에서 워커 1개만 성공해도 라운드가 완료 처리됨. 라운드 2에서 "상호 반박"할 대상이 1개뿐이므로 debate의 가치(다양한 관점 충돌)가 없음. diverge-synth와 동일한 결과를 debate 비용으로 얻는 꼴.

**실측**: 2026-03-17 monorepo vs polyrepo deliberation — 라운드 1에서 5개 워커 중 4개 실패(Google 429 ×2, local 미설치, Anthropic degenerate). 1개 응답만으로 라운드 완료 후 라운드 2 진행.

**파일**: `src/deliberation/engine.ts` — `executeRound`에서 전원 실패만 체크, 최소 성공 수 없음.

**권장안**: debate 프로토콜에 최소 성공 워커 수(예: 2) 적용. 미달 시 retry 또는 diverge-synth로 자동 전환.

## 2. 프로바이더 다양성 부재 시 debate 가치 없음

**현상**: 실패한 모델 교체 후 팀이 단일 프로바이더(xAI)로만 구성됨. warnings 필드가 추가됐지만, 단일 프로바이더 debate는 훈련 편향이 겹쳐 다양한 시각 확보 불가.

**실측**: 위와 동일 세션. Google/Anthropic/local 모두 탈락, xAI 3개 모델만 남음.

**권장안**: warnings를 넘어서, 프로바이더 다양성이 임계값 미달이면 protocol을 debate→diverge-synth로 자동 다운그레이드. debate 비용을 절약하고 결과 품질 기대치를 호스트에 명확히 전달.
