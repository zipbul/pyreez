/**
 * Shared helpers for the official agent-SDK providers (claude-agent, codex-sdk).
 */

import { LLMClientError } from "../errors";
import type { ChatCompletionResponse } from "../types";

export function buildSdkResponse(
  text: string,
  originalModel: string,
  usage?: { input_tokens?: number; output_tokens?: number },
  sessionId?: string,
): ChatCompletionResponse {
  return {
    id: `sdk-${Date.now()}`,
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
    ...(usage
      ? {
          usage: {
            prompt_tokens: usage.input_tokens ?? 0,
            completion_tokens: usage.output_tokens ?? 0,
            total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
          },
        }
      : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export function toSdkError(error: unknown, vendor: string): LLMClientError {
  if (error instanceof LLMClientError) return error;
  const status = (error as { status?: number })?.status ?? 500;
  const msg = error instanceof Error ? error.message : String(error);
  return new LLMClientError(status, `${vendor} agent SDK error: ${msg}`, "sdk_error");
}
