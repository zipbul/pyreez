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

## Introspection loop (2026-07, discovery-era, live 3-worker runs)
Method: run → collect all problems → batch-interrogate the worker (session resume) → fix via 3-way
debate (subagent + codex + me, NOT pyreez) → re-measure. Models: claude-haiku, xai/grok-build, gpt-5.4-mini.

- **it1**: 1/3 (grok) ignored output-format (prose+headings); all 3 converged despite distinct angles.
  Fix: format-MUST line; attack-angle made self-contained ("avoid obvious critiques any model would reach
  without this lens", dropped the unactionable "your peers cover those").
- **it2**: measured — format-MUST INEFFECTIVE for grok (still prose, 0 labels); grok CONFABULATED
  compliance on interrogation. Tried a concrete filled-finding example (different channel).
- **it3**: measured — filled example ALSO ineffective for grok (3rd consecutive non-compliant run).
  → **grok-build is intrinsically format-noncompliant for this protocol** (ignores bare-fields → MUST →
  example; confabulates compliance). NOT prompt-fixable. Reverted the example (bulky, no measured effect;
  claude-haiku/gpt-5.4-mini comply without it). Downstream stance: treat grok output as prose (the affinity
  rubric judge scores axes from content regardless), or deprioritize grok for field-parsing consumers.

- **it4**: measured — spec-gap/ambiguity findings rated critical/HIGH, violating the HIGH-rule (worker
  mis-reads "cheap deterministic check" as "I can confirm the spec is silent"). Fix (3-way debate): add
  to both NOLOOKUP+WEB confidence defs — "a missing/ambiguous spec is not HIGH unless the failure it
  implies is itself deterministically checkable." Convergence debated → NO CHANGE (corroboration in a
  stress-test, not a defect; it's a symptom of the confidence inflation). (Reverted an unauthorized
  attack-angle edit a reviewer slipped in — subagent-verification.)
- **it5**: measured — HIGH ratio unchanged (it3 7/24 → it5 9/23). Not a regression: most spec-gaps on
  this task DO imply deterministically-checkable failures (windowing→boundary burst, missing atomicity
  →TOCTOU race), so HIGH is CORRECT per the new clause. The pure-ambiguity class (shared-vs-per-endpoint,
  needs code-read) rarely recurred, so the clause's effect is within noise at n=1 — principled but
  statistically invisible per-run (same lesson as the earlier campaigns). Clause kept (1 line, correct).

## Robust conclusions from the 2026-07 loop (n-independent)
1. grok-build is INTRINSICALLY format-noncompliant for this protocol (n=3; ignores bare-fields → MUST →
   filled example; confabulates compliance). Not prompt-fixable → treat grok as prose downstream.
2. attack-angle made self-contained (drop the unactionable "peers cover those") — unambiguous improvement.
3. format-MUST line: helps the explicit contract; compliant models (haiku, gpt-5.4-mini) already complied.
4. spec-gap confidence clause: principled correctness refinement; measured effect within per-run noise.
5. convergence of heterogeneous workers on the top flaw = corroboration, NOT a defect (no change).
Method worked: every fix was decided by 3-way debate (subagent+codex+me, not pyreez) and measured live;
grok's intrinsic limit was found by re-questioning the worker in its own resumed session.

## CORRECTION (supersedes the it3 "grok-intrinsic" conclusion)
Root-caused by direct CLI isolation (outside pyreez): grok-build IS NOT intrinsically format-noncompliant.
- Experiment B (format in `--system-prompt-override`, no --verbatim): grok emits markdown → FAILS.
- Experiment C (same format placed in the `-p` prompt instead): grok follows it exactly (steelman:/weakness:/
  verdict:, zero markdown) → WORKS.
- Experiment D (`grok --json-schema`): hard-constrained structured output, also works.
Cause: grok UNDERWEIGHTS `--system-prompt-override` content for format-critical instructions but obeys the
same instructions in the `-p` user prompt. pyreez's grok-cli passed the system block ONLY via
--system-prompt-override, while codex/gemini fold it into the prompt via composeSystemPrompt — so grok
alone never effectively received the output-format. This is why the it1 MUST line and it2 example didn't
move grok: it wasn't reading them. FIX: grok-cli now folds system into the -p prompt (composeSystemPrompt),
matching codex/gemini. Verified live via pyreez: grok-build now emits proper fields (steelman/verdict, 0
markdown headings). grok's "confabulation" was partly this — it did receive the system (via override) but
underweighted it. The one "hard" finding of the loop was itself a tooling bug, now fixed.

## Loop-2 (2026-07, grok now format-compliant) — re-baseline, 5 rounds over 5 domains
Fresh loop after the grok-cli fix (all 3 workers now emit fields). Tasks spanned 5 domains:
sync-writes, sync-writes(re-measure), csv-permission-column, client-only-validation, unbounded-cache.
- **L2-it1** (sync-writes): the evidence-gaps worker produced 3/3 pure META findings ("no data/no
  measurement") + near-identical "record a trace and benchmark" falsifications. Root cause (3-way debate,
  subagent+codex independently reaching the same wording): ATTACK_ANGLES[1] was the only angle naming an
  ABSENCE as its target. FIX: reworded to "Focus on evidence gaps — if an asserted premise is false, what
  concrete failure path follows?"
- **L2-it2** (re-measure): evidence-gaps worker meta 3→0, falsifications went from "benchmark it" to
  concrete failure-path tests ("commit a unique row after the last …", "simulated complete primary loss").
  Clean measured win. No new defect.
- **L2-it3/it4/it5** (csv-perms / client-validation / unbounded-cache): high quality across the board —
  format compliant (0 markdown), confidence well-calibrated (HIGH for deterministic, MEDIUM for
  contingent), lens-diverse findings, no fabrication, low convergence. Only residual: the evidence-gaps
  angle still slips to meta on ~1 finding per run (down from 3/3) — a within-noise residual; chasing it
  further is over-prompting.
→ **Loop-2 reached DRY**: 4 consecutive clean probe rounds across 4 distinct domains after the it1 fix.

## Session net (both loops + root-cause)
1. grok "format non-compliance" was a pyreez grok-cli TOOLING bug (system in --system-prompt-override,
   which grok underweights), NOT intrinsic — fixed by folding system into -p (composeSystemPrompt). This
   was the single highest-impact fix; found only by tracing WHY (direct CLI isolation) instead of
   accepting the it3 "intrinsic" conclusion.
2. attack-angle self-contained (loop-1) + evidence-gaps→failure-path (loop-2): two measured angle fixes.
3. format-MUST + spec-gap-confidence clauses: principled, low-cost, effect within per-run noise.
Every fix decided by 3-way debate (subagent+codex+me, not pyreez) and measured live; defects found by
re-questioning the worker in its own resumed session.

## Full-prompt char-level audit (5 independent auditors) → 4 deterministic fixes
Ran the audit the RIGHT way this time: rendered the real delivered prompt via `deliberate --transcript`
(not a hand-render), then audited it with FIVE independent auditors — pyreez dogfooded as a 3-worker
adversarial_debate (opus[1m] + gpt-5.4 + grok-build, file captured) PLUS a general-purpose subagent PLUS
codex. Cross-checked every finding against the real prompts.ts before applying anything.

Filtered out a false-positive: gpt-5.4 flagged a stray `</task>` "critical" — that was an artifact of the
audit-SUBJECT extraction file, not ADVERSARIAL_CLOSING. Not applied.

Applied (consensus + text-deterministic + verified no behavioral loss):
- **A. role drop-rule grammar** (4/5 auditors): the comma-splice "drop any your own counter-attack defeats,
  that only fire…" → a clean 3-condition list (a)/(b)/(c). It was the only outright ungrammatical sentence;
  ambiguous parse of the sole finding-drop rule risked over/under-pruning.
- **B. R1 severity-vs-lens ordering conflict** (4/5, highest consensus): system said "most critical first"
  while the R1 <attack-angle> said "lead with the strongest weakness the lens reveals" — position-1 was
  non-deterministic. System rule now explicitly yields finding[0] to the attack-angle in R1.
- **C. format-compliance lever** (3/5): "no omitted fields" → "no renamed, added, or omitted fields" (rename/
  add is the dominant drift, not omission); verdict line now says "no backticks or quotes around it" (models
  copied the template's delimiter backticks).
- **D. optional `target` vs "no omitted fields"** (codex): the conditional peer field read as an omission
  violation; marked it the sole exception inline.

Rejected (measured design / no manifest defect):
- gpt-5.4's confidence-rubric rewrite (anchor to textual determinacy) — would collapse the intentional
  falsifier-decisiveness scale (measured kappa 0.60). Kept as-is.
- gpt/grok's "emit ONLY lens-diagnostic findings" — opus Finding-1 correctly warned this suppresses the
  dominant obvious flaw across all workers. Post-fix measurement (caching task) CONFIRMED the opposite of
  the worry: all 3 workers covered unbounded-memory/OOM while their LEADS stayed diverse (assumption /
  premise / operational) — so "avoid obvious" already applies to emphasis, not omission. No coverage rule
  added (would be over-prompting).
- angle-1 reframe (opus Finding-3, angle0/angle1 premise overlap) — the "meta"-looking grok lead is the
  evidence-gaps lens working legitimately (questioning an unmeasured premise); the measured L2it1 win holds.
  Re-tuning risks thrashing a measured-good angle. Not applied.

Verification: 742 tests pass, typecheck clean, format 0-markdown / 0-backtick / calibrated verdicts on live
re-measure. Fixes decided by cross-checking 5 auditors (pyreez + subagent + codex), not one voice.

## Evidence block: 2 variants → 1 tool-agnostic block (remove prompt/wiring desync)
Question raised: why does the prompt have a separate web vs no-lookup evidence block, and why mention web
tools at all? Answer: it shouldn't. Whether a worker holds web tools is decided by the harness WIRING
(request.webAccess → grok --disable-web-search / claude WebSearch tools / codex webSearchEnabled) — the
single source of truth. The model learns its tools from the tool schema, not prose. A prompt that ALSO
announces "you have web search tools" (or forbids URLs in no-lookup) creates a second, desyncable source:
if it claims a tool the wiring didn't grant, the worker acts on a false self-model (tries to fetch, then
confabulates); if it suppresses a granted tool, the capability is wasted. Same category error as baking a
reasoning-effort instruction into a prompt when the vendor exposes an effort parameter.

The two disciplines were never actually opposite — both reduce to ONE invariant: "assert a specific only
when you can confirm it." A web worker confirms by running a check; a no-tool worker confirms by exact
recall, else abstains ([unverified]). "Never emit a URL" (no-lookup) and "cite the URL" (web) are the same
rule — emit only confirmable specifics — over an empty vs non-empty confirmable set.

Change: merged ADVERSARIAL_EVIDENCE_WEB + ADVERSARIAL_EVIDENCE_NOLOOKUP into one tool-agnostic
ADVERSARIAL_EVIDENCE; removed the `webAccess` parameter from adversarialSystem + the R1/R2 builders + the
EngineDeps buildR1/R2Messages signatures + the engine's workerWebAccess + wire's threading. The wiring
(request.webAccess → workerGenParams → provider) is untouched — web search is NOT killed.

Measured both modes (live):
- **no-lookup** (caching task, 3 workers): no regression — format 0-markdown, 0 fabricated URLs, 0 stray
  backticks, calibrated verdicts, meta count identical to prior clean runs.
- **web** (libuv thread-pool task, --web-access, grok+gpt): active verification PRESERVED — gpt fetched
  Node/libuv docs and cited 7 URLs + a Sources section + used [unverified]; grok quoted libuv verbatim
  with the correct fact ("default size is 4") and reasoned from it. The tool-agnostic "confirm by a check
  you actually ran" still drives real verification.
Honest caveat: the merge softened the old web block's explicit "cite every URL" MANDATE to a guard against
FALSE citation. grok verified-without-citing. This is intentional and aligned with the anti-confabulation
design — the citation-first mandate is exactly what drove the earlier confabulation floor. 742 tests pass.

## Worker-interrogation loop (R2 live-captured) → 4 fixes + 1 tool bug
Ran a 2-round debate, captured the R1+R2 prompts LIVE, then interrogated all 3 workers in their resumed
sessions ("reflect only on the prompt you were given — redundant / ambiguous / conflicting / dead-weight /
missing?"). This surfaced defects that R1-only measurement never could.

First it exposed a TOOL bug: `interrogate --worker N --round M` always returned worker 0 / round 1 —
BunFileIO.glob filtered on the suffix after '*' alone, so "r2_w1_*.json" matched every "*.json". Fixed
(prefix+suffix match, RED test); only then could I target grok/gpt individually.

Cross-model-confirmed prompt fixes (quotes from the workers' own audits):
- **A. ordering stated twice** (haiku+grok): the R1 <attack-angle> wrapper's "Then order the rest by
  severity" duplicated <output-format>'s severity rule (a redundancy my earlier ordering-conflict fix
  introduced). Removed it from the wrapper; ordering now lives once in <output-format>.
- **B. two <attack-angle> blocks in R2, no precedence** (gpt+grok+haiku — 3/3): in session-continuation the
  R1 lens stays in history while R2 injects a rotated lens, so the worker saw two lenses and guessed which
  governs. The rotated R2/FollowUp angle now announces "New lens for this round — it replaces the lens you
  led with earlier." Only catchable by interrogating a real R2 session.
- **C. "a check you actually ran" was ambiguous** (haiku+grok): a no-tool worker on a one-sentence
  hypothetical couldn't tell if it should use tools. Reworded to "confirm it with the means available to
  you (certain recall, or verification if you have tools)". Measured: gpt then verified TCP keepalive
  defaults by running sysctl + reading tcp(7) on the host (its available means) — verification preserved,
  arguably stronger than URL-citation, still zero confabulation.
- **E. host-format dangling reference** (gpt+codex): "Follow host-format if given" named an undefined
  input. Tied it to the visible block: "If <host-instructions> specifies an output format, follow it."

Measured after fixes: no-lookup 2-round + web 1-round — format 0-markdown / 0-backtick, verdicts
calibrated, supersede signal renders for all 3 workers, R1 ordering stated once, web verification intact.
744 tests. NOT declaring dry — re-interrogating the new prompt for the next round.

## Re-interrogation of the fixed prompt → convergence (marginal tail)
Re-interrogated 2 workers on the post-fix prompt (same "audit the prompt, none if no real issue" question):
- **gpt**: conflicts / dead-weight / missing → ALL "none" (was multiple each before). Only residual: a
  marginal "Do not soften ≈ surface strongest weaknesses" and a reading-order note on the two lenses.
- **grok**: the "ordering stated twice" complaint is gone; it now flags only a precedence *nuance* (the
  inherent lens-vs-severity tension), plus single-model nitpicks (verdict template shown in backticks while
  forbidding them; whitespace/delimiter spec absent; "means available to you" not operationalized).
One clean shave taken from this round: removed the dead "(Severity ordering … governed by <output-format>)"
cross-reference the prior fix introduced.

Remaining items are the marginal tail, deliberately NOT cut:
- "Do not soften your criticism" (2 models call it redundant) is a documented anti-sycophancy anchor
  re-injected in the user turn for CROSS-ROUND drift resistance — a value a single-turn reflection can't
  see. Cutting it correctly needs a multi-round with/without A/B on verdict-severity drift; not worth a
  noisy multi-run experiment for a ~6-token gain on a load-bearing anchor. Kept.
- verdict-template-in-backticks, host-instructions reference, whitespace spec: single-model subjective
  nitpicks; models disagree; chasing them is over-prompting.

Assessment: the prompt-text layer has CONVERGED for adversarial_debate — two substantive fix-rounds
(char-audit + tool-agnostic merge + interrogation fixes) drove the cross-model issue count to a marginal,
model-inconsistent tail. Further text edits would cut deliberate anchors or chase subjective single-model
reads. This is evidence-backed convergence (re-interrogation deltas), not a fiat "done".

## A/B: is "Do not soften your criticism" dead weight? → NO, load-bearing (kept)
Two workers called the anchor redundant. Rather than declare it kept-by-fiat OR cut it on their nitpick,
measured it: same task WITH vs WITHOUT the anchor (removed from both R1 <approach> and R2 peer <approach>),
2-round, 3 workers. Ran on two proposal types:
- **clear-cut bad** (unencrypted session cookie): no difference — without-anchor was equal/sharper (crit
  R1→R2 3→5 without vs 3→3 with). The proposal is egregious, so there is no softening temptation to resist;
  the anchor is inert here. This is the task the 2 workers reflected on → their "redundant" read was correct
  FOR THIS CASE.
- **borderline tradeoff** (feature-flags-for-all-config): the anchor bites. WITH: critical verdicts 3→5
  across rounds, zero softening/concession words. WITHOUT: critical 1→3, and a concession word appears.
  Removing the anchor measurably softened the critique exactly where softening is tempting.
Conclusion: the anchor does real work on borderline proposals (its documented purpose — drift/softening
resistance) and is merely inert on clear-cut ones. KEPT. The workers' redundancy flag was task-specific to
a clear-cut case and missed the borderline value a single-turn reflection can't see. (n=1 task/arm, 3
workers — directional but consistent with the rationale; the effect only appears on borderline tasks, which
is why the clear-cut A/B showed nothing.)

## Status: adversarial_debate prompt-text is evidence-backed converged
Every shaving candidate this session was resolved by evidence, not fiat: real defects were fixed and
measured (char-audit fixes, tool-agnostic merge, 4 interrogation fixes, dead cross-reference); the one
remaining 2-model candidate ("Do not soften") was A/B-measured and found load-bearing. What's left is
single-model subjective nitpicks that models disagree on. There is nothing left to cut without removing
something that does measurable work. Remaining UNMEASURED surface (honest): R3+ (≥3 rounds), larger n across
domains, and the other 5 protocols — none audited this way.

## R3+ verification (all prior measurement was R1/R2 only)
Ran a 3-round debate (Redis-as-primary-payment-store) — the first ≥3-round test this session. Verified
per round × worker (9 turns):
- format: 9/9 zero markdown headings, zero stray backticks — no regression across 3 rounds.
- supersede signal: absent R1 (no prior lens), present R2 AND R3 — scales correctly.
- <closing>: absent R1/R2, present ONLY at R3 (final) — isFinalRound placement correct at 3 rounds.
- angle rotation: each worker gets 3 DISTINCT angles across the rounds (e.g. haiku: hidden-assumptions →
  evidence-gaps → operational-failure; gpt: operational → edge-cases → incentive-misalignment). The
  (workerIndex+shift)%5 rotation yields no within-worker repeat for ≤5 rounds (documented collision past 5).
- verdicts stay calibrated and sharp; no softening/degradation as rounds accumulate.
The R2 fixes (supersede announcement, angle rotation) hold at R3. No new defect at ≥3 rounds.
