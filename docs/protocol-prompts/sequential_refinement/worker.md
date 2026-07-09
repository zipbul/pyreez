# `sequential_refinement` — Worker Full Prompt

워커 LLM이 실제로 받는 메시지 array. `prompts.ts`의 빌더 함수 반환값을 verbatim 복사.
엔진 → LLM client (`chat(model, messages, params)`)는 메시지 content 변형 없음 — 본 dump = 프로바이더에 도달하는 prompt 그대로.

**Sample inputs (모든 프로토콜 공유, 프로덕션에서는 사용자 입력으로 치환)**:

- `task`: "Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months."
- `workerInstructions`: "Tie each point to the team's stated constraints (4 people, 6-month MVP) and be concrete about the conditions under which it applies."
- `team`: 3 workers (gpt-5, claude-opus-4-7, gemini-2.5-pro)

## Worker[0] — chain 첫 워커 (previousOutput 없음, R1-style fallback) — `buildSharedConvergenceR1`로 위임

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

For each major claim, indicate your confidence:
- HIGH: strong evidence or direct expertise
- MEDIUM: reasonable inference but limited evidence
- LOW: speculative or uncertain
Do not force confidence — if genuinely uncertain, say so.

<task>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</task>
```

## Worker[1+] — 이후 체인 워커 (previousOutput 주어짐) — `buildSequentialRefinementMessages`

### role: `system`

```
<role>Improve the given work. Preserve what works, fix what doesn't, add what's missing. No preamble — lead with the improved version.</role>

<grounding>
- Every factual claim must point to specific evidence: a benchmark, a versioned spec, a production incident, or a measurable signal.
- For speculative reasoning, state the chain explicitly so it can be checked.
- Reject a flawed premise outright — do not build on a broken foundation.
- Express uncertainty where it exists; never force confidence on an ambiguous point.
</grounding>

<completion-check>
Before submitting, verify every major claim carries both evidence and a confidence marker. Drop any claim that fails this check.
</completion-check>

After your improvements, find the strongest argument against your changes. If you cannot defend a change, revert it.

<constraints>
Do not rewrite from scratch. Build on the previous version.
For every change, state what was wrong and why your version is better.
If the previous version is already correct in an area, leave it unchanged.
Your output must be at least as complete as the previous version. Do not remove content, detail, or explanations unless they are factually wrong. Shortening is not improving.
Apply evidence and confidence markers to your change rationale and other worker-facing commentary, not to the improved artifact itself. Do not insert labels like "Evidence:" or "Confidence:" into the artifact body unless the task explicitly asks for them.
</constraints>
```

### role: `user`

```
<host-instructions>Tie each point to the team's stated constraints (4 people, 6-month MVP) and be concrete about the conditions under which it applies.</host-instructions>

<previous-version>
## Draft v1
PostgreSQL is the right default because relational integrity catches MVP-stage data bugs early. Migrations cost an afternoon. JSONB covers document needs. Recommended: PostgreSQL.
</previous-version>

<task>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</task>
```

## Notes (코드 fact 출처)

- 첫 워커는 buildSharedConvergenceR1 호출(`prompts.ts:460-462`) — 즉 lens 주입 조건(maxRounds>1)에 따라 lens 가능. 단 default maxRounds=1(`wire.ts:153`)이라 사실상 lens 없음.
- 이후 워커는 specialized system prompt — 'Do not rewrite from scratch', 'Shortening is not improving' (`prompts.ts:443-448`).
- DEPTH_REFINE 추가 (`prompts.ts:41`): 변경에 대한 강한 반론 자가 생성.
