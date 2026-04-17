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
6. Synthesize, following inspect's `host_actions`.
7. Run `acceptance` with `alignment` per worker.

## Reframe the task

Convert directional questions into failure-condition questions before passing to `deliberate`. Directional questions produce unanimous agreement and waste the run.

| Directional | Reframed |
|---|---|
| "X가 맞는가?" | "X가 틀린 시나리오를 구성하라. 구성할 수 없다면 왜 불가능한지 논증하라." |
| "X의 가치는?" | "X가 가치를 잃는 경계 조건은?" |
| "X를 도입해야 하는가?" | "X 도입이 도입하지 않는 것보다 나쁜 결과를 내는 조건은?" |

## Protocols

| protocol | when to use |
|---|---|
| `shared_convergence` | converge on a position (architecture, tradeoff) |
| `adversarial_debate` | stress-test, find weaknesses (design review) |
| `host_interrogation` | independent answers to specific questions |
| `sequential_refinement` | iterative improvement (drafting) |
| `evaluation_scoring` | independent scoring against criteria |
| `red_team` | attack/defense (security review) |

## CLI

```bash
bun run src/cli.ts deliberate --task "..." --models "m1,m2,m3" --protocol <p> [--max-rounds N]
bun run src/cli.ts inspect --task "..." --judge <model> --deliberate -    # pipe deliberate JSON
bun run src/cli.ts fuse --task "..." --judge <model> --candidates '[{id, content}]' [--ranking '[{id, wins, losses}]']
bun run src/cli.ts acceptance --task "..." --synthesis "..." --workers '[{model, original_position, alignment?}]'
```

`fuse` produces a synthesis DRAFT from worker responses (LLM-Blender GenFuser pattern). Use after inspect when you want a starting point — still apply cross-worker gap checks and pick the stronger case yourself. Pass `--ranking` from `inspect`'s ranking output (or `rank`) to weight strong candidates.

Pass `--factual true` to `inspect` when responses contain verifiable factual claims.

## Read inspect output

| field | action |
|---|---|
| `convergence.level: "high"` | Reframe task (too directional) and re-run deliberate. Do NOT synthesize from converged responses |
| `convergence.level: "moderate"` + `dissenterId` | Read the dissenter response FIRST. Treat as candidate-correct until disproven |
| `convergence.level: "moderate"` no dissenter | Synthesize with explicit acknowledgment of split |
| `convergence.level: "diverse"` | Best case. Synthesize with full diversity |
| `convergenceScore.status: "converged"` | Same as `level: high` — reframe |
| `convergenceScore.status: "diverging"` | Treat as alarm; rare on single-provider runs |
| `ranking` (N≥4 only) | Weight workers by win count |
| `qualityFindings` | Remove or caveat flagged unsupported/contradicted claims |
| `host_actions` includes `provider_diversity_low` | Add caveat in confidence assessment |

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

Mark each worker's `alignment`:
- `"on-task"` — answered the question; verdict counts toward `action_required`
- `"meta-critique"` — rejected the framing or proposed an unrelated alternative; preserved in `metaCritiques`, does not block

If any on-task worker rejects, revise synthesis addressing the misrepresented/unresolved fields and re-run. Cap acceptance retries at 3 — if an on-task worker still rejects after 3 revisions, surface the disagreement to the user instead of looping. Meta-critique positions can be cited as alternative perspectives but cannot force re-runs.

Workers without explicit `alignment` are auto-classified by the same model that judges them. Override by passing `alignment: "on-task" | "meta-critique"` explicitly when you want to force a classification.
