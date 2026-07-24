/**
 * Shared helpers for the official agent-SDK providers (claude-agent, codex-sdk).
 */

import { LLMClientError } from "../errors";
import type { ChatCompletionResponse } from "../types";

export function buildSdkResponse(text: string, sessionId?: string): ChatCompletionResponse {
  return {
    content: text,
    ...(sessionId ? { sessionId } : {}),
  };
}

export function toSdkError(error: unknown, vendor: string): LLMClientError {
  if (error instanceof LLMClientError) return error;
  const status = (error as { status?: number })?.status ?? 500;
  const msg = error instanceof Error ? error.message : String(error);
  return new LLMClientError(status, `${vendor} agent SDK error: ${msg}`, "sdk_error");
}
