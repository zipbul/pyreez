/**
 * Pyreez entry point.
 * Wires infrastructure modules and starts the MCP server over stdio.
 *
 * Architecture: pyreez = Infrastructure layer (5 MCP tools).
 * Host (e.g., Copilot) = Orchestrator.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfigFromEnv, loadRoutingConfig } from "./config";
import { createChatAdapter, createDeliberateFn } from "./deliberation/wire";
import { FileDeliberationStore } from "./deliberation/file-store";
import { ProviderRegistry } from "./llm/registry";
import { AnthropicProvider } from "./llm/providers/anthropic";
import { ClaudeCliProvider } from "./llm/providers/claude-cli";
import { GoogleProvider } from "./llm/providers/google";
import { OpenAIProvider } from "./llm/providers/openai";
import { LocalProvider } from "./llm/providers/local";
import { OpenAICompatibleProvider } from "./llm/providers/openai-compatible";
import type { LLMProvider, ProviderName } from "./llm/types";
import { PyreezMcpServer } from "./mcp/server";
import { ModelRegistry } from "./model/registry";
import { calibrate, extractRatingsMap, persistRatings } from "./model/calibration";
import { BunFileIO } from "./report/bun-file-io";
import { FileReporter } from "./report/file-reporter";
import { FileRunLogger } from "./report/run-logger";
import { PyreezEngine } from "./axis/engine";
import {
  BtScoringSystem,
  DomainOverrideProfiler,
  TwoTrackCeSelector,
  DivergeSynthProtocol,
} from "./axis/wrappers";
import type { ChatFn } from "./axis/types";
import type { ChatMessage } from "./llm/types";

async function main(): Promise<void> {
  const routing = await loadRoutingConfig();
  const config = loadConfigFromEnv(routing);
  const registry = new ModelRegistry();
  const fileIO = new BunFileIO();
  const reporter = new FileReporter(".pyreez/reports", fileIO);
  const deliberationStore = new FileDeliberationStore(".pyreez/deliberations", fileIO);
  const runLogger = new FileRunLogger(".pyreez/runs", fileIO);

  // Build providers from config
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
  if (config.providers.local) {
    providers.push(new LocalProvider(config.providers.local));
  }

  // OpenAI-compatible providers (DeepSeek, xAI, Mistral, Qwen, Groq)
  const OPENAI_COMPAT_PROVIDERS = {
    deepseek: "https://api.deepseek.com",
    xai: "https://api.x.ai",
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

  // Axis ChatFn adapter: bridge (modelId, string | ChatMessage[]) → ChatResult
  const axisChatFn: ChatFn = async (modelId, input) => {
    const messages: ChatMessage[] =
      typeof input === "string"
        ? [{ role: "user", content: input }]
        : input;
    return chatAdapter(modelId, messages);
  };

  // Build 3-stage pipeline directly (no factory)
  // Filter models to only those from configured providers
  const configuredProviders = new Set(providers.map((p) => p.name));
  const availableModels = registry.getAvailable().filter((m) => configuredProviders.has(m.provider));
  if (availableModels.length === 0) {
    console.error(
      `Warning: No models match configured providers (${[...configuredProviders].join(", ")}). ` +
      "Check scores/models.json provider names.",
    );
  }
  const modelIds = availableModels.map((m) => m.id);
  const scoring = new BtScoringSystem();
  const profiler = new DomainOverrideProfiler();
  const selector = new TwoTrackCeSelector(3, undefined, config.routing);
  const deliberation = new DivergeSynthProtocol("leader_decides", 1);

  const engine = new PyreezEngine(
    scoring,
    profiler,
    selector,
    deliberation,
    axisChatFn,
    modelIds,
  );

  const deliberateFn = createDeliberateFn({
    registry,
    chat: (model, messages) => chatAdapter(model, messages),
    store: deliberationStore,
  });

  const mcpServer = new McpServer({ name: "pyreez", version: "1.0.0" });
  const server = new PyreezMcpServer({
    mcpServer,
    registry,
    reporter,
    summaryFn: () => reporter.summary(),
    deliberateFn,
    deliberationStore,
    runLogger,
    engine,
    calibrateFn: async () => {
      const records = await reporter.getAll();
      const models = registry.getAll();
      const ratings = extractRatingsMap(models);
      const result = calibrate(ratings, [...records]);
      await persistRatings("scores/models.json", ratings, fileIO);
      return result;
    },
  });

  const transport = new StdioServerTransport();

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.start(transport);
}

main().catch((error) => {
  console.error("Pyreez failed to start:", error);
  process.exit(1);
});
