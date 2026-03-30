/**
 * Pyreez entry point.
 * Wires infrastructure modules and starts the MCP server over stdio.
 *
 * Architecture: pyreez = Infrastructure layer (3 MCP tools).
 * Host (e.g., Copilot) = Orchestrator.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfigFromEnv, loadRoutingConfig } from "./config";
import { createChatAdapter, createDeliberateFn } from "./deliberation/wire";
import { FileDeliberationStore } from "./deliberation/file-store";
import { ProviderRegistry } from "./llm/registry";
import { ClaudeCliProvider } from "./llm/providers/claude-cli";
import { GeminiCliProvider } from "./llm/providers/gemini-cli";
import { CodexCliProvider } from "./llm/providers/codex-cli";
import { LocalProvider } from "./llm/providers/local";
import { OpenAICompatibleProvider } from "./llm/providers/openai-compatible";
import { XaiProvider } from "./llm/providers/xai";
import type { LLMProvider, ProviderName } from "./llm/types";
import { PyreezMcpServer } from "./mcp/server";
import { ModelRegistry } from "./model/registry";
import { BunFileIO } from "./report/bun-file-io";
import { FileRunLogger } from "./report/run-logger";
import { createCooldownManager, type CooldownState } from "./deliberation/cooldown";

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
  const deliberationStore = new FileDeliberationStore(".pyreez/deliberations", fileIO);
  const runLogger = new FileRunLogger(".pyreez/runs", fileIO);

  // Build providers from config
  // CLI providers (subscription-based) take priority over API key providers
  const providers: LLMProvider[] = [];
  providers.push(new ClaudeCliProvider());
  providers.push(new GeminiCliProvider());
  providers.push(new CodexCliProvider());
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

  // Build pipeline
  const { modelIds, warnings: providerWarnings } = filterModelsByProviders(registry, providers);
  for (const w of providerWarnings) console.warn(`[pyreez] ${w}`);
  if (modelIds.length === 0) {
    console.error("[pyreez] No models available. Check API keys and scores/models.json.");
    process.exit(1);
  }

  // Shared CooldownManager: process-scoped, persists across MCP calls
  const sharedCooldown = createCooldownManager();

  // Restore cooldown state from previous session (best-effort)
  const COOLDOWN_PATH = "scores/cooldown.json";
  try {
    const raw = await fileIO.readFile(COOLDOWN_PATH);
    const state = JSON.parse(raw) as CooldownState;
    sharedCooldown.restore(state); // default 1h max age
    console.error(`[pyreez] Restored cooldown state (${state.entries.length} entries)`);
  } catch {
    // No persisted state or parse error — start fresh
  }

  // NOTE: filteredRegistry is built below (line ~189). DivergeSynthProtocol needs it
  // at construction but filteredRegistry is defined later. Hoist the definition.
  const configuredModelIds = new Set(modelIds);
  const filteredRegistry = {
    getAll: () => registry.getAll().filter((m) => configuredModelIds.has(m.id)),
    getAvailable: () => registry.getAvailable().filter((m) => configuredModelIds.has(m.id)),
    getById: (id: string) => configuredModelIds.has(id) ? registry.getById(id) : undefined,
  };




  // SkillCell store for Thompson Sampling model selection
  const { FileSkillCellStore } = await import("./model/skillcell-store");
  const skillCellStore = new FileSkillCellStore({
    io: fileIO,
    path: "scores/skillcells.json",
    familyLookup: new Map(registry.getAll().map((m) => [m.id, m.family ?? m.provider])),
  });
  await skillCellStore.load();

  // External evaluator for binary dimension feedback
  const { LLMExternalEvaluator } = await import("./deliberation/external-evaluator");
  const externalEvaluator = new LLMExternalEvaluator({
    chat: (model, messages, params) => chatAdapter(model, messages, params),
    getAvailableModels: () => filteredRegistry.getAvailable(),
  });

  const deliberateFn = createDeliberateFn({
    registry: filteredRegistry,
    chat: (model, messages, params) => chatAdapter(model, messages, params),
    store: deliberationStore,
    cooldown: sharedCooldown,
    skillCellStore,
    externalEvaluator,
  });

  const mcpServer = new McpServer({ name: "pyreez", version: "1.0.0" });
  const server = new PyreezMcpServer({
    mcpServer,
    registry,
    deliberateFn,
    runLogger,
    chatFn: (model, messages, params) => chatAdapter(model, messages, params),
    skillCellStore,
    filteredRegistry,
  });

  const transport = new StdioServerTransport();

  const shutdown = async () => {
    // Persist cooldown state for next session
    try {
      const state = sharedCooldown.serialize();
      if (state.entries.length > 0) {
        await fileIO.writeFile(COOLDOWN_PATH, JSON.stringify(state, null, 2));
      }
    } catch {
      // best-effort
    }
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
