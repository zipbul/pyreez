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

      throw new LLMClientError(response.status, errorMessage, errorType);
    }

    return (await response.json()) as ChatCompletionResponse;
  }
}
