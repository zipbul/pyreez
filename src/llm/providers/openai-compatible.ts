/**
 * Generic OpenAI-compatible provider.
 * Connects to any remote API that implements the /v1/chat/completions endpoint.
 * Used for DeepSeek, xAI, Mistral, Qwen, Groq, and similar services.
 * Uses Bun-native fetch — no npm SDK dependency.
 */

import { LLMClientError, parseHttpError } from "../errors";
import type {
  ProviderName,
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../types";

export interface OpenAICompatibleConfig {
  name: ProviderName;
  baseUrl: string;
  apiKey: string;
  /** Request timeout in milliseconds (default: 60_000 = 1 min). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Strip provider prefix from model ID.
 * "deepseek/deepseek-r1" → "deepseek-r1"
 * "groq/llama-4-scout" → "llama-4-scout"
 */
export function stripProviderPrefix(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  return slashIndex === -1 ? modelId : modelId.slice(slashIndex + 1);
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: ProviderName;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: OpenAICompatibleConfig) {
    if (!config.apiKey) {
      throw new Error(`${config.name} provider: apiKey is required`);
    }
    if (!config.baseUrl) {
      throw new Error(`${config.name} provider: baseUrl is required`);
    }
    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;

    const body = {
      model: stripProviderPrefix(request.model),
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content ?? "",
      })),
      temperature: request.temperature,
      top_p: request.top_p,
      max_tokens: request.max_tokens,
      stream: false,
      stop: request.stop,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new LLMClientError(
          504,
          `${this.name} request timed out after ${this.timeoutMs}ms`,
          "timeout_error",
        );
      }
      throw new LLMClientError(
        503,
        `${this.name} connection failed: ${error instanceof Error ? error.message : String(error)}`,
        "connection_error",
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw await parseHttpError(response);
    }

    return (await response.json()) as ChatCompletionResponse;
  }
}
