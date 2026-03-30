/**
 * Codex CLI provider.
 * Uses `codex exec` (headless mode) instead of the OpenAI SDK.
 * Leverages ChatGPT Plus subscription — no per-token API cost.
 */

import { LLMClientError } from "../errors";
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from "../types";

/**
 * Convert pyreez model ID to Codex CLI --model value.
 * "openai/gpt-5.4" → "gpt-5.4"
 */
export function toCodexCliModelId(pyreezId: string): string {
  return pyreezId.startsWith("openai/")
    ? pyreezId.slice("openai/".length)
    : pyreezId;
}

/**
 * Serialize chat messages into a single prompt string for `codex exec`.
 */
export function serializeMessages(messages: ChatMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      parts.push(msg.content ?? "");
    } else if (msg.role === "user") {
      parts.push(msg.content ?? "");
    } else if (msg.role === "assistant") {
      parts.push(`[Assistant]: ${msg.content ?? ""}`);
    }
  }

  return parts.join("\n\n");
}

export class CodexCliProvider implements LLMProvider {
  readonly name = "openai" as const;

  async chat(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const modelId = toCodexCliModelId(request.model);
    const prompt = serializeMessages(request.messages);

    const args = [
      "exec",
      "--json",
      "-m", modelId,
      "--full-auto",
      prompt,
    ];

    try {
      const proc = Bun.spawn(["codex", ...args], {
        stdout: "pipe",
        stderr: "pipe",
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
          `codex CLI exited with code ${exitCode}: ${stderr.trim()}`,
          "cli_error",
        );
      }

      return this.parseResponse(stdout, request.model);
    } catch (error) {
      if (error instanceof LLMClientError) throw error;
      throw new LLMClientError(
        500,
        `Failed to spawn codex CLI: ${error instanceof Error ? error.message : String(error)}`,
        "cli_spawn_error",
      );
    }
  }

  private parseResponse(
    stdout: string,
    originalModel: string,
  ): ChatCompletionResponse {
    // codex exec --json outputs newline-delimited JSON events
    // Find the last item.completed or turn.completed for the response
    const lines = stdout.trim().split("\n");
    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as CodexCliEvent;
        if (event.type === "item.completed" && event.item?.text) {
          text = event.item.text;
        }
        if (event.type === "turn.completed" && event.usage) {
          inputTokens = event.usage.input_tokens ?? 0;
          outputTokens = event.usage.output_tokens ?? 0;
        }
      } catch {
        // skip non-JSON lines
      }
    }

    if (!text && lines.length > 0) {
      // Fallback: use raw stdout if no structured events found
      text = stdout.trim();
    }

    return {
      id: `codex-cli-${Date.now()}`,
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
      ...(inputTokens || outputTokens ? {
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        },
      } : {}),
    };
  }
}

/** Codex exec --json event types. */
interface CodexCliEvent {
  type?: string;
  thread_id?: string;
  item?: {
    id?: string;
    type?: string;
    text?: string;
  };
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };
}
