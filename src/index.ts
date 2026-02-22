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
import { LLMClient } from "./llm/client";
import { PyreezMcpServer } from "./mcp/server";
import { ModelRegistry } from "./model/registry";
import { BunFileIO } from "./report/bun-file-io";
import { FileReporter } from "./report/file-reporter";
import { route } from "./router/router";

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const llmClient = new LLMClient(config.llm);
  const registry = new ModelRegistry();
  const fileIO = new BunFileIO();
  const reporter = new FileReporter(".pyreez/reports", fileIO);
  const deliberationStore = new FileDeliberationStore(".pyreez/deliberations", fileIO);

  const chatAdapter = createChatAdapter((req) => llmClient.chat(req));
  const deliberateFn = createDeliberateFn({
    registry,
    chat: chatAdapter,
    store: deliberationStore,
  });

  const mcpServer = new McpServer({ name: "pyreez", version: "1.0.0" });
  const server = new PyreezMcpServer({
    mcpServer,
    llmClient,
    registry,
    reporter,
    routeFn: route,
    summaryFn: () => reporter.summary(),
    deliberateFn,
    deliberationStore,
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
