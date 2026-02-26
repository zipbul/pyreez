/**
 * Google provider.
 * Uses the @google/genai SDK.
 */

import { GoogleGenAI } from "@google/genai";
import type { GenerateContentResponse } from "@google/genai";
import { LLMClientError } from "../errors";
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../types";

export interface GoogleProviderConfig {
  apiKey: string;
}

/**
 * Convert pyreez model ID to Google API model ID.
 * "google/gemini-3.1-pro" → "gemini-3.1-pro"
 */
export function toGoogleModelId(pyreezId: string): string {
  return pyreezId.startsWith("google/")
    ? pyreezId.slice("google/".length)
    : pyreezId;
}

export class GoogleProvider implements LLMProvider {
  readonly name = "google" as const;
  private readonly client: GoogleGenAI;

  constructor(config: GoogleProviderConfig) {
    if (!config.apiKey) {
      throw new Error("apiKey is required");
    }
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const systemParts: string[] = [];
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemParts.push(msg.content ?? "");
      } else if (msg.role === "user") {
        contents.push({ role: "user", parts: [{ text: msg.content ?? "" }] });
      } else if (msg.role === "assistant") {
        contents.push({ role: "model", parts: [{ text: msg.content ?? "" }] });
      }
    }

    try {
      const response = await this.client.models.generateContent({
        model: toGoogleModelId(request.model),
        contents,
        config: {
          systemInstruction: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
          temperature: request.temperature,
          topP: request.top_p,
          maxOutputTokens: request.max_tokens,
          stopSequences: request.stop,
        },
      });

      return this.toOpenAIFormat(response, request.model);
    } catch (error) {
      if (error instanceof Error && "status" in error) {
        const status = (error as any).status ?? 500;
        throw new LLMClientError(status, error.message);
      }
      throw error;
    }
  }

  private toOpenAIFormat(
    res: GenerateContentResponse,
    originalModel: string,
  ): ChatCompletionResponse {
    const text = res.text ?? "";
    const finishReason =
      res.candidates?.[0]?.finishReason === "MAX_TOKENS"
        ? ("length" as const)
        : ("stop" as const);

    return {
      id: `google-${Date.now()}`,
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
        prompt_tokens: res.usageMetadata?.promptTokenCount ?? 0,
        completion_tokens: res.usageMetadata?.candidatesTokenCount ?? 0,
        total_tokens: res.usageMetadata?.totalTokenCount ?? 0,
        cached_tokens: (res.usageMetadata as any)?.cachedContentTokenCount as number | undefined,
      },
    };
  }
}
