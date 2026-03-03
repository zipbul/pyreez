# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**pyreez** is a heterogeneous multi-model deliberation infrastructure exposed as an MCP (Model Context Protocol) server. It sits between a host agent (GitHub Copilot, Claude Desktop, etc.) and multiple LLM providers, routing tasks to optimal models, orchestrating multi-model deliberation with consensus, and calibrating model ratings via Bradley-Terry scoring.

Runtime: **Bun** (v1.3+). Language: **TypeScript** (strict mode, ESNext, bundler module resolution).

## Commands

```bash
bun install              # Install dependencies
bun test                 # Run all tests
bun test src/axis/       # Run tests in a directory
bun test src/axis/engine.spec.ts  # Run a single test file
bun run typecheck        # TypeScript type checking (tsc --noEmit)
bun run index.ts         # Start the MCP server (stdio transport)
```

## Architecture

### 5-Slot Pipeline (src/axis/)

The core is a modular 5-slot pipeline where each slot is independently replaceable via a config-based factory (`src/axis/factory.ts` → `createEngine()`). Boundary types between slots are defined in `src/axis/types.ts`.

```
prompt → [Slot 2: Classifier] → ClassifyOutput
       → [Slot 3: Profiler]   → AxisTaskRequirement (capability weights)
       → [Slot 1: Scoring]    → ModelScore[] (BT ratings from scores/models.json + personal learning)
       → [Slot 4: Selector]   → EnsemblePlan (models[], strategy, cost)
       → [Slot 5: Deliberation] → DeliberationResult (consensus output)
              ↑↓
       [Learning Layer] (optional, cross-cutting L1-L4 + Tiers T0-T3)
```

**Slot variants** (each implements a shared interface from `src/axis/interfaces.ts`):

| Slot | Interface | Variants | Key Files |
|------|-----------|----------|-----------|
| 1 Scoring | `ScoringSystem` | BT 21-dim, Step BT, LLM Judge | `model/calibration.ts`, `evaluation/bt-updater.ts` |
| 2 Classifier | `Classifier` | Keyword rules, Step declare, Embedding, LLM | `classify/classifier.ts`, `axis/step-classifier.ts` |
| 3 Profiler | `Profiler` | Domain+Override, Step profile, MoE Gating | `profile/profiler.ts`, `router/gating.ts` |
| 4 Selector | `Selector` | 2-Track CE, 4-Strategy, Cascade, Preference, MAB | `router/selector.ts`, `router/cascade.ts`, `router/preference.ts` |
| 5 Deliberation | `DeliberationProtocol` | Role-based (D2a/b/c), Diverge-Synth, ADP, Free Debate, Single Best | `deliberation/engine.ts`, `axis/role-based-protocol.ts` |

Compatibility between classifier and profiler variants is enforced by a **vocab compatibility matrix** in the factory — e.g., keyword classifier + step profiler is rejected at initialization.

### Module Map

| Directory | Responsibility |
|-----------|---------------|
| `src/axis/` | 5-slot pipeline interfaces, engine compositor, factory, all variant implementations, learning layer |
| `src/classify/` | Task classification (12 domains, 62 task types, keyword rules) |
| `src/profile/` | Maps classification → capability weight requirements (21 dimensions) |
| `src/router/` | Model selection algorithms, gating, cascade, preference routing |
| `src/deliberation/` | Multi-model consensus engine: team composition, round execution (producer→reviewers→leader), prompts, shared context, file-based persistence |
| `src/llm/` | OpenAI-compatible HTTP client (targets GitHub Models API) with retry/backoff |
| `src/model/` | Model registry (loads `scores/models.json`), 21-dimension BT rating system, calibration |
| `src/mcp/` | MCP server exposing 7 tools: `pyreez_route`, `pyreez_ask`, `pyreez_ask_many`, `pyreez_scores`, `pyreez_report`, `pyreez_deliberate`, `pyreez_calibrate` |
| `src/report/` | Quality tracking, call record persistence, run logging |
| `src/evaluation/` | Bradley-Terry rating update logic |
| `scores/` | `models.json` — global BT ratings for 21 models across 21 capability dimensions |

### Key Wiring (src/index.ts)

Entry point creates LLMClient → ModelRegistry → FileReporter → FileDeliberationStore → ChatAdapter (with retry) → DeliberateFn → PyreezMcpServer, then connects via stdio MCP transport.

### Data Storage

- `scores/models.json` — Global model ratings (shipped with project, version-controlled)
- `.pyreez/reports/` — CallRecord JSONL files (runtime quality tracking)
- `.pyreez/deliberations/` — DeliberationRecord JSONL files (round-by-round logs)
- `.pyreez/learning/` — Personal BT rating adjustments, preferences, MoE weights, MF factors

### Environment

Provider API keys (set at least one):
- `PYREEZ_ANTHROPIC_KEY` — Anthropic API key
- `PYREEZ_GOOGLE_API_KEY` — Google AI API key
- `PYREEZ_OPENAI_KEY` — OpenAI API key
- `PYREEZ_DEEPSEEK_KEY` — DeepSeek API key
- `PYREEZ_XAI_KEY` — xAI (Grok) API key
- `PYREEZ_MISTRAL_KEY` — Mistral AI API key
- `PYREEZ_QWEN_KEY` — Qwen/Alibaba Cloud API key
- `PYREEZ_GROQ_KEY` — Groq API key
- `PYREEZ_CLAUDE_CLI` — set to `"1"` to use `claude -p` for anthropic/* models (no API cost)
- `PYREEZ_LOCAL_URL` — Local LLM base URL (Docker Model Runner, Ollama, LM Studio)
- `PYREEZ_LOCAL_SOCKET` — Unix socket path for Docker Model Runner

Optional: `PYREEZ_MODEL` (default: `anthropic/claude-sonnet-4.6`). Config loaded in `src/config.ts`.

## Testing Conventions

- **Unit tests**: `*.spec.ts` colocated with source. SUT = single export.
- **Integration tests**: `*.test.ts` in `test/`. SUT = cross-module combination.
- Test runner: `bun:test` exclusively. Test doubles via `mock()`, `spyOn()` — no hand-rolled counters.
- Unit tests must have **zero real I/O** — all external deps test-doubled.
- BDD-style `it` titles ("should ... when ..."), AAA structure (Arrange → Act → Assert).

## Bun-First Policy

Always prefer Bun built-in APIs over Node.js APIs or npm packages. Before using any Node.js or npm dependency, verify no Bun equivalent exists.
