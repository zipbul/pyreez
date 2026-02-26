/**
 * OpenAI direct provider.
 * Uses the openai SDK with the standard api.openai.com endpoint.
 */

import OpenAI from "openai";
import { LLMClientError } from "../errors";
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../types";

export interface OpenAIProviderConfig {
  apiKey: string;
}

/**
 * Convert pyreez model ID to OpenAI API model ID.
 * "openai/gpt-4.1" → "gpt-4.1"
 */
export function toOpenAIModelId(pyreezId: string): string {
  return pyreezId.startsWith("openai/")
    ? pyreezId.slice("openai/".length)
    : pyreezId;
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai" as const;
  private readonly client: OpenAI;

  constructor(config: OpenAIProviderConfig) {
    if (!config.apiKey) {
      throw new Error("apiKey is required");
    }
    this.client = new OpenAI({
      apiKey: config.apiKey,
    });
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: toOpenAIModelId(request.model),
        messages: request.messages.map((m) => ({
          role: m.role as "system" | "user" | "assistant",
          content: m.content ?? "",
        })),
        temperature: request.temperature,
        top_p: request.top_p,
        max_tokens: request.max_tokens,
        stream: false,
        tools: request.tools as OpenAI.ChatCompletionTool[] | undefined,
        tool_choice: request.tool_choice as OpenAI.ChatCompletionToolChoiceOption | undefined,
        response_format: request.response_format as OpenAI.ResponseFormatText | OpenAI.ResponseFormatJSONObject | undefined,
        seed: request.seed,
        stop: request.stop,
      });

      const result = response as unknown as ChatCompletionResponse;
      // Map OpenAI cached tokens into our normalized field
      const details = (response as any).usage?.prompt_tokens_details;
      if (result.usage && typeof details?.cached_tokens === "number") {
        result.usage.cached_tokens = details.cached_tokens;
      }
      return result;
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        throw new LLMClientError(
          error.status ?? 500,
          error.message,
          error.type ?? undefined,
          parseRetryAfter(error),
        );
      }
      throw error;
    }
  }
}

function parseRetryAfter(error: InstanceType<typeof OpenAI.APIError>): number | undefined {
  const headers = error.headers;
  if (!headers) return undefined;
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const sec = parseInt(raw, 10);
  return Number.isFinite(sec) ? sec * 1000 : undefined;
}
