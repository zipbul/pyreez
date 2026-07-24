/**
 * Grok CLI provider.
 * Uses the official xAI "Grok Build" CLI (`grok -p`, pinned npm package @xai-official/grok)
 * instead of the Vercel AI SDK. The SDK's tool use returns Bad Request, so SDK Grok workers
 * could never verify claims and confabulated DB/tech mechanisms in no-lookup mode. The CLI
 * grants web_search/web_fetch tools (on by default), letting Grok workers VERIFY before asserting.
 *
 * Because of that no-lookup confabulation floor (~8% even after prompt discipline), this provider
 * keeps web tools ON when request.webAccess is undefined — the opposite of the other providers'
 * default. Only an explicit webAccess: false disables them (forced no-lookup runs).
 *
 * Serializes messages, passes the system block via --system-prompt-override, reads the plain-text
 * response from stdout. Spawned by name ("grok") — under `bun run`, the pinned
 * node_modules/.bin/grok precedes any global install on PATH.
 */

import { LLMClientError } from "../errors";
import { spawnWithIdleTimeout, IdleTimeoutError } from "./spawn-with-idle";
import { composeSystemPrompt, flattenConversation, bucketEffort } from "./message-util";
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../types";

/** Kill CLI subprocess after 5 minutes of no stdout/stderr activity (web fetch can be slow). */
const IDLE_TIMEOUT_MS = 300_000;

/**
 * Convert pyreez model ID to Grok CLI -m value.
 * "xai/grok-4-1-fast" → "grok-4-1-fast"
 */
export function toGrokCliModelId(pyreezId: string): string {
  return pyreezId.startsWith("xai/") ? pyreezId.slice("xai/".length) : pyreezId;
}

// Grok effort vocabulary (no "minimal"; has "max").
const GROK_EFFORT = ["low", "medium", "high", "xhigh", "max"] as const;

export class GrokCliProvider implements LLMProvider {
  readonly name = "xai" as const;
  readonly capabilities = { web: true, effort: true, fileAccess: true } as const;

  // No constructor config: the grok CLI authenticates with its own login (~/.grok/auth.json).

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const modelId = toGrokCliModelId(request.model);
    // Fold the system block INTO the prompt (as codex/gemini do). Verified: grok underweights
    // --system-prompt-override for format-critical instructions but obeys the same instructions when
    // they appear in the -p prompt. (--system-prompt-override is still passed below to replace grok's
    // default coding-agent persona.)
    const prompt = composeSystemPrompt(request.system, flattenConversation(request.messages));

    // Resume the recorded session (interrogate) or name a fresh one with a UUID we control, so the
    // session is addressable later. Returned in the response → recorded for resume.
    const sessionId = request.resumeSessionId ?? crypto.randomUUID();

    const args = [
      "-p", prompt,
      "--model", modelId,
      "--output-format", "plain",
      "--no-subagents",
      // send the worker prompt unmodified — no agent reframing
      "--verbatim",
      ...(request.resumeSessionId ? ["--resume", sessionId] : ["--session-id", sessionId]),
    ];

    // Permission mode controls file mutation. Verified live: `plan` is read-only (edit attempts make
    // no change), `bypassPermissions` writes. No file access → throwaway /tmp cwd, auto-approve web
    // tools, and skip the agentic plan loop (the original pure-inference path).
    if (request.fileAccess === "write") {
      args.push("--permission-mode", "bypassPermissions");
    } else if (request.fileAccess === "read") {
      args.push("--permission-mode", "plan");
    } else {
      args.push("--permission-mode", "bypassPermissions", "--no-plan");
    }

    // Replace the CLI's default coding-agent system prompt with the worker's system block.
    if (request.system) args.push("--system-prompt-override", request.system);

    if (request.reasoning_effort) {
      args.push("--reasoning-effort", bucketEffort(request.reasoning_effort, GROK_EFFORT));
    }

    // Web search + web fetch stay ON unless the host forces no-lookup with an explicit false —
    // undefined means "provider default", and for grok that default is web ON (see header).
    if (request.webAccess === false) args.push("--disable-web-search");

    try {
      const env: Record<string, string | undefined> = { ...process.env };
      delete env.CLAUDECODE;

      const { stdout, stderr, exitCode } = await spawnWithIdleTimeout(
        ["grok", ...args],
        // File access points cwd at the host workspace (the files the host wants reviewed). Without it,
        // run from /tmp: avoids the CLI loading repo AGENTS.md/CLAUDE.md context for raw inference.
        { env, cwd: request.fileAccess ? process.cwd() : "/tmp" },
        { idleMs: IDLE_TIMEOUT_MS },
      );

      if (exitCode !== 0) {
        throw new LLMClientError(
          500,
          `grok CLI exited with code ${exitCode}: ${stderr.trim()}`,
          "cli_error",
        );
      }

      return this.buildResponse(stdout.trim(), sessionId);
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
    sessionId?: string,
  ): ChatCompletionResponse {
    return {
      content: text,
      ...(sessionId ? { sessionId } : {}),
    };
  }
}
