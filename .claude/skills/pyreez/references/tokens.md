# Token Budget Guide

## Per-Protocol Estimates

### diverge-synth (1 round)
| Component | Tokens (3 workers) | Tokens (5 workers) |
|-----------|-------------------|-------------------|
| Worker input | ~1.5K × 3 = 4.5K | ~1.5K × 5 = 7.5K |
| Worker output | ~1K × 3 = 3K | ~1K × 5 = 5K |
| **Total** | **~7.5K** | **~12.5K** |

### debate (2 rounds)
| Component | Tokens (3 workers) | Tokens (5 workers) |
|-----------|-------------------|-------------------|
| Round 1 (diverge) | ~7.5K | ~12.5K |
| Round 2 (debate) | ~6K | ~10K |
| **Total** | **~13.5K** | **~22.5K** |

Debate round 2 uses digest sharing (position + evidence only), reducing cross-worker context by ~60% vs full sharing.

### acceptance (optional)
| Component | Tokens |
|-----------|--------|
| Per worker | ~800 (input ~500 + output ~300) |
| 3 workers | ~2.5K |
| 5 workers | ~4K |

### feedback
Negligible — no LLM calls, only BT rating update.

## Cost Optimization

1. Use `diverge-synth` for artifact tasks (code generation) — debate adds cost without improving code quality
2. Use `debate` for critique tasks (analysis, review) — worker cross-examination catches errors
3. Skip acceptance for brainstorming/ideation — low-stakes, speed matters
4. Use `auto_route: true` to let pyreez optimize team size and model selection for cost/quality
