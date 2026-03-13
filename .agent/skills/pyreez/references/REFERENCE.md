# Pyreez Deliberation Reference

## Available Models (Check Before Use)

Models require both:
1. `available: true` in `scores/models.json`
2. Corresponding API key in `.env` (`PYREEZ_*_KEY`)

### Vendor → Key Mapping

| Vendor prefix | Env var |
|---------------|---------|
| `anthropic/` | `PYREEZ_ANTHROPIC_KEY` or `PYREEZ_CLAUDE_CLI=1` |
| `google/` | `PYREEZ_GOOGLE_API_KEY` |
| `openai/` | `PYREEZ_OPENAI_KEY` |
| `xai/` | `PYREEZ_XAI_KEY` |
| `deepseek/` | `PYREEZ_DEEPSEEK_KEY` |
| `mistral/` | `PYREEZ_MISTRAL_KEY` |
| `qwen/` | `PYREEZ_QWEN_KEY` |
| `groq/` | `PYREEZ_GROQ_KEY` |
| `local/` | `PYREEZ_LOCAL_URL` or `PYREEZ_LOCAL_SOCKET` |

## Worker Instruction Templates

### For Architecture/Design Topics
```
You are a senior systems architect. Argue with concrete implementation details — show schemas, file structures, CLI examples. Challenge other workers with specific failure modes. Do not cite benchmarks you cannot link to a URL.
```

### For Code Review/Bug Finding
```
You are a code auditor. Focus on: correctness bugs, security vulnerabilities, performance issues, and maintainability concerns. Reference specific line numbers and propose concrete fixes. Do not suggest stylistic changes unless they affect correctness.
```

### For Ideation/Brainstorming
```
You are a product strategist. Propose bold, specific ideas — not vague directions. For each idea, state: (1) what it enables, (2) implementation complexity (hours/days/weeks), (3) biggest risk. Challenge other workers' ideas with concrete objections.
```

## Hallucination Patterns to Watch

Workers commonly fabricate:
1. **Benchmark names and numbers** — "X benchmark shows Y% improvement"
2. **GitHub star counts** — often inflated or outdated
3. **CVE numbers** — real-looking but non-existent
4. **API features** — describing features that don't exist in current versions
5. **Cross-citation** — Worker B cites Worker A's fabrication as independent confirmation

## Token Budget Guidelines

| Team size | Estimated tokens (2 rounds) |
|-----------|---------------------------|
| 3 workers | ~20K input, ~8K output |
| 4 workers | ~30K input, ~12K output |
| 5 workers | ~45K input, ~18K output |

Keep teams at 3 workers for most tasks. Use 4+ only for complex multi-axis debates.
