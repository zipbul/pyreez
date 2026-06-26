# `host_interrogation` — Worker Revised Full Prompt

## 적용한 수정과 출처

- FIX 2 — raw injected content XML escape: `buildHostInterrogationMessages`에서 `task`, `question`, `previousExchanges[].question`, `previousExchanges[].answer`가 XML 태그 안에 raw 주입되는 것을 확인했다. 주입 전에 `escapeXmlContent`로 `<`, `>`, `&`를 escape한다.
- FIX 3 — `CONFIDENCE_AND_UNCERTAINTY` injection: host_interrogation system prompt에는 confidence fragment가 없고, confidence 안내를 user message의 `<question>`/`<context>` XML block 앞에 추가한다. 출처: arxiv 2601.19921, "explicit, calibrated confidence communication".
- FIX 4 — false-premise rejection priority: `Answer only what is asked`와 false-premise rejection이 같은 constraints block에 있지만 우선순위가 없다. false premise rejection이 scope discipline보다 우선한다는 priority order로 교체한다.

## 측정 후 결정

- FIX 1 — Anthropic chain-of-thought 문구 교체: `prompts.ts:402-410`의 host_interrogation system prompt에 `think` 또는 `think deeply`가 없어서 적용하지 않는다. 출처: Anthropic docs, `https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/chain-of-thought`.
- FIX 2 — code reading 결과 적용: XML escape는 prompt 문자열 조립 직전, 각 값이 태그에 삽입되기 전에 수행한다. 예: `<question>${escapeXmlContent(question)}</question>`, `<context>${escapeXmlContent(task)}</context>`, previous exchange의 question/answer도 동일.
- FIX 3 — code reading 결과 적용: confidence 안내는 system prompt가 아니라 user message의 맨 앞, previous exchanges보다 뒤가 아니라 `<task>/<context>` XML blocks 앞에 고정 삽입한다.
- FIX 4 — code reading 결과 적용: constraints block 내부 문장 순서를 priority order로 교체한다.

## Full revised prompts

Sample inputs:

- `task`: "Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months."
- `workerInstructions`: "Cite a benchmark, official source, or production case for each major claim."
- `team`: 3 workers (gpt-5, claude-opus-4-7, gemini-2.5-pro)

### A. Worker (no previous exchanges) — `buildHostInterrogationMessages`

#### role: `system`

```
<role>Answer the question directly and thoroughly. No preamble.</role>

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.
If a premise is flawed, reject it — do not build on a broken foundation.
Express uncertainty where it exists. Do not force confidence on ambiguous points.
Before finishing, verify your key claims.

Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.

If the question challenges your previous answer, address the challenge with evidence — do not simply reaffirm.

<constraints>
Priority order:
1. If the question contains a false premise, identify it and stop. Premise rejection takes precedence over scope discipline.
2. Otherwise, answer only what is asked. Do not volunteer unrelated analysis.
</constraints>
```

#### role: `user`

```
For each major claim, indicate calibrated confidence:
- HIGH: strong evidence; ≥80% certain
- MEDIUM: reasonable inference; 50-80% certain
- LOW: speculative; <50% certain
Do not force confidence — if genuinely uncertain, say so.

<question>What is the single most likely failure mode for PostgreSQL on a 4-person SaaS MVP and what early signal precedes it?</question>

<context>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</context>
```

### B. Worker (with previous exchanges, session continuation)

#### role: `system`

```
<role>Answer the question directly and thoroughly. No preamble.</role>

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.
If a premise is flawed, reject it — do not build on a broken foundation.
Express uncertainty where it exists. Do not force confidence on ambiguous points.
Before finishing, verify your key claims.

Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.

If the question challenges your previous answer, address the challenge with evidence — do not simply reaffirm.

<constraints>
Priority order:
1. If the question contains a false premise, identify it and stop. Premise rejection takes precedence over scope discipline.
2. Otherwise, answer only what is asked. Do not volunteer unrelated analysis.
</constraints>
```

#### role: `user`

```
For each major claim, indicate calibrated confidence:
- HIGH: strong evidence; ≥80% certain
- MEDIUM: reasonable inference; 50-80% certain
- LOW: speculative; <50% certain
Do not force confidence — if genuinely uncertain, say so.

<previous-exchange>
<question>Have you previously assumed any specific traffic profile?</question>
<your-answer>I assumed read-heavy with stable schema. If that assumption breaks, PostgreSQL's edge weakens.</your-answer>
</previous-exchange>

<question>What is the single most likely failure mode for PostgreSQL on a 4-person SaaS MVP and what early signal precedes it?</question>

<context>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</context>
```

## Diff table

| Fix | Before | After |
| --- | --- | --- |
| FIX 1 — `think`/`think deeply` replacement | `prompts.ts:402-410`에 해당 문구 없음 | 미적용. `Reason through this carefully` 추가 없음 |
| FIX 2 — XML escape | `<question>${question}</question>`, `<context>${task}</context>`, previous exchange question/answer raw interpolation | XML 삽입 전 `escapeXmlContent` 적용. Escape 대상은 `<`, `>`, `&` |
| FIX 3 — calibrated confidence | host_interrogation system prompt에 confidence fragment 없음. User message도 confidence 안내 없음 | user message 맨 앞에 calibrated confidence 안내 block 추가 |
| FIX 4 — priority order | `Answer only what is asked...` 다음 `If the question contains a false premise...`로 병렬 제약 | false-premise rejection을 1순위로 두고, false premise면 identify 후 stop. 그 외에만 asked scope로 제한 |
