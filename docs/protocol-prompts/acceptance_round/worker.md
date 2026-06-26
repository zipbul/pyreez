# `acceptance_round` — Worker Full Prompt

워커 LLM이 실제로 받는 메시지 array. `prompts.ts`의 빌더 함수 반환값을 verbatim 복사.
엔진 → LLM client (`chat(model, messages, params)`)는 메시지 content 변형 없음 — 본 dump = 프로바이더에 도달하는 prompt 그대로.

**Sample inputs (모든 프로토콜 공유, 프로덕션에서는 사용자 입력으로 치환)**:

- `task`: "Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months."
- `workerInstructions`: "Tie each point to the team's stated constraints (4 people, 6-month MVP) and be concrete about the conditions under which it applies."
- `team`: 3 workers (gpt-5, claude-opus-4-7, gemini-2.5-pro)

## Acceptance — `buildAcceptanceMessages` (모든 프로토콜 공통, 합성 후 워커별 ratify)

### role: `system`

```
<role>You are reviewing whether this synthesis accurately represents your position and is factually grounded.</role>

<instructions>
1. Check if your position is accurately represented — not distorted, softened, or exaggerated.
2. Check if critical issues from your position are addressed — not ignored.
3. Check if factual claims in the synthesis are grounded — reject claims presented as facts without evidence or verification. Code/architecture claims must match actual code. External claims (benchmarks, statistics) must cite sources or be labeled uncertain.
</instructions>

<output-format>
Respond with ONLY the following XML structure:
<acceptance>
  <verdict>accept, partial, or reject</verdict>
  <misrepresented>What was distorted. "None." if accept.</misrepresented>
  <unresolved>Critical issues ignored OR ungrounded factual claims. "None." if accept.</unresolved>
</acceptance>
</output-format>
```

### role: `user`

```
## Your Original Position
Position: PostgreSQL underperforms MongoDB when (a) schema churns weekly during MVP, (b) workload is document-shaped with deeply nested JSON, (c) ops capacity is zero. Evidence: MongoDB Atlas free tier removes ops burden; pg JSONB lacks per-field index ergonomics.

## Synthesis
## Synthesis
PostgreSQL is the safer default for this MVP under three guardrails: (1) commit to JSONB only for genuinely sparse fields with explicit GIN indexes, (2) cap schema-changing migrations at 1/week with a rollback script, (3) revisit at 50k MAU. MongoDB wins only if the team has zero SQL fluency AND the data shape is deeply nested AND ops capacity is genuinely zero — a rare conjunction.

## Task
Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.
```

## Notes (코드 fact 출처)

- 프로토콜 아님 — 합성문에 대한 워커 ratify 단계. 참고용으로 함께 dump.
- 출력 강제 XML: `<acceptance><verdict>…</verdict>…</acceptance>` (`prompts.ts:601-608`).
