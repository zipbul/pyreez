/**
 * Grok CLI provider.
 * Uses the official xAI "Grok Build" CLI (`grok -p`, pinned npm package @xai-official/grok)
 * instead of the Vercel AI SDK. The SDK's tool use returns Bad Request, so SDK Grok workers
 * could never verify claims and confabulated DB/tech mechanisms in no-lookup mode. The CLI
 * grants web_search/web_fetch tools (on by default), letting Grok workers VERIFY before asserting.
 *
 * Mirrors ClaudeCliProvider: serialize messages, pass the system block via --system-prompt-override,
 * read the plain-text response from stdout. Spawned by name ("grok") — under `bun run`, the pinned
 * node_modules/.bin/grok precedes any global install on PATH.
 */

import { LLMClientError } from "../errors";
import { spawnWithIdleTimeout, IdleTimeoutError } from "./spawn-with-idle";
import { serializeMessages } from "./claude-cli";
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../types";

/** Kill CLI subprocess after 5 minutes of no stdout/stderr activity (web fetch can be slow). */
const IDLE_TIMEOUT_MS = 300_000;

export interface GrokCliProviderConfig {
  readonly apiKey: string;
}

/**
 * Convert pyreez model ID to Grok CLI -m value.
 * "xai/grok-4-1-fast" → "grok-4-1-fast"
 */
export function toGrokCliModelId(pyreezId: string): string {
  return pyreezId.startsWith("xai/") ? pyreezId.slice("xai/".length) : pyreezId;
}

/** Map pyreez reasoning_effort to a Grok CLI --reasoning-effort value (Grok has no "minimal"). */
export function toGrokEffort(effort: string): string {
  return effort === "minimal" ? "low" : effort;
}

export class GrokCliProvider implements LLMProvider {
  readonly name = "xai" as const;

  constructor(private readonly config: GrokCliProviderConfig) {}

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const modelId = toGrokCliModelId(request.model);
    const { system, prompt } = serializeMessages(request.messages);

    const args = [
      "-p", prompt,
      "--model", modelId,
      "--output-format", "plain",
      // headless: auto-approve tool calls (web_search/web_fetch) and skip the agentic plan/subagent loop
      "--permission-mode", "bypassPermissions",
      "--no-subagents",
      "--no-plan",
      // send the worker prompt unmodified — no agent reframing
      "--verbatim",
    ];

    // Replace the CLI's default coding-agent system prompt with the worker's system block.
    if (system) args.push("--system-prompt-override", system);

    if (request.reasoning_effort) {
      args.push("--reasoning-effort", toGrokEffort(request.reasoning_effort));
    }

    // Web search + web fetch tools are ON by default; disable them for no-lookup workers.
    if (!request.webAccess) args.push("--disable-web-search");

    try {
      const env: Record<string, string | undefined> = { ...process.env };
      delete env.CLAUDECODE;
      env.XAI_API_KEY = this.config.apiKey;
      env.GROK_CODE_XAI_API_KEY = this.config.apiKey;

      const { stdout, stderr, exitCode } = await spawnWithIdleTimeout(
        ["grok", ...args],
        // Run from /tmp: avoids the CLI loading repo AGENTS.md/CLAUDE.md context for raw inference.
        { env, cwd: "/tmp" },
        { idleMs: IDLE_TIMEOUT_MS },
      );

      if (exitCode !== 0) {
        throw new LLMClientError(
          500,
          `grok CLI exited with code ${exitCode}: ${stderr.trim()}`,
          "cli_error",
        );
      }

      return this.buildResponse(stdout.trim(), request.model);
    } catch (error) {
      if (error instanceof LLMClientError) throw error;
      if (error instanceof IdleTimeoutError) {
        throw new LLMClientError(408, error.message, "timeout");
      }
      throw new LLMClientError(
        500,
        `Failed to spawn grok CLI: ${error instanceof Error ? error.message : String(error)}`,
        "cli_spawn_error",
      );
    }
  }

  private buildResponse(
    text: string,
    originalModel: string,
  ): ChatCompletionResponse {
    return {
      id: `cli-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: originalModel,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
        },
      ],
    };
  }
}
