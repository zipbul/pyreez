---
name: validate_before_commit
description: 커밋 전 Validate에서 반드시 복잡한 실행 경로를 end-to-end 추적할 것
type: feedback
---

테스트 통과만 확인하고 커밋하면 안 됨. 사용자가 "완벽한가?" 물어본 후에야 경로 추적해서 버그를 찾는 패턴이 3회 반복됨.

**Why:** cooldown skip 경로에서 errorCode 누락, 보충 워커 팀 미합류, respondedModels 미전달 등 모두 Validate 단계에서 경로 추적했으면 커밋 전에 잡을 수 있었음.

**How to apply:** 커밋 전 Validate에서:
1. 가장 복잡한 실행 경로 1개를 직접 코드 라인 단위로 추적
2. "이 데이터가 여기서 저기로 전달되는가?" 질문
3. 새로 추가한 인터페이스의 모든 호출 지점에서 파라미터가 올바르게 전달되는지 확인
