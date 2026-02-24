# pyreez

Heterogeneous multi-model deliberation infrastructure exposed as an [MCP](https://modelcontextprotocol.io/) server.

pyreez sits between a host agent (GitHub Copilot, Claude Desktop, etc.) and multiple LLM providers.
It routes tasks to the optimal model, orchestrates multi-model deliberation with consensus,
and continuously calibrates model ratings via Bradley-Terry scoring.

## Key Features

- **Intelligent Routing** — CLASSIFY → PROFILE → SELECT pipeline picks the best model per task
- **Multi-Model Deliberation** — Producer → Reviewers → Leader consensus loop across providers
- **Bradley-Terry Ratings** — 14-dimension capability scores with pairwise calibration
- **Provider Diversity** — 21 models across 7 providers (OpenAI, Anthropic, Google, xAI, DeepSeek, Meta, Mistral, Microsoft)
- **Quality Tracking** — Per-model reporting with context utilization metrics
- **Automated Benchmarks** — Evaluation suite with LLM-as-judge pairwise comparison

## Supported Models

| Provider | Models |
|----------|--------|
| OpenAI | gpt-5.3, o3, o4-mini, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, gpt-4o, gpt-4o-mini |
| Anthropic | claude-opus-4.6 |
| Google | gemini-3.1-pro |
| xAI | grok-3, grok-3-mini |
| DeepSeek | DeepSeek-R1-0528, DeepSeek-V3-0324 |
| Meta | Llama-4-Maverick-17B-128E, Llama-4-Scout-17B-16E |
| Mistral | Codestral-2501, Mistral-Medium-3 |
| Microsoft | Phi-4, Phi-4-mini-instruct, Phi-4-reasoning |

## MCP Tools

| Tool | Description |
|------|-------------|
| `pyreez_route` | Route a task through CLASSIFY → PROFILE → SELECT to find the optimal model |
| `pyreez_ask` | Send a chat completion request to a specific model |
| `pyreez_ask_many` | Send the same request to multiple models in parallel |
| `pyreez_scores` | Query model capability scores (filter by model, dimension, top-N) |
| `pyreez_report` | Record LLM call results or retrieve quality summaries |
| `pyreez_deliberate` | Run multi-model consensus-based deliberation |
| `pyreez_calibrate` | Update Bradley-Terry ratings from usage data |
| `pyreez_benchmark` | Run automated eval pipeline: prompts → pairwise comparison → BT update |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.3+
- API keys for at least one LLM provider

### Install

```bash
bun install
```

### Environment

Create a `.env` file with your API keys:

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
XAI_API_KEY=...
DEEPSEEK_API_KEY=...
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
Host Agent (Copilot / Claude Desktop)
    │
    ▼
┌─────────────────────────────────────┐
│  pyreez MCP Server (stdio)          │
│                                     │
│  ┌─────────┐  ┌──────────────────┐  │
│  │ Router  │  │ Deliberation     │  │
│  │ classify│  │ producer→review  │  │
│  │ profile │  │ →leader consensus│  │
│  │ select  │  └──────────────────┘  │
│  └─────────┘                        │
│  ┌─────────┐  ┌──────────────────┐  │
│  │ Model   │  │ Evaluation       │  │
│  │ Registry│  │ benchmark,judge  │  │
│  │ BT score│  │ pairwise,calibr. │  │
│  └─────────┘  └──────────────────┘  │
│  ┌─────────┐  ┌──────────────────┐  │
│  │ Reporter│  │ LLM Client       │  │
│  │ quality │  │ multi-provider   │  │
│  │ tracking│  │ adapter          │  │
│  └─────────┘  └──────────────────┘  │
└─────────────────────────────────────┘
    │
    ▼
LLM Providers (OpenAI, Anthropic, Google, xAI, DeepSeek, Meta, Mistral, Microsoft)
```

## Development

```bash
# Run all tests
bun test

# Type check
bun run typecheck
```

## License

[MIT](LICENSE) © 2026 Junhyung Park
