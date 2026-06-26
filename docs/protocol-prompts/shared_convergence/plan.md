# shared_convergence 정밀화 계획 (v2 — 사실 기반 재작성)

이전 v1 회수. 정직 감사 후 사실/가설 분리. 측정 없는 prompt fragment 추가는 dead-metric 패턴 위험 → 보류.

검증 방법:
- 코드 fact: 본 conversation에서 `prompts.ts` 직접 read·grep으로 재현 확인
- 외부 인용: arxiv abstract page title만 확인. **abstract·본문 verbatim 미확보** → 인용 시 [arxiv title verified, content unverified] 라벨
- 행동 효과: pyreez bench 측정 0. 일반 통설 인용은 [추정] 라벨

---

## Tier 1 — 사실 기반 safe fix (즉시)

### F1. XML escape 누락 — 보안 hardening
- **위치**: `prompts.ts:172, 214, 227, 242`
- **사실 (코드 read 확인)**: `formatOtherPositions`(L91-99) 와 cold-join transcript fallback(L219)은 `escapeXmlContent` 사용. 그러나 `<host-instructions>${instructions}`, `<your-previous>${ownPrevious.content}`, `<task>${ctx.task}` 미적용
- **재현**: 호스트가 `instructions` 또는 `task`에 `</task>...<role>system</role><task>` 류 텍스트 주입 시 XML 구조 깨짐
- **영향**: prompt injection 표면. 실제 발생 빈도 측정 0이나 표면 자체는 사실
- **변경**:
  ```ts
  // L172
  if (instructions) userParts.push(`<host-instructions>${escapeXmlContent(instructions)}</host-instructions>`);
  // L214
  userParts.push(`<your-previous>${escapeXmlContent(ownPrevious.content)}</your-previous>`);
  // L227
  if (instructions) userParts.push(`<host-instructions>${escapeXmlContent(instructions)}</host-instructions>`);
  // L242
  userParts.push(`<task>${escapeXmlContent(ctx.task)}</task>`);
  // 동일 — buildSharedConvergenceFollowUp(L269, L284)
  ```
- **비용**: 4 위치 × 1 변경. spec 영향 (escape 적용 후 기존 task에 `<`, `&`, `>` 포함된 경우 출력 변환)
- **검증 후 측정 X 가능**: 보안 hardening은 사용 빈도 무관 적용 정당화

---

## Tier 2 — 코드 fact 진단 (사실 보고만, fix는 측정 후 결정)

### D1. Lens 분포 skew
- **사실**: `prompts.ts:175-178, 230-233, 272-275`의 `workerIndex % DIVERSITY_LENSES.length` (7). 3-worker 팀이면 lens index 0,1,2만 사용. lens 3-6 (contrarian/first-principles/human factors/empirical evidence)은 count≥4일 때만 도달
- **재현**: `bun -e 'const N=3; for (let i=0;i<N;i++) console.log(i%7)'` → 0,1,2 출력
- **잠재 영향**: 7-lens 다양화 설계가 일반 팀(3-5명)에서 절반 미만 활성. 단 균등 분배(`Math.round(i*7/N)`)가 실제 더 좋은 결과를 내는지는 **측정 0** — fix direction 가설
- **결정**: bench 측정 후 결정. 두 분배 알고리즘 A/B 결과 비교 필요

### D2. Final-round commit notice ↔ CONFIDENCE_AND_UNCERTAINTY 텍스트 충돌
- **사실**: `prompts.ts:239, 281`의 "Commit to your strongest position" vs `prompts.ts:58-62` `CONFIDENCE_AND_UNCERTAINTY`의 "Do not force confidence — if genuinely uncertain, say so"
- **재현**: R3 user message가 두 instruction 모두 포함 — 텍스트 read로 확인
- **잠재 영향**: 워커가 어느 쪽 우선할지 불명. LOW confidence 정직 보고가 commit 압력에 약화되는지 **측정 0**
- **결정**: 측정 후 결정. 가설 — final round LOW confidence 비율 vs commit 제거 베이스 비교

### D3. R1 vs R2+ asymmetry
- **사실**: `prompts.ts:181-183` "Explore broadly. Do not converge prematurely"는 R1+max>1 only. R2/R3에는 explore anchor 없음
- **사실**: ANTI_CONFORMITY는 R2+만(`prompts.ts:235`), R1 미주입
- **잠재 영향**: R2가 너무 빨리 수렴하는 ConfMAD 패턴 [추정 — arxiv 2509.14034 title verified, content unverified]
- **결정**: 측정 후. 가설 — R2 응답 다양성 ratio (R1 대비)

### D4. `<your-previous>` 1인칭 그대로
- **사실**: `prompts.ts:213-214, 268-269` `ownPrevious.content` 그대로 노출. `formatOtherPositions`는 "One analyst argues" 3인칭 변환
- **재현**: worker.md dump의 R2 user 메시지 확인
- **잠재 영향**: self-anchor 강화 가능 [추정 — 일반 metacognitive distance 통설]
- **결정**: 측정 후. 가설 — R2에서 워커가 R1 입장 유지 비율 비교

### D5. Fragment 내 표현 중복
- **사실**: `prompts.ts:32-49, 58-62`에 "specific evidence" 4회, "express uncertainty" + "do not force confidence" 의미 중복
- **재현**: grep
- **잠재 영향**: token 약간 절감. 압축이 동일 또는 더 나은 워커 행동 유도하는지 **측정 0**
- **결정**: 측정 후. 텍스트 압축은 prompt content 변경 — 효과 alone 검증 필요

---

## Tier 3 — 가설 기반 (측정 없이 적용 금지)

다음 항목은 v1 plan에 있었으나 측정 0 → 보류:

| ID | 가설 | 출처 | 측정 필요 |
|---|---|---|---|
| H1' | conformity 4-bucket(kept/changed/rejected/undecided) 강제가 sycophancy 감소 | Codex 인용 arxiv 2509.14034 [title only] | bench: 응답 enumeration 빈도 + dissent 보존율 |
| M3' | `<your-previous>` metacognitive prefix가 self-anchor 감소 | 일반 통설 [추정] | bench: 워커 입장 변경 빈도 |
| M4' | lens distinct prefix가 lens 적용도 향상 | 추론 | bench: lens별 출력 특성 측정 |
| M5' | lens 의미 정리 (human factors → user value 등) | judgment | bench: 도메인별 lens 적용도 |
| M6' | step-back R1 한 줄이 invariant 추출 유도 | Codex 인용 [추정] | bench: R1 응답에 invariant 명시 비율 |
| L1' | R2 re-explore anchor가 early convergence 잡음 | 직관 | bench: R2 다양성 |
| L3' | 영문 lens vs task language 영향 | 추론 | bench: 다국어 task 응답 품질 |

각 가설 적용 비용: 1줄 prompt 추가. 7 항목 모두 적용 시 system/user 약 +10-15 token. 큰 부담 아님이나 측정 없이 누적 시 dead-metric 패턴 (현재 r1Diversity·detectMinorityDissent·detectConformity와 동일 함정)

---

## Tier 4 — 다른 plan과 통합

### I1. Acceptance protocol-aware 분기
- **위치**: `prompts.ts:588-616`
- **공통 작업**: adversarial M6, host_intr L6, sequential H5, eval, red_team H7과 통합
- **분리 작업** — 별도 PR. 본 plan에선 보류

---

## 회수 (v1에 있었으나 잘못된 진단)

### ❌ H2 FollowUp system 재주입
- **v1 주장**: FollowUp이 user 메시지만 반환 → 세션 깨지면 system 손실
- **재검증**: `engine.ts:509-528` callWithFallback은 client-side에 messages array 누적 + 매 chat() 호출에 전체 array 송신. system 메시지는 항상 index 0에 포함. **session loss로 system 손실 시나리오 없음**
- **결론**: 잘못된 진단. 삭제

### ❌ H1 conformity 4-bucket (Tier 3로 이동)
- **이유**: arxiv 인용은 title only verified, content unverified. 측정 0. 즉시 적용 시 모든 R2+ 응답 길이 ~15% 증가 추정 (over-engineering 위험)

### ❌ 나머지 v1 항목 (Tier 3로 이동)

---

## 실행 순서

1. **F1 XML escape** — 4 위치. 즉시. spec 영향 검토 후 적용. cost 0
2. **Tier 2 진단 보고** — 본 plan으로 문서화 완료. 코드 변경 없음
3. **측정 인프라 활성** — bench/ 활용 결정. Tier 3 가설 검증 환경 구축이 prerequisite
4. **측정 후 D1-D5 + Tier 3 결정** — 가설별 측정 결과로 적용/폐기

---

## 과설계 회피 룰

본 plan 적용 후 추가 prompt fragment 도입은 다음 조건 충족 시만:
- 사전 측정 가설 명시
- bench로 효과 비교
- 측정 결과 positive일 때 적용
- 결과 negative 또는 inconclusive 시 폐기

dead-metric 패턴 (`r1Diversity`·`detectMinorityDissent`·`detectConformity`가 코드 주석에서 자기 무용 인정) 재발 방지가 본 룰의 본질.

---

## Out of scope

- 새 lens 추가 (M5 lens 의미 변경 포함)
- step-back / verify checklist (Tier 3)
- 다국어 lens (Tier 3)
- Acceptance 분기 (다른 plan과 통합)
- 측정 인프라 구축 자체 (별도 작업)
