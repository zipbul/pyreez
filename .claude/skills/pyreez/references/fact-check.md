# Fact-Checking Methodology

## High-Risk Claim Types

These claim types have the highest hallucination rate in multi-model deliberation:

1. **Benchmark numbers** — "X is 3x faster than Y" → almost always wrong or outdated
2. **Paper citations** — workers frequently cite non-existent papers with plausible-sounding titles
3. **API behavior** — "Framework X supports Y since version Z" → often wrong about version or feature details
4. **Adoption statistics** — "Used by 80% of Fortune 500" → rarely verifiable, usually inflated

## Verification Strategy

### 2-Source Rule
Per project policy (CLAUDE.md), external claims require 2+ sources for cross-verification. Single source = report as unverifiable.

### Search Patterns
- For benchmarks: search "[tool A] vs [tool B] benchmark [year]"
- For papers: search exact title in quotes on Google Scholar
- For API features: search official docs directly, not blog posts
- For statistics: look for primary sources (surveys, reports), not secondary citations

## Common Hallucination Patterns

| Pattern | Example | Detection |
|---------|---------|-----------|
| Plausible fabrication | "According to the 2024 CNCF survey..." | Search exact survey name |
| Version confusion | "Added in React 19" | Check official changelog |
| Metric inflation | "99.99% uptime SLA" | Verify against actual SLA docs |
| Consensus bias | All 3 workers claim same wrong number | Workers share training data biases |
