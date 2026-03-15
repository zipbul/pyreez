# Agentic Workflow

## 전제

인간은 기획만 리뷰. 코드 품질은 자동 검증(테스트/타입체크/Firebat)이 보장.

## 단계 풀

| 단계 | 설명 |
|------|------|
| Classify | 플로우 진입 게이트. 태스크 분류 → 적절한 플로우로 라우팅 |
| Ideate | 브레인스토밍, 다각적 탐색 (Pyreez 숙의 가능) |
| Plan | 뭘 할지 결정 → 인간 승인 |
| Spec | Emberdeck 카드로 세분화 → 인간 승인 |
| Analyze | 영향 범위 파악, 구현 방법 설계 (일회성, 구현 후 폐기) |
| Test | 테스트 작성 (RED) |
| Implement | 코드 구현 (GREEN) |
| Verify | 테스트/타입체크 자동 검증. 실패 시 다음 진행 금지 |
| Validate | Plan/Spec 대비 산출물 대조. 요구사항 충족 여부 의미 검증 |
| Commit | 논리적 단위 저장. conventional commits |
| Retrospect | 인간과 에이전트가 사이클 전 과정을 회고. 워크플로우 개선안 도출 |

## 상황별 플로우

Classify는 모든 플로우 진입 전에 실행된다. 어떤 플로우에도 해당하지 않으면 인간에게 보고하고 진행하지 않는다.

```
신규 기능:     Ideate → Plan → Spec → Analyze → [Test ↔ Implement → Verify]* → Validate → Commit → Retrospect
버그 수정:     Analyze → Test(RED) → Implement(GREEN) → Verify → Validate → Commit
리팩토링:      Analyze → [Implement → Verify]* → Commit
대규모 변경:   Plan → Spec → Analyze → [Test ↔ Implement → Verify]* → Validate → Commit → Retrospect
탐색/조사:     Analyze → Report
성능 최적화:   Analyze(프로파일) → [Implement → Measure → Verify]* → Commit
단순 변경:     Implement → Verify → Commit
```

`[]*` = 완료 조건 충족까지 자율 반복 (Ralph Loop). 완료 조건: 모든 테스트 통과 + 타입체크 통과.

## 리뷰 (어느 단계에든 적용 가능)

| 유형 | 시점 |
|------|------|
| 인간 리뷰 | Plan, Spec (기획 영역) |
| 자동 검증 | Verify (테스트/타입/품질) |
| 숙의 리뷰 | Ideate, 어려운 판단 시 (Pyreez) |
| 셀프 리뷰 | 어느 단계든 (Reflection) |
