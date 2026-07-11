---
name: pyreez-protocol-optimize
description: Debug and minimally improve a pyreez deliberation protocol prompt — read the whole prompt and its full runtime context, run the protocol, interrogate the actual workers to find where the prompt made them misunderstand, locate the root cause, and apply the smallest change that removes it (not a wholesale rewrite). Use whenever the user wants to improve/optimize/diagnose a protocol prompt (adversarial_debate, shared_convergence, host_interrogation, sequential_refinement, evaluation_scoring, red_team), asks "why do the workers answer like this", "this protocol's output is off", "fix the prompt for protocol X", "is this prompt optimized for its protocol", or reports that a protocol produces weak/biased/malformed results. Trigger even without the word "optimize" — any request to diagnose or improve how a deliberation protocol prompts its workers qualifies.
allowed-tools:
  - Bash(bun *)
  - Read
  - Edit
  - Write
  - Agent
  - WebSearch
  - WebFetch
user-invocable: true
argument-hint: "[protocol name or the symptom you saw]"
---

Target: the protocol prompts in `src/deliberation/prompts.ts`.

Never fix by guessing. Primary evidence is the workers' testimony, checked against the full sent prompt. Workers are heterogeneous models (anthropic / openai / xai / google): a failure several share is a clear defect; a single-worker failure can still be real prompt ambiguity — judge, don't assume.

## Cycle

**0. Intent + tasks.** State in one sentence what the protocol must make workers do. Run tasks across varied domains (medical, legal, policy, art, …) — pyreez is not engineering-only. Don't presume the defect before reading the run.

**1. Run + capture.**
```
bun run src/cli.ts deliberate --protocol <P> --task "<task>" --models "<≥2 providers>" [--max-rounds ≥2]
```
Always writes `.pyreez/debug/<id>/` — never `--no-debug-capture`. Required: `host_interrogation`→`--questions`; `evaluation_scoring`→`--criteria` + `--subject`. Scratch in /tmp.

**2. Read full context.** From the debug dir, read every message in order — the whole worker-visible prompt (system, host text, task / criteria / subject / questions), then `output` and `result.json`. Quote sent text verbatim, not the assembly code.

**3. Audit — whole prompt, all findings.** For every clause, state its function and whether it earns its place — dead weight (removal wouldn't change behavior) is *latent*, never deleted on suspicion or for neatness. Also check each for contradiction, ambiguity, weak boundaries, robustness across domains/models, Technique violations (wording / format / template), and **quality** — does the critique reach the root mechanism and the strongest task-grounded weakness with accurate claims, or stay shallow/obvious? A missed deeper weakness (specific, evidence-grounded) is *latent* until a re-run confirms it (step 6). Score each output, every round, against intent. List EVERY finding, tagged *confirmed* (a defect observed in output) or *latent* (recorded only; removal needs approval + an observed-failure link). Cross-review with subagent + codex against the captured files. Loop until a pass finds nothing new.

**4. Interrogate — the core.**
```
bun run src/cli.ts interrogate --run <id> --round <N> --worker <I> --question "..."
```
Live call (session `resumed`, hidden reasoning intact). Make the worker localize the fault: what you thought the instruction required, which exact text made you read it that way, where intent failed to land, the smallest change that fixes it. Ask workers from every round — late rounds degrade (premature convergence, confidence drift, format decay), not just round 1. Where a protocol shows peer positions in later rounds (`<other-positions>`, `<positions-to-challenge>`), ask how each shown peer position or confidence changed the worker's answer — anchoring, or genuine new evidence? For shallow output, also ask how it reasoned and why it stopped: the reasoning path, any deeper task-grounded weakness it saw but did not pursue, which exact clause or omission held it at the surface, and the smallest change that removes that cap. Cross several workers. Answers are evidence — confirm each against the prompt; a leading-question admission is a lead, not proof.

**5. Root cause (per confirmed finding).** Name the fault and the exact worker-visible text or omission behind it: conflicting instructions, domain assumption, position bias, missing boundary, duplicated auto-injection. Mark what is load-bearing.

**6. Minimal fix.** Fix each confirmed root, changing only the text that carries it — a one-line root gets a one-line fix. Leave latent issues and correctly-read text untouched. Deliver the exact diff, each change tied to its cause, load-bearing rules preserved. Approval, then edit. A depth defect is confirmed only when the same task/model, re-run with only the proposed change, produces the deeper/more-accurate finding with no regression — not one cherry-picked run, not a worker's admission alone; fix it by editing only the clause that caps depth (a "give one weakness" limit, a length cap, a stop signal), never by adding generic "go deeper / be profound / think harder" text (reasoning effort stays in the vendor parameter).

**7. Verify.** Re-run and re-interrogate: the misunderstanding is gone, no regression. `bun test src/deliberation/` + `bun run typecheck`, update pinned specs, re-measure tuned values. Repeat only if a root remains or a regression appeared.

## Techniques (use only at the fix site — don't touch unrelated text)

- **Be direct.** State the wanted output and constraints; number steps when order matters; cut vague words.
- **Say what to do,** not what to avoid.
- **Give one reason.** A short "why" lets the model generalize.
- **Tag boundaries.** Wrap instructions, context, input, and examples in their own XML tags with consistent names.
- **Show examples.** 3–5 relevant, varied ones (with edge cases) in `<examples>`; uniform examples bias.
- **Role in one system line.** Don't re-add a host role the protocol already sets.
- **Position bias.** Long data and context first; instructions, question, and task last.
- **Fix the format.** Repeated output → fixed field labels, parseable, every field structurally alike.
- **Respect the template.** Preserve fields, labels, tags, ordering, and placeholders unless one is the root cause.
- **Stay scoped.** Edit only what the confirmed fault implicates; no restyling of healthy text.
- **No conflicts.** After editing, scan the changed clause and its dependents for contradictions. Reasoning effort via the vendor parameter, not "think harder"; don't loosen tuned values.
