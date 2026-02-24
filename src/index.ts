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
import { runBenchmarkPipeline } from "./evaluation/pipeline";
import type { BenchmarkPipelineDeps } from "./evaluation/pipeline";
import { runEvalSuite } from "./evaluation/suite";
import { createLLMJudge } from "./evaluation/judge";
import type { EvalResponse } from "./evaluation/types";
import { PyreezMcpServer } from "./mcp/server";
import { ModelRegistry } from "./model/registry";
import { calibrate, extractRatingsMap, persistRatings } from "./model/calibration";
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
    calibrateFn: async () => {
      const records = await reporter.getAll();
      const models = registry.getAll();
      const ratings = extractRatingsMap(models);
      const result = calibrate(ratings, [...records]);
      await persistRatings("scores/models.json", ratings, fileIO);
      return result;
    },
    benchmarkFn: async (cfg) => {
      const runner = {
        generate: async (modelId: string, prompt: string): Promise<EvalResponse> => {
          const content = await chatAdapter(modelId, [{ role: "user", content: prompt }]);
          return {
            promptId: "",
            modelId,
            response: content,
            latencyMs: 0,
            tokenUsage: { prompt: 0, completion: 0 },
          };
        },
      };
      const judge = createLLMJudge(async (model, prompt, judgeCfg) => {
        const judgeAdapter = createChatAdapter(
          (req) => llmClient.chat({
            ...req,
            temperature: judgeCfg.temperature,
            max_tokens: judgeCfg.maxTokens,
          }),
        );
        return judgeAdapter(model, [
          { role: "user", content: prompt },
        ]);
      });
      const defaultJudgeConfig = {
        judgeModel: config.llm.model,
        temperature: 0,
        maxTokens: 4000,
        lengthBiasCorrection: true,
      };
      const deps: BenchmarkPipelineDeps = {
        runner,
        judge,
        loadPrompts: () => {
          throw new Error("No prompt source configured. Provide evaluation prompts.");
        },
        loadModels: () => registry.getAll(),
        persistIO: fileIO,
        runEvalSuite,
        extractRatingsMap,
        persistRatings,
      };
      return runBenchmarkPipeline(
        {
          modelIds: cfg.modelIds,
          anchorModelId: cfg.anchorModelId,
          judgeConfig: defaultJudgeConfig,
          concurrency: 2,
          positionSwap: cfg.positionSwap ?? false,
          modelsPath: "scores/models.json",
          domains: cfg.domains as any,
          difficulties: cfg.difficulties as any,
        },
        deps,
      );
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
