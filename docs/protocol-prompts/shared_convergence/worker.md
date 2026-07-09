# `shared_convergence` — Worker Full Prompt

워커 LLM이 실제로 받는 메시지 array. `prompts.ts`의 빌더 함수 반환값을 verbatim 복사.
엔진 → LLM client (`chat(model, messages, params)`)는 메시지 content 변형 없음 — 본 dump = 프로바이더에 도달하는 prompt 그대로.

**Sample inputs (모든 프로토콜 공유, 프로덕션에서는 사용자 입력으로 치환)**:

- `task`: "Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months."
- `workerInstructions`: "Tie each point to the team's stated constraints (4 people, 6-month MVP) and be concrete about the conditions under which it applies."
- `team`: 3 workers (gpt-5, claude-opus-4-7, gemini-2.5-pro)

## Worker R1 (workerIndex=0, roundInfo={current:1,max:3}, instructions present) — `buildSharedConvergenceR1`

### role: `system`

```
<role>Think deeply, present concisely. No preamble — lead with your position.</role>

<grounding>
- Every factual claim must point to specific evidence: a benchmark, a versioned spec, a production incident, or a measurable signal.
- For speculative reasoning, state the chain explicitly so it can be checked.
- Reject a flawed premise outright — do not build on a broken foundation.
- Express uncertainty where it exists; never force confidence on an ambiguous point.
</grounding>

<completion-check>
Before submitting, verify every major claim carries both evidence and a confidence marker. Drop any claim that fails this check.
</completion-check>

Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.
```

### role: `user`

```
<host-instructions>Tie each point to the team's stated constraints (4 people, 6-month MVP) and be concrete about the conditions under which it applies.</host-instructions>

<analysis-lens>Prioritize practical constraints: cost, time, the skills and resources required, and the effort to move from the current situation. What looks good in principle but fails in practice?</analysis-lens>

For each major claim, indicate your confidence:
- HIGH: strong evidence or direct expertise
- MEDIUM: reasonable inference but limited evidence
- LOW: speculative or uncertain
Do not force confidence — if genuinely uncertain, say so.

Explore broadly. Do not converge prematurely.

<task>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</task>
```

## Worker R1 (workerIndex=1) — diversity lens 차이 확인용

### role: `system`

```
<role>Think deeply, present concisely. No preamble — lead with your position.</role>

<grounding>
- Every factual claim must point to specific evidence: a benchmark, a versioned spec, a production incident, or a measurable signal.
- For speculative reasoning, state the chain explicitly so it can be checked.
- Reject a flawed premise outright — do not build on a broken foundation.
- Express uncertainty where it exists; never force confidence on an ambiguous point.
</grounding>

<completion-check>
Before submitting, verify every major claim carries both evidence and a confidence marker. Drop any claim that fails this check.
</completion-check>

Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.
```

### role: `user`

```
<host-instructions>Tie each point to the team's stated constraints (4 people, 6-month MVP) and be concrete about the conditions under which it applies.</host-instructions>

<analysis-lens>Prioritize long-term consequences: ongoing burden, limits that appear as scale or stakes grow, where the field is heading, and how hard the choice is to reverse. What decision will you regret in 2 years?</analysis-lens>

For each major claim, indicate your confidence:
- HIGH: strong evidence or direct expertise
- MEDIUM: reasonable inference but limited evidence
- LOW: speculative or uncertain
Do not force confidence — if genuinely uncertain, say so.

Explore broadly. Do not converge prematurely.

<task>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</task>
```

## Worker R2 (workerIndex=0, current=2/max=3, otherResponses=[1,2], ownPrevious=[0]) — `buildSharedConvergenceR2`

### role: `system`

```
<role>Think deeply, present concisely. No preamble — lead with your position.</role>

<grounding>
- Every factual claim must point to specific evidence: a benchmark, a versioned spec, a production incident, or a measurable signal.
- For speculative reasoning, state the chain explicitly so it can be checked.
- Reject a flawed premise outright — do not build on a broken foundation.
- Express uncertainty where it exists; never force confidence on an ambiguous point.
</grounding>

<completion-check>
Before submitting, verify every major claim carries both evidence and a confidence marker. Drop any claim that fails this check.
</completion-check>

Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.
```

### role: `user`

```
<other-positions>
One analyst argues (their confidence: HIGH):
Position: The premise is suspect — PostgreSQL is rarely worse for MVPs. Conditions where it loses: (1) team has zero SQL experience and prototypes in JS/TS only, (2) data model is genuinely graph/document with cross-collection joins rare, (3) deploy target is serverless with cold-start sensitivity (Neon mitigates but not fully).

One analyst argues (their confidence: LOW):
Position: Cannot decide without traffic profile. If reads dominate and shape is fixed → PostgreSQL wins. If shape mutates and team writes only TS → MongoDB ergonomics win. Evidence weak — depends on team's stack familiarity, which is unspecified.
</other-positions>

<your-previous>Position: PostgreSQL underperforms MongoDB when (a) schema churns weekly during MVP, (b) workload is document-shaped with deeply nested JSON, (c) ops capacity is zero. Evidence: MongoDB Atlas free tier removes ops burden; pg JSONB lacks per-field index ergonomics.</your-previous>

<host-instructions>Tie each point to the team's stated constraints (4 people, 6-month MVP) and be concrete about the conditions under which it applies.</host-instructions>

<analysis-lens>Prioritize practical constraints: cost, time, the skills and resources required, and the effort to move from the current situation. What looks good in principle but fails in practice?</analysis-lens>

<constraints>
Assess discrepancies between your analysis and others' using specific evidence.
Change your position only when evidence against your analysis is clear.
State what specific evidence or logic led you to agree or disagree.
Do not rely on conformity, consensus, or social pressure.
When others report their confidence, weigh their evidence against their stated certainty: high-confidence claims with weak evidence are red flags; low-confidence claims with strong evidence deserve attention.
</constraints>

For each major claim, indicate your confidence:
- HIGH: strong evidence or direct expertise
- MEDIUM: reasonable inference but limited evidence
- LOW: speculative or uncertain
Do not force confidence — if genuinely uncertain, say so.

<task>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</task>
```

## Worker R3 final round (workerIndex=0, current=3/max=3) — `buildSharedConvergenceR2` with final-round notice

### role: `system`

```
<role>Think deeply, present concisely. No preamble — lead with your position.</role>

<grounding>
- Every factual claim must point to specific evidence: a benchmark, a versioned spec, a production incident, or a measurable signal.
- For speculative reasoning, state the chain explicitly so it can be checked.
- Reject a flawed premise outright — do not build on a broken foundation.
- Express uncertainty where it exists; never force confidence on an ambiguous point.
</grounding>

<completion-check>
Before submitting, verify every major claim carries both evidence and a confidence marker. Drop any claim that fails this check.
</completion-check>

Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.
```

### role: `user`

```
<other-positions>
One analyst argues (their confidence: HIGH):
Position: The premise is suspect — PostgreSQL is rarely worse for MVPs. Conditions where it loses: (1) team has zero SQL experience and prototypes in JS/TS only, (2) data model is genuinely graph/document with cross-collection joins rare, (3) deploy target is serverless with cold-start sensitivity (Neon mitigates but not fully).

One analyst argues (their confidence: LOW):
Position: Cannot decide without traffic profile. If reads dominate and shape is fixed → PostgreSQL wins. If shape mutates and team writes only TS → MongoDB ergonomics win. Evidence weak — depends on team's stack familiarity, which is unspecified.
</other-positions>

<your-previous>Position: PostgreSQL underperforms MongoDB when (a) schema churns weekly during MVP, (b) workload is document-shaped with deeply nested JSON, (c) ops capacity is zero. Evidence: MongoDB Atlas free tier removes ops burden; pg JSONB lacks per-field index ergonomics.</your-previous>

<host-instructions>Tie each point to the team's stated constraints (4 people, 6-month MVP) and be concrete about the conditions under which it applies.</host-instructions>

<analysis-lens>Prioritize practical constraints: cost, time, the skills and resources required, and the effort to move from the current situation. What looks good in principle but fails in practice?</analysis-lens>

<constraints>
Assess discrepancies between your analysis and others' using specific evidence.
Change your position only when evidence against your analysis is clear.
State what specific evidence or logic led you to agree or disagree.
Do not rely on conformity, consensus, or social pressure.
When others report their confidence, weigh their evidence against their stated certainty: high-confidence claims with weak evidence are red flags; low-confidence claims with strong evidence deserve attention.
</constraints>

For each major claim, indicate your confidence:
- HIGH: strong evidence or direct expertise
- MEDIUM: reasonable inference but limited evidence
- LOW: speculative or uncertain
Do not force confidence — if genuinely uncertain, say so.

This is the final round. Commit to your strongest position.

<task>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</task>
```

## Worker FollowUp (session continuation, workerIndex=0, current=2/max=3) — `buildSharedConvergenceFollowUp`

### role: `user`

```
<other-positions>
One analyst argues (their confidence: HIGH):
Position: The premise is suspect — PostgreSQL is rarely worse for MVPs. Conditions where it loses: (1) team has zero SQL experience and prototypes in JS/TS only, (2) data model is genuinely graph/document with cross-collection joins rare, (3) deploy target is serverless with cold-start sensitivity (Neon mitigates but not fully).

One analyst argues (their confidence: LOW):
Position: Cannot decide without traffic profile. If reads dominate and shape is fixed → PostgreSQL wins. If shape mutates and team writes only TS → MongoDB ergonomics win. Evidence weak — depends on team's stack familiarity, which is unspecified.
</other-positions>

<analysis-lens>Prioritize practical constraints: cost, time, the skills and resources required, and the effort to move from the current situation. What looks good in principle but fails in practice?</analysis-lens>

<constraints>
Assess discrepancies between your analysis and others' using specific evidence.
Change your position only when evidence against your analysis is clear.
State what specific evidence or logic led you to agree or disagree.
Do not rely on conformity, consensus, or social pressure.
When others report their confidence, weigh their evidence against their stated certainty: high-confidence claims with weak evidence are red flags; low-confidence claims with strong evidence deserve attention.
</constraints>
```

## Notes (코드 fact 출처)

- R1: lens 주입은 `roundInfo.max > 1` 조건. 단일 라운드면 lens 없음 (`prompts.ts:175-178`).
- R2: lens 복원 (round 간 lens loss 방지, `prompts.ts:230-233`) + ANTI_CONFORMITY constraints + final-round commit notice (`prompts.ts:238-240`).
- FollowUp: `system` 메시지 없음 — 기존 세션의 누적된 history 위에 user message 1개만 append.
