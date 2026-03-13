# Agentic Workflow

## 전제

인간은 기획만 리뷰. 코드 품질은 자동 검증(테스트/타입체크/Firebat)이 보장.

## 단계 풀 (상황별 선택 진입)

| 단계 | 설명 |
|------|------|
| Ideate | 브레인스토밍, 다각적 탐색 (Pyreez 숙의 가능) |
| Plan | 뭘 할지 결정 → 인간 승인 |
| Spec | Emberdeck 카드로 세분화 → 인간 승인 |
| Analyze | 영향 범위 파악, 구현 방법 설계 (일회성, 구현 후 폐기) |
| Test | 테스트 작성 (RED) |
| Implement | 코드 구현 (GREEN) |
| Verify | 테스트/타입체크 자동 검증. 실패 시 다음 진행 금지 |
| Commit | 논리적 단위 저장. conventional commits |

## 상황별 플로우

```
신규 기능:     Ideate → Plan → Spec → Analyze → [Test ↔ Implement → Verify]* → Commit
버그 수정:     Analyze → Test(RED) → Implement(GREEN) → Verify → Commit
리팩토링:      Analyze → [Implement → Verify]* → Commit
대규모 변경:   Plan → Spec → Analyze → [Test ↔ Implement → Verify]* → Commit
탐색/조사:     Analyze → Report
성능 최적화:   Analyze(프로파일) → [Implement → Measure → Verify]* → Commit
```

`[]*` = 완료 조건 충족까지 자율 반복 (Ralph Loop). 완료 조건: 모든 테스트 통과 + 타입체크 통과.

## 리뷰 (어느 단계에든 적용 가능)

| 유형 | 시점 |
|------|------|
| 인간 리뷰 | Plan, Spec (기획 영역) |
| 자동 검증 | Verify (테스트/타입/품질) |
| 숙의 리뷰 | Ideate, 어려운 판단 시 (Pyreez) |
| 셀프 리뷰 | 어느 단계든 (Reflection) |
