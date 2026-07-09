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
</constraints>

<output-format>
Analyze each criterion against the provided criteria, with reasoning. Then state which criterion or criteria weighed most and the rule by which your per-criterion assessments set the overall score (e.g. the worst criterion floors it, or strengths and weaknesses balance out) — the rule is yours, but state it, so a split score reflects genuine disagreement, not a hidden weighting. Where the completion-check asks you to mark a claim's confidence, express it as reasoning in the body (e.g. "the evidence here is weak" or "this is well-supported"); reserve the literal words HIGH, MEDIUM, and LOW for the single confidence line below, because only that line is read as your overall confidence.

Then close with exactly these four labeled lines, in this order, as plain text — no markdown, no emphasis on the labels or values, each read literally:
judgment: <one sentence overall, consistent with your analysis>
confidence: <exactly one of HIGH, MEDIUM, LOW — a single word, not a range>
verdict: <exactly one of broken, significant-issues, acceptable, good, excellent>
score: <an integer 1-10 in the tier your verdict names: broken 1-2, significant-issues 3-4, acceptable 5-6, good 7-8, excellent 9-10>
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

- 워커 격리 — role 라인 'Evaluate independently'만으로 강제. 단일 라운드라 peer 출력이 주입되는 경로 자체가 없음.
- 출력 형식 강제: judgment/confidence/verdict/score 4줄. verdict는 다섯 tier 단어 중 하나, score는 그 tier band에 고정.
- DEPTH_EXPLORE / DEPTH_REFINE 미주입 — `buildSystemPrompt` 두 번째 인자 생략.
- CONFIDENCE_AND_UNCERTAINTY 별도 fragment 미주입. 주장별 confidence는 본문에 산문으로, 리터럴 HIGH/MEDIUM/LOW 토큰은 마지막 confidence 줄에만.
