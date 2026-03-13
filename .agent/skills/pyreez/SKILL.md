---
name: pyreez
description: Run leaderless multi-model deliberation with host-side fact verification. Use when the user asks to debate, deliberate, brainstorm, or get multi-perspective analysis on any topic. The host agent acts as leader — synthesizing worker outputs, fact-checking claims via web search, and filtering hallucinations before reporting.
license: Apache-2.0
compatibility: Requires pyreez MCP server running with pyreez_deliberate and pyreez_scores tools available. Requires web search capability for fact verification.
metadata:
  author: zipbul
  version: "1.0"
---

# Leaderless Multi-Model Deliberation

You are the leader. Do not delegate synthesis to an LLM — you perform it yourself with tool access the workers lack.

## Step 1: Team Composition

Check available models before composing a team:

```
pyreez_scores → filter by available: true
```

Selection criteria (strict priority):
1. Minimum 3 workers from 3 different vendors (perspective diversity)
2. Pick models with highest REASONING scores among available ones
3. Last model in the array is used as leader by the engine — set it to the weakest available model or duplicate a worker (the leader output will be discarded; you are the real leader)
4. Never include models the user lacks API keys for

## Step 2: Run Deliberation

Call `pyreez_deliberate` with:

```json
{
  "task": "<detailed task description>",
  "models": ["worker1", "worker2", "worker3", "dummy-leader"],
  "protocol": "debate",
  "max_rounds": 2,
  "leader_contributes": false,
  "worker_instructions": "<role + constraints>",
  "leader_instructions": "Output the raw worker responses without synthesis. Do not judge or filter claims."
}
```

Key settings:
- `leader_contributes: false` — dummy leader should not waste tokens
- `leader_instructions` must say "do not synthesize" — we want raw material
- `protocol: "debate"` — workers see and challenge each other's responses
- `max_rounds: 2` — sufficient for convergence without token waste

## Step 3: Fact Verification (Immediately After Receiving Worker Outputs)

Before any synthesis or analysis, scan ALL worker responses and verify every claim that includes:
- Specific numbers, percentages, or benchmarks
- Named studies, papers, or reports
- CVE numbers or security advisories
- Tool features or API behaviors
- Community adoption statistics

Verify each with `WebSearch`. Classify as:
- **CONFIRMED** — source found, claim matches
- **PARTIALLY TRUE** — source exists but claim exaggerated or details wrong
- **UNVERIFIABLE** — no source found, cannot confirm or deny
- **REFUTED** — source contradicts the claim

Do NOT proceed to synthesis until all verifiable claims are checked. Synthesizing with unverified claims contaminates the conclusion.

## Step 4: Synthesis (Only With Verified Material)

Produce the final report yourself using ONLY verified inputs:
1. Discard refuted claims entirely — they do not exist
2. Flag unverifiable claims explicitly — the user decides whether to trust them
3. Merge confirmed insights across workers
4. Add your own analysis using tool access (codebase grep, web search, file reads)
5. Identify gaps no worker addressed

Output format — adapt to user's language and context. No rigid template.

## Anti-Patterns (Do Not)

- Do not relay the engine leader's synthesis as your own analysis
- Do not say "workers agreed on X" as proof X is true (consensus != correctness)
- Do not skip fact-checking because the output "looks reasonable"
- Do not include unverified benchmarks or statistics without flagging them
- Do not run deliberation for simple factual questions (use web search directly)
