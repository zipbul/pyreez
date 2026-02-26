/**
 * GitHub Models provider.
 * Uses the openai SDK with baseURL targeting models.github.ai.
 */

import OpenAI from "openai";
import { LLMClientError } from "../errors";
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../types";

export interface GitHubProviderConfig {
  apiKey: string;
}

export class GitHubProvider implements LLMProvider {
  readonly name = "github" as const;
  private readonly client: OpenAI;

  constructor(config: GitHubProviderConfig) {
    if (!config.apiKey) {
      throw new Error("apiKey is required");
    }
    this.client = new OpenAI({
      baseURL: "https://models.github.ai/inference",
      apiKey: config.apiKey,
    });
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: request.model,
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

      return response as unknown as ChatCompletionResponse;
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
