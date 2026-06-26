# `evaluation_scoring` — Worker Full Prompt

워커 LLM이 실제로 받는 메시지 array. `prompts.ts`의 빌더 함수 반환값을 verbatim 복사.
엔진 → LLM client (`chat(model, messages, params)`)는 메시지 content 변형 없음 — 본 dump = 프로바이더에 도달하는 prompt 그대로.

**Sample inputs (모든 프로토콜 공유, 프로덕션에서는 사용자 입력으로 치환)**:

- `task`: "Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months."
- `workerInstructions`: "Tie each point to the team's stated constraints (4 people, 6-month MVP) and be concrete about the conditions under which it applies."
- `team`: 3 workers (gpt-5, claude-opus-4-7, gemini-2.5-pro)

## Worker — `buildEvaluationScoringMessages`

### role: `system`

```
<role>Evaluate independently. No preamble — lead with your analysis.</role>

<grounding>
- Every factual claim must point to specific evidence: a benchmark, a versioned spec, a production incident, or a measurable signal.
- For speculative reasoning, state the chain explicitly so it can be checked.
- Reject a flawed premise outright — do not build on a broken foundation.
- Express uncertainty where it exists; never force confidence on an ambiguous point.
</grounding>

<completion-check>
Before submitting, verify every major claim carries both evidence and a confidence marker. Drop any claim that fails this check.
</completion-check>

<constraints>
Evaluate the subject against the provided criteria. Do not invent additional criteria.
For each criterion, provide your own analysis and reasoning about the subject.
Do not consider how other evaluators might score. Judge independently.
</constraints>

<output-format>
1. Analyze each criterion with your reasoning.
2. For each major claim, indicate your confidence (e.g., **HIGH**, [MEDIUM], confidence: LOW).
3. Write your verdict (one sentence overall judgment).
4. Based on your verdict, assign a score.

End with exactly this format:
verdict: [one sentence — must be consistent with your analysis above]
score: [overall 1-10 — must match the severity described in your verdict]

Score anchors: 1-2 = fundamentally flawed/broken, 3-4 = significant issues, 5-6 = acceptable with notable issues, 7-8 = good with minor issues, 9-10 = excellent/exceptional.
</output-format>
```

### role: `user`

```
<host-instructions>Tie each point to the team's stated constraints (4 people, 6-month MVP) and be concrete about the conditions under which it applies.</host-instructions>

<evaluation-criteria>
1. Team velocity impact during MVP phase (weight 40%)
2. Operational burden for a 4-person team without dedicated DBA (weight 30%)
3. Schema evolution friction during weekly iteration (weight 30%)
</evaluation-criteria>

<subject>
Decision: Adopt PostgreSQL as the default database for a 4-person SaaS MVP launching in 6 months, with MongoDB rejected during architecture review.
</subject>

<task>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</task>
```

## Notes (코드 fact 출처)

- 워커 격리 — 'Do not consider how other evaluators might score' (`prompts.ts:483`).
- 출력 형식 강제: `verdict: ...` + `score: 1-10` 마지막 두 줄 + 점수 anchor 1-10 명시 (`prompts.ts:485-496`).
- DEPTH_EXPLORE / DEPTH_REFINE 미주입 — `buildSystemPrompt` 두 번째 인자 생략 (`prompts.ts:477`).
- CONFIDENCE_AND_UNCERTAINTY 별도 fragment 미주입. confidence 표기는 `<output-format>` 단계 2에서 인라인 강제.
