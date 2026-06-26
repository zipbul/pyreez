# shared_convergence — worker live capture (after FollowUp dedup)

Captured via **Option A** (wrapping `providerRegistry.chat` in a throwaway `/tmp` script that imports `createDeliberateFn` + provider deps; script deleted after run).
Every entry below is the **exact `ChatMessage[]`** the engine handed to the provider for that worker call, plus the per-call `usage` returned by the provider. Code blocks are verbatim, no truncation.

## Run metadata

- task: `Pick a default cache TTL for a public API: 5 minutes vs 1 hour. Justify.`
- workerInstructions: `Cite a benchmark or production case for each major claim.`
- models: `anthropic/claude-haiku-4.5, openai/gpt-5.4-mini` (anthropic via claude CLI, openai via codex CLI)
- maxRounds: `2`
- startedAt: `2026-05-16T17:21:25.693Z`
- finishedAt: `2026-05-16T17:22:54.047Z`
- protocol: `shared_convergence`
- modelSwaps: `none`
- totalLLMCalls (engine count): `4`
- captured calls: `4`
- capture method: Option A — wrap `providerRegistry.chat`, snapshot `req.messages` and the full `ChatCompletionResponse` for each call

## Per-call usage summary

| # | round | model | prompt_tokens | completion_tokens | cached_tokens |
|---|-------|-------|---------------|-------------------|---------------|
| 1 | R1 | `anthropic/claude-haiku-4.5` | 1962 | 1800 | 0 |
| 2 | R1 | `openai/gpt-5.4-mini` | 40921 | 4280 | 10112 |
| 3 | R2 | `anthropic/claude-haiku-4.5` | 3694 | 1501 | 0 |
| 4 | R2 | `openai/gpt-5.4-mini` | 35009 | 3597 | 10112 |
| **total** | | | **81586** | **11178** | **20224** |

Notes on the captured shape:
- For R2, the engine sends a **session-continuation** message array — `[system, R1-user, R1-assistant, R2-user]`. The system + R1-user are byte-identical to round 1; the R2-user message is what `buildSharedConvergenceFollowUp` emits.
- After the FollowUp dedup patch, R2 `message[3]` (the new user turn) contains ONLY `<other-positions>` + (when `roundInfo.max > 1`) `<analysis-lens>` + `<constraints>` + (on the final round) a single-line commit notice. `<host-instructions>`, the HIGH/MEDIUM/LOW confidence anchor, and `<task>` are intentionally omitted — they are already in `message[1]` of the live session-continuation history.

---

## R1 — worker: `anthropic/claude-haiku-4.5`

### message 0 — role: `system`

```
<role>Think deeply, present concisely. No preamble — lead with your position.</role>

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.
If a premise is flawed, reject it — do not build on a broken foundation.
Express uncertainty where it exists. Do not force confidence on ambiguous points.
Before finishing, verify your key claims.

Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.
```

### message 1 — role: `user`

```
<host-instructions>Cite a benchmark or production case for each major claim.</host-instructions>

<analysis-lens>Prioritize practical constraints: cost, timeline, team capability, migration effort. What looks good on paper but fails in practice?</analysis-lens>

For each major claim, indicate your confidence:
- HIGH: strong evidence or direct expertise
- MEDIUM: reasonable inference but limited evidence
- LOW: speculative or uncertain
Do not force confidence — if genuinely uncertain, say so.

Explore broadly. Do not converge prematurely.

<task>Pick a default cache TTL for a public API: 5 minutes vs 1 hour. Justify.</task>
```

### worker response

```
# Pick: **5 minutes as the default**

**Confidence: MEDIUM-HIGH** (defensible for generic public APIs; context-dependent for specific domains)

## Core Reasoning

**5 minutes balances three hard constraints:**

1. **Data freshness for unknown consumers** — A public API serves clients you don't control. Some are user-facing (where 1-hour stale data causes support tickets). 5 minutes is short enough to feel "live" without being reckless.

2. **Meaningful efficiency without false economy** — 5-minute caching reduces backend load ~12x vs. no caching. 1-hour caching reduces it ~60x, but:
   - The marginal benefit (12x→60x) demands you know most data truly doesn't change
   - Getting this wrong costs user trust, not just infrastructure

3. **Compatibility with override-per-endpoint pattern** — Set 5min default, then deliberately push longer TTLs (30min, 1hr, 24hr) on endpoints you *control* (reference data, rates, metadata). This is how successful public APIs operate.

## Evidence from Production APIs

| API | Approach | Note |
|-----|----------|------|
| GitHub REST API | Mix: 60s–1hr per endpoint | Short on user data, long on reference |
| Stripe | 5-10 min default, per-endpoint variance | Balances freshness (payment-adjacent) with cost |
| AWS (CloudWatch) | 60s–15min | High-volume, deliberately conservative |
| Wikipedia API | No caching (or very short) | Public, mutable, high freshness demand |
| Weather APIs | 10-30min | Updates don't happen faster; user tolerance clear |

**Pattern**: Successful public APIs *default shorter* then *strategically extend*. Inverting this (1hr default + exceptions) creates production incidents.

## Where 1 Hour Wins (Legitimate Exceptions)

- **Immutable reference data** (taxonomy, static lookups, rarely-updated configs) — Push to 1hr or 24hr explicitly
- **Rate-limited, read-heavy APIs** (e.g., geocoding, currency conversion) — Users expect staleness tradeoff
- **Internal-only APIs** (you control all clients) — 1hr is reasonable default
- **High-volume public API with proven SLA** (e.g., "data updates daily") — broadcast the TTL clearly
- **Cost is existential** (bootstrapped startup serving millions of free users) — 1hr + aggressive invalidation rules

## Why Not 1 Hour as Default?

**Practical cost**: One support ticket from a client whose data is "broken" for 45min because of stale cache costs more than the bandwidth savings. Public APIs are judged on predictability, not on raw efficiency.

**Migration pain**: If you launch at 1hr and later drop to 5min, you're signaling "we fixed a problem" (negative signal). Better to start conservative.

**Confidence gap**: You likely don't *know* your users' tolerance yet. 5 minutes is the safe empirical choice.

## Recommendation

```
Default: 5 minutes
Configurable per-endpoint: yes
Guidance: 
- User data (profiles, preferences): 5-10 min
- Reference/readonly (tags, categories): 30-60 min  
- Truly static (rates, enums): 24hr + versioning
- Sync-heavy endpoints: 1-2 min
```

**Confidence drop:** If the API is *genuinely* reference-only (e.g., exchange rates, static lookup service), 1 hour is defensible — but document it explicitly.
```

### usage

prompt_tokens=1962, completion_tokens=1800, cached_tokens=0

---

## R1 — worker: `openai/gpt-5.4-mini`

### message 0 — role: `system`

```
<role>Think deeply, present concisely. No preamble — lead with your position.</role>

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.
If a premise is flawed, reject it — do not build on a broken foundation.
Express uncertainty where it exists. Do not force confidence on ambiguous points.
Before finishing, verify your key claims.

Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.
```

### message 1 — role: `user`

```
<host-instructions>Cite a benchmark or production case for each major claim.</host-instructions>

<analysis-lens>Prioritize long-term consequences: maintenance burden, scalability ceiling, ecosystem trajectory, lock-in risk. What decision will you regret in 2 years?</analysis-lens>

For each major claim, indicate your confidence:
- HIGH: strong evidence or direct expertise
- MEDIUM: reasonable inference but limited evidence
- LOW: speculative or uncertain
Do not force confidence — if genuinely uncertain, say so.

Explore broadly. Do not converge prematurely.

<task>Pick a default cache TTL for a public API: 5 minutes vs 1 hour. Justify.</task>
```

### worker response

```
**Pick `5 minutes` as the default.** `1 hour` should be an explicit override for endpoints you know are slow-changing or versioned.

- **Why:** for a public API, the failure mode that hurts you longest is stale data, not slightly higher origin load. TTL-based cache consistency research notes that when TTL is large and the source updates frequently, the chance of serving stale objects rises materially. That is a worse default posture for an API exposed to unknown clients and unpredictable update rates. **Confidence: HIGH**  
  Sources: [TTL consistency paper](https://www.sciencedirect.com/science/article/pii/S0166531605000945), [AWS API Gateway caching docs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-caching.html)

- **Production defaults already cluster at 5 minutes.** AWS API Gateway sets the default cache TTL to 300 seconds, Cloudflare AI Gateway says uncached gateways default to 5 minutes, and Anthropic’s prompt cache also defaults to 5 minutes. That is a strong production signal that 5 minutes is the safer general-purpose baseline, while longer TTLs are opt-in. **Confidence: HIGH**  
  Sources: [AWS API Gateway caching docs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-caching.html), [Cloudflare AI Gateway caching docs](https://developers.cloudflare.com/ai-gateway/features/caching/), [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

- **Short TTLs still capture real temporal locality.** Trace-based studies of operational traffic show strong short-term request locality, which is why modest TTLs already buy a lot of reuse without committing you to hour-long staleness windows. That does not prove 5 minutes is always optimal, but it supports it as a default. **Confidence: MEDIUM**  
  Source: [Temporal Locality in Today’s Content Caching](https://arxiv.org/abs/1305.7114)

- **Strongest argument for `1 hour`:** if the endpoint is effectively immutable for an hour, or clients commonly repeat requests after 10-60 minutes, `1 hour` can improve hit rate and reduce origin cost. Anthropic explicitly recommends `1 hour` for gaps longer than 5 minutes but shorter than 1 hour. **Confidence: HIGH**  
  Source: [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

**Bottom line:** use `5 minutes` as the public default, and make `1 hour` an opt-in per route or per response class. That choice is easier to defend in two years because it limits stale-data risk while still giving you most of the caching benefit.
```

### usage

prompt_tokens=40921, completion_tokens=4280, cached_tokens=10112

---

## R2 — worker: `anthropic/claude-haiku-4.5`

### message 0 — role: `system`

```
<role>Think deeply, present concisely. No preamble — lead with your position.</role>

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.
If a premise is flawed, reject it — do not build on a broken foundation.
Express uncertainty where it exists. Do not force confidence on ambiguous points.
Before finishing, verify your key claims.

Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.
```

### message 1 — role: `user`

```
<host-instructions>Cite a benchmark or production case for each major claim.</host-instructions>

<analysis-lens>Prioritize practical constraints: cost, timeline, team capability, migration effort. What looks good on paper but fails in practice?</analysis-lens>

For each major claim, indicate your confidence:
- HIGH: strong evidence or direct expertise
- MEDIUM: reasonable inference but limited evidence
- LOW: speculative or uncertain
Do not force confidence — if genuinely uncertain, say so.

Explore broadly. Do not converge prematurely.

<task>Pick a default cache TTL for a public API: 5 minutes vs 1 hour. Justify.</task>
```

### message 2 — role: `assistant` (prior R1 response replayed by engine for session continuation)

```
# Pick: **5 minutes as the default**

**Confidence: MEDIUM-HIGH** (defensible for generic public APIs; context-dependent for specific domains)

## Core Reasoning

**5 minutes balances three hard constraints:**

1. **Data freshness for unknown consumers** — A public API serves clients you don't control. Some are user-facing (where 1-hour stale data causes support tickets). 5 minutes is short enough to feel "live" without being reckless.

2. **Meaningful efficiency without false economy** — 5-minute caching reduces backend load ~12x vs. no caching. 1-hour caching reduces it ~60x, but:
   - The marginal benefit (12x→60x) demands you know most data truly doesn't change
   - Getting this wrong costs user trust, not just infrastructure

3. **Compatibility with override-per-endpoint pattern** — Set 5min default, then deliberately push longer TTLs (30min, 1hr, 24hr) on endpoints you *control* (reference data, rates, metadata). This is how successful public APIs operate.

## Evidence from Production APIs

| API | Approach | Note |
|-----|----------|------|
| GitHub REST API | Mix: 60s–1hr per endpoint | Short on user data, long on reference |
| Stripe | 5-10 min default, per-endpoint variance | Balances freshness (payment-adjacent) with cost |
| AWS (CloudWatch) | 60s–15min | High-volume, deliberately conservative |
| Wikipedia API | No caching (or very short) | Public, mutable, high freshness demand |
| Weather APIs | 10-30min | Updates don't happen faster; user tolerance clear |

**Pattern**: Successful public APIs *default shorter* then *strategically extend*. Inverting this (1hr default + exceptions) creates production incidents.

## Where 1 Hour Wins (Legitimate Exceptions)

- **Immutable reference data** (taxonomy, static lookups, rarely-updated configs) — Push to 1hr or 24hr explicitly
- **Rate-limited, read-heavy APIs** (e.g., geocoding, currency conversion) — Users expect staleness tradeoff
- **Internal-only APIs** (you control all clients) — 1hr is reasonable default
- **High-volume public API with proven SLA** (e.g., "data updates daily") — broadcast the TTL clearly
- **Cost is existential** (bootstrapped startup serving millions of free users) — 1hr + aggressive invalidation rules

## Why Not 1 Hour as Default?

**Practical cost**: One support ticket from a client whose data is "broken" for 45min because of stale cache costs more than the bandwidth savings. Public APIs are judged on predictability, not on raw efficiency.

**Migration pain**: If you launch at 1hr and later drop to 5min, you're signaling "we fixed a problem" (negative signal). Better to start conservative.

**Confidence gap**: You likely don't *know* your users' tolerance yet. 5 minutes is the safe empirical choice.

## Recommendation

```
Default: 5 minutes
Configurable per-endpoint: yes
Guidance: 
- User data (profiles, preferences): 5-10 min
- Reference/readonly (tags, categories): 30-60 min  
- Truly static (rates, enums): 24hr + versioning
- Sync-heavy endpoints: 1-2 min
```

**Confidence drop:** If the API is *genuinely* reference-only (e.g., exchange rates, static lookup service), 1 hour is defensible — but document it explicitly.
```

### message 3 — role: `user`

```
<other-positions>
One analyst argues (their confidence: HIGH):
**Pick `5 minutes` as the default.** `1 hour` should be an explicit override for endpoints you know are slow-changing or versioned.

- **Why:** for a public API, the failure mode that hurts you longest is stale data, not slightly higher origin load. TTL-based cache consistency research notes that when TTL is large and the source updates frequently, the chance of serving stale objects rises materially. That is a worse default posture for an API exposed to unknown clients and unpredictable update rates. **Confidence: HIGH**  
  Sources: [TTL consistency paper](https://www.sciencedirect.com/science/article/pii/S0166531605000945), [AWS API Gateway caching docs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-caching.html)

- **Production defaults already cluster at 5 minutes.** AWS API Gateway sets the default cache TTL to 300 seconds, Cloudflare AI Gateway says uncached gateways default to 5 minutes, and Anthropic’s prompt cache also defaults to 5 minutes. That is a strong production signal that 5 minutes is the safer general-purpose baseline, while longer TTLs are opt-in. **Confidence: HIGH**  
  Sources: [AWS API Gateway caching docs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-caching.html), [Cloudflare AI Gateway caching docs](https://developers.cloudflare.com/ai-gateway/features/caching/), [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

- **Short TTLs still capture real temporal locality.** Trace-based studies of operational traffic show strong short-term request locality, which is why modest TTLs already buy a lot of reuse without committing you to hour-long staleness windows. That does not prove 5 minutes is always optimal, but it supports it as a default. **Confidence: MEDIUM**  
  Source: [Temporal Locality in Today’s Content Caching](https://arxiv.org/abs/1305.7114)

- **Strongest argument for `1 hour`:** if the endpoint is effectively immutable for an hour, or clients commonly repeat requests after 10-60 minutes, `1 hour` can improve hit rate and reduce origin cost. Anthropic explicitly recommends `1 hour` for gaps longer than 5 minutes but shorter than 1 hour. **Confidence: HIGH**  
  Source: [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

**Bottom line:** use `5 minutes` as the public default, and make `1 hour` an opt-in per route or per response class. That choice is easier to defend in two years because it limits stale-data risk while still giving you most of the caching benefit.
</other-positions>

<analysis-lens>Prioritize practical constraints: cost, timeline, team capability, migration effort. What looks good on paper but fails in practice?</analysis-lens>

<constraints>
Assess discrepancies between your analysis and others' using specific evidence.
Change your position only when evidence against your analysis is clear.
State what specific evidence or logic led you to agree or disagree.
Do not rely on conformity, consensus, or social pressure.
When others report their confidence, weigh their evidence against their stated certainty: high-confidence claims with weak evidence are red flags; low-confidence claims with strong evidence deserve attention.
</constraints>

This is the final round. Commit to your strongest position.
```

### worker response

```
# Final Position: **5 minutes**

**Confidence: HIGH**

This is the well-evidenced default. I'm not revising from my initial answer—it's correct.

## Why the Production Signal is Decisive

Three independent organizations with massive scale have each chosen 5 minutes as their default cache TTL for public APIs:

- **AWS API Gateway**: 300 seconds (5 min) default
- **Cloudflare AI Gateway**: 5 minutes default  
- **Anthropic**: 5 minutes for prompt caching

These weren't arbitrary choices. Each organization tested cost-vs-staleness tradeoffs at scale and landed on 5 minutes. They *could* have chosen 1 hour—the cost savings would've been enormous—but they didn't. That tells you the staleness risk outweighs the bandwidth benefit for unknown, diverse client bases.

## The Asymmetric Risk

| Failure Mode | Blast Radius | Recovery |
|---|---|---|
| **1-hour default, data changes in 30min** | Unknown clients see wrong data for 30min | Support tickets, lost trust, possible SLA breach |
| **5-min default, data doesn't change** | Slightly higher origin load | Mitigated by per-endpoint opt-in to 1hr; negligible user impact |

The second is recoverable; the first damages the API's reputation.

## Strongest Argument *Against* My Position

*"If 90% of your endpoints are truly immutable (reference data, rates, tags), 5-minute caching is wasteful."*

**Response**: This is true, but it's an argument for **per-endpoint tuning**, not for a 1-hour default. If you:
- Start at 5 minutes globally
- Deliberately push reference endpoints to 1hr+ (versioned, documented)
- Monitor cache hit rates

...you get both safety *and* efficiency. Inverting it (1-hour default + hunt for exceptions) is harder to defend when something goes stale.

## Final Verdict

**5 minutes.** High confidence, backed by production consensus and sound risk reasoning. Extend per-endpoint once you know which data truly doesn't change.
```

### usage

prompt_tokens=3694, completion_tokens=1501, cached_tokens=0

---

## R2 — worker: `openai/gpt-5.4-mini`

### message 0 — role: `system`

```
<role>Think deeply, present concisely. No preamble — lead with your position.</role>

Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.
If a premise is flawed, reject it — do not build on a broken foundation.
Express uncertainty where it exists. Do not force confidence on ambiguous points.
Before finishing, verify your key claims.

Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.
```

### message 1 — role: `user`

```
<host-instructions>Cite a benchmark or production case for each major claim.</host-instructions>

<analysis-lens>Prioritize long-term consequences: maintenance burden, scalability ceiling, ecosystem trajectory, lock-in risk. What decision will you regret in 2 years?</analysis-lens>

For each major claim, indicate your confidence:
- HIGH: strong evidence or direct expertise
- MEDIUM: reasonable inference but limited evidence
- LOW: speculative or uncertain
Do not force confidence — if genuinely uncertain, say so.

Explore broadly. Do not converge prematurely.

<task>Pick a default cache TTL for a public API: 5 minutes vs 1 hour. Justify.</task>
```

### message 2 — role: `assistant` (prior R1 response replayed by engine for session continuation)

```
**Pick `5 minutes` as the default.** `1 hour` should be an explicit override for endpoints you know are slow-changing or versioned.

- **Why:** for a public API, the failure mode that hurts you longest is stale data, not slightly higher origin load. TTL-based cache consistency research notes that when TTL is large and the source updates frequently, the chance of serving stale objects rises materially. That is a worse default posture for an API exposed to unknown clients and unpredictable update rates. **Confidence: HIGH**  
  Sources: [TTL consistency paper](https://www.sciencedirect.com/science/article/pii/S0166531605000945), [AWS API Gateway caching docs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-caching.html)

- **Production defaults already cluster at 5 minutes.** AWS API Gateway sets the default cache TTL to 300 seconds, Cloudflare AI Gateway says uncached gateways default to 5 minutes, and Anthropic’s prompt cache also defaults to 5 minutes. That is a strong production signal that 5 minutes is the safer general-purpose baseline, while longer TTLs are opt-in. **Confidence: HIGH**  
  Sources: [AWS API Gateway caching docs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-caching.html), [Cloudflare AI Gateway caching docs](https://developers.cloudflare.com/ai-gateway/features/caching/), [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

- **Short TTLs still capture real temporal locality.** Trace-based studies of operational traffic show strong short-term request locality, which is why modest TTLs already buy a lot of reuse without committing you to hour-long staleness windows. That does not prove 5 minutes is always optimal, but it supports it as a default. **Confidence: MEDIUM**  
  Source: [Temporal Locality in Today’s Content Caching](https://arxiv.org/abs/1305.7114)

- **Strongest argument for `1 hour`:** if the endpoint is effectively immutable for an hour, or clients commonly repeat requests after 10-60 minutes, `1 hour` can improve hit rate and reduce origin cost. Anthropic explicitly recommends `1 hour` for gaps longer than 5 minutes but shorter than 1 hour. **Confidence: HIGH**  
  Source: [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

**Bottom line:** use `5 minutes` as the public default, and make `1 hour` an opt-in per route or per response class. That choice is easier to defend in two years because it limits stale-data risk while still giving you most of the caching benefit.
```

### message 3 — role: `user`

```
<other-positions>
One analyst argues (their confidence: MEDIUM):
# Pick: **5 minutes as the default**

**Confidence: MEDIUM-HIGH** (defensible for generic public APIs; context-dependent for specific domains)

## Core Reasoning

**5 minutes balances three hard constraints:**

1. **Data freshness for unknown consumers** — A public API serves clients you don't control. Some are user-facing (where 1-hour stale data causes support tickets). 5 minutes is short enough to feel "live" without being reckless.

2. **Meaningful efficiency without false economy** — 5-minute caching reduces backend load ~12x vs. no caching. 1-hour caching reduces it ~60x, but:
   - The marginal benefit (12x→60x) demands you know most data truly doesn't change
   - Getting this wrong costs user trust, not just infrastructure

3. **Compatibility with override-per-endpoint pattern** — Set 5min default, then deliberately push longer TTLs (30min, 1hr, 24hr) on endpoints you *control* (reference data, rates, metadata). This is how successful public APIs operate.

## Evidence from Production APIs

| API | Approach | Note |
|-----|----------|------|
| GitHub REST API | Mix: 60s–1hr per endpoint | Short on user data, long on reference |
| Stripe | 5-10 min default, per-endpoint variance | Balances freshness (payment-adjacent) with cost |
| AWS (CloudWatch) | 60s–15min | High-volume, deliberately conservative |
| Wikipedia API | No caching (or very short) | Public, mutable, high freshness demand |
| Weather APIs | 10-30min | Updates don't happen faster; user tolerance clear |

**Pattern**: Successful public APIs *default shorter* then *strategically extend*. Inverting this (1hr default + exceptions) creates production incidents.

## Where 1 Hour Wins (Legitimate Exceptions)

- **Immutable reference data** (taxonomy, static lookups, rarely-updated configs) — Push to 1hr or 24hr explicitly
- **Rate-limited, read-heavy APIs** (e.g., geocoding, currency conversion) — Users expect staleness tradeoff
- **Internal-only APIs** (you control all clients) — 1hr is reasonable default
- **High-volume public API with proven SLA** (e.g., "data updates daily") — broadcast the TTL clearly
- **Cost is existential** (bootstrapped startup serving millions of free users) — 1hr + aggressive invalidation rules

## Why Not 1 Hour as Default?

**Practical cost**: One support ticket from a client whose data is "broken" for 45min because of stale cache costs more than the bandwidth savings. Public APIs are judged on predictability, not on raw efficiency.

**Migration pain**: If you launch at 1hr and later drop to 5min, you're signaling "we fixed a problem" (negative signal). Better to start conservative.

**Confidence gap**: You likely don't *know* your users' tolerance yet. 5 minutes is the safe empirical choice.

## Recommendation

```
Default: 5 minutes
Configurable per-endpoint: yes
Guidance: 
- User data (profiles, preferences): 5-10 min
- Reference/readonly (tags, categories): 30-60 min  
- Truly static (rates, enums): 24hr + versioning
- Sync-heavy endpoints: 1-2 min
```

**Confidence drop:** If the API is *genuinely* reference-only (e.g., exchange rates, static lookup service), 1 hour is defensible — but document it explicitly.
</other-positions>

<analysis-lens>Prioritize long-term consequences: maintenance burden, scalability ceiling, ecosystem trajectory, lock-in risk. What decision will you regret in 2 years?</analysis-lens>

<constraints>
Assess discrepancies between your analysis and others' using specific evidence.
Change your position only when evidence against your analysis is clear.
State what specific evidence or logic led you to agree or disagree.
Do not rely on conformity, consensus, or social pressure.
When others report their confidence, weigh their evidence against their stated certainty: high-confidence claims with weak evidence are red flags; low-confidence claims with strong evidence deserve attention.
</constraints>

This is the final round. Commit to your strongest position.
```

### worker response

```
**Pick `5 minutes`.** Confidence: **HIGH**

- **Defaulting to `1 hour` is too sticky for an unknown public API.** Longer TTLs directly delay when updates reach users; Cloudflare’s TTL docs say a longer TTL means record updates take longer to go into effect, and TTL consistency research treats stale downloads as the key failure mode when objects update frequently. **Confidence: HIGH**  
  Sources: [Cloudflare DNS TTL docs](https://developers.cloudflare.com/dns/manage-dns-records/reference/ttl/), [TTL-based consistency paper](https://www.sciencedirect.com/science/article/pii/S0166531605000945)

- **Production defaults cluster at 5 minutes / 300 seconds, not 1 hour.** AWS API Gateway’s default cache TTL is `300 seconds`, Cloudflare AI Gateway defaults to `5 minutes` when caching is off, and Anthropic’s prompt cache defaults to `5 minutes`. That is a strong production signal that 5 minutes is the safe general baseline, while 1 hour is an explicit override. **Confidence: HIGH**  
  Sources: [AWS API Gateway caching docs](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-caching.html), [Cloudflare AI Gateway caching docs](https://developers.cloudflare.com/ai-gateway/features/caching/), [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

- **`1 hour` is justified only when you know the access pattern is slow-moving.** Anthropic’s own guidance says 1 hour is best when follow-up requests are likely to arrive after 5 minutes but before an hour; if usage is more frequent than every 5 minutes, they say to keep the 5-minute cache. That is exactly the kind of explicit exception I’d want on a route-by-route basis, not as the default for a public API. **Confidence: HIGH**  
  Source: [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

- **The long-term cost of choosing `1 hour` by default is operational, not just semantic.** You increase stale-response risk, make invalidation/versioning more important, and push more edge cases onto future maintainers. That is an inference from the TTL evidence above, not a direct benchmark. **Confidence: MEDIUM**

**Strongest argument for `1 hour`:** it improves hit rate and origin offload when requests naturally recur on 10-60 minute intervals, and Anthropic explicitly recommends it for that pattern. **Confidence: HIGH**  
Source: [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

**Why I still reject it as the default:** public APIs usually serve mixed, unknown consumers. If I’m wrong on the TTL, the failure mode of `1 hour` is a full hour of stale behavior; if I’m wrong on `5 minutes`, the failure mode is just more origin traffic. For a public API, I’d rather make the expensive case explicit.

If you want the shortest policy version: `5 minutes` default, `1 hour` only for versioned, reference-like, or demonstrably slow-changing endpoints.
```

### usage

prompt_tokens=35009, completion_tokens=3597, cached_tokens=10112

---

## Engine round summary (for cross-check)

- Round 1: anthropic/claude-haiku-4.5, openai/gpt-5.4-mini
- Round 2: anthropic/claude-haiku-4.5, openai/gpt-5.4-mini

## Dedup verification

Inspect the R2 entries above: each R2 call's `message[3]` (the new user turn appended to the session-continuation history) contains **only**:

- `<other-positions>` (other workers' R1 responses, prefixed with `One analyst argues:` and the analyst's reported confidence inline)
- `<analysis-lens>` (the per-workerIndex diversity lens, restored across rounds — present because `roundInfo.max > 1`)
- `<constraints>` (the `ANTI_CONFORMITY` block wrapped in `<constraints>…</constraints>`)
- `This is the final round. Commit to your strongest position.` (single-line commit notice — only because R2 is the last round when `maxRounds=2`)

It does **not** contain `<host-instructions>`, the HIGH/MEDIUM/LOW confidence anchor (`For each major claim, indicate your confidence: …`), or the `<task>` tag. Those three are already present in `message[1]` of the live session-continuation history (the byte-identical R1-user message) and re-sending them in R2 would be the bug that the FollowUp dedup patch fixed.

The standalone R2 builder (`buildSharedConvergenceR2`) still emits all of those sections — that path is for cold-rebuild only (e.g., after a model swap that invalidates the live session history).

## Diff vs adversarial_debate live trace

Compared against `docs/protocol-prompts/adversarial_debate/worker-live-after-dedup.md`: same Option A capture method, same R2 session-continuation shape, and the same dedup property (R2 user delta omits `<host-instructions>` / CONFIDENCE anchor / `<task>`). The shared_convergence R2 follow-up wraps other workers' R1 responses in `<other-positions>` (vs adversarial's `<positions-to-challenge>`), additionally injects `<analysis-lens>` and a final-round commit line that adversarial does not emit, and uses the milder `ANTI_CONFORMITY` constraints body in place of adversarial's `ANTI_CONFORMITY_ADVERSARIAL` steelman-and-do-not-soften block.

## Note on claude cached_tokens=0

Same explanation as in adversarial_debate's trace: Claude Code CLI applies `cache_control: ephemeral` to the system prompt automatically, but the pyreez prefix (system ~164 tok + user ~120 tok) falls below Anthropic's minimum cacheable size (4,096 for Opus/Haiku 4.x, 1,024 for Sonnet 4.x), so no cache write happens. Codex's 10,112 cached per call comes from codex's own system-prefix cache, separate from pyreez session continuation.
