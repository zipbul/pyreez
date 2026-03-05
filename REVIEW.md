# Deliberation Quality Review

> Reviewed: 2026-03-05
> Scope: 8 production deliberation tests across Planning, Architecture, Coding, Review, Testing, Ideation, Code Review, Communication domains
> Method: 4 independent sub-agent audits (consensus verification, posture compliance, untested paths, leader diversity)

## Status Summary

| ID | Issue | Severity | Status |
|----|-------|----------|--------|
| C1 | `consensusReached` hardcoded true without consensus mode | **Critical** | Open |
| C2 | `leaderContributes` default mismatch between paths | **Critical** | Open |
| C3 | Debate protocol silent degradation without consensus | **Critical** | Open |
| S1 | Deterministic leader selection — no rotation | **High** | Open |
| S2 | Leader verification is a tail appendix — anchoring bias | **High** | Open |
| S3 | Debate worker identity not tracked across rounds | **Medium** | Open |
| S4 | DivergeSynthProtocol class — zero unit tests | **Medium** | Open |
| S5 | Local models fail posture compliance | **Medium** | Open |

---

## Critical Issues

### C1. `consensusReached: true` is structurally fraudulent

When `consensus` mode is not set (the default), `engine.ts` unconditionally sets `consensusReached = true`:

```typescript
// engine.ts
if (!cfg.consensus) {
  consensusReached = true;  // hardcoded — no actual consensus process
}
```

All 8 production tests reported `consensusReached: true`, but the leader was never asked to approve or reject. The JSON output format with `decision: "approve"/"continue"` is only injected when `consensus === "leader_decides"` (see `prompts.ts` line 242). Without it, the leader receives a plain synthesis prompt — no decision mechanism exists.

**Impact:** Users see "consensus reached" but no consensus process occurred. The field is misleading.

**Fix:** Report `consensusReached: null` or `"not_applicable"` when consensus mode is off. Only report true/false when the leader was actually asked to decide.

### C2. `leaderContributes` default mismatch between code paths

Two paths exist with conflicting defaults:

| Path | Code | Default |
|------|------|---------|
| `deliberate()` via `DEFAULT_CONFIG` | `engine.ts` | `leaderContributes: false` |
| `DivergeSynthProtocol` (auto_route) | `wrappers.ts` | `config.leaderContributes !== false` → `undefined !== false` = **true** |

The `engine.ts` default was changed to `false` to prevent self-reinforcement bias (leader grading its own work). But the `DivergeSynthProtocol` wrapper used by auto_route bypasses `DEFAULT_CONFIG` and evaluates `undefined !== false` as `true`.

**Impact:** In the auto_route path (the primary production path), the leader still participates as a worker and then synthesizes its own response alongside others. This creates anchoring/confirmation bias.

**Fix:** Align `DivergeSynthProtocol` to respect `false` as default. Change `config.leaderContributes !== false` to `config.leaderContributes === true` or apply `DEFAULT_CONFIG` consistently.

### C3. Debate protocol silently degrades without consensus mode

The debate moderator prompt (which identifies agreements, disagreements, and gaps) only activates when BOTH conditions hold:

```typescript
// prompts.ts — buildLeaderMessages
const isDebateIntermediate = !isFinalRound && protocol === "debate" && consensus === "leader_decides";
```

When `protocol: "debate"` is used without `consensus: "leader_decides"`, the leader receives the standard diverge-synth prompt instead of the moderator prompt. The debate becomes functionally identical to running diverge-synth N times — no disagreement identification, no structured rebuttal framing.

Additionally, `DivergeSynthProtocol` enforces `Math.max(maxRounds, 3)` for debate, but the manual `createDeliberateFn` path applies no such floor. A user can request `protocol: "debate"` with `max_rounds: 1` through the manual path, producing a single-round "debate" that never exchanges views.

**Impact:** Users requesting debate get diverge-synth behavior unless they also set consensus mode. No error or warning.

**Fix:** Either (a) require `consensus: "leader_decides"` when `protocol: "debate"`, or (b) always use the moderator prompt for intermediate debate rounds regardless of consensus mode.

---

## Structural Issues

### S1. Leader selection is deterministic — no rotation or exploration

Leader is selected by a fixed composite score:

```
JUDGMENT * 0.4 + ANALYSIS * 0.3 + REASONING * 0.2 + SELF_CONSISTENCY * 0.1
```

Given the same ensemble, the same model is always the leader. There is no randomness, rotation, or Thompson Sampling (unlike worker selection). Computed leader composite scores:

| Model | Composite | Notes |
|-------|-----------|-------|
| openai/gpt-5.3 | 726.1 | Highest when present |
| openai/o3 | 723.8 | |
| openai/gpt-5.2 | 717.0 | |
| anthropic/claude-opus-4.5 | 709.4 | |
| google/gemini-2.5-pro | 666.5 | Leader in 6/8 tests |
| anthropic/claude-opus-4.6 | 536.2 | mu=1000 but sigma=341 → massive penalty |

The sigma values are mostly hand-assigned (`comparisons: 0` in `scores/models.json`), not earned through calibration. claude-opus-4.6 has the highest raw mu (1000) but scores lowest due to high uncertainty — despite this not reflecting actual performance data.

**Risk:** Systematic leader biases accumulate across all deliberations. No feedback loop evaluates whether the leader produced a good synthesis.

**Recommendations:**
1. Weighted random leader selection (Thompson Sampling on JUDGMENT composite)
2. Leader quality evaluation via meta-assessment
3. Calibrate sigma through actual pairwise comparisons, not hand-tuning

### S2. Leader verification is structurally anchored

The `LEADER_OUTPUT_STRUCTURE` prompt instructs:

```
1. First, provide your synthesized answer to the task.
2. Then include a brief verification section at the end...
```

Problems:
- **Answer-first structure:** Leader commits to a synthesis before critically evaluating it. This creates anchoring bias — the verification section rationalizes the already-written answer.
- **"Brief" signals lightweight:** The word "brief" tells the leader to keep verification short. Result: 3 of 8 tests had NO verification section at all; in others, verification averaged 15-25% of synthesis length.
- **No enforcement:** Some LLMs simply skip the verification section. The prompt requests it but cannot enforce compliance.

**Recommendation:** Restructure to verification-first: "1. Identify problems, disagreements, and gaps in worker responses. 2. Then produce your synthesis addressing those findings."

### S3. Debate worker identity not tracked across rounds

In multi-round debate, all workers receive identical `buildDebateWorkerMessages` output containing the leader's summary. Workers are told to "rebut arguments you disagree with" but have no way to know which position they took in the previous round.

```typescript
// prompts.ts — buildDebateWorkerMessages
// No worker-specific context; all workers get the same messages
```

**Impact:** Genuine back-and-forth debate is impossible. Workers cannot maintain or defend a consistent position across rounds. Each round is essentially independent brainstorming.

**Fix:** Include the worker's own previous response in their round 2+ messages so they can maintain, defend, or revise their position.

### S4. DivergeSynthProtocol — zero unit tests

The `DivergeSynthProtocol` class in `wrappers.ts` is the primary production path for auto_route deliberation. It contains:
- Team building logic (`buildTeam`, `buildExplicitTeam`, `buildAutoTeam`)
- Debate `maxRounds` floor enforcement
- Override precedence logic
- Conditional prompt selection (debate vs diverge-synth)

None of this is covered by unit tests in `wrappers.spec.ts`.

### S5. Local models fail posture compliance

| Model | Posture Score (/8) | Notes |
|-------|--------------------|-------|
| local/ai/deepseek-r1-distill-llama | **0** | Ignored all 8 principles. Produced factual errors ("CAP+3" fabrication). |
| local/ai/phi4 | **3** | Partial compliance. Picked up generation/judgment split but missed epistemic principles. |

Cloud API models average 6.9/8. Local/distilled models lack the instruction-following capability for complex meta-cognitive prompts.

**Impact:** When local models are selected as workers, they contribute low-quality, non-postured responses that the leader must compensate for.

**Recommendation:** Consider posture compliance as a routing constraint — exclude models below a capability threshold from deliberation teams, or weight their contributions lower.

---

## Worker Posture Compliance (Detailed)

### Per-Model Scores

| Model | Appearances | Avg Score (/8) |
|-------|-------------|----------------|
| openai/gpt-5, gpt-5.2 | 5 | **7.3** |
| anthropic/claude-sonnet-4.6 | 2 | **7.0** |
| anthropic/claude-opus-4.6 | 1 | **7.0** |
| google/gemini-2.5-pro | 5 | **6.6** |
| local/ai/phi4 | 1 | **3.0** |
| local/ai/deepseek-r1-distill-llama | 1 | **0.0** |

### Per-Principle Compliance (across 15 worker responses)

| # | Principle | Compliance | Notes |
|---|-----------|------------|-------|
| 1 | Classify claims {fact/inference/hypothesis} | **13/15** | Most consistently followed. OpenAI tags every line. |
| 2 | Generate 3+ competing approaches | **13/15** | Workers produce 3-6 real alternatives with tradeoff analysis. |
| 3 | Separate generation from judgment | **13/15** | Explicit "Mode: Brainstorming" / "Mode: Judgment" headers. |
| 4 | Form own position first | **12/15** | Usually via "What would change my mind" opening. |
| 5 | Steel-man opposing arguments | **5-6/15** | **Weakest principle.** Most evaluate fairly but don't explicitly restate strongest version. |
| 6 | Evidence first, then conclusions | **13/15** | Claim classification tables precede design/analysis. |
| 7 | State what would change your mind | **13/15** | Consistently present. Often both opening and closing. |
| 8 | Treat being wrong as progress | **2-3/15** | Almost entirely implicit. No explicit "welcome correction" statements. |

### Observations

- **Posture prompts are genuinely working** for cloud models — response structures are visibly different from un-postured LLM output (explicit mode declarations, claim classification tables, falsifiability statements)
- **Risk of performative compliance:** OpenAI models sometimes tag 60+ claims per response. This mechanical over-tagging reduces discriminative value.
- **Generation/judgment separation is sometimes nominal:** Some workers label "brainstorming mode" but evaluate within it.

---

## Leader Verification Quality

### Per-Test Results

| # | Domain | Leader | Verification Quality |
|---|--------|--------|---------------------|
| 1 | Planning (Restaurant MVP) | gemini-2.5-pro | **None** — No verification section |
| 2 | Architecture (Hospital) | claude-sonnet-4.6 | **Moderate** — Independence check but rationalizes agreement |
| 3 | Coding (Rate limiter) | — | Saved to file |
| 4 | Review (Microservices) | gemini-2.5-pro | **Weak** — Admits correlated reasoning but rationalizes |
| 5 | Testing (Payments) | gemini-2.5-pro | **Good** — Challenged worker's reject-unknown-fields recommendation |
| 6 | Ideation (DevEx tool) | gemini-2.5-pro | **Moderate** — Challenged flow detection accuracy claims |
| 7 | Code Review (Go cache) | gpt-5 | **Excellent** — Corrected Worker 1's race condition error, debunked Worker 2's "Scenario A" |
| 8 | Communication (CAP) | gemini-2.5-pro | **Excellent** — Identified Worker 1's fabricated "CAP+3", corrected CAP misconception |

### Summary

- 2/8 **no verification at all** (pure rubber stamp)
- 2/8 **weak/rationalizing** (admits issues but explains them away)
- 2/8 **moderate** (identifies some problems)
- 2/8 **excellent** (genuine correction of worker errors)

Leader verification quality correlates with task difficulty and presence of actual worker errors. When workers agree and are correct, the leader tends to rubber-stamp. When workers disagree or make errors, the leader provides substantive verification.

---

## Test Configuration

All 8 tests used identical configuration:
- `protocol: "diverge-synth"` (default)
- `maxRounds: 1` (default)
- `consensus: not set` (no consensus mode)
- `leaderContributes: not set` (defaults to true via wrappers.ts)
- `workerInstructions: not set`
- `leaderInstructions: not set`

**Untested configurations:** debate protocol, multi-round deliberation, consensus mode, custom instructions passthrough via auto_route.

---

## Action Items (Priority Order)

1. **[Critical] Fix `consensusReached` semantics** — return null/not_applicable when consensus mode is off
2. **[Critical] Fix `leaderContributes` default in `DivergeSynthProtocol`** — align with `DEFAULT_CONFIG: false`
3. **[Critical] Fix debate-without-consensus degradation** — moderator prompt should activate for all debate intermediate rounds
4. **[High] Restructure leader prompt to verification-first** — eliminate answer-then-verify anchoring
5. **[High] Add Thompson Sampling to leader selection** — prevent deterministic bias accumulation
6. **[Medium] Track worker identity across debate rounds** — enable genuine multi-round debate
7. **[Medium] Add DivergeSynthProtocol unit tests** — cover team building, override precedence, debate floor
8. **[Medium] Add posture compliance threshold for model routing** — exclude incapable models from deliberation
