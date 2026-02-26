/**
 * Pyreez entry point.
 * Wires infrastructure modules and starts the MCP server over stdio.
 *
 * Architecture: pyreez = Infrastructure layer (6 MCP tools).
 * Host (e.g., Copilot) = Orchestrator.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfigFromEnv } from "./config";
import { createChatAdapter, createDeliberateFn } from "./deliberation/wire";
import { FileDeliberationStore } from "./deliberation/file-store";
import { ProviderRegistry } from "./llm/registry";
import { GitHubProvider } from "./llm/providers/github";
import { AnthropicProvider } from "./llm/providers/anthropic";
import { GoogleProvider } from "./llm/providers/google";
import { OpenAIProvider } from "./llm/providers/openai";
import type { LLMProvider } from "./llm/types";
import { PyreezMcpServer } from "./mcp/server";
import { ModelRegistry } from "./model/registry";
import { calibrate, extractRatingsMap, persistRatings } from "./model/calibration";
import { BunFileIO } from "./report/bun-file-io";
import { FileReporter } from "./report/file-reporter";
import { FileRunLogger } from "./report/run-logger";
import { route } from "./router/router";
import { createEngine, DEFAULT_CONFIG } from "./axis/factory";
import type { ChatFn } from "./axis/types";
import type { ChatMessage } from "./llm/types";

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const registry = new ModelRegistry();
  const fileIO = new BunFileIO();
  const reporter = new FileReporter(".pyreez/reports", fileIO);
  const deliberationStore = new FileDeliberationStore(".pyreez/deliberations", fileIO);
  const runLogger = new FileRunLogger(".pyreez/runs", fileIO);

  // Build providers from config
  const providers: LLMProvider[] = [];
  if (config.providers.github) {
    providers.push(new GitHubProvider(config.providers.github));
  }
  if (config.providers.anthropic) {
    providers.push(new AnthropicProvider(config.providers.anthropic));
  }
  if (config.providers.google) {
    providers.push(new GoogleProvider(config.providers.google));
  }
  if (config.providers.openai) {
    providers.push(new OpenAIProvider(config.providers.openai));
  }

  const providerRegistry = new ProviderRegistry(
    providers,
    registry.buildProviderMap(),
  );

  const chatAdapter = createChatAdapter((req) => providerRegistry.chat(req));

  // Axis ChatFn adapter: bridge (modelId, string | ChatMessage[]) to chatAdapter
  const axisChatFn: ChatFn = async (modelId, input) => {
    const messages: ChatMessage[] =
      typeof input === "string"
        ? [{ role: "user", content: input }]
        : input;
    return chatAdapter(modelId, messages);
  };

  const engine = createEngine(DEFAULT_CONFIG, axisChatFn);

  const deliberateFn = createDeliberateFn({
    registry,
    chat: chatAdapter,
    store: deliberationStore,
  });

  const mcpServer = new McpServer({ name: "pyreez", version: "1.0.0" });
  const server = new PyreezMcpServer({
    mcpServer,
    chatFn: (req) => providerRegistry.chat(req),
    registry,
    reporter,
    routeFn: (prompt, budget, hints) => route(prompt, budget, undefined, hints),
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
