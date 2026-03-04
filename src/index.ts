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
import { XaiProvider } from "./llm/providers/xai";
import type { LLMProvider, ProviderName } from "./llm/types";
import { PyreezMcpServer } from "./mcp/server";
import { ModelRegistry } from "./model/registry";
import { calibrate, extractRatingsMap, persistRatings } from "./model/calibration";
import { BunFileIO } from "./report/bun-file-io";
import { FileReporter } from "./report/file-reporter";
import { FileRunLogger } from "./report/run-logger";
import { FileFeedbackStore } from "./report/feedback-store";
import { PyreezEngine } from "./axis/engine";
import {
  BtScoringSystem,
  DomainOverrideProfiler,
  TwoTrackCeSelector,
  DivergeSynthProtocol,
} from "./axis/wrappers";
import { LocalLearningLayer } from "./axis/learning";
import { MfLearner } from "./axis/mf-learner";
import { NUM_TASK_TYPES } from "./axis/mf-index";
import { KnnSelector } from "./router/knn-selector";
import { CascadeSelector } from "./router/cascade-selector";
import type { Selector } from "./axis/interfaces";
import type { ChatFn } from "./axis/types";
import type { ChatMessage } from "./llm/types";

/**
 * Filter registry models to only those from configured providers.
 * Exported for testability.
 */
export function filterModelsByProviders(
  registry: ModelRegistry,
  providers: readonly LLMProvider[],
): { modelIds: string[]; warnings: string[] } {
  const configuredProviders = new Set(providers.map((p) => p.name));
  const availableModels = registry.getAvailable().filter((m) => configuredProviders.has(m.provider));
  const warnings: string[] = [];
  if (availableModels.length === 0) {
    warnings.push(
      `No models match configured providers (${[...configuredProviders].join(", ")}). ` +
      "Check scores/models.json provider names.",
    );
  }
  return { modelIds: availableModels.map((m) => m.id), warnings };
}

async function main(): Promise<void> {
  const routing = await loadRoutingConfig();
  const config = loadConfigFromEnv(routing);
  const registry = new ModelRegistry();
  const fileIO = new BunFileIO();
  const reporter = new FileReporter(".pyreez/reports", fileIO);
  const deliberationStore = new FileDeliberationStore(".pyreez/deliberations", fileIO);
  const runLogger = new FileRunLogger(".pyreez/runs", fileIO);
  const feedbackStore = new FileFeedbackStore(".pyreez/feedback", fileIO);

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

  // xAI provider (Vercel AI SDK)
  if (config.providers.xai) {
    providers.push(new XaiProvider(config.providers.xai));
  }

  // OpenAI-compatible providers (DeepSeek, Mistral, Qwen, Groq)
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

  // Axis ChatFn adapter: bridge (modelId, string | ChatMessage[]) → ChatResult
  const axisChatFn: ChatFn = async (modelId, input) => {
    const messages: ChatMessage[] =
      typeof input === "string"
        ? [{ role: "user", content: input }]
        : input;
    return chatAdapter(modelId, messages);
  };

  // Build 3-stage pipeline directly (no factory)
  const { modelIds } = filterModelsByProviders(registry, providers);

  const scoring = new BtScoringSystem();
  const profiler = new DomainOverrideProfiler();
  const deliberation = new DivergeSynthProtocol("leader_decides", 1);

  // MF Learner: matrix factorization for task-type × model affinity
  const mfLearner = new MfLearner({
    numContexts: NUM_TASK_TYPES,
    numModels: modelIds.length,
    io: fileIO,
  });
  await mfLearner.load();

  // Learning Layer: preference tracking + online BT + MF + persistence
  const learningLayer = new LocalLearningLayer({
    scoring,
    io: fileIO,
    mfLearner,
    modelIds,
  });
  await learningLayer.init();

  // Selector variant from config
  let selector: Selector;
  switch (config.routing.selector) {
    case "knn":
      selector = new KnnSelector({
        preferenceTable: learningLayer.table,
        registry,
        ensembleSize: 3,
        routing: config.routing,
      });
      break;
    case "cascade":
      selector = new CascadeSelector({ registry, routing: config.routing });
      break;
    default:
      selector = new TwoTrackCeSelector(3, undefined, config.routing);
  }

  const engine = new PyreezEngine(
    scoring,
    profiler,
    selector,
    deliberation,
    axisChatFn,
    modelIds,
    learningLayer,
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
    feedbackStore,
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

  // Load latency data if latencyWeight is configured
  if (config.routing.latencyWeight && config.routing.latencyWeight > 0 && selector instanceof TwoTrackCeSelector) {
    try {
      const latencyMap = await reporter.getLatencyMap();
      if (latencyMap.size > 0) {
        selector.setLatencyMap(latencyMap);
      }
    } catch {
      // Latency data is optional — skip on error
    }
  }

  const shutdown = async () => {
    await learningLayer.flush();
    await mfLearner.flush();
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
