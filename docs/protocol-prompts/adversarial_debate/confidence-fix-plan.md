# Confidence-parse fix plan (draft for 3-way review)

## Problem (measured, reproduced)
`parseConfidence` (engine.ts:181-198, regex :185) does not recognize a bolded field label
`**confidence**: HIGH`. Claude renders the per-finding confidence field this way by default
(6-8×/response; the worker itself confirmed it bolds labels). GPT writes plain `confidence: HIGH`
(parses). Live adversarial run: R1 claude → confidence UNDEFINED; R1 gpt → high.

## Attribution (measured)
- The parser regex limitation is **pre-existing** (engine.ts unchanged from HEAD; regex byte-identical).
- The **manifestation in adversarial is a regression introduced by the v3 worker-prompt change**: the
  new `<output-format>` added a discrete `confidence` field that Claude bolds. Measured control:
  shared_convergence (unchanged `CONFIDENCE_AND_UNCERTAINTY`, no field) → Claude writes inline confidence,
  parses fine. evaluation_scoring is protected because its prompt gives parser-matching examples
  (`(e.g. **HIGH**, [MEDIUM], confidence: LOW)`, prompts.ts:556).

## Why prompt-only (B) is NOT the proper fix
B = instruct the model "don't bold the confidence label." It fights the model's markdown default,
is unreliable (worker-confirmed), and leaves the parser fragile for the next model/format. It treats
the symptom. The orthodox fix is parser robustness at the layer that owns parsing.

## Proper fix — two parts

### Part A (root cause, shared): make parseConfidence tolerant of reasonable markdown emphasis
- Extend the regex to accept optional `**`/`__` emphasis around the LABEL and/or VALUE on the
  `confidence: VALUE` form. Keep ALL existing alternatives unchanged (purely additive).
- Proposed added alternative (illustrative):
  `\*{0,2}_{0,2}confidence_{0,2}\*{0,2}\s*:\s*\[?\*{0,2}(high|medium|low)\*{0,2}\]?`
- Scope reality: engine.ts is shared by ALL protocols + detectConformity/detectMinorityDissent/
  evaluation aggregation. This is correct (the gap is a parser robustness bug), NOT scope creep — but
  it MUST be regression-guarded.
- Risk to manage: over-matching / false positives (matching the word "confidence" in unintended prose).
  Mitigation: anchor on `confidence\s*:` with the value adjacent; do not loosen the value side to
  free-floating words.

### Part B (in-scope adversarial reconciliation, regardless of A)
- The `<output-format>` field list (prompts.ts:316-321) omits a `confidence` row though `<approach>`
  mandates per-finding confidence — a real inconsistency both reviewers flagged. Add:
  `- confidence: HIGH | MEDIUM | LOW`
  to the field list. This is a within-adversarial-scope correctness fix and also nudges a
  parser-friendly form WITHOUT a brittle "don't bold" instruction.

### Deferred — Part C (separate plan, NOT this fix)
Per-finding confidence vs single response-level `WorkerResponse.confidence` is a semantic mismatch
(parseConfidence majority-collapses N findings to 1). Fixing it means a schema change
(types.ts/engine.ts/serialization/consumers). Out of scope here; tracked as its own plan.

## Tests (RED → GREEN, per workflow.md)
- engine.spec.ts parseConfidence: ADD cases — `**confidence**: HIGH` → high, `__confidence__: LOW`
  → low, `**HIGH**` still → high, plain `confidence: MEDIUM` → medium, mixed picks most-frequent,
  and a NEGATIVE case ensuring prose like "I have confidence in X" does NOT match (no false positive).
- prompts.spec.ts adversarial: assert `<output-format>` now contains the `confidence:` field row.
- Regression guard: run FULL suite; confirm shared_convergence + evaluation_scoring confidence
  assertions (e.g. the `HIGH:` user-turn asserts, evaluation `**HIGH**`/`[MEDIUM]`/`confidence: LOW`)
  remain GREEN — A must not change their parse outcomes.
- Re-run the LIVE adversarial deliberation and confirm Claude R1 confidence now parses.

## Open questions for review
1. Is the proposed regex extension truly additive (no existing-match regression, no new false
   positives)? Provide a counterexample if not.
2. Should Part A also handle `[HIGH]`-style on the label, or is value-side `[high]` (already matched)
   enough?
3. Is reconciling the output-format field (B) sufficient on its own for adversarial if A lands, or is
   B redundant once A is in? (Keep B for the documented inconsistency regardless.)
4. Confirm: does any consumer rely on confidence being ABSENT for adversarial (i.e., would newly
   parsing Claude's confidence change detectConformity/detectMinorityDissent behavior in a way that
   needs its own test)?

---

## v2 — post 3-way review (converged)

**Correction (verified by grep):** `detectConformity`/`detectMinorityDissent` are defined+tested but
NEVER called in `deliberate()` (orphaned). So A causes NO detector behavior change. A's live effect is
only: host output (engine.ts:1300,1329) and R2 peer-view (prompts.ts:102) now carry Claude's
previously-dropped confidence. Both reviewers' "detector regression" concern is moot.

**Regex must add word boundaries (both reviewers, independently):** without them the new alternative
false-positives on `overconfidence:`, `nonconfidence:`, `confidence: lower`, `confidence: mediumship`.
Require `\b` before the label and `\b` after the value.

**Korean:** apply the same emphasis-tolerance to the existing `신뢰도` label (bolded `**신뢰도**:`).

**B reframed:** pure prompt-consistency fix (output-format field list omits a `confidence` row that
`<approach>` mandates, prompts.ts:316-322). NOT a parser nudge. Redundant for parsing once A lands,
kept for the documented inconsistency. Update prompts.spec.ts output-format assertion.

**Tests (RED first):** positives `- **confidence**: HIGH`, `__confidence__: LOW`, `confidence: [HIGH]`,
`confidence: **HIGH**`, `_confidence_: HIGH`; preserve `**HIGH**`/`[HIGH]`/`HIGH confidence`/`신뢰도: HIGH`;
NEGATIVES `overconfidence: HIGH`, `nonconfidence: LOW`, `confidence: lower`, `confidence: mediumship`
(must NOT match); HIGH+LOW tie → `low` (engine.ts:195 low-bias); full-suite regression
(shared_convergence + evaluation unchanged); LIVE re-run confirms Claude adversarial confidence parses.

**C deferred** (per-finding confidence array) — separate plan; note response-level value stays a coarse
majority-collapse meanwhile.
