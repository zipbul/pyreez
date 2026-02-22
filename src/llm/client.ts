/**
 * OpenAI-compatible LLM HTTP client.
 * Works with GitHub Models API.
 */

import type { LLMProviderConfig } from "../config";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  LLMError,
} from "./types";

export class LLMClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly type?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LLMClientError";
  }
}

export class LLMClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly chatEndpoint: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly fetchFn: typeof fetch;

  constructor(config: LLMProviderConfig, fetchFn: typeof fetch = fetch) {
    if (!config.baseUrl) {
      throw new Error("baseUrl is required");
    }
    if (!config.apiKey) {
      throw new Error("apiKey is required");
    }
    if (!config.model) {
      throw new Error("model is required");
    }

    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.defaultModel = config.model;
    this.chatEndpoint =
      config.chatEndpoint ?? "/inference/chat/completions";
    this.extraHeaders = config.headers ?? {};
    this.fetchFn = fetchFn;
  }

  /**
   * Send a chat completion request.
   */
  async chat(
    request: Omit<ChatCompletionRequest, "model"> &
      Partial<Pick<ChatCompletionRequest, "model">>,
  ): Promise<ChatCompletionResponse> {
    const body: ChatCompletionRequest = {
      ...request,
      model: request.model ?? this.defaultModel,
      stream: false,
    };

    const url = `${this.baseUrl}${this.chatEndpoint}`;

    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Parse Retry-After header (seconds → ms)
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterSec = retryAfterHeader
        ? parseInt(retryAfterHeader, 10)
        : NaN;
      const retryAfterMs = Number.isFinite(retryAfterSec)
        ? retryAfterSec * 1000
        : undefined;

      const errorBody = await response.text();
      let errorMessage: string;
      let errorType: string | undefined;

      try {
        const parsed = JSON.parse(errorBody) as {
          error?: { message?: string; type?: string };
          message?: string;
        };
        errorMessage =
          parsed.error?.message ?? parsed.message ?? errorBody;
        errorType = parsed.error?.type;
      } catch {
        errorMessage = errorBody || `HTTP ${response.status}`;
      }

      // Standardize 429 rate-limit messages
      if (response.status === 429) {
        const retryPart = retryAfterMs
          ? ` Retry after ${retryAfterMs / 1000}s.`
          : "";
        errorMessage = `Rate limit exceeded.${retryPart}`;
        errorType = errorType ?? "rate_limit_error";
      }

      throw new LLMClientError(
        response.status,
        errorMessage,
        errorType,
        retryAfterMs,
      );
    }

    return (await response.json()) as ChatCompletionResponse;
  }
}
