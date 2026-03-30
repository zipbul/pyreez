/**
 * Gemini CLI provider.
 * Uses `gemini -p` (headless mode) instead of the Google GenAI SDK.
 * Leverages Google AI Pro subscription — no per-token API cost.
 */

import { LLMClientError } from "../errors";
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from "../types";

/**
 * Convert pyreez model ID to Gemini CLI --model value.
 * "google/gemini-3.1-pro-preview" → "gemini-3.1-pro-preview"
 */
export function toGeminiCliModelId(pyreezId: string): string {
  return pyreezId.startsWith("google/")
    ? pyreezId.slice("google/".length)
    : pyreezId;
}

/**
 * Serialize chat messages into a single prompt string for `gemini -p`.
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

export class GeminiCliProvider implements LLMProvider {
  readonly name = "google" as const;

  async chat(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const modelId = toGeminiCliModelId(request.model);
    const { system, prompt } = serializeMessages(request.messages);

    const fullPrompt = system
      ? `${system}\n\n${prompt}`
      : prompt;

    const args = [
      "-p", fullPrompt,
      "--model", modelId,
      "-o", "json",
      "-y",  // auto-approve — pyreez needs raw LLM inference, not agent behavior
    ];

    try {
      const proc = Bun.spawn(["gemini", ...args], {
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
        const stderrText = stderr.trim();
        // Google quotas are per-model, NOT per-provider.
        // Map to "timeout" (model-scoped cooldown) instead of "rate_limit" (provider-scoped).
        // This allows fallback to other gemini models in the same session.
        const isCapacityExhausted = stderrText.includes("429")
          || stderrText.includes("RESOURCE_EXHAUSTED")
          || stderrText.includes("rateLimitExceeded");
        throw new LLMClientError(
          isCapacityExhausted ? 429 : 500,
          `gemini CLI exited with code ${exitCode}: ${stderrText}`,
          isCapacityExhausted ? "timeout" : "cli_error",
        );
      }

      return this.parseResponse(stdout, request.model);
    } catch (error) {
      if (error instanceof LLMClientError) throw error;
      throw new LLMClientError(
        500,
        `Failed to spawn gemini CLI: ${error instanceof Error ? error.message : String(error)}`,
        "cli_spawn_error",
      );
    }
  }

  private parseResponse(
    stdout: string,
    originalModel: string,
  ): ChatCompletionResponse {
    let parsed: GeminiCliJsonOutput;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return this.buildResponse(stdout.trim(), originalModel);
    }

    const text = parsed.response ?? "";
    const stats = parsed.stats?.models;
    let inputTokens = 0;
    let outputTokens = 0;

    if (stats) {
      for (const model of Object.values(stats)) {
        inputTokens += (model as any)?.tokens?.input ?? 0;
        outputTokens += (model as any)?.tokens?.candidates ?? 0;
      }
    }

    return this.buildResponse(text, originalModel, inputTokens, outputTokens);
  }

  private buildResponse(
    text: string,
    originalModel: string,
    inputTokens = 0,
    outputTokens = 0,
  ): ChatCompletionResponse {
    return {
      id: `gemini-cli-${Date.now()}`,
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

/** Shape of `gemini -p -o json` output. */
interface GeminiCliJsonOutput {
  session_id?: string;
  response?: string;
  stats?: {
    models?: Record<string, {
      tokens?: {
        input?: number;
        candidates?: number;
        total?: number;
      };
    }>;
  };
}
