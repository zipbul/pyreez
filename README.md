# pyreez

A CLI tool for **heterogeneous multi-model LLM deliberation**.

pyreez sends one task to several different LLMs, has them deliberate under a chosen
protocol (independent analysis, adversarial debate, interrogation, etc.), and then
gives a host agent the structured material to synthesize a single answer — plus
tools to inspect convergence, rank candidates, and cross-check factual claims.

The core idea: diversity comes from **different model architectures**, not from
assigning roles to one model. The host (you, or an agent calling the CLI) owns the
task and the final synthesis; pyreez owns the deliberation harness.

> **Status:** pyreez is a command-line tool. It is **not** an MCP server today, and
> it does **not** auto-route tasks or learn model ratings — see
> [Roadmap](#roadmap--not-yet-implemented). Everything in the sections above the
> Roadmap is implemented and tested.

## Requirements

- [Bun](https://bun.sh) v1.3+
- At least one provider available:
  - **CLI providers** — the `claude`, `codex`, and `gemini` CLIs on your `PATH`.
    These run as subprocesses and use your existing subscriptions, so they need
    no API key.
  - **xAI** — set `PYREEZ_XAI_KEY` (uses the Vercel AI SDK over HTTP).

> **Known issue:** the config loader currently throws
> `No LLM providers configured. Set PYREEZ_XAI_KEY.` when `PYREEZ_XAI_KEY` is unset,
> even though the CLI providers need no key (`src/config.ts:77`). Until this is
> fixed, set `PYREEZ_XAI_KEY` to any non-empty value to pass the config gate, even
> if you only intend to use the CLI providers.

## Install

```bash
bun install
```

## Quick Start

```bash
# List the models pyreez knows about
bun run src/cli.ts models

# Run a deliberation across three models
bun run src/cli.ts deliberate \
  --task "Should we use PostgreSQL or MongoDB for a 4-person SaaS MVP?" \
  --models "anthropic/claude-opus-4.6,openai/gpt-5.4,google/gemini-3.1-pro-preview" \
  --protocol shared_convergence

# Pipe a long task in via stdin with `-`
echo "long task text..." | bun run src/cli.ts deliberate --task - --models "..."
```

Each command prints a JSON result to stdout; progress lines go to stderr.

## Commands

| Command | What it does |
|---------|--------------|
| `models` | List configured models with provider, cost, and benchmark scores |
| `deliberate` | Run a multi-model deliberation under a protocol |
| `acceptance` | Have each worker verify that a synthesis represents its position and is grounded |
| `rank` | Pairwise-rank candidate responses with an LLM judge (LLM-Blender PairRanker) |
| `quality-check` | Cross-validate factual claims across responses |
| `convergence-check` | LLM judge classifies semantic convergence (HIGH / MODERATE / DIVERSE) |
| `inspect` | Post-deliberation pass: convergence + (rank if N≥4) + optional quality-check |
| `fuse` | Fuse ranked candidates into a single synthesis draft (LLM-Blender GenFuser) |

Run `bun run src/cli.ts <command> --help` for command-specific options.

Key `deliberate` flags: `--task`, `--models` (comma-separated, **required** — you
choose the models), `--protocol`, `--count`, `--max-rounds`, `--worker-instructions`,
plus protocol-specific `--questions`, `--criteria`, `--subject`, `--aggregation`,
and `--file-access`. A flag value of `-` reads from stdin. Worker count is capped at 7.

## Deliberation Protocols

Set with `--protocol`. Default is `shared_convergence`.

| Protocol | Structure | Default rounds |
|----------|-----------|----------------|
| `shared_convergence` | Workers analyze independently, see others' positions, converge | 3 |
| `adversarial_debate` | Workers challenge each other's positions; no forced consensus (≥2 models) | 3 |
| `host_interrogation` | Workers answer the host's questions 1:1, isolated from each other | 1 |
| `sequential_refinement` | Workers chain A→B→C, each improving the previous output | 1 |
| `evaluation_scoring` | Workers score a subject against criteria; host aggregates | 1 |
| `red_team` | Asymmetric: generators produce, attackers find weaknesses (≥2 models) | 2 |

## How a Run Works

- **Per-worker fallback** — if a worker model fails, it is replaced from a pool
  (same provider first, then any unique model, then a team duplicate), so one bad
  model doesn't sink the round.
- **Cooldown** — failed models are excluded for the rest of the session; provider-wide
  errors (rate limit, auth, 5xx) cool the whole provider. Cooldown is in-memory per run
  (the CLI restores `.pyreez/cooldown.json` on startup if present, but does not write it).
- **Replenishment & degradation** — empty slots are refilled from healthy providers;
  if the team shrinks below a minimum viable size the run reports a degradation error
  instead of returning a misleading result.
- **Post-deliberation** — `inspect` (and the standalone `rank`/`quality-check`/
  `convergence-check`/`fuse` commands) score convergence, rank candidates pairwise,
  and cross-check factual claims, returning `host_actions` for the synthesizing agent.

## Providers & Models

15 models across 4 providers, defined in `.pyreez/models.jsonc`:

| Provider | Wiring | Models |
|----------|--------|--------|
| Anthropic | `claude` CLI subprocess | Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5 |
| Google | `gemini` CLI subprocess | Gemini 3.1 Pro, Gemini 3 Flash, Gemini 3.1 Flash-Lite (all preview) |
| OpenAI | `codex` CLI subprocess | GPT-5.4, GPT-5.4 Mini, GPT-5.4 Nano, GPT-5.3 Codex |
| xAI | Vercel AI SDK (HTTP) | Grok 4, Grok 4.1 Fast (+ Reasoning / Non-Reasoning), Grok Code Fast 1 |

Edit `.pyreez/models.jsonc` to add, remove, or toggle models. Benchmark scores
shown by `models` come from that file (sources noted in its header) and are used
only for internal fallback-ordering, not for automatic selection.

## Configuration

Environment variables actually read:

```env
PYREEZ_XAI_KEY=...      # required to pass the config gate (see Known issue); used by the xAI provider
PYREEZ_MODEL=...        # optional default model id (default: anthropic/claude-sonnet-4.6)
```

The `claude` CLI provider strips the `CLAUDECODE` env var so it can be spawned from
within a Claude Code session, and runs from `/tmp` (or the project dir when
`--file-access` is set) to avoid loading project context it doesn't need.

## Roadmap / Not Yet Implemented

None of the following exists in the code today. They reflect design intent, not
current behavior:

- **MCP server** — a `.mcp.json` registration exists but starts no server
  (`src/index.ts` only exports a utility function). No MCP SDK is used.
- **Automatic routing** — there is no PROFILE→SCORE→SELECT pipeline; you pass
  `--models` explicitly. The `routing` weights in config are not consumed.
- **Bradley-Terry ratings / capability calibration** — not implemented
  (`src/evaluation/` and `src/math/` are empty).
- **Learning layer** — online rating updates, preference tracking, MoE gating,
  matrix factorization: not implemented.
- **Feedback API** — not implemented.

## Development

```bash
bun test                 # run all tests
bun test src/deliberation/   # run a directory
bun run typecheck        # tsc --noEmit
bun run src/cli.ts <cmd> # run a command
```

## License

[MIT](LICENSE) © 2026 Junhyung Park
