---
name: no-unsolicited-implementation
description: Do not implement items from planning documents unless explicitly instructed to do so
type: feedback
---

계획 문서(PLAN.md, REMAIN_1.md 등)에 TODO로 기록된 항목이라도 사용자가 명시적으로 구현을 지시하지 않은 항목은 구현하지 않는다.

**Why:** 사용자가 "모두 수정하라"고 했을 때 TODO 8(통합 테스트 부재)은 현황 기록이지 구현 지시가 아니었음. 임의로 스모크 테스트를 작성하여 불필요한 작업과 API 호출을 유발함.

**How to apply:** "수정하라"는 지시는 기존 코드의 버그 수정에 한정. 새 기능/테스트 추가는 별도 명시적 지시가 있을 때만.
