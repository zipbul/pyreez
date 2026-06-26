# adversarial_debate worker prompt — fix plan v2 (post 3-way review)

Supersedes v1. Resolves the 18 verified defects (H1–H5, M1–M10, L1–L3) AND the v1 review
objections (P1 recency split, P2 test impact, P3 parseable-claim, P4 shared-helper relabel,
P5 steelman slot, P6 M5). Source: `src/deliberation/prompts.ts`.

## Decisions taken (no longer open)
1. **Output-format = worker default, host overrides.** pyreez owns the harness (structure/method);
   the host owns the semantic payload incl. desired output shape. So the worker carries a default
   schema but explicitly yields to a host-specified format. Resolves the "strict schema overrides
   host task format" objection.
2. **Peer labels = turn-local "Analyst A/B".** The shared `formatOtherPositions` (prompts.ts:91) is
   NOT touched. A new adversarial-only formatter labels peers A/B by their order *in this turn* and
   keeps per-response confidence. Cross-round attribution is impossible under `sparseSelect`
   (subset changes per round; replenished workers get index ≥ team size), so we do not claim
   stability — labels are local to the turn, which is all the `<approach>` rules need.
3. **Rules split by volatility (fixes P1 recency).** Static reference (evidence/confidence taxonomy,
   output-format) lives ONCE in the system message. Drift-sensitive directives (steelman,
   no-soften, revise-only-on-own-evidence, weigh-confidence-vs-evidence) are re-injected in EVERY
   round's user turn (R1 included), preserving late-round conformity-drift resistance — the reason
   shared_convergence still re-injects anti-conformity per round (prompts.ts:277).
4. **DEPTH_EXPLORE removed from adversarial; "Think deeply" removed.** Depth is a vendor
   reasoning-effort concern (CLAUDE.md harness), not prompt text. One revision rule only (kills M1).
5. **roundInfo is already wired** (engine.ts:508, wire.ts:138-139); implementation only un-underscores
   `_roundInfo`/`_workerIndex` inside the builders — no engine/wire change.

## Proposed `ADVERSARIAL_SYSTEM` (static; NOT via buildSystemPrompt → GLOBAL_DEPTH/DEPTH_EXPLORE not used by adversarial; other protocols unaffected)

```
<role>
You are one of several independent analysts stress-testing a proposal. Surface its strongest,
evidence-backed weaknesses. Lead with the findings themselves — no throat-clearing, no meta-preamble.
</role>

<evidence-and-confidence>
- Back each factual claim with specific evidence: a benchmark, a versioned spec, a production
  incident, a measurable signal, or explicit reasoning from stated direct expertise. For speculative
  reasoning, give the inference chain so it can be checked and mark that finding LOW — keep it, do
  not drop it.
- Confidence per finding: HIGH (strong evidence, or direct expertise whose reasoning you state) /
  MEDIUM (reasonable inference, limited evidence) / LOW (speculative). Never inflate confidence on
  an ambiguous point.
- If a premise is flawed, surface it as a weakness with evidence — do not silently build on it, and
  do not refuse the task.
</evidence-and-confidence>

<output-format>
Use this structure unless the task or host-instructions specify a different output format, in which
case follow the host's. Order findings by severity, critical first. For each weakness:
- severity: critical | high | medium | low
- target: the proposal, or the analyst you are challenging (e.g. "Analyst B")
- steelman: the strongest form of the position you are about to attack (1–2 sentences)
- weakness: the scenario or condition under which it breaks (one paragraph)
- evidence: a citation, or [unverified] plus the inference chain
- falsification: the cheapest concrete test that would change your mind (a benchmark, a spec check,
  a load test, a counterexample)
End with one line: the condition under which the proposal would be acceptable.
```
Resolves H3 (output structure + severity ordering, justified by HOST readability — no machine parser
is claimed), H2 (steelman has a slot AND a directive), M2 (target defined: proposal in R1, analyst
when peers present), M3 (speculative kept+labeled), M5 (direct-expertise reasoning is an allowed
evidence representation), M6 (flawed premise → finding), L1 (single static encoding), L2/L3
(tiers/"each finding" defined; "Think deeply" gone).

## Proposed `<approach>` fragment (drift-sensitive; re-injected every round, R1 included)
```
<approach>
- Steelman each position before attacking it (this is satisfied by the steelman field in the
  output format — no separate prose preamble needed).
- Do not soften criticism, and do not agree merely to reach consensus.
- Revise your own position only when your own evidence falsifies it — never because another analyst
  sounded confident. Weigh others' evidence against their stated confidence: high confidence on weak
  evidence is a red flag; low confidence on strong evidence deserves attention.
- Label each finding's confidence: HIGH / MEDIUM / LOW (definitions in the system message).
</approach>
```
Fixes P1 (late-round drift defense kept) and the codex "red-flag interpretation rule lost" objection.
The last bullet re-injects the confidence *directive* every round (the full taxonomy stays in system),
closing the M5 / codex-point-1 asymmetry (shared_convergence re-injects CONFIDENCE every round;
adversarial now re-injects the label directive too).

## R1 user (`buildAdversarialDebateR1`)
```
<host-instructions>…</host-instructions>   (if provided)
<approach>…</approach>
<attack-angle>…</attack-angle>             (ATTACK_ANGLES[workerIndex % len])
<task>…</task>                             (last — recency)
```
No peers in R1 → "target" defaults to the proposal, "steelman" = strongest form of the proposal.

## R2 user — followup (`buildAdversarialDebateFollowUp`, session-continuation)
```
<positions-to-challenge>                   (turn-local "Analyst A/B" labels + per-response confidence; intro: "a sample of the other analysts")
…
</positions-to-challenge>
<approach>…</approach>                     (re-injected)
<attack-angle>…</attack-angle>             (re-injected — M10)
[final round only] <closing>This is the final round. Consolidate into one severity-ordered list:
  keep the weaknesses that survived challenge, fold in any new ones, and still challenge any new peer
  position. Do not manufacture agreement or drop unresolved disagreements.</closing>
                   (H5. The output-format's acceptability-condition line remains THE single close;
                    <closing> adds no second closing line — it only governs consolidation scope.)
```
**Reversal from v2 draft:** followup does NOT re-anchor `<task>`. Session-continuation keeps `<task>`
in history (message[1]) — the same dedup pattern `buildSharedConvergenceFollowUp` uses (prompts.ts
omits task in followup too). Re-adding it would diverge adversarial from shared_convergence and
break the existing `:589` "followup omits task" test. H4 is instead resolved by making the RULE SET
identical across followup/cold-rebuild (system + `<approach>`), not the message layout: a swapped
(cold-rebuild) model legitimately needs `<task>`/`<your-previous>`/`<host-instructions>` re-sent
because it has no history; a continuing model has them in history. M4 "task far back in long session"
is accepted as inherent to session-continuation and consistent with shared_convergence.

## R2 user — cold-rebuild (`buildAdversarialDebateR2`)
Same variable set as followup, plus what a swapped model lacks from history, task last:
```
<positions-to-challenge>…</positions-to-challenge>   (or <debate-so-far> on cold-join — WITH confidence labels, M9)
<your-previous>…</your-previous>                     (if present)
<host-instructions>…</host-instructions>             (if provided)
<approach>…</approach>
<attack-angle>…</attack-angle>
[final round only] <closing>…same as followup…</closing>
<task>…</task>
```
Both R2 paths now carry identical method via `<approach>` and end on `<task>`; cold-rebuild only adds
`<your-previous>`/`<host-instructions>` (genuinely missing from a swapped model's history). H4 closed.

## Cross-cutting
- New adversarial-only `formatChallengePositions(responses)`: "Analyst A/B" by turn-local order +
  confidence. `formatOtherPositions` (shared with shared_convergence) UNCHANGED → no shared_convergence
  regression (fixes P4).
- Adversarial cold-join `<debate-so-far>` (prompts.ts:357-363): add confidence labels (M9). The
  identical shared_convergence cold-join (prompts.ts:217-223) is parallel but OUT OF SCOPE here.
- `escapeXmlContent` on host task/instructions unchanged (anti-injection intended). The host-guidance
  phase (playbook, next) will switch host examples from embedded XML to markdown headings. Deferred,
  flagged (M3-XML).

## Tests to rewrite (RED → GREEN, per workflow.md) — corrected after 3-way v2 review
Verified directly against prompts.spec.ts. **Adversarial system tests live at `:521-527` ONLY**
(`:77-92` and `:286-292` are buildSharedConvergence tests and STAY GREEN — v2 does not touch
shared_convergence; the v2 draft miscited them).

Breaking adversarial assertions to rewrite:
- `:521-527`: adversarial system asserts `<grounding>`, `<completion-check>`, "Reject a flawed
  premise", "multiple approaches" → rewrite to assert `<evidence-and-confidence>`, `<output-format>`,
  severity tiers, "do not refuse the task".
- `:451-453`: `sys.toContain("find weaknesses")` → role no longer uses that literal; update to the
  new "stress-testing / strongest weaknesses" wording.
- `:456-460`: `user.toContain("steelman" / "Do not agree to reach consensus" / "Do not soften
  criticism")` → these move into `<approach>` (still user turn) with new casing/wording; update strings.
- `:463-465`: falsification `/falsify|change your mind/i` asserted in **R2 user** turn → falsification
  is now an `<output-format>` field in the system; update to assert it in system.
- `:468-470`: `/Revise[^.]*own evidence/i` in user → stays GREEN (`<approach>` keeps this); verify.
- `:505, :213`: `HIGH:` in adversarial **user** turn → confidence taxonomy moves to system; rewrite
  to assert taxonomy in system + the per-round label directive in `<approach>`.
- `:513-518`: "should NOT include final round commitment" → **FLIP**: now asserts the final-round
  `<closing>` IS present on the last round and absent otherwise.
- `:558, :603`: order asserts `<positions-to-challenge>` before `<constraints>` (R2 + followup) →
  `<constraints>` replaced by `<approach>`; update tag name + order.
- `:589`: "followup omits `<task>`" → STAYS GREEN (v3 reversal keeps task out of followup); verify.
- `:592/:595`: followup `not.toContain("find weaknesses")` → stays green.
- `:283, :486, :351, :177`: adversarial "One analyst argues" → now "Analyst A/B"; update.
- `:993-1005`: **mixed cross-protocol loop** asserts every builder (sc + ad) contains
  "One analyst argues:" → STRUCTURAL SPLIT required (adversarial entries → "Analyst", sc entries
  stay) — not a one-line edit.
- New tests: `<approach>` in R1/R2/followup incl. confidence-label directive; output-format +
  severity ordering + steelman field in system; final-round `<closing>` only on last round;
  cold-join transcript carries confidence; new `formatChallengePositions` A/B labeling.
- Rerun `scripts/dump-protocol-prompts.ts`; note the R2 sample passes no final-round `roundInfo`
  (script ~:231-238) so the regenerated doc won't show `<closing>` unless the sample args are updated.

## extractDebateDigest (requested dependency check)
No regression: `extractDebateDigest` (prompts.ts:111-133) parses `<position>/<evidence>/<alternatives>`
tags that adversarial output NEVER emitted (before or after v3) — it already falls through to the
line heuristic. v3 does not change this. The digest is effectively dead for adversarial either way.

## Implementation scope
Pure `prompts.ts` (new `ADVERSARIAL_SYSTEM` string, `<approach>` const, `formatChallengePositions`,
un-underscore `roundInfo`/`workerIndex` in R2/followup builders, cold-join confidence) + the
`prompts.spec.ts` rewrites above + doc regen. No engine/wire changes.
```
