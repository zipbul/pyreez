# `host_interrogation` — Worker Full Prompt

워커 LLM이 실제로 받는 메시지 array. `prompts.ts`의 빌더 함수 반환값을 verbatim 복사.
엔진 → LLM client (`chat(model, messages, params)`)는 메시지 content 변형 없음 — 본 dump = 프로바이더에 도달하는 prompt 그대로.

**Sample inputs (모든 프로토콜 공유, 프로덕션에서는 사용자 입력으로 치환)**:

- `task`: "Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months."
- `workerInstructions`: "Tie each point to the team's stated constraints (4 people, 6-month MVP) and be concrete about the conditions under which it applies."
- `team`: 3 workers (gpt-5, claude-opus-4-7, gemini-2.5-pro)

## Worker (no previous exchanges) — `buildHostInterrogationMessages`

### role: `system`

```
<role>Answer the question directly and thoroughly. No preamble.</role>

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

If the question challenges your previous answer, address the challenge with evidence — do not simply reaffirm.

<constraints>
Answer only what is asked. Do not volunteer unrelated analysis.
If the question contains a false premise, identify it before answering.
</constraints>
```

### role: `user`

```
<question>What is the single most likely failure mode for PostgreSQL on a 4-person SaaS MVP and what early signal precedes it?</question>

<context>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</context>
```

## Worker (with previous exchanges, session continuation)

### role: `system`

```
<role>Answer the question directly and thoroughly. No preamble.</role>

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

If the question challenges your previous answer, address the challenge with evidence — do not simply reaffirm.

<constraints>
Answer only what is asked. Do not volunteer unrelated analysis.
If the question contains a false premise, identify it before answering.
</constraints>
```

### role: `user`

```
<previous-exchange>
<question>Have you previously assumed any specific traffic profile?</question>
<your-answer>I assumed read-heavy with stable schema. If that assumption breaks, PostgreSQL's edge weakens.</your-answer>
</previous-exchange>

<question>What is the single most likely failure mode for PostgreSQL on a 4-person SaaS MVP and what early signal precedes it?</question>

<context>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</context>
```

## Notes (코드 fact 출처)

- 워커 간 격리 — 다른 워커 응답 미주입 (`prompts.ts:415-436`).
- system prompt에 false-premise 거부 강제 (`prompts.ts:407-410`).
- `workerInstructions`는 빌더 시그니처에 없음 — host_interrogation은 host instructions를 주입하지 않는다 (`prompts.ts:415-419`).
