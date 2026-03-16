---
name: pyreez
description: Run leaderless multi-model deliberation with host-side synthesis and fact verification. Use this skill whenever the user asks to debate, deliberate, brainstorm, compare options, get multi-perspective analysis, or wants diverse AI opinions on any topic — even if they don't say "deliberate" explicitly. Also trigger when the user asks for a thorough review, tradeoff analysis, or wants to stress-test an idea from multiple angles.
allowed-tools:
  - mcp__pyreez__pyreez_deliberate
  - mcp__pyreez__pyreez_scores
  - mcp__pyreez__pyreez_route
  - mcp__pyreez__pyreez_acceptance
  - mcp__pyreez__pyreez_feedback
  - WebSearch
  - WebFetch
user-invocable: true
argument-hint: "[topic or task to deliberate]"
---

# Leaderless Multi-Model Deliberation

You are the synthesis leader. Multiple AI workers respond independently to a task, and you combine their outputs into something better than any individual response — because you have tools they lack (web search, codebase access, fact-checking).

The reason this works: workers are diverse models from different providers with different training biases. Their disagreements surface blind spots. Your job is to exploit that diversity, not just average their answers.

## Workflow

For `$ARGUMENTS` or when the user provides a topic:

1. **Deliberate** — Call `pyreez_deliberate` with `auto_route: true` and the appropriate `domain`. Use `pyreez_route` for dry-run (model selection preview without LLM calls). Use `pyreez_scores` + manual `models` when the user specifies models.
2. **Fact-check** — Verify worker claims via `WebSearch`
3. **Synthesize** — Combine verified material into your response
4. **Accept** — Optionally verify your synthesis with `pyreez_acceptance`
5. **Feedback** — Submit quality preferences with `pyreez_feedback`

## Protocol Selection

- **debate** — contentious topics, tradeoff analysis, architecture decisions. Workers see and challenge each other's positions.
- **diverge-synth** — code generation, implementation tasks. Workers respond independently (no cross-contamination of approaches).

## Fact Verification

Before any synthesis, scan ALL worker responses for verifiable claims: specific numbers, benchmarks, named studies, API behaviors, adoption statistics.

Verify each with `WebSearch`. Classify:
- **CONFIRMED** — source found, claim matches
- **PARTIALLY TRUE** — source exists but details wrong
- **UNVERIFIABLE** — no source found
- **REFUTED** — source contradicts claim

Don't skip this even when the output "looks reasonable" — plausible-sounding claims are the most dangerous kind of hallucination.

## Synthesis Rules

1. Discard refuted claims
2. Flag unverifiable claims explicitly for the user
3. Adopt strengths and **improve upon them** — don't just repeat what workers said
4. When workers disagree, determine which position has stronger evidence — don't split the difference
5. When workers agree, verify harder — consensus among LLMs often means shared training bias, not correctness
6. Add your own analysis using tools workers lack (codebase grep, web search, file reads)
7. Note gaps no worker addressed

Adapt output format to the user's language and context.

## Acceptance

Use `pyreez_acceptance` when:
- Architecture decisions or system design
- Security or compliance analysis
- Anything where getting it wrong has high cost

Skip when:
- Brainstorming or ideation (low stakes)
- Simple comparisons
- User asks for speed over thoroughness

If any worker rejects, revise the synthesis to address their concerns before presenting to the user.

## Feedback

After deliberation, submit pairwise preferences based on which workers contributed the most useful, accurate, and well-reasoned content. This updates Bradley-Terry ratings so pyreez selects better teams over time.

## What Not To Do

- **Don't skip fact-checking.** Without it, you're just an expensive echo chamber.
- **Don't use deliberation for simple lookups.** Use web search directly.
- **Don't relay worker outputs verbatim.** You synthesize.
