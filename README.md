# pyreez

Heterogeneous multi-model deliberation infrastructure exposed as an [MCP](https://modelcontextprotocol.io/) server.

pyreez sits between a host agent (GitHub Copilot, Claude Desktop, etc.) and multiple LLM providers.
It routes tasks to the optimal model, orchestrates multi-model deliberation with consensus,
and continuously calibrates model ratings via Bradley-Terry scoring.

## Key Features

- **Intelligent Routing** — PROFILE → SCORE → SELECT pipeline picks the best model per task
- **Multi-Model Deliberation** — Workers → Leader consensus loop across providers
- **Bradley-Terry Ratings** — 21-dimension capability scores with pairwise calibration
- **Provider Diversity** — 43 models across 9 providers
- **Learning Layer** — Online BT updates, preference tracking, MoE gating, matrix factorization
- **Feedback API** — 4-type feedback (boolean, float, comment, demonstration) with session linkage
- **Quality Tracking** — Per-model reporting with context utilization metrics
- **A/B Testing** — Selector splitter for controlled routing experiments

## Supported Models

| Provider | Models |
|----------|--------|
| OpenAI | GPT-5.3, GPT-5.2, GPT-5, GPT-5 Mini, GPT-5 Nano, o3, o4-mini, GPT-4.1, GPT-4.1 mini, GPT-4.1 nano, GPT-4o, GPT-4o mini |
| Anthropic | Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5, Claude Sonnet 4.5, Claude Opus 4.5, Claude Opus 4.1, Claude Sonnet 4, Claude Opus 4 |
| Google | Gemini 3.1 Pro, Gemini 3 Pro, Gemini 3 Flash, Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash-Lite, Gemini 2.0 Flash |
| DeepSeek | DeepSeek V3.2, DeepSeek R1 |
| xAI | Grok 4.1 Fast, Grok 4, Grok Code Fast 1 |
| Mistral | Mistral Large 3, Codestral, Devstral 2 |
| Qwen | Qwen 3.5 Plus, Qwen 3.5 Flash, Qwen 3 Coder Next |
| Groq | Llama 4 Maverick, Llama 4 Scout |
| Local | DeepSeek R1 Distill Llama, Qwen3 Coder, Phi-4 |

## MCP Tools

| Tool | Description |
|------|-------------|
| `pyreez_route` | Route a task through PROFILE → SCORE → SELECT to find the optimal model. Domain required, task_type and complexity auto-inferred if omitted. |
| `pyreez_scores` | Query model capability scores (filter by model, dimension, top-N) |
| `pyreez_report` | Record LLM call results or retrieve quality summaries |
| `pyreez_deliberate` | Run multi-model consensus-based deliberation |
| `pyreez_calibrate` | Update Bradley-Terry ratings from usage data |
| `pyreez_feedback` | Record feedback (boolean/float/comment/demonstration) linked to a session |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.3+
- API keys for at least one LLM provider

### Install

```bash
bun install
```

### Environment

Set provider API keys as environment variables:

```env
PYREEZ_ANTHROPIC_KEY=sk-ant-...
PYREEZ_GOOGLE_API_KEY=...
PYREEZ_OPENAI_KEY=sk-...
PYREEZ_DEEPSEEK_KEY=...
PYREEZ_XAI_KEY=...
PYREEZ_MISTRAL_KEY=...
PYREEZ_QWEN_KEY=...
PYREEZ_GROQ_KEY=...
PYREEZ_CLAUDE_CLI=1          # Use claude CLI instead of Anthropic API
PYREEZ_LOCAL_URL=http://...  # Local LLM (Docker Model Runner, Ollama, LM Studio)
PYREEZ_LOCAL_SOCKET=/var/run/docker.sock  # Docker Model Runner socket
```

### MCP Client Configuration

Add to your MCP client config (e.g., `.vscode/mcp.json`):

```json
{
  "servers": {
    "pyreez": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/path/to/pyreez/index.ts"]
    }
  }
}
```

### Run

```bash
bun run index.ts
```

## Architecture

```
Host Agent (Copilot / Claude Desktop / Claude Code)
    │
    ▼ (MCP stdio)
┌──────────────────────────────────────────────┐
│  pyreez MCP Server (6 tools)                 │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  3-Stage Pipeline (PyreezEngine)       │  │
│  │                                        │  │
│  │  Score → [Learning L2~L4] → Profile    │  │
│  │    → Select → Deliberate               │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ Selectors   │  │ Learning Layer       │  │
│  │ ├ bt-ce     │  │ ├ L2 Preference      │  │
│  │ ├ knn       │  │ ├ L3 MoE Gating      │  │
│  │ └ cascade   │  │ ├ L4 Matrix Factor.  │  │
│  │ (+ A/B)     │  │ └ Online BT Update   │  │
│  └─────────────┘  └──────────────────────┘  │
│                                              │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ Model       │  │ Feedback Store       │  │
│  │ Registry    │  │ (4-type: bool/float/ │  │
│  │ 21-dim BT   │  │  comment/demo)       │  │
│  └─────────────┘  └──────────────────────┘  │
│                                              │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ Reporter    │  │ LLM Client           │  │
│  │ quality     │  │ 9 providers          │  │
│  │ tracking    │  │ multi-adapter        │  │
│  └─────────────┘  └──────────────────────┘  │
└──────────────────────────────────────────────┘
    │
    ▼
LLM Providers (OpenAI, Anthropic, Google, DeepSeek, xAI, Mistral, Qwen, Groq, Local)
```

## Routing Configuration

Configure selector variant and weights in `.pyreez/config.jsonc`:

```jsonc
{
  "routing": {
    "qualityWeight": 0.7,
    "costWeight": 0.3,
    // Selector variant: "bt-ce" (default), "knn", "cascade"
    "selector": "bt-ce"
  }
}
```

| Selector | Strategy |
|----------|----------|
| `bt-ce` | Composite quality + cost-efficiency scoring with exploration (default) |
| `knn` | Preference-based selection using historical win rates, composite fallback |
| `cascade` | Cost-first: cheapest model above median quality threshold |

## Development

```bash
# Run all tests
bun test

# Type check
bun run typecheck
```

## License

[MIT](LICENSE) © 2026 Junhyung Park
