---
name: pyreez
description: Run heterogeneous multi-model deliberation when a single model's opinion is insufficient. Use this skill whenever the user asks for design tradeoffs, architecture decisions, code/PR review of nontrivial changes, comparison of options, brainstorming with diverse angles, debate, stress-testing an idea, or any judgment call where missing a critical perspective is costly. Trigger even when the user does not explicitly say "deliberate" — phrases like "what do you think about X", "which is better", "review this design", "is this approach right" all qualify.
allowed-tools:
  - Bash(bun *)
  - WebSearch
  - WebFetch
user-invocable: true
argument-hint: "[topic or task to deliberate]"
---

## Workflow

1. Reframe the task for divergence (failure conditions, not yes/no).
2. Pick models with `bun run src/cli.ts models` — at least 2 providers.
3. Pick protocol (table below).
4. Run `deliberate`.
5. Pipe its JSON into `inspect` (always).
6. Read inspect output via the table below — `host_actions` are raw signals; this SKILL's tables (Read inspect output, Operational caveats) are authoritative when they conflict with literal action strings.
7. Run `acceptance` with `alignment` per worker.

## Reframe the task

Convert directional questions into failure-condition questions before passing to `deliberate`. Directional questions produce unanimous agreement and waste the run.

| Directional | Reframed |
|---|---|
| "X가 맞는가?" | "X가 틀린 시나리오를 구성하라. 구성할 수 없다면 왜 불가능한지 논증하라." |
| "X의 가치는?" | "X가 가치를 잃는 경계 조건은?" |
| "X를 도입해야 하는가?" | "X 도입이 도입하지 않는 것보다 나쁜 결과를 내는 조건은?" |

**Wording**: avoid first-person opinion ("I think X is correct..."), persona prefixes ("you are an expert in..."), and harness duplication. pyreez auto-injects depth, anti-conformity, and confidence cues — repeating them in `--task` is over-prompting.

## Protocols

| protocol | when to use |
|---|---|
| `shared_convergence` | converge on a position (architecture, tradeoff) |
| `adversarial_debate` | stress-test, find weaknesses (design review) |
| `host_interrogation` | independent answers to specific questions |
| `sequential_refinement` | iterative improvement (drafting) |
| `evaluation_scoring` | independent scoring against criteria |
| `red_team` | attack/defense (security review) |

### shared_convergence specifics

Deep playbook (task composition, worker-instructions, parameter choice, output interpretation) — load when running this protocol: [shared-convergence.md](shared-convergence.md)

- **Use `--max-rounds 3` (default).** Lower values disable per-worker analysis lenses and cross-round anti-conformity; higher values cost more without measured gain.
- **Convergence detection is specific to this protocol.** `inspect` runs the convergence-judge on any responses it receives, but the `convergence.level` interpretation only carries meaning when workers were trying to converge. Engine-side early-termination is also gated to this protocol.
- **HIGH alone is not a sycophancy signal.** Heterogeneous providers naturally converge on many topics, including contested ones (ethics, philosophy). Read worker responses for evidence quality — HIGH with weak/echoed reasoning is the actual red flag, not HIGH itself.

## CLI

```bash
bun run src/cli.ts deliberate --task "..." --models "m1,m2,m3" --protocol <p> [--max-rounds N] [--worker-instructions "..."]
# protocol-specific extra inputs:
#   host_interrogation:  --questions "Q1,Q2,Q3"
#   evaluation_scoring:  --criteria "..." --subject "..."
bun run src/cli.ts inspect --task "..." --judge <model> --deliberate -    # pipe deliberate JSON
bun run src/cli.ts fuse --task "..." --judge <model> --candidates '[{id, content}]' [--ranking '[{id, wins, losses}]']
bun run src/cli.ts acceptance --task "..." --synthesis "..." --workers '[{model, original_position, alignment?}]'
```

`fuse` produces a synthesis DRAFT from worker responses (LLM-Blender GenFuser pattern). Use after inspect when you want a starting point — still apply cross-worker gap checks and pick the stronger case yourself. Pass `--ranking` from `inspect`'s ranking output (or `rank`) to weight strong candidates.

Pass `--factual true` to `inspect` when responses contain verifiable factual claims.

## Read inspect output

| field | action |
|---|---|
| `convergence.level: "high"` | Verify against responses first (judge tends to over-classify HIGH — see specifics). If responses genuinely converged: reframe and re-run. If the judge mislabeled: synthesize normally |
| `convergence.level: "moderate"` + `dissenterId` | Read the dissenter response FIRST and treat as candidate-correct until disproven (peer-reviewed minority-influence literature: dissent broadens information processing and improves group decision quality — Nemeth's program of work) |
| `convergence.level: "moderate"` no dissenter | Synthesize with explicit acknowledgment of split |
| `convergence.level: "diverse"` | Two readings are possible: workers offered genuinely complementary framings (good — synthesize with full diversity) or workers disagreed on basic facts (bad — the task may be underspecified). Read the responses to distinguish before synthesizing |
| `convergence.level: "unknown"` | judge could not classify — review responses directly |
| `convergence.level: "insufficient"` | fewer than 2 responses — re-run with more workers |
| `convergenceScore.status` | composite of semantic+lexical+evidence+stability — interpret alongside `level`. Mismatch (e.g. `level: "high"` with `status: "diverging"`) is a judge over-confidence signal — read the responses directly before acting on `level` |
| `ranking` (N≥4 only) | Weight workers by win count |
| `qualityFindings` | Remove or caveat flagged unsupported/contradicted claims |
| `host_actions` includes `provider_diversity_low` | Add caveat in confidence assessment |
| `host_actions` includes `self_judge_bias` | Judge shares provider with a worker — convergence/ranking verdicts may be biased. Re-run inspect with a judge from a non-overlapping provider |

## Synthesize

For each worker fill three fields:
- **unique_contribution** — what this worker provides that no other does
- **most_unexpected_claim** — the single most surprising claim, one sentence
- **loss_if_removed** — what the synthesis loses without this worker

Then check across all workers for gaps:
- ambiguous concepts left undefined
- hidden assumptions no one questioned
- claims lacking evidence no one challenged
- viewpoints/stakeholders unexplored
- implications/consequences untraced
- the original question itself flawed or too narrow

If a critical gap exists, run a supplementary `deliberate` targeting it before continuing.

When workers disagree, pick the stronger case (stronger evidence for facts, stronger reasoning for design). Do not present parallel options ("Path A / Path B").

Build the synthesis — adopt and extend, do not copy worker text verbatim.

## Acceptance

Workers are classified as `on-task` (answered the question — verdict counts toward `action_required`) or `meta-critique` (rejected the framing — surfaced separately in the `metaCritiques` array, does not block). Pass `alignment` explicitly per worker to override; otherwise the judge auto-classifies.

Each on-task worker returns one of three verdicts:

| verdict | meaning | host action |
|---|---|---|
| `accept` | synthesis represents the worker's position faithfully | no revision needed |
| `partial` | synthesis misrepresents some aspect or leaves issues unresolved | revise the flagged `misrepresented` / `unresolved` fields, re-run acceptance |
| `reject` | synthesis fundamentally distorts the worker's position | rewrite the corresponding sections, re-run acceptance |

`action_required` is emitted when any on-task worker returns `partial` or `reject` (absent on full accept). `metaCritiques` lists meta-critique workers' positions for host review — they do not block but cite them as alternative perspectives when relevant.

Cap revision loops at ~3 iterations as a host-side heuristic (not enforced by code, no measured optimum) — if a worker still rejects after several revisions, surface the disagreement to the user instead of looping.

## Operational caveats

Always check the `deliberate` JSON before consuming it — `inspect` does not surface every host-relevant field.

| field in deliberate output | host action |
|---|---|
| `modelSwaps` (non-empty) | A requested model failed and was substituted from your provider pool. The actual `modelsUsed` may differ from your `--models` argument (e.g. anthropic+openai+google requested, anthropic+xai+google delivered). If a vendor is forbidden by policy, re-run with an explicit narrower pool or treat the result as void |
| `degradation` (present) | The team shrank below the requested size — fewer perspectives than planned. Re-run if the surviving pool no longer meets your diversity threshold |
| `warnings` includes `team_degraded` | Same signal as `degradation` |

Other caveats applicable to every run:

- **Task content fan-out**. Whatever you put in `--task` is sent to every worker provider (and the judge during `inspect`). Mask secrets, internal paths, customer data, and unreleased plans before invoking. The `inspect --judge` model also sees full responses.
- **Cost order of magnitude**. One full pass (`deliberate` + `inspect` + `acceptance`) makes roughly 1×N×R worker calls + 1 judge call (+ ranking call when N≥4 + quality call when `--factual true` + acceptance call). For N=3, R=2 baseline: ~7–10 LLM calls per pass. Cap rounds and worker count when iterating.
- **Non-determinism**. LLM-based convergence judges vary between runs at non-zero temperature (judge call uses default temperature in `inspect`). The same task may yield different `convergence.level` on re-run; re-run variance unmeasured in current bench. Treat the level as a signal, not a verdict; the table above covers reading it correctly.
