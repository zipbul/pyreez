/**
 * xAI provider using Vercel AI SDK (@ai-sdk/xai).
 */

import { createXai } from "@ai-sdk/xai";
import { generateText } from "ai";
import { LLMClientError } from "../errors";
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../types";

export interface XaiProviderConfig {
  apiKey: string;
}

/** Strip provider prefix: "xai/grok-4" → "grok-4" */
function stripPrefix(modelId: string): string {
  const i = modelId.indexOf("/");
  return i === -1 ? modelId : modelId.slice(i + 1);
}

export class XaiProvider implements LLMProvider {
  readonly name = "xai" as const;
  private readonly client: ReturnType<typeof createXai>;

  constructor(config: XaiProviderConfig) {
    if (!config.apiKey) {
      throw new Error("xai provider: apiKey is required");
    }
    this.client = createXai({ apiKey: config.apiKey });
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = stripPrefix(request.model);

    try {
      const result = await generateText({
        model: this.client(model),
        messages: request.messages.map((m) => ({
          role: m.role as "system" | "user" | "assistant",
          content: m.content ?? "",
        })),
        temperature: request.temperature,
        topP: request.top_p,
      });

      // Normalize to ChatCompletionResponse format
      return {
        id: result.response?.id ?? `xai-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: result.text },
            finish_reason: result.finishReason === "stop" ? "stop" : "stop",
          },
        ],
        usage: {
          prompt_tokens: result.usage?.inputTokens ?? 0,
          completion_tokens: result.usage?.outputTokens ?? 0,
          total_tokens: result.usage?.totalTokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof Error) {
        const status = (error as unknown as Record<string, unknown>).status;
        throw new LLMClientError(
          typeof status === "number" ? status : 500,
          `xai: ${error.message}`,
          "api_error",
        );
      }
      throw new LLMClientError(500, `xai: ${String(error)}`, "api_error");
    }
  }
}
