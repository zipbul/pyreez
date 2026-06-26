# evaluation_scoring 정밀화 계획

Codex(GPT-5.4) + Claude(Opus 4.7) 이원 리뷰.

---

## Critical (진짜 버그)

### C1. Voting majority 1-vote bug
- **위치**: `engine.ts:949-962`
- **문제**: N=3 with 3 different verdicts → 각 count=1. 현재 로직: 첫 verdict를 `majorityVerdict`, `voteCount: 1` emit. **다수결 아님**
- **변경**:
  ```ts
  const totalVotes = [...verdictCounts.values()].reduce((a, b) => a + b, 0);
  const tied = [...verdictCounts.values()].filter((c) => c === topCount).length > 1;
  const hasMajority = topCount > totalVotes / 2 && !tied;
  // emit majorityVerdict only when hasMajority; otherwise emit tie: true + voteCount
  ```
- **출처**: Codex#7
- **비용**: aggregation 10줄. spec.ts 업데이트
- **권고**: 즉시 수정

---

## High

### H1. Score regex 견고화
- **위치**: `engine.ts:882-884`
- **문제**: 첫 매치 우선. 본문 중간 "criterion score: 4" 같은 부분 점수가 final score로 오인 가능. PROBLEM.md S3 일치
- **변경**: 최종 score 라인 매칭 (line-start, anchored)
  ```ts
  const scoreMatches = [...r.content.matchAll(
    /^\s*(?:score|rating|점수|overall)\s*[:=]\s*\**(\d+(?:\.\d+)?)\**(?:\s*(?:\/\s*10|out of 10))?\s*$/gim,
  )];
  const scoreMatch = scoreMatches.at(-1);
  ```
- **출처**: Codex#1 + PROBLEM.md S3
- **비용**: 한 줄 교체. 측정 필요 — 기존 모델 응답이 line-anchored format 따르는지

### H2. Verdict enum 도입 — consensus·voting 의미 안정성
- **위치**: `prompts.ts:485-496`, `engine.ts:886, 925-927`
- **문제**: 자유문 verdict + `toLowerCase()` 비교 → "Approved" vs "approve" 정상 일치, "Approved with caveat" vs "Approved" silent 불일치. consensus·voting 모두 취약
- **변경**: output-format에 `verdict_label` 열거형 추가
  ```
  verdict_label: [approve | approve_with_caveats | needs_revision | reject]
  verdict: [one sentence — consistent with verdict_label and analysis above]
  score: [1-10]
  ```
  engine.ts에서 `verdictLabel`로 집계, `verdict`는 host에게 텍스트 reference로만 전달
- **출처**: Codex#6
- **비용**: types.ts 추가, engine 분기, prompt 형식. backward compat 부분 (구버전 응답은 verdict만 있을 수 있음 — graceful fallback)

### H3. Confidence weight calibration
- **위치**: `engine.ts:899`, `prompts.ts:487`
- **문제**: HIGH=1.0/MED=0.6/LOW=0.3는 코드 근거 없음. RLHF verbalized overconfidence 연구와 충돌 (Codex 인용 arxiv:2410.09724 — verbatim 미확보, [추정])
- **변경**:
  ```ts
  // engine.ts:899 — 보수적 가중치
  const weights: Record<string, number> = { high: 0.7, medium: 0.55, low: 0.4 };
  ```
  prompt도 calibrated definition으로 교체:
  ```
  Indicate calibrated confidence: LOW = <60% certain, MEDIUM = 60-80%, HIGH = >80%. Use HIGH only when evidence would survive independent verification.
  ```
- **출처**: Codex#8
- **비용**: 코드 1줄 + prompt 1줄. 측정 필요 — 가중치 변경이 aggregation 결과 분포 어떻게 바꾸는지

### H4. verdict ↔ score 일관성 코드 검증
- **위치**: `engine.ts:887-893` parsed mapping
- **문제**: prompt가 "must be consistent" 강제하지만 코드 검증 없음. 워커 응답에 verdict "good" + score 3 silent 통과
- **변경**: H2 enum 도입 후 enum-score 매핑 강제
  ```ts
  const SCORE_RANGE_FOR_LABEL: Record<VerdictLabel, [number, number]> = {
    reject: [1, 4],
    needs_revision: [3, 6],
    approve_with_caveats: [5, 8],
    approve: [7, 10],
  };
  // mismatch면 warning에 emit + parsed.score를 null 처리
  ```
- **출처**: 내#1 + Codex#6 결합
- **비용**: validator 추가. mismatch 워커 응답을 보고하면 host가 재실행 결정

### H5. Multi-round 의미 정의
- **위치**: `engine.ts:773-774` (R2도 R1 builder 호출), `engine.ts:1380-1383` (aggregation은 last round only)
- **문제**: maxRounds>1 시 동일 평가 반복, 마지막 라운드만 집계. test-retest reliability 의도라면 모든 라운드 집계해야 의미. 의도 모호
- **선택**:
  - (a) maxRounds=1 강제 (handler validation)
  - (b) 모든 라운드 응답 flatten + variance 보고
- **권고**: (a). 측정 의도 명확화 후 (b) 결정
- **출처**: Codex#10
- **비용**: handler validation 1줄

---

## Medium

### M1. Score anchor 세분화
- **위치**: `prompts.ts:495`
- **문제**: 5-6/7-8 경계 모호 ("acceptable with notable" vs "good with minor")
- **변경**:
  ```
  Score anchors: 1-2 = unusable/fundamentally wrong; 3-4 = major failures blocking intended use; 5 = minimally acceptable with material gaps; 6 = acceptable with manageable but visible issues; 7 = solid, only minor issues; 8 = strong, no material issues; 9 = excellent with strengths beyond baseline; 10 = exceptional, reference-quality.
  ```
- **출처**: Codex#2
- **비용**: 1줄 교체

### M2. Verdict multi-line 파싱
- **위치**: `engine.ts:886`
- **문제**: 다음 줄 verdict 절단
- **변경**:
  ```ts
  const verdictMatch = r.content.match(
    /^\s*(?:verdict|결론|판정)\s*[:=]\s*([^|\n].*?)(?=\n\s*(?:score|rating|점수|overall)\s*[:=]|\s*$)/ims,
  );
  ```
- **출처**: Codex#3
- **비용**: 한 줄 교체. H2 enum 도입 시 verdict_label 중심으로 옮기면 영향 약화

### M3. "Do not invent criteria" — out-of-scope 별도 채널
- **위치**: `prompts.ts:480`
- **문제**: 기준 밖 치명 결함 보고 막힘
- **변경**:
  ```
  Evaluate the subject against the provided criteria. Do not add new scoring criteria or change the rubric.
  If you notice a material out-of-scope risk, report it separately as <out_of_scope_risk>...</out_of_scope_risk>. Do not let it change the score unless the host criteria already cover it.
  ```
- **출처**: Codex#4
- **비용**: 2줄

### M4. Confidence 결론 우선 규칙
- **위치**: `prompts.ts:487`, `engine.ts:181-197`
- **문제**: parseConfidence는 본문 빈도 채택. 결론 confidence와 다를 수 있음
- **변경**:
  - prompt: "End with a single line: `final_confidence: HIGH|MEDIUM|LOW`. This overrides any inline confidence in the analysis above."
  - parseConfidence: `final_confidence:` 패턴 발견 시 우선 (matches 1개로 결정), 없으면 기존 빈도 fallback
- **출처**: 내#2
- **비용**: parser 분기 + prompt 1줄

### M5. Subject anonymization / identity bias
- **위치**: `prompts.ts:480` constraints
- **변경**:
  ```
  Ignore author identity, organization, brand, demographic attributes, and model/vendor names unless the criteria explicitly require them. Base the score on subject content and stated evidence.
  ```
- **출처**: Codex#9
- **비용**: 1줄

### M6. task vs subject 경계
- **위치**: `prompts.ts:506-511`
- **문제**: `<task>`가 평가 의도 메타지만 워커가 "사용자 원 의도"로 fold-in 가능
- **변경**: constraints에 명시
  ```
  <task> describes the host's evaluation intent. Use it only to clarify scope. <subject> is the artifact you score. Do not let <task> phrasing change the evaluation criteria or score.
  ```
- **출처**: 내#3
- **비용**: 2줄

### M7. Criteria weight 적용 가이드
- **위치**: `prompts.ts:487-489`
- **문제**: weight 명시된 criteria 적용 방법 부재
- **변경**: output format에 추가
  ```
  If criteria specify weights (e.g., "Correctness 40%"), report criterion_score for each separately, then compute final_score = sum(criterion_score * weight). Show the calculation.
  ```
- **출처**: 내#4
- **비용**: 2줄

### M8. SOTA G-Eval / reference-aware
- **위치**: `prompts.ts:485-495`
- **문제**: criterion별 점수 분리, reference-based/free 구분 부재
- **변경**: output-format 보강 (M7과 결합)
  ```
  1. Identify reference-based or reference-free evaluation.
  2. For each criterion: criterion_score [1-10], evidence, failure modes, calibrated confidence.
  3. Check criterion-score ↔ final-score consistency.
  4. verdict_label, verdict, score, final_confidence.
  ```
- **출처**: Codex#11
- **비용**: 5줄. spec.ts 영향

---

## Low

### L1. Worker isolation 강화
- **위치**: `prompts.ts:482`
- **변경**:
  ```
  Judge independently. Do not predict, imitate, or optimize for how other evaluators might score. Your score must come only from the subject, criteria, and evidence you can state.
  ```
- **출처**: Codex#5
- **비용**: 1줄

### L2. Host 합성 단계 가이드 (SKILL.md)
- **위치**: SKILL.md / playbook
- **변경**: eval에 합성 없지만 host 후처리 가이드 — tie 명시·confidence 분포·out_of_scope_risks 보고
- **출처**: 내#5
- **비용**: 문서 추가

### L3. DEPTH_* 미주입 결정
- **위치**: `prompts.ts:475-479`
- **변경**: 보류. contested subject(윤리·법률) 평가용 frame 다양화는 host가 criteria 작성 시 책임. 측정 후 결정
- **출처**: 내#6

### L4. wire.ts dead path
- **위치**: `wire.ts:140` evaluation_scoring가 buildSharedConvergenceR1 default
- **문제**: engine.ts:773-774에서 자체 builder 호출 → wire.ts default 무관. dead code
- **변경**: wire.ts switch에서 host_intr·seq·eval·red_team 분기 단순화 — chat fn만 전달, builder는 engine이 직접 import
- **출처**: 내(추가 발견)
- **비용**: refactor

---

## 실행 순서

1. **C1 voting bug** — 10줄. spec.ts 업데이트. 즉시
2. **H5 maxRounds=1 강제** — handler validation 1줄
3. **H1 score regex** — 한 줄. 측정 후 적용
4. **M1 anchor 세분화** — 1줄
5. **M2 verdict multi-line** — H2 도입 후 약화
6. **L1 worker isolation 강화** — 1줄
7. **M3 out_of_scope_risk** — 2줄
8. **M5 anonymization** — 1줄
9. **M6 task vs subject** — 2줄
10. **M4 final_confidence** — parser + prompt
11. **H3 confidence weight** — 가중치 변경. 측정 권장
12. **M7+M8 criteria weight + G-Eval** — output format 보강
13. **H2 verdict_label enum** — 큰 변경. types·prompt·engine·spec
14. **H4 verdict-score 일관성** — H2 적용 후
15. **L4 wire dead path** — cleanup

---

## 측정 권고

- C1 적용 전후: voting 결과의 majority/tie 분포
- H3 가중치 변경 전후: weightedScore 분포·랭킹 안정성
- H1 regex 변경 전후: score 파싱 성공률
- H2 enum 적용 후: consensus 도달 빈도 (관용 표현 변형으로 인한 silent 실패 감소)

---

## Out of scope

- Reference corpus 자동 fetch (reference-based eval)
- Inter-rater reliability 자동 계산 (Cohen's kappa 등) — 별도 작업
- Score calibration via Bradley-Terry (이미 axis에 존재하지만 deliberate path 미통합)
