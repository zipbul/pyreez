/**
 * Admin deliberation script — bypasses MCP to call internal API with explicit models.
 * Usage: bun run scripts/deliberate-admin.ts
 */

import { loadConfigFromEnv, loadRoutingConfig } from "../src/config";
import { createChatAdapter, createDeliberateFn } from "../src/deliberation/wire";
import { ProviderRegistry } from "../src/llm/registry";
import { AnthropicProvider } from "../src/llm/providers/anthropic";
import { GoogleProvider } from "../src/llm/providers/google";
import { OpenAIProvider } from "../src/llm/providers/openai";
import { OpenAICompatibleProvider } from "../src/llm/providers/openai-compatible";
import { XaiProvider } from "../src/llm/providers/xai";
import { LocalProvider } from "../src/llm/providers/local";
import { ClaudeCliProvider } from "../src/llm/providers/claude-cli";
import type { LLMProvider, ProviderName } from "../src/llm/types";
import { ModelRegistry } from "../src/model/registry";

// -- Config --

const MODELS = [
  "local/ai/deepseek-r1-distill-llama",
  "xai/grok-4",
  "openai/o3",
  "google/gemini-2.5-pro",
  "anthropic/claude-sonnet-4.6",
];

const TASK = process.argv[2] || `We need consensus on two design decisions for our model routing system's scoring formula.

## Context
- We have computeWeightedThompson (stochastic, for exploration):
    sampledMu = clamp(mu + sigma * gaussianSample(), 0, 1000)
    weighted += sampledMu * weight
- And computeWeighted (deterministic, for exploitation):
    confidence = max(0.15, min(1.0, 1 - sigma/350))
    weighted += mu * confidence * weight
- Bootstrap sigma is currently fixed at 350 (SIGMA_BASE) for all models regardless of LMSYS vote count.
- BT calibration reduces sigma as local comparisons accumulate.

## Decision 1: Clamp truncation bias
For low-mu models (e.g., mu=100, sigma=350), clamp(0, 1000) truncates ~39% of the left tail,
systematically inflating their expected sampled score. Options:
A) Keep clamp — bias is acceptable for exploration (low-mu models need more chances)
B) Use truncated normal math — correct expectation but adds complexity
C) Reduce sigma scaling — e.g., sampledMu = mu + (sigma/2) * sample, limiting extreme draws

## Decision 2: Bootstrap sigma policy
Currently sigma=350 for ALL bootstrap models regardless of LMSYS vote count.
Previous deliberation said this "discards real information." Options:
A) Keep sigma=350 — LMSYS votes are global, not local; local comparisons should earn confidence
B) Use LMSYS votes to reduce sigma — e.g., sigma = 350/sqrt(1+votes/SCALE)
C) Two-tier: sigma=350 for <1000 LMSYS votes, sigma=200 for >=1000

For each decision, state your recommendation with reasoning. Be specific.`;

// -- Main --

async function main() {
  const routing = await loadRoutingConfig();
  const config = loadConfigFromEnv(routing);
  const registry = new ModelRegistry();

  const providers: LLMProvider[] = [];
  if (config.providers.claudeCli) {
    providers.push(new ClaudeCliProvider());
  } else if (config.providers.anthropic) {
    providers.push(new AnthropicProvider(config.providers.anthropic));
  }
  if (config.providers.google) {
    providers.push(new GoogleProvider(config.providers.google));
  }
  if (config.providers.openai) {
    providers.push(new OpenAIProvider(config.providers.openai));
  }
  if (config.providers.xai) {
    providers.push(new XaiProvider(config.providers.xai));
  }
  if (config.providers.local) {
    providers.push(new LocalProvider(config.providers.local));
  }

  const OPENAI_COMPAT_PROVIDERS = {
    deepseek: "https://api.deepseek.com",
    mistral: "https://api.mistral.ai",
    qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode",
    groq: "https://api.groq.com/openai",
  } as const;

  for (const [name, baseUrl] of Object.entries(OPENAI_COMPAT_PROVIDERS)) {
    const block = config.providers[name as keyof typeof OPENAI_COMPAT_PROVIDERS];
    if (block) {
      providers.push(
        new OpenAICompatibleProvider({
          name: name as ProviderName,
          baseUrl,
          apiKey: block.apiKey,
        }),
      );
    }
  }

  const providerRegistry = new ProviderRegistry(
    providers,
    registry.buildProviderMap(),
  );
  const chatAdapter = createChatAdapter((req) => providerRegistry.chat(req));
  const deliberateFn = createDeliberateFn({
    registry,
    chat: (model, messages) => chatAdapter(model, messages),
  });

  console.log(`\nDeliberation with ${MODELS.length} models: ${MODELS.join(", ")}\n`);
  console.log("Task:", TASK.slice(0, 100) + "...\n");

  const protocol = process.argv.includes("--debate") ? "debate" as const : undefined;
  const roundsArg = process.argv.find(a => a.startsWith("--rounds="));
  const maxRounds = roundsArg ? parseInt(roundsArg.split("=")[1]!, 10) : (protocol === "debate" ? 3 : 1);

  console.log(`Protocol: ${protocol ?? "diverge-synth"}, Max rounds: ${maxRounds}\n`);

  const start = Date.now();
  const result = await deliberateFn({
    task: TASK,
    models: MODELS,
    consensus: "leader_decides",
    leaderContributes: true,
    protocol,
    maxRounds,
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`--- Result (${elapsed}s) ---`);
  console.log(`Models used: ${result.modelsUsed.join(", ")}`);
  console.log(`Rounds: ${result.roundsExecuted}, Consensus: ${result.consensusReached}`);
  console.log(`LLM calls: ${result.totalLLMCalls}, Tokens: ${JSON.stringify(result.totalTokens)}`);

  if (result.rounds) {
    for (const r of result.rounds) {
      console.log(`\n${"=".repeat(80)}\nRound ${r.number}\n${"=".repeat(80)}`);

      if (r.failedWorkers?.length) {
        console.log(`\n⚠ Failed workers:`);
        for (const fw of r.failedWorkers) {
          console.log(`  - ${fw.model}: ${fw.error}`);
        }
      }

      if (r.responses) {
        for (const resp of r.responses) {
          console.log(`\n--- [${resp.model}] ---\n${resp.content}`);
        }
      }

      if (r.synthesis) {
        console.log(`\n--- [LEADER SYNTHESIS] ---\n${r.synthesis}`);
      }
    }
  }
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
