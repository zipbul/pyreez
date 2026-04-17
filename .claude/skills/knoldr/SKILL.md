---
name: knoldr
description: "Search the knoldr knowledge store. Automatically crawls the web and re-searches when results are insufficient. Use when the user asks to find references, look something up, or research a topic. Triggers on requests like 'find me resources on X', 'look this up', 'research this topic', 'any references on X?'."
allowed-tools:
  - Bash(bun *knoldr-cli*)
user-invocable: true
argument-hint: "[search query]"
---

Search the knoldr knowledge store. When results are insufficient, the server automatically crawls the web, stores findings, and re-searches.

```bash
bun run knoldr-cli/index.ts find "search query" [--domain X] [--limit N]
```

- `--domain`: filter by domain (e.g. "ai-research")
- `--limit`: max entries to return (default 10)

`researched: true` in the output means auto-collection was triggered.
