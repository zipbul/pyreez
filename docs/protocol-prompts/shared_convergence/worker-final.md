# shared_convergence — worker가 받는 full prompt

## R1 (workerIndex=0)

### system

```
<role>Reason through this carefully, present concisely. No preamble — start with your position.</role>

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.
If a premise contains a factual error, internal contradiction, or impossibility, reject it and stop. Otherwise proceed with the task — discomfort with the framing is not grounds for refusal.
Express uncertainty where it exists. Do not force confidence on ambiguous points.
Before finishing, verify your key claims.

Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.
```

### user

```
<host-instructions>Cite a benchmark, official source, or production case for each major claim.</host-instructions>

<analysis-lens>Prioritize practical constraints: cost, timeline, team capability, migration effort. What looks good on paper but fails in practice?</analysis-lens>

For each major claim, indicate calibrated confidence:
- HIGH: strong evidence supporting the claim; ≥80% certain
- MEDIUM: reasonable inference but limited evidence; 50-79% certain
- LOW: speculative or uncertain; <50% certain
Do not force confidence — if genuinely uncertain, say so.

If you cannot cite a specific verifiable source (URL, paper, CVE, named incident, version-specific spec section, or measured production metric), label the claim as [unverified] rather than fabricating a citation. Fabricated citations are worse than missing citations.

<output-format>
Structure your response as:
1. Position: one-line statement of your stance on the task.
2. Body: for each major claim or supporting point, state:
   - Claim text.
   - Evidence: a verifiable citation OR [unverified].
   - Confidence: HIGH | MEDIUM | LOW.
3. End with exactly one line: final_confidence: HIGH|MEDIUM|LOW.
</output-format>

Explore broadly. Do not converge prematurely.

<task>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</task>
```

---

## R1 (workerIndex=1)

### system

```
<role>Reason through this carefully, present concisely. No preamble — start with your position.</role>

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.
If a premise contains a factual error, internal contradiction, or impossibility, reject it and stop. Otherwise proceed with the task — discomfort with the framing is not grounds for refusal.
Express uncertainty where it exists. Do not force confidence on ambiguous points.
Before finishing, verify your key claims.

Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.
```

### user

```
<host-instructions>Cite a benchmark, official source, or production case for each major claim.</host-instructions>

<analysis-lens>Prioritize long-term consequences: maintenance burden, scalability ceiling, ecosystem trajectory, lock-in risk. What decision will you regret in 2 years?</analysis-lens>

For each major claim, indicate calibrated confidence:
- HIGH: strong evidence supporting the claim; ≥80% certain
- MEDIUM: reasonable inference but limited evidence; 50-79% certain
- LOW: speculative or uncertain; <50% certain
Do not force confidence — if genuinely uncertain, say so.

If you cannot cite a specific verifiable source (URL, paper, CVE, named incident, version-specific spec section, or measured production metric), label the claim as [unverified] rather than fabricating a citation. Fabricated citations are worse than missing citations.

<output-format>
Structure your response as:
1. Position: one-line statement of your stance on the task.
2. Body: for each major claim or supporting point, state:
   - Claim text.
   - Evidence: a verifiable citation OR [unverified].
   - Confidence: HIGH | MEDIUM | LOW.
3. End with exactly one line: final_confidence: HIGH|MEDIUM|LOW.
</output-format>

Explore broadly. Do not converge prematurely.

<task>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</task>
```

---

## R2 (workerIndex=0)

### system

```
<role>Reason through this carefully, present concisely. No preamble — start with your position.</role>

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.
If a premise contains a factual error, internal contradiction, or impossibility, reject it and stop. Otherwise proceed with the task — discomfort with the framing is not grounds for refusal.
Express uncertainty where it exists. Do not force confidence on ambiguous points.
Before finishing, verify your key claims.

Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.
```

### user

```
<other-positions>
One analyst argues (their confidence: HIGH):
Position: The premise is suspect — PostgreSQL is rarely worse for MVPs. Conditions where it loses: (1) team has zero SQL experience and prototypes in JS/TS only, (2) data model is genuinely graph/document with cross-collection joins rare, (3) deploy target is serverless with cold-start sensitivity (Neon mitigates but not fully).

One analyst argues (their confidence: LOW):
Position: Cannot decide without traffic profile. If reads dominate and shape is fixed → PostgreSQL wins. If shape mutates and team writes only TS → MongoDB ergonomics win. Evidence weak — depends on team's stack familiarity, which is unspecified.
</other-positions>

<your-previous>Position: PostgreSQL underperforms MongoDB when (a) schema churns weekly during MVP, (b) workload is document-shaped with deeply nested JSON, (c) ops capacity is zero. Evidence: MongoDB Atlas free tier removes ops burden; pg JSONB lacks per-field index ergonomics.</your-previous>

<host-instructions>Cite a benchmark, official source, or production case for each major claim.</host-instructions>

<analysis-lens>Prioritize practical constraints: cost, timeline, team capability, migration effort. What looks good on paper but fails in practice?</analysis-lens>

<constraints>
Assess discrepancies between your analysis and others' using specific evidence.
Change your position only when evidence against your analysis is clear.
State what specific evidence or logic led you to agree or disagree.
Do not rely on conformity, consensus, or social pressure.
When others report their confidence, weigh their evidence against their stated certainty: high-confidence claims with weak evidence are red flags; low-confidence claims with strong evidence deserve attention.
</constraints>

For each major claim, indicate calibrated confidence:
- HIGH: strong evidence supporting the claim; ≥80% certain
- MEDIUM: reasonable inference but limited evidence; 50-79% certain
- LOW: speculative or uncertain; <50% certain
Do not force confidence — if genuinely uncertain, say so.

If you cannot cite a specific verifiable source (URL, paper, CVE, named incident, version-specific spec section, or measured production metric), label the claim as [unverified] rather than fabricating a citation. Fabricated citations are worse than missing citations.

<output-format>
Structure your response as:
1. Position: one-line statement of your stance on the task.
2. Body: for each major claim or supporting point, state:
   - Claim text.
   - Evidence: a verifiable citation OR [unverified].
   - Confidence: HIGH | MEDIUM | LOW.
3. End with exactly one line: final_confidence: HIGH|MEDIUM|LOW.
</output-format>

<task>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</task>
```

---

## R3 (final round)

### system

```
<role>Reason through this carefully, present concisely. No preamble — start with your position.</role>

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.
If a premise contains a factual error, internal contradiction, or impossibility, reject it and stop. Otherwise proceed with the task — discomfort with the framing is not grounds for refusal.
Express uncertainty where it exists. Do not force confidence on ambiguous points.
Before finishing, verify your key claims.

Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.
```

### user

```
<other-positions>
One analyst argues (their confidence: HIGH):
Position: The premise is suspect — PostgreSQL is rarely worse for MVPs. Conditions where it loses: (1) team has zero SQL experience and prototypes in JS/TS only, (2) data model is genuinely graph/document with cross-collection joins rare, (3) deploy target is serverless with cold-start sensitivity (Neon mitigates but not fully).

One analyst argues (their confidence: LOW):
Position: Cannot decide without traffic profile. If reads dominate and shape is fixed → PostgreSQL wins. If shape mutates and team writes only TS → MongoDB ergonomics win. Evidence weak — depends on team's stack familiarity, which is unspecified.
</other-positions>

<your-previous>Position: PostgreSQL underperforms MongoDB when (a) schema churns weekly during MVP, (b) workload is document-shaped with deeply nested JSON, (c) ops capacity is zero. Evidence: MongoDB Atlas free tier removes ops burden; pg JSONB lacks per-field index ergonomics.</your-previous>

<host-instructions>Cite a benchmark, official source, or production case for each major claim.</host-instructions>

<analysis-lens>Prioritize practical constraints: cost, timeline, team capability, migration effort. What looks good on paper but fails in practice?</analysis-lens>

<constraints>
Assess discrepancies between your analysis and others' using specific evidence.
Change your position only when evidence against your analysis is clear.
State what specific evidence or logic led you to agree or disagree.
Do not rely on conformity, consensus, or social pressure.
When others report their confidence, weigh their evidence against their stated certainty: high-confidence claims with weak evidence are red flags; low-confidence claims with strong evidence deserve attention.
</constraints>

For each major claim, indicate calibrated confidence:
- HIGH: strong evidence supporting the claim; ≥80% certain
- MEDIUM: reasonable inference but limited evidence; 50-79% certain
- LOW: speculative or uncertain; <50% certain
Do not force confidence — if genuinely uncertain, say so.

If you cannot cite a specific verifiable source (URL, paper, CVE, named incident, version-specific spec section, or measured production metric), label the claim as [unverified] rather than fabricating a citation. Fabricated citations are worse than missing citations.

<output-format>
Structure your response as:
1. Position: one-line statement of your stance on the task.
2. Body: for each major claim or supporting point, state:
   - Claim text.
   - Evidence: a verifiable citation OR [unverified].
   - Confidence: HIGH | MEDIUM | LOW.
3. End with exactly one line: final_confidence: HIGH|MEDIUM|LOW.
</output-format>

This is the final round. State your strongest position. Where evidence remains insufficient, preserve LOW confidence rather than inflating to close the deliberation.

<task>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</task>
```

---

## FollowUp (session continuation, system 미주입)

### user

```
<other-positions>
One analyst argues (their confidence: HIGH):
Position: The premise is suspect — PostgreSQL is rarely worse for MVPs. Conditions where it loses: (1) team has zero SQL experience and prototypes in JS/TS only, (2) data model is genuinely graph/document with cross-collection joins rare, (3) deploy target is serverless with cold-start sensitivity (Neon mitigates but not fully).

One analyst argues (their confidence: LOW):
Position: Cannot decide without traffic profile. If reads dominate and shape is fixed → PostgreSQL wins. If shape mutates and team writes only TS → MongoDB ergonomics win. Evidence weak — depends on team's stack familiarity, which is unspecified.
</other-positions>

<host-instructions>Cite a benchmark, official source, or production case for each major claim.</host-instructions>

<analysis-lens>Prioritize practical constraints: cost, timeline, team capability, migration effort. What looks good on paper but fails in practice?</analysis-lens>

<constraints>
Assess discrepancies between your analysis and others' using specific evidence.
Change your position only when evidence against your analysis is clear.
State what specific evidence or logic led you to agree or disagree.
Do not rely on conformity, consensus, or social pressure.
When others report their confidence, weigh their evidence against their stated certainty: high-confidence claims with weak evidence are red flags; low-confidence claims with strong evidence deserve attention.
</constraints>

For each major claim, indicate calibrated confidence:
- HIGH: strong evidence supporting the claim; ≥80% certain
- MEDIUM: reasonable inference but limited evidence; 50-79% certain
- LOW: speculative or uncertain; <50% certain
Do not force confidence — if genuinely uncertain, say so.

If you cannot cite a specific verifiable source (URL, paper, CVE, named incident, version-specific spec section, or measured production metric), label the claim as [unverified] rather than fabricating a citation. Fabricated citations are worse than missing citations.

<output-format>
Structure your response as:
1. Position: one-line statement of your stance on the task.
2. Body: for each major claim or supporting point, state:
   - Claim text.
   - Evidence: a verifiable citation OR [unverified].
   - Confidence: HIGH | MEDIUM | LOW.
3. End with exactly one line: final_confidence: HIGH|MEDIUM|LOW.
</output-format>

<task>Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.</task>
```
