# red_team 정밀화 계획

Codex(GPT-5.4) + Claude(Opus 4.7) 이원 리뷰.

---

## High

### H1. DEPTH_EXPLORE 양 역할 주입
- **위치**: `prompts.ts:521-523, 531-533`
- **문제**: generator·attacker 모두 `buildSystemPrompt` 두 번째 인자 생략 → `DEPTH_EXPLORE`/`DEPTH_REFINE` 미주입. shared/adversarial 대비 결함
- **변경**:
  ```ts
  const RED_TEAM_GENERATOR_SYSTEM = buildSystemPrompt(
    "Produce the requested output. No preamble.",
    DEPTH_EXPLORE,
  );
  const RED_TEAM_ATTACKER_SYSTEM = buildSystemPrompt(
    "Find vulnerabilities in the given output. No preamble — lead with the most critical finding.",
    DEPTH_EXPLORE,
  );
  ```
- **출처**: Codex#2
- **비용**: 2줄

### H2. CONFIDENCE 양 역할 주입
- **위치**: `prompts.ts:526-529, 533-539`
- **문제**: parseConfidence 모든 응답에 적용. red_team은 prompt 자동 주입 없음 → silent miss. attacker는 severity proxy 있으나 generator는 없음
- **변경**: generator·attacker constraints에 추가
  ```
  For each major claim or decision, indicate confidence (HIGH/MEDIUM/LOW) and the evidence behind it.
  ```
- **출처**: Codex#3
- **비용**: 양 system 1줄씩

### H3. Severity 정의 + threat model + robust output 구조 (묶음)
- **위치**: `prompts.ts:533-539` ATTACKER constraints + buildRedTeamAttackerMessages
- **문제**: severity critical/high/medium/low 라벨만 있고 정의 없음. threat scope·actor·boundary·out-of-scope 가이드 없음. robust 판정 출력 구조 없음
- **변경**: ATTACKER system에 추가
  ```
  Rank findings by severity:
  - critical: directly exploitable; invalidates the core output under stated task constraints
  - high: likely exploitable; causes a major wrong decision
  - medium: plausible issue with bounded impact, or missing evidence for an important claim
  - low: minor ambiguity, incomplete edge case, presentation issue

  <threat-model>
  Stay within the task and host-instructions. Identify attacker capability, target asset, trust boundary, and impact for each finding. Mark out-of-scope scenarios separately instead of ranking them.
  </threat-model>
  ```
  output-format 추가:
  ```
  Return either:
  <robust>No exploitable findings found. Scope checked: ... Residual uncertainty: ...</robust>
  or one or more:
  <finding severity="critical|high|medium|low" target="target-id">
    <claim>...</claim>
    <proof>...</proof>
    <impact>...</impact>
    <out_of_scope>true|false</out_of_scope>
  </finding>
  ```
- **출처**: Codex#7+#8+#10
- **비용**: ATTACKER system ~15줄. spec.ts 업데이트

### H4. Generator attack-results tagged + triage
- **위치**: `engine.ts:809-810`, `prompts.ts:551-553`
- **문제**: 모든 attacker 출력 단일 blob (`\n\n---\n\n` 구분). generator가 어느 finding이 어느 attacker로부터인지 모름. triage 가이드 없음
- **변경**:
  ```ts
  // engine.ts
  .map((r) => `<attacker-result worker="${r.workerIndex}" model="${r.model}">\n${r.content}\n</attacker-result>`)
  .join("\n\n")
  ```
  prompt에 triage 1줄 추가:
  ```
  Triage attack-results by severity and duplicate status. Address critical/high findings first; explicitly defer low-priority items if needed.
  ```
- **출처**: Codex#5
- **비용**: engine 1줄, prompt 1줄

### H5. Attacker target-output id + cross-validation
- **위치**: `prompts.ts:572`, `engine.ts:829-831, 833-846`
- **문제**: (a) target-output 식별자 없음 — attacker가 어느 generator 출력 공격하는지 모호. (b) 여러 attacker 시 서로의 finding 검증 X — false positive·중복 미검출
- **변경**:
  ```ts
  // prompts.ts:572
  const targets = targetOutputs
    .map((o, i) => `<target-output id="${i + 1}">\n${o}\n</target-output>`)
    .join("\n\n");
  ```
  attacker output-format에 `target` 속성 필수 (H3에 포함)
  cross-validation은 R(n+2) attacker가 prior attacker ledger 받도록 — 별도 작업 (M2 참조)
- **출처**: Codex#6 + 내#2
- **비용**: format 변경

### H6. Replenishment red_team 허용
- **위치**: `engine.ts:1196`
- **문제**: red_team에 replenishment 비활성 (`cfg.protocol !== "red_team"` 조건). attacker fail 시 fallback 없음
- **변경**: 조건 제거 + red_team용 분기 — empty slot 계산을 "현재 라운드의 active role"만 기준으로
  ```ts
  if (emptySlots > 0 && fallbackDeps?.replenish && i === 1) {
    // red_team: only count slots in active role for this round
    const activeSlots = cfg.protocol === "red_team" ? activeRoleSlots(...) : emptySlots;
    ...
  }
  ```
- **출처**: Codex#12
- **비용**: 분기 + 활성 role 계산 함수

### H7. Acceptance role 비대칭 분기
- **위치**: `prompts.ts:588-616`
- **문제**: acceptance가 "your position" 단일 prompt. red_team generator/attacker 산출물 의미 다름 (artifact vs finding list)
- **변경**: `buildAcceptanceMessages` 시그니처에 `protocol?: Protocol`, `role?: "generator" | "attacker"` 추가. red_team일 때:
  ```
  Generator: "Does the synthesis preserve your generated artifact, stated assumptions, and residual risks without overstating robustness?"
  Attacker: "Does the synthesis preserve your findings, severity, proof, target id, and unresolved impact without weakening or merging them?"
  ```
- **출처**: Codex#13 (다른 protocol acceptance 분기와 통합)
- **비용**: signature 변경. adversarial M6, host_intr L6, sequential H5와 묶어 처리

### H8. roundsExecuted UX
- **위치**: output schema (`types.ts:DeliberateOutput`), `engine.ts:1387-1399`
- **문제**: red_team `roundsExecuted: 2`는 1 gen round + 1 atk round 의미. 합의/논쟁 R1+R2와 의미 다름. user 혼란
- **변경**: output에 `generatorRounds`·`attackerRounds` 분리 emit (red_team only)
  ```ts
  ...(cfg.protocol === "red_team" ? {
    generatorRounds: countGeneratorRounds(allRounds),
    attackerRounds: countAttackerRounds(allRounds),
  } : {}),
  ```
- **출처**: 내#1
- **비용**: output schema 추가

---

## Medium

### M1. Generator 방어 과장 금지
- **위치**: `prompts.ts:526-529`
- **문제**: attacker는 "Do not fabricate" 있으나 generator는 대칭 가드 없음. 방어 품질 과장 silent
- **변경**:
  ```
  Do not exaggerate robustness or defense quality. State residual risks and assumptions explicitly.
  ```
- **출처**: Codex#4
- **비용**: 1줄

### M2. Cross-round attack ledger
- **위치**: `engine.ts:809-820` (generator round), 추가 `attackerLedger` 구성
- **문제**: generator는 직전 round attacker만, attacker는 직전 round generator만. 누적 finding history 없음 → duplicate 발견·resolved 추적 X
- **변경**:
  ```ts
  const attackLedger = ctx.rounds
    .flatMap((round) => round.responses)
    .filter((r) => getRole(r.workerIndex) === "attacker")
    .map((r, i) => `<attack-result round="${r.round}" worker="${r.workerIndex}">${r.content}</attack-result>`)
    .join("\n\n");
  ```
  generator prompt에 "ledger as cumulative history. Mark each prior finding as addressed/partially-addressed/duplicate/still-open."
  attacker prompt에 "Review the attack ledger. Do not duplicate prior findings; mark prior findings as confirmed/falsified before adding new ones."
- **출처**: Codex#11 + 내#4 (attacker self-history) 통합
- **비용**: engine 분기 + 양 prompt 보강

### M3. roles 입력 validation
- **위치**: `handlers.ts` (handleDeliberate), `wire.ts:190`
- **문제**: `roles` 키가 잘못된 workerIndex 시 silent → default fallback. 의도 모호
- **변경**: handler에서 검증
  ```ts
  if (input.protocol === "red_team" && input.roles) {
    const validKeys = Object.keys(input.roles).every(k => {
      const n = Number(k);
      return Number.isInteger(n) && n >= 0 && n < input.models.length;
    });
    if (!validKeys) return { error: "roles keys must be valid worker indices [0, N)" };
  }
  ```
- **출처**: 내#3
- **비용**: validation 5줄

### M4. Default role split — attacker 우선
- **위치**: `engine.ts:799-801`
- **문제**: `ceil/2`로 generator 우세 (N=3 → gen 2, atk 1). 보안 검증에선 attacker 우세가 보통 더 효과적
- **변경**:
  ```ts
  const generatorCount = Math.max(1, Math.floor(participants.length / 2));
  return idx < generatorCount ? "generator" : "attacker";
  ```
- **출처**: Codex#1 + 본인 강조
- **비용**: 한 줄

### M5. Round alternation 옵션
- **위치**: `engine.ts:804`
- **문제**: 첫 라운드 무조건 generate. 기존 artifact 가지고 attack-first 사용 사례 unsupported
- **변경**: `DeliberateInput`에 `redTeam?: { start?: "generate" | "attack" }`, 또는 별도 `targetOutput?: string` 입력 받아 attack-first 가능하게
  ```ts
  const startWithAttack = input.redTeam?.start === "attack";
  const isAttackRound = startWithAttack ? roundNumber % 2 === 1 : roundNumber % 2 === 0;
  ```
- **출처**: Codex#9
- **비용**: types + engine. 측정 후 결정

### M6. Generator가 attacker 정체성 인지
- **위치**: `prompts.ts:521-529`
- **문제**: generator가 attacker LLM이라는 사실 모름. LLM-specific attack vector(prompt injection·jailbreak) 우선순위 anchor 부재
- **변경**: system에 1줄
  ```
  Note: the attacker is an LLM agent. Prioritize defenses against prompt injection, jailbreak, role confusion, and structured-input parsing attacks alongside the task domain.
  ```
- **출처**: 내#5
- **비용**: 1줄

### M7. host-instructions 역할별 분리
- **위치**: `prompts.ts:544-580`
- **문제**: generator·attacker 모두 동일 instructions. 역할별 의도 다를 수 있음
- **변경**: `DeliberateInput`에 optional `generatorInstructions`·`attackerInstructions`. 미지정 시 공통 `workerInstructions` 사용
- **출처**: 내#7
- **비용**: types + 양 builder. 측정 후 결정

---

## Low

### L1. Playbook skill 이전
- **위치**: `docs/protocol-prompts/red_team/playbook.md` (draft 존재)
- **변경**: SKILL.md §1 표가 6 protocol 균등 커버하므로 미이전 결정 이미 됨. 그러나 red_team의 task-side 가이드(threat model·severity 도메인) 가치 큼. 별도 결정 — 본 plan 적용 후 host 부담 재평가
- **출처**: 내#6

### L2. SOTA 프레임워크 (NIST·STRIDE·OWASP·MITRE)
- **위치**: `prompts.ts:533-539` ATTACKER
- **변경**: H3 threat-model에 통합 + task-compatible rubric 한 줄 추가
  ```
  When security-relevant, classify findings by threat category (STRIDE/MITRE if applicable), state threat boundary, provide falsifiable proof or reproduction condition, distinguish verified findings from hypotheses.
  Do not cite frameworks unless they apply to the task.
  ```
- **출처**: Codex#14
- **비용**: H3에 통합

---

## 실행 순서

1. **H1 DEPTH_EXPLORE 양 역할** — 2줄
2. **H2 CONFIDENCE 양 역할** — 양 system 1줄씩
3. **M2 (전) M4 default role split** — 1줄
4. **M1 generator 과장 금지** — 1줄
5. **M6 attacker LLM identity** — 1줄
6. **M3 roles validation** — handler 5줄
7. **H3 severity 정의 + threat model + robust output 구조** — ATTACKER system 보강
8. **H4 generator attack-results tagged + triage** — engine + prompt
9. **H5 attacker target-output id + cross-validation** — format 변경
10. **M2 cross-round ledger** — engine + prompt
11. **H8 roundsExecuted 분리 emit** — output schema
12. **H6 replenishment 허용** — engine 분기
13. **M5 round alternation 옵션** — 측정 후
14. **M7 역할별 instructions** — 측정 후
15. **H7 acceptance role 분기** — 다른 protocol acceptance 분기와 통합 작업

---

## 측정 권고

- H1·H2 적용 전후: generator·attacker 응답 품질 평가 (depth·confidence 표기)
- H3 적용 후: severity 분포 (critical·high inflation 감소 가설)
- H4 적용 후: generator R3가 critical/high finding 우선 해결 비율
- H5+M2 적용 후: duplicate finding 감소, false positive 감소
- H7 적용 후: red_team acceptance verdict 분포 (generator·attacker 차등 검증)

---

## Out of scope

- Automated PoC verification (외부 도구 통합)
- 실시간 attack execution (워커는 LLM call only)
- BT 21-dim rating 통합 (axis/ 활용)
