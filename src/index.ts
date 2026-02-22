/**
 * Pyreez entry point.
 * Wires infrastructure modules and starts the MCP server over stdio.
 *
 * Architecture: pyreez = Infrastructure layer (5 MCP tools).
 * Host (e.g., Copilot) = Orchestrator.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfigFromEnv } from "./config";
import { LLMClient } from "./llm/client";
import { PyreezMcpServer } from "./mcp/server";
import { ModelRegistry } from "./model/registry";
import { InMemoryReporter } from "./report/reporter";
import { route } from "./router/router";

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const llmClient = new LLMClient(config.llm);
  const registry = new ModelRegistry();
  const reporter = new InMemoryReporter();

  const mcpServer = new McpServer({ name: "pyreez", version: "1.0.0" });
  const server = new PyreezMcpServer({
    mcpServer,
    llmClient,
    registry,
    reporter,
    routeFn: route,
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
