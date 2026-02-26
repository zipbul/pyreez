/**
 * Anthropic provider.
 * Uses the @anthropic-ai/sdk.
 */

import Anthropic from "@anthropic-ai/sdk";
import { LLMClientError } from "../errors";
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from "../types";

export interface AnthropicProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Convert pyreez model ID to Anthropic API model ID.
 * "anthropic/claude-opus-4.6" → "claude-opus-4-6"
 */
export function toAnthropicModelId(pyreezId: string): string {
  const bare = pyreezId.startsWith("anthropic/")
    ? pyreezId.slice("anthropic/".length)
    : pyreezId;
  return bare.replace(/\./g, "-");
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(config: AnthropicProviderConfig) {
    if (!config.apiKey) {
      throw new Error("apiKey is required");
    }
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const systemParts: string[] = [];
    const apiMessages: Anthropic.MessageParam[] = [];

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemParts.push(msg.content ?? "");
      } else if (msg.role === "user" || msg.role === "assistant") {
        apiMessages.push({ role: msg.role, content: msg.content ?? "" });
      }
    }

    try {
      const params: Anthropic.MessageCreateParams = {
        model: toAnthropicModelId(request.model),
        messages: apiMessages,
        max_tokens: request.max_tokens ?? 4096,
      };
      if (systemParts.length > 0) {
        params.system = systemParts.join("\n\n");
      }
      if (request.temperature != null) {
        params.temperature = request.temperature;
      }
      if (request.top_p != null) {
        params.top_p = request.top_p;
      }
      if (request.stop) {
        params.stop_sequences = request.stop;
      }

      const response = await this.client.messages.create(params);
      return this.toOpenAIFormat(response, request.model);
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new LLMClientError(
          error.status,
          error.message,
          (error as any).error?.type ?? undefined,
          parseRetryAfter(error),
        );
      }
      throw error;
    }
  }

  private toOpenAIFormat(
    res: Anthropic.Message,
    originalModel: string,
  ): ChatCompletionResponse {
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const finishReason =
      res.stop_reason === "end_turn"
        ? ("stop" as const)
        : res.stop_reason === "max_tokens"
          ? ("length" as const)
          : ("stop" as const);

    return {
      id: res.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: originalModel,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: res.usage.input_tokens,
        completion_tokens: res.usage.output_tokens,
        total_tokens: res.usage.input_tokens + res.usage.output_tokens,
        cached_tokens: (res.usage as any).cache_read_input_tokens as number | undefined,
      },
    };
  }
}

function parseRetryAfter(error: InstanceType<typeof Anthropic.APIError>): number | undefined {
  const headers = error.headers;
  if (!headers) return undefined;
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const sec = parseInt(raw, 10);
  return Number.isFinite(sec) ? sec * 1000 : undefined;
}
