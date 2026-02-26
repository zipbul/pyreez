/**
 * Claude CLI provider.
 * Uses `claude -p` (pipe mode) instead of the Anthropic SDK.
 * Leverages existing Claude Code subscription — no additional API cost.
 */

import { LLMClientError } from "../errors";
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from "../types";

/**
 * Convert pyreez model ID to Claude CLI --model value.
 * "anthropic/claude-opus-4.6" → "claude-opus-4-6"
 */
export function toCliModelId(pyreezId: string): string {
  const bare = pyreezId.startsWith("anthropic/")
    ? pyreezId.slice("anthropic/".length)
    : pyreezId;
  return bare.replace(/\./g, "-");
}

/**
 * Serialize chat messages into a single prompt string for `claude -p`.
 * System messages are extracted separately (passed via --system-prompt).
 */
export function serializeMessages(messages: ChatMessage[]): {
  system: string | undefined;
  prompt: string;
} {
  const systemParts: string[] = [];
  const conversationParts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push(msg.content ?? "");
    } else if (msg.role === "user") {
      conversationParts.push(msg.content ?? "");
    } else if (msg.role === "assistant") {
      conversationParts.push(`[Assistant]: ${msg.content ?? ""}`);
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    prompt: conversationParts.join("\n\n"),
  };
}

export class ClaudeCliProvider implements LLMProvider {
  readonly name = "anthropic" as const;

  async chat(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const modelId = toCliModelId(request.model);
    const { system, prompt } = serializeMessages(request.messages);

    // Always pass --system-prompt to REPLACE Claude Code's default system prompt
    // (22K tokens of coding agent instructions). Without this, every call loads
    // the full agent context even though pyreez only needs raw LLM inference.
    const systemPrompt = system ?? "You are a helpful assistant. Respond concisely.";

    const args = [
      "-p",
      "--model", modelId,
      "--output-format", "json",
      "--system-prompt", systemPrompt,
      "--max-turns", "1",
    ];

    try {
      // Strip CLAUDECODE env var to allow spawning from within a Claude Code session
      const env = { ...process.env };
      delete env.CLAUDECODE;

      const proc = Bun.spawn(["claude", ...args], {
        stdin: new Blob([prompt]),
        stdout: "pipe",
        stderr: "pipe",
        env,
        // Run from /tmp to prevent Claude Code from loading CLAUDE.md
        // and project context (~18K tokens overhead per call)
        cwd: "/tmp",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        throw new LLMClientError(
          500,
          `claude CLI exited with code ${exitCode}: ${stderr.trim()}`,
          "cli_error",
        );
      }

      return this.parseResponse(stdout, request.model);
    } catch (error) {
      if (error instanceof LLMClientError) throw error;
      throw new LLMClientError(
        500,
        `Failed to spawn claude CLI: ${error instanceof Error ? error.message : String(error)}`,
        "cli_spawn_error",
      );
    }
  }

  private parseResponse(
    stdout: string,
    originalModel: string,
  ): ChatCompletionResponse {
    let parsed: ClaudeCliJsonOutput;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // If JSON parsing fails, treat entire stdout as plain text response
      return this.buildResponse(stdout.trim(), originalModel);
    }

    // claude --output-format json returns { type, subtype, cost_usd, duration_ms, duration_api_ms,
    //   is_error, num_turns, result, session_id, total_cost_usd }
    if (parsed.is_error) {
      throw new LLMClientError(
        500,
        `claude CLI error: ${parsed.result}`,
        "cli_runtime_error",
      );
    }

    return this.buildResponse(parsed.result ?? "", originalModel);
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

/** Shape of `claude -p --output-format json` output. */
interface ClaudeCliJsonOutput {
  type?: string;
  subtype?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  num_turns?: number;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
}
