export const meta = {
  name: 'adversarial-quality-eval',
  description: 'Subagents use the pyreez skill (evaluation_scoring) to judge adversarial_debate output quality at an extreme bar',
  phases: [
    { title: 'SkillEval', detail: 'each subagent runs pyreez evaluation_scoring on one artifact + expert read' },
    { title: 'Synthesize', detail: 'combine into an extreme-bar quality verdict' },
  ],
}

const RUBRIC = "Score 1-10. 10 = a staff/principal engineer would accept EVERY finding in a real production design review with zero corrections. Penalize hard: any fabricated or unverifiable citation (a paraphrase presented as a direct quote counts as fabrication); any hallucinated incident/benchmark/spec; any steelman that is actually a strawman; any falsification test that would not actually falsify the claim; any severity not justified by real impact; any redundant or off-task finding. A SINGLE fabricated citation caps the score at 4. 7+ requires genuinely expert-grade, verifiable, non-redundant, correctly-severity-ranked findings. Be ruthless.";

const ARTIFACTS = args && args.length ? args : [
  { id: 'RESULT_t2', file: '.advq/RESULT_t2.txt', task: 'Redis 24h-TTL idempotency keys for payment retries — conditions causing double-charge / lost / duplicate payments', role: 'result (R2 consolidation)' },
  { id: 'RESULT_t3', file: '.advq/RESULT_t3.txt', task: '40-eng monorepo, single CI running full suite per PR — conditions where this CI fails / becomes unworkable', role: 'result (R2 consolidation)' },
  { id: 'PROCESS_t2', file: '.advq/PROCESS_t2.txt', task: 'Redis idempotency (R1 independent stress-test, before peer challenge)', role: 'process (R1)' },
  { id: 'PROCESS_t3', file: '.advq/PROCESS_t3.txt', task: 'monorepo CI (R1 independent stress-test, before peer challenge)', role: 'process (R1)' },
]

const EVAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['artifactId', 'role', 'pyreez', 'expert', 'verdictSummary'],
  properties: {
    artifactId: { type: 'string' },
    role: { type: 'string' },
    pyreez: {
      type: 'object', additionalProperties: false,
      required: ['ran', 'degraded', 'providersResponded', 'verdict', 'score', 'note'],
      properties: {
        ran: { type: 'boolean' },
        degraded: { type: 'boolean', description: 'true if codex/gemini failed and team shrank or fell back' },
        providersResponded: { type: 'array', items: { type: 'string' } },
        verdict: { type: 'string', description: "pyreez aggregation verdict/majorityVerdict, or '' if none" },
        score: { type: ['number', 'null'], description: 'pyreez weighted/avg score if present' },
        note: { type: 'string', description: 'process observation: degradation, self-judge bias (claude judging claude), failures' },
      },
    },
    expert: {
      type: 'object', additionalProperties: false,
      required: ['factualAccuracy', 'evidenceValidity', 'steelmanGenuineness', 'falsifiabilityConcreteness', 'severityJustified', 'hallucinations', 'fabricatedCitations', 'redundantFindings', 'offTaskFindings', 'meetsStaffEngineerBar', 'worstProblem'],
      properties: {
        factualAccuracy: { type: 'number' },
        evidenceValidity: { type: 'number' },
        steelmanGenuineness: { type: 'number' },
        falsifiabilityConcreteness: { type: 'number' },
        severityJustified: { type: 'number' },
        hallucinations: { type: 'array', items: { type: 'string' } },
        fabricatedCitations: { type: 'array', items: { type: 'string' } },
        redundantFindings: { type: 'integer' },
        offTaskFindings: { type: 'integer' },
        meetsStaffEngineerBar: { type: 'boolean' },
        worstProblem: { type: 'string' },
      },
    },
    verdictSummary: { type: 'string' },
  },
}

phase('SkillEval')
const evals = await parallel(ARTIFACTS.map((a) => () =>
  agent(
    `You are judging the QUALITY of an adversarial_debate critique that pyreez produced. You MUST USE THE PYREEZ SKILL (the evaluation_scoring protocol) to score it — do not merely opine. Then add your own ruthless staff-engineer read. The artifact is the "${a.role}" for this task: ${a.task}.

Working dir: /home/revil/projects/zipbul/pyreez

STEP 1 — read the artifact fully:
  the file is ${a.file} (read it).

STEP 2 — USE THE PYREEZ SKILL to score it. Run the evaluation_scoring deliberation:
  cd /home/revil/projects/zipbul/pyreez && cat ${a.file} | bun run src/cli.ts deliberate --task "Evaluate this adversarial critique against the criteria." --protocol evaluation_scoring --criteria ${JSON.stringify(RUBRIC)} --subject - --models "anthropic/claude-opus-4.6,openai/gpt-5.4,google/gemini-3.1-pro-preview" --max-rounds 1 > ${a.file}.eval.json 2> ${a.file}.eval.err
  Then read ${a.file}.eval.json. It is JSON with .aggregation (results[], weightedScore/majorityVerdict), .modelsUsed, .modelSwaps, .degradation, .warnings.
  Determine: did it run? which providers actually responded (modelsUsed)? did codex (openai) / gemini (google) fail (see modelSwaps/degradation/warnings)? Note that if only claude responded, this is a SELF-JUDGE (claude judging claude-authored text) — flag the bias. If the CLI errors entirely, set ran=false and explain in note.

STEP 3 — independent ruthless expert read of the artifact at this bar: ${RUBRIC}
  Check EACH finding: is every cited incident/benchmark/spec REAL and correctly represented (treat paraphrase-as-quote as fabrication)? Is each steelman the genuine strongest form or a strawman? Would each falsification test actually falsify the claim? Is severity justified? Any redundant or off-task finding?

Return the structured object. Be specific and quote the artifact for any hallucination/fabrication you allege.`,
    { label: `eval:${a.id}`, phase: 'SkillEval', schema: EVAL_SCHEMA, agentType: 'general-purpose' }
  ).then(r => ({ ...r, _id: a.id })).catch(e => ({ artifactId: a.id, error: String(e) }))
))

const ok = evals.filter(Boolean)
log(`SkillEval done: ${ok.length}/${ARTIFACTS.length} artifacts evaluated`)

phase('Synthesize')
const synthesis = await agent(
  `Synthesize an EXTREME-BAR quality verdict for the pyreez adversarial_debate worker prompt, from these per-artifact evaluations (each combines a pyreez evaluation_scoring run + an independent staff-engineer read):

${JSON.stringify(ok, null, 2)}

Produce a tight report:
1. PROCESS quality: did the pyreez evaluation_scoring skill run cleanly? degradation (codex/gemini down)? self-judge bias present? What does that say about trusting the skill's own scores here?
2. RESULT (substance) quality at the staff-engineer bar: aggregate the expert reads. Are there fabricated citations or hallucinations (list them verbatim)? Does the output clear the bar (every finding accepted with zero corrections)? Where exactly does it fall short?
3. The single most important remaining quality gap, and whether it is a PROMPT problem, a MODEL-behavior problem, or a measurement artifact.
4. Honest bottom line: is this "the best possible" adversarial output, or what concretely would raise it. No flattery.`,
  { label: 'synthesize', phase: 'Synthesize', agentType: 'general-purpose' }
)

return { evals: ok, synthesis }
