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

## Quick Start

For `$ARGUMENTS` or when the user provides a topic:

1. Call `pyreez_deliberate` with `auto_route: true` and the appropriate `domain`
2. Fact-check worker claims via `WebSearch`
3. Synthesize verified material into your response
4. Optionally verify your synthesis with `pyreez_acceptance`
5. Submit quality feedback with `pyreez_feedback`

## Step 1: Run Deliberation

Let pyreez handle team composition automatically — it selects diverse models across providers using Bradley-Terry capability scores.

```
pyreez_deliberate({
  task: "<detailed task in English>",
  auto_route: true,
  domain: "<pick closest>",
  protocol: "debate",        // workers challenge each other
  max_rounds: 2              // 1 for simple, 2 for complex
})
```

When to use `debate` vs `diverge-synth`:
- **debate** — contentious topics, tradeoff analysis, architecture decisions. Workers see and challenge each other's positions.
- **diverge-synth** — code generation, implementation tasks. Workers respond independently (no cross-contamination of approaches).

For manual team selection (rare — only when user specifies models):
```
pyreez_scores({ dimension: "REASONING", top: 5 })
→ pick 3+ models from different providers
→ pyreez_deliberate({ task: "...", models: ["a/m1", "b/m2", "c/m3"] })
```

## Step 2: Fact Verification

Before any synthesis, scan ALL worker responses for verifiable claims:
- Specific numbers, benchmarks, percentages
- Named studies, papers, CVEs
- Tool features, API behaviors
- Adoption statistics

Verify each with `WebSearch`. Classify:
- **CONFIRMED** — source found, claim matches
- **PARTIALLY TRUE** — source exists but details wrong
- **UNVERIFIABLE** — no source found
- **REFUTED** — source contradicts claim

This step is the reason you're better than a simple LLM synthesis. Workers hallucinate; you catch it. Don't skip this even when the output "looks reasonable" — plausible-sounding claims are the most dangerous kind of hallucination.

## Step 3: Synthesis

Produce your final response using only verified inputs:

1. Discard refuted claims — they don't exist
2. Flag unverifiable claims explicitly for the user
3. Merge confirmed insights across workers — look for complementary strengths
4. Add your own analysis using tools workers lack (codebase grep, web search, file reads)
5. Note gaps no worker addressed

Adapt output format to the user's language and context. No rigid template.

## Step 4: Acceptance (Optional — for high-stakes tasks)

When the task is complex or the user needs high confidence, verify your synthesis:

```
pyreez_acceptance({
  task: "<original task>",
  synthesis: "<your synthesis>",
  workers: [
    { model: "a/m1", original_position: "<worker 1's response>" },
    { model: "b/m2", original_position: "<worker 2's response>" }
  ]
})
```

Workers independently judge whether your synthesis misrepresents their position. If any worker rejects, revise the synthesis to address their concerns before presenting to the user.

Use acceptance when:
- Architecture decisions or system design
- Security or compliance analysis
- Anything where getting it wrong has high cost

Skip acceptance when:
- Brainstorming or ideation (low stakes)
- Simple comparisons
- User asks for speed over thoroughness

## Step 5: Feedback

After the user sees your deliberation result, submit quality feedback to improve future model selection:

```
pyreez_feedback({
  preferences: [
    { winner: "a/m1", loser: "b/m2", dimension: "JUDGMENT" }
  ]
})
```

Base preferences on which workers contributed the most useful, accurate, and well-reasoned content. This updates Bradley-Terry ratings so pyreez selects better teams over time.

## What Not To Do

- **Don't treat consensus as truth.** When all workers agree, verify the shared claim independently — group agreement on a wrong answer is common across LLMs with similar training data.
- **Don't skip fact-checking.** The entire value of this workflow is verification. Without it, you're just an expensive echo chamber.
- **Don't use deliberation for simple lookups.** If the user asks "what's the capital of France", use web search directly. Deliberation is for complex, multi-faceted questions.
- **Don't relay worker outputs verbatim.** You synthesize. Workers provide raw material; you provide the refined answer.

## Reference Files

For detailed patterns, see:
- [references/fact-check.md](references/fact-check.md) — fact-checking methodology and hallucination patterns
- [references/tokens.md](references/tokens.md) — token budget guide per protocol and team size
