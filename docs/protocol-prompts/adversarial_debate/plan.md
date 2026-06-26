# adversarial_debate 정밀화 계획

Codex(GPT-5.4) + Claude(Opus 4.7) 이원 리뷰. 합의 + 단독 항목 통합.

---

## High (즉시)

### H1. Self-critique + fabrication 가드 추가
- **위치**: `prompts.ts:51-56` `ANTI_CONFORMITY_ADVERSARIAL`
- **문제**: (a) 자기 R1 입장에 동일 falsification 기준 미적용 → self blind spot 보존. (b) `red_team_attacker`(538)는 "Do not fabricate" 명시지만 adversarial는 없음 → 견고한 입장에 약한 critique 양산 유인
- **변경**: `ANTI_CONFORMITY_ADVERSARIAL` 끝에 추가
  ```
  Apply the same falsification standard to your own prior position — do not exempt yourself.
  If a position survives your strongest attack, state so explicitly. Fabricated critiques are worse than no critique.
  ```
- **출처**: 내#1, 내#2
- **비용**: 2줄

### H2. Steelman 출력 구조 강제
- **위치**: `prompts.ts:361-364` R2+ user message, `prompts.ts:393-396` FollowUp
- **문제**: steelman은 지시만 있고 출력 검증 없음. 워커가 "steelman했다"고 선언만 가능
- **변경**: R2+에 `<output-format>` 추가
  ```
  <output-format>
  For each position you challenge:
  1. <steelman>strongest form of the opposing argument</steelman>
  2. <weakest-point>the specific flaw with evidence</weakest-point>
  3. <verification>cheapest test that would settle the disagreement</verification>
  4. <concession>what you concede, if any, and the evidence that moved you</concession>
  Do not critique a position unless its steelman is present.
  </output-format>
  ```
- **출처**: Codex#2 (보강: verification test는 Codex#10)
- **비용**: ~8줄. spec.ts 영향

### H3. R1 attack-angle scaffolding
- **위치**: `prompts.ts:305-323` `buildAdversarialDebateR1`
- **문제**: 모든 워커가 동일 R1 prompt. R1 starting position 다양성이 모델 차이에만 의존. shared_convergence는 lens로 차별화, adversarial는 무차별
- **변경**: workerIndex 기반 attack-angle 5종 부여 (lens가 아닌 공격 각도)
  ```ts
  const ATTACK_ANGLES = [
    "Focus on hidden assumptions — what implicit premises must hold for this default to work?",
    "Focus on evidence gaps — what is asserted without measurable support?",
    "Focus on operational failure — under what conditions does this break in production?",
    "Focus on edge cases and adversarial input — what scenarios make this fall apart?",
    "Focus on incentive misalignment — whose interests does this serve vs whose does it harm?",
  ];
  ```
  R1 user message에 `<attack-angle>` 태그로 주입
- **출처**: Codex#4
- **비용**: 상수 + 5 분기. `_workerIndex` 실제 사용으로 전환

### H4. Final-round semantics 명시
- **위치**: `prompts.ts:361-364` R2+ user, `prompts.ts:393-396` FollowUp
- **문제**: adversarial final = ? 워커·호스트 모두 모호. shared_convergence처럼 "commit" 하면 adversarial 본질 손상
- **변경**: final round 조건 분기 추가
  ```
  if (roundInfo && roundInfo.current === roundInfo.max && roundInfo.max > 1) {
    userParts.push("This is the final adversarial round. Output: (a) unresolved objections in priority order, (b) explicit concessions with evidence, (c) remaining open questions requiring evidence to settle.");
  }
  ```
- **출처**: Codex#7 + 내#5
- **비용**: 분기 + 1줄 prompt

### H5. Falsifiability + verification test
- **위치**: H2와 결합 (`<verification>` 태그)
- **출처**: Codex#10 (NIST AI red-teaming + Scientific Reports 2026)
- **상태**: H2에 흡수. 별도 작업 불필요

---

## Medium

### M1. Concede ↔ do-not-agree 경계 명확화
- **위치**: `prompts.ts:53-55`
- **문제**: "Concede" + "Do not agree to reach consensus" + DEPTH_EXPLORE "revise" 3중 → 워커 응답 양극 (0 concession 또는 과도 concession) 추정
- **변경**:
  ```
  // 현재
  Concede points where the opposing evidence is genuinely stronger than yours.
  State what you concede and why, with the specific evidence that convinced you.
  Do not agree to reach consensus. Do not soften criticism.
  // 변경
  Concede facts or logic when evidence is genuinely stronger — never to reach consensus or soften criticism.
  For each disagreement, output both: where you concede and where you do not, with the specific evidence supporting each.
  ```
- **출처**: Codex#3 + 내#6
- **비용**: 2줄 교체

### M2. DEPTH_EXPLORE의 adversarial 한정 해석 명시
- **위치**: `prompts.ts:38-39`
- **문제**: "If you cannot defend against it, revise" — adversarial 모드에서 revise = 합의로 오해 가능
- **변경**: `DEPTH_EXPLORE`는 그대로 두고, `ADVERSARIAL_SYSTEM`(290-293)에 1줄 추가
  ```
  In adversarial_debate, revision means narrowing or correcting claims, not reducing scrutiny.
  ```
- **출처**: Codex#3
- **비용**: 1줄

### M3. Protocol 명시 태그
- **위치**: `prompts.ts:361, 393` R2+ user / FollowUp
- **문제**: 워커가 자기가 adversarial 모드인지 shared 모드인지 명시 신호 없음 (`<positions-to-challenge>` 명명만으로 추론)
- **변경**: R1/R2/FollowUp 모두에 `<protocol>adversarial_debate</protocol>` + `<round-goal>` 1줄 주입
  ```
  <round-goal>Challenge, falsify, and preserve unresolved disagreements. Do not converge.</round-goal>
  ```
- **출처**: Codex#5
- **비용**: 3 위치 × 2줄

### M4. Cold-join 워커 anchor
- **위치**: `prompts.ts:215-223` (fallback transcript), R2 user 구성
- **문제**: model swap 시 새 워커가 ownPrevious 없이 cold-join. adversarial에선 anchor 없는 채로 공격 진행 → 얕은 critique
- **변경**: ownPrevious가 없을 때 R2 user message에 1줄 추가
  ```
  Cold-join: select one position to defend OR one unique angle of attack before proceeding. State your choice in your first sentence.
  ```
- **출처**: 내#4
- **비용**: 분기 1줄

### M5. Digest 사용 — Lost-in-the-Middle
- **위치**: `prompts.ts:341-344` (R2 `<positions-to-challenge>` 구성)
- **문제**: `formatOtherPositions`가 full content. N=5 × 2K = 10K token. challenger 본인 instruction 도달 전 dilution
- **변경**: adversarial 전용 formatter — `extractDebateDigest` 활용
  ```ts
  function formatChallengeTargets(responses, workerIndex) {
    return responses
      .filter(r => r.workerIndex !== workerIndex)
      .map(r => {
        const digest = extractDebateDigest(r.content);
        return `One analyst argues:\n${escapeXmlContent(digest)}\n\n<full-position-available>true</full-position-available>`;
      })
      .join("\n\n");
  }
  ```
- **출처**: Codex#9 + 내#3
- **비용**: 함수 1개 추가

### M6. Acceptance prompt adversarial 분기
- **위치**: `prompts.ts:588-608`
- **문제**: "your position" 검토 prompt가 합의용. adversarial 워커는 입장+steelman+concession+critique 모두 출력 → "represents faithfully" 의미 모호
- **변경**: `buildAcceptanceMessages` 시그니처에 `protocol?: Protocol` 추가. adversarial일 때:
  ```
  For adversarial_debate: check whether the synthesis preserves your strongest objections, key concessions, and unresolved disagreements. Do not require consensus.
  ```
- **출처**: Codex#8 + 내#7
- **비용**: 시그니처 변경 + 분기

---

## Low

### L1. Min worker 2 → 3 권장
- **위치**: `wire.ts:193-195`
- **문제**: 2명은 binary echo 위험. provider 다양성 사후 warning만 있음
- **변경**: 2명 허용 유지하되 input metadata에 `low_worker_count` warning 강제. 또는 SKILL.md operational caveat에 "adversarial은 ≥3 권장" 명시
- **출처**: Codex#6
- **권고**: SKILL.md 가이드만 추가. 코드 강제는 측정 후 결정

### L2. `--worker-instructions` adversarial 패턴 가이드
- **위치**: SKILL.md
- **문제**: shared-convergence.md에는 use/skip 가이드 있음. adversarial에는 없음
- **변경**: 본 plan과 별도. adversarial-debate playbook 작성 시 포함 (현재 `docs/protocol-prompts/adversarial_debate/playbook.md` draft에 일부 있음 — skill로 이전 시 보강)
- **출처**: 내#8

---

## 실행 순서

1. **H3 attack-angle** — 상수 추가 + R1 분기. 한 곳
2. **H4 final-round semantics** — 분기 추가
3. **M2 adversarial revision 단서** — system 1줄
4. **M3 protocol 명시 태그** — 3 위치
5. **M4 cold-join anchor** — 분기 1줄
6. **M1 concede 경계** — fragment 교체
7. **H1 self-critique + fabrication** — fragment 추가 2줄
8. **M5 digest 사용** — 함수 추가
9. **H2 steelman output-format** — 8줄 + spec.ts 업데이트
10. **M6 acceptance 분기** — 시그니처 변경

각 변경 후 dump 스크립트 재실행으로 worker.md 갱신.

---

## 측정 권고 (실행 후)

가설:
- H1 적용 후 워커 응답에 self-position에 대한 falsification 시도 빈도 ≥30%
- H2 적용 후 critique당 steelman 명시 비율 ≥80%
- H3 적용 후 R1 응답 간 attack-angle diversity 측정 가능 (angle 5종 분포)
- M1 적용 후 concession 빈도 분포가 양극에서 mid로 이동

측정 후 추가 정밀화 결정.

---

## Out of scope

- 다른 protocol 영향: 없음 (adversarial 전용 변경)
- engine.ts 변경: H4의 분기·M4·M6만 영향. early termination·convergence 로직 무수정
- 새 protocol·기능: 본 작업은 정밀화 한정
