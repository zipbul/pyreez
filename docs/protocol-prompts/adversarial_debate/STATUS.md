# adversarial_debate — status & evidence (worker prompt + harness)

Self-contained record of the work and the measured ceiling. Nothing here is committed.

## Final state
- Tests: **698 pass / 0 fail**, `tsc --noEmit` clean.
- Worker prompt (`src/deliberation/prompts.ts` `ADVERSARIAL_SYSTEM` / `ADVERSARIAL_APPROACH`) and the
  generated docs (`worker.md`, `user-agent.md`) are in sync (regenerated via `scripts/dump-protocol-prompts.ts`).
- Host guidance (`playbook.md`) synced: removed the harmful "force an external citation" rule (it
  caused fabrication on a no-lookup worker), removed deleted-symbol references, switched task examples
  from escaped-XML to markdown, documented that severity/output-format/evidence-discipline are worker defaults.

## What the worker prompt now contains (and why)
Evidence-discipline contract (system, cached):
- No external lookup → **reasoning chain is the default evidence** (full credit, can be HIGH); cite only
  exact-recall sources. This removed the citation-first incentive that drove confabulation.
- Per-claim self-checks: Existence / Attribution / **Identifier** (named command/flag/API must be real) /
  Venue-year / Quote-verbatim / Number-in-source.
- **CoVe-factored pre-submit pass**: verify each source/number/quote IN ISOLATION (judged by memory of the
  source, not by fit to the argument); on failure → "source unknown" / "[exact figure not recalled]" / drop
  quotation marks. Plus a **self-consistency** check (resolve a finding that contradicts its own description).
- Uncertain → `[unverified]`, capped LOW; "a sharp [unverified] argument outscores a fabricated citation".
Output-format (system): reason-before-verdict field order (target/steelman/weakness/evidence/falsification,
THEN severity/confidence) to undo the commit-first penalty; severity-ordered findings; acceptability line.
Per-round `<approach>` (user turn, re-injected): steelman / no-soften / revise-only-on-own-evidence /
weigh-confidence / **≥1 substantive falsifiable critique per round** (anti-lazy) / confidence label.
Role: staged framing ("enumerate failure modes → attack each → keep survivors") for depth without banned CoT.

Depth lever (vendor, not prompt): `--reasoning-effort minimal|low|medium|high|xhigh` exposed on the CLI
(`cli.ts`) → handler → wire pass-through. **Caller opt-in, no baked default** (a prior auto-default was
rolled back). This is the sanctioned way to push reasoning depth (CLAUDE.md harness rule).

## Measurement journey (live runs, every citation web-verified)
Same 6 diverse tasks (Redis idempotency, monorepo CI, Postgres queue, JWT localStorage, Kafka EOS, RSC).

| Version | prompt change | defect rate | fabricated | misattributed | fake-id | paraphrase | abstentions | staff-bar | RQ |
|---|---|---|---|---|---|---|---|---|---|
| pre-v3 (early, n=2) | original (citation-first) | many | GoCardless etc. | — | — | — | ~0 | — | — |
| v2 | evidence-discipline + Identifier check | 10/93 = 10.75% | 3 | 5 | 0 | 2 | ~10 | 1/6 | 8.0 |
| v3 | + CoVe-factored isolation + abstention + reason-before-verdict + anti-lazy | 5/83 = 6.0% | 0 | 3 | 0 | 2 | 24 | 2/6 | 8.2 |
| v4 | + self-consistency | 7/75 = 9.3% (n=6) | 1 | 3 | 0 | 1 (+venue 1, selfC 1) | 18 | **3/6** | 8.0 |

Per-class trend (defects / citations), n=6 each except where noted:
- defect rate: 10.8% (v2) → 6.0% (v3) → 9.3% (v4) — **oscillates within noise, not converging to 0**.
- fabricated (catastrophic): 3 → 0 → 1 — **essentially eliminated** (v4's 1 is a single instance in c4).
- fake identifiers: 0 → 0 → 0 — **solved** (the Identifier check holds).
- staff-bar (zero-corrections): 1/6 → 2/6 → **3/6** — the one **monotonically improving** signal.
- reasoning quality: 8.0 → 8.2 → 8.0 — flat (no over-suppression from the added rules).
- abstentions: ~10 → 24 → 18 — the abstention mechanism fires, but variably.

**Key correction to an earlier claim:** in v3 two residual defects (Kafka `emit.checkpoints.interval.seconds`
default; React hydration semantics) were called "needs retrieval / hard recall limit." In v4 **neither
recurred** — c5 (Kafka) marked the two uncertain defaults `[unverified]` (abstention catching the exact
confident-wrong-recall class) and c6 (RSC) made no false doc claim. So that residual is **partly
abstention-catchable and partly stochastic, NOT a fixed hard floor.** My earlier "model/retrieval limit"
framing was too strong; the honest read is a noisy mix of abstention-catchable, stochastic, and genuinely
hard recall errors — the hard fraction is smaller and less cleanly isolable than asserted.

**Statistical honesty:** every campaign is n=6 (v4 verified across 2 batched + 2 single-agent passes due to
recurring server rate-limits), single auditor model, temp=1.0 regeneration → different artifacts each run.
Wilson CIs overlap heavily; no per-class rate change is statistically significant. Robust, n-independent
conclusions only: (1) catastrophic fabrication (invented incidents / fake APIs) ≈ 0 — solved; (2) staff-bar
rose 1/6→3/6 across iterations; (3) a few-percent precision-defect floor persists and is not driven to 0 by
more prompt rules — adding rules trades one class for another within noise.

## The ceiling (evidence-based, not asserted)
- **Catastrophic fabrication (invented incidents/sources/fake APIs): eliminated** (0 across v3/v4). A direct
  no-lookup probe (3/3) proved the model KNOWS a fake API is fake when asked in isolation — so that class was
  generation-discipline (prompt-fixable), and the Identifier + CoVe checks closed it.
- **Residual is precision defects: misattribution / wrong external specifics / paraphrase-as-quote /
  occasional self-contradiction.** It does NOT split into a clean "prompt-fixable vs retrieval" ratio —
  the v4 data showed the v3 "retrieval-class" cases (Kafka default, React semantics) did not recur and one
  was caught by abstention. The honest characterization: a noisy mix of (a) abstention-catchable
  confident-wrong recall, (b) stochastic precision slips that vary run-to-run, (c) a small genuinely-hard
  recall fraction. The hard fraction is real but smaller and less isolable than a single measurement implied.
- **Verdict:** "extreme reasoning" is achievable without retrieval (vendor reasoning-effort + reason-before-
  verdict + staged framing). Catastrophic fabrication (invented incidents / fake APIs) is solved (~0).
  **A ~0 precision floor is NOT reached by prompting alone** — more rules trade defect classes within noise.
  The only lever the evidence still points to for the hard-recall fraction is **worker tool-grounding**
  (read-only web/file lookup so the worker verifies a citation instead of recalling it): a separate
  architectural change (see `docs/VISION_WORKER_TOOLS.md`; ~30× cost, web not wired) and a cost decision —
  NOT done autonomously. Prompting has been pushed to its evidenced limit.

## Retrieval (worker tool-grounding) — IMPLEMENTED + smoke-confirmed, rigorous verify PENDING
User-approved. Added an opt-in `--web-access` capability: claude `-p` workers get `WebSearch,WebFetch`
tools and the adversarial system prompt swaps its no-lookup discipline for a **verify-with-tools**
contract (verify each source/number/identifier before asserting; cite the URL; `[unverified]` if a
lookup can't confirm). Plumbed types→adapter→claude-cli→wire→handler→CLI. **701 tests pass, typecheck
clean.** Claude only (codex/gemini ignore webAccess). No baked default — opt-in (cost/latency ~2-3×).

- **Smoke test (1 round, 2 anthropic models):** works headless, exit 0, no swaps, **13 & 19 URLs cited**
  (no-lookup runs cite ~0) — workers genuinely use the tools.
- **PoC (c3/c5/c6, 2 rounds, web-access):** directional signal STRONG (deterministic check, agents blocked):
  - web_c5 (Kafka): cites `cwiki.apache.org` KIP pages, "KIP-360 ... (verified)", correct default
    `transaction.max.timeout.ms=900000ms` — the exact confident-wrong-recall class that failed no-lookup
    now grounded in the real spec.
  - web_c6 (RSC): surfaced + cited REAL current advisories (CVE-2025-55183 etc. from react.dev / GitHub
    Advisory DB) with a verbatim quote — content no-lookup recall could not safely produce.
  - All URLs from authoritative domains (cwiki.apache.org, react.dev, nextjs.org, github.com).
- **NOT yet confirmed (blocked):** the rigorous "does each cited URL actually support its claim?" audit
  (the new citation-theater risk) — the verification workflow hit the **weekly API usage limit (resets
  3am Asia/Seoul)**. Also: c3/c5 R2 came from claude-haiku (weaker fallback after opus/sonnet swapped),
  and n=3. So "retrieval closes the citation gap" is **directionally supported, not rigorously proven**.
- **Next when quota resets:** web-verify web_c3/c5/c6 (URL-supports-claim), and run web-access on the
  v4-DEFECTIVE tasks (c1/c2/c4) for a clean fix-demonstration vs no-lookup.

## Prompt cleanup + B4 measurement (post-review)
Two adversarial reviews (subagent + codex) of the full rendered worker prompt. After verifying each
finding against the prompt + measurement, applied only the confirmed low-risk structural fixes:
- role: reconciled "keep only survivors" vs "keep low-confidence findings" (discard only what your own
  counter-attack fully refutes; keep the rest, weak ones LOW).
- output-format: decoupled inter-finding severity ordering from intra-finding verdict-last; merged
  severity+confidence into one `verdict:` line; `target` is now R2-only (dead in R1).
- `<approach>` split R1 vs R2+: R1 drops the peer-relative lines (consensus / weighing-others /
  not-restating) that are dead weight with no peers; steelmanning lives only in the output-format field.
  R1 user turn 767→242 chars. System 2879→2966 (role/output reconciliation). 701 tests pass.
Rejected after verification: "[unverified] launders fabrication" (already handled — identifier rule says
describe-don't-name, number rule forbids fake specifics; live run confirmed correct hedging) and
"falsification field is dead weight" (it's a disconfirmation proposal for the host, not self-executed).

**B4 — does the reasoning→HIGH path inflate confidence, and is it fixable?** Measured, R1-only, 4 tasks
(c1/c3/c5/c6), 2 anthropic models, no swaps. FOUR confidence-rule treatments tested:
- current: "HIGH = exact-recall fact OR a deductively tight argument; clean reasoning is not by itself HIGH."
- sharp: current + an embedded "can you construct a realistic escape?" wording test.
- struct: current + a mandatory `necessity:` OUTPUT FIELD forcing the worker to WRITE the escape scenario
  (or "none: unconditional") before any HIGH. (This is the structural intervention a result-review flagged
  as the most important untested lever.)
- medcap: "reasoning alone never earns HIGH; HIGH = exact-recall fact ONLY."

First pass used a single blind judge → current 48.9% inflated. A results-review correctly attacked that:
single judge = single point of failure, denominator gap (parsed-HIGH ≠ judged-HIGH), struct untested,
medcap precision unmeasured. Redone properly: fixed the extractor (judged-count == parsed-HIGH-count) and
ran TWO independent blind judges over the merged 83 HIGH findings.
| variant | HIGH-rate | inflated-HIGH J1 / J2 |
|---|---|---|
| current | 0.73 | 62.2% / 68.9% |
| sharp | 0.755 | (single-judge era: ~44%) |
| struct (forced necessity field) | 0.59 | 56.3% / 78.1% |
| medcap | 0.097 | 33.3% / 33.3% (n=6) |
Inter-judge agreement 80.7%, Cohen κ=0.59 (moderate) — the inflation metric itself carries ~±15pp
judge-dependent slop, so the single-judge 48.9% was an under-estimate; true current inflation ≈ 62-69%.

Corrected conclusions:
1. **Neither wording (sharp) NOR structure (struct's forced necessity field) reduces inflation among HIGH.**
   struct only trims HIGH *volume* (0.73→0.59); the surviving HIGHs are no more deductive (56-78%). So
   confidence inflation is not promptable away within a self-labeling paradigm — now shown across 2
   interventions × 2 judges, not assumed.
2. **medcap is the only treatment that improves HIGH precision** (33% vs ~65% inflated) by removing the
   self-assessed reasoning→HIGH path — but n=6 HIGH, Wilson CI overlaps current, so the precision gain is
   directional, NOT statistically established; and it costs recall (caps the genuine ~25-35/83 deductive
   findings at MEDIUM).
3. **Decision (revised after a third review round): adopt `medcap`.** A first cut kept `current` and
   justified it by an UNMEASURED R2 cross-check backstop ("peers flag high-confidence-weak-evidence"). A
   results-review (subagent + codex) correctly called that a status-quo rationalization: the backstop is
   untested (R1-only experiment), "medcap underpowered → keep current" is a non-sequitur (underpowering
   means suspend judgment, not default to incumbent), and the directional evidence (medcap halves inflation
   AND uniquely targets the root cause — self-assessed deductive tightness) leans medcap. Decisive point:
   keep-current DEPENDS on the unmeasured backstop; `medcap` does NOT (it never grants reasoning a HIGH), so
   it is the choice that rests on no untested assumption, with the conservative failure mode (under-claim,
   not over-claim). Adopted medcap wording: "HIGH = a fact you recall exactly or can verify; reasoning is at
   most MEDIUM here, however tight it feels." **This is a principled + directional call, NOT statistically
   proven** — see Honest gaps below.
Artifacts: `.advq/val/` (b4_*, blind2.json, blind2_map.json, hi2_*, extract2.ts, parse.ts).

**Honest gaps (reviewers, conceded — NOT closed):** (a) the whole experiment is n=4 tasks × 2 models × 1
sample, R1-only → findings cluster in ~8 task-model cells (pseudoreplication); "inflation not promptable
away" is itself underpowered, not just the medcap estimate. (b) Inter-judge κ=0.59: on `struct` the two
judges disagree on the SIGN of the effect (56% vs 78%), so "struct doesn't help" is unestablished. (c) The
`struct` necessity-field was a weak implementation (free-text, placed AFTER falsification → backfillable);
a machine-checked, HIGH-gating version was not tested. (d) The judges are themselves LLMs doing the same
self-labeling under test — no human-adjudicated gold anchor. (e) medcap precision is n=6 (33% = 2/6). Full
resolution needs ≥12 tasks × ≥3 samples, R1→R2 backstop measurement, a machine-checked struct, ≥2 vendors,
and a human-anchored judge subsample — a larger experiment, not run.

**Prompt fixes from the review rounds (verified, applied).** role discard-bar softened from "fully refutes"
(over-retention) to "drop what your counter-attack defeats or that only fires under excluded conditions";
restored `target` as an optional leading field; re-added a steelman cue to the R2 `<approach>`;
acceptability line may now state "none exists"; **the R2 "must add at least one critique per round" quota
(flagged by BOTH prompt reviewers as manufactured-filler pressure in the one protocol whose top goal is
preventing fabrication) is now conditional** — "add one if it survives; if none does, say so and test the
peers' claims." Rejected after verification: "attack-angle dropped in R2" (false — R2 injects it when
workerIndex is set, confirmed in code + spec).

## Open / not done
- Larger-n measurement for statistical power (current n=6 is underpowered; conclusion is stable but CIs wide).
- Worker retrieval/tool-grounding — the only lever left for the confident-wrong-recall residual.
- Other 5 protocols not audited to this depth (potential same residual class).
- Nothing committed (per standing instruction).

## CORRECTION (supersedes the B4 "unmeasurable / ~65-80% inflation" conclusions above)

A statistics error invalidated the earlier confidence conclusions. The inflation metric used a SUBJECTIVE
"deductive vs contingent" judge rubric whose inter-judge Cohen κ was 0.04 — which I read as "the metric is
noise → confidence is unmeasurable." That was wrong: κ=0.04 is a **base-rate artifact (the kappa paradox)** —
both judges call ~80% CONTINGENT, so chance agreement pe≈0.70 and κ collapses to ~0 by arithmetic even though
raw agreement is 71%. The judges agreed on the aggregate but disagreed on *which* findings are deductive
(positive agreement on the DEDUCTIVE class = 0.21). A results-review (subagent + codex) caught this and
proposed an OBJECTIVE, per-finding metric matching the rule's own definition: **does a cheap deterministic
falsifier actually exist for this HIGH finding?** (spec/config/code-inspection/one counterexample = yes;
load-test/benchmark/timing/telemetry = no).

Re-measured the shipped falsifier-decisiveness confidence rule with that objective metric, 2 blind judges:
| variant | HIGH findings | deterministic-backed (judge A / B) | inter-judge |
|---|---|---|---|
| cons (shipped) | 44 | 66% / 66% | raw 82%, **κ 0.60** |
| aggr (deeper cut) | 32 | 88% / 78% | raw 84%, **κ 0.46** |

Corrected, reliable conclusions:
1. The confidence metric IS measurable — with the objective falsifier-existence rubric κ jumps 0.04 → 0.60.
   "Unmeasurable" was a kappa-paradox misread, now retracted.
2. The falsifier-decisiveness confidence rule WORKS: ~66% of HIGH findings carry the cheap deterministic
   falsifier the rule requires. The ~34% residual (HIGH on genuinely load/timing-dependent failures) is a
   real but moderate generation-discipline gap, not the 65-80% "inflation" the broken subjective metric
   implied.
3. The aggressive condensation is safe on confidence quality (aggr 83% ≥ cons 66%, both reliably measured) —
   the deeper cut did not degrade the HIGH label and if anything tightened it.

Prompt size after the full minimization: SYSTEM 3343→2101 chars / 525→305 words; R1 worker ~899→583 tokens.
All rules preserved (unit tests pin each); 701 tests pass. Lesson for this record: an unreliable metric
(κ=0.04) produced three wrong "ceiling" conclusions that survived multiple rounds until an objective,
rule-matched metric (κ=0.60) was used. Measure the right thing, and check inter-rater reliability BEFORE
drawing conclusions.
