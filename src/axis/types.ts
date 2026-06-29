/**
 * Axis types — shared across deliberation infrastructure.
 */

import type { ChatMessage } from "../llm/types";
import type { GenerationParams } from "../deliberation/types";

/**
 * Result of a single LLM call, including token usage.
 */
export interface ChatResult {
  readonly content: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** True when the response was cut off (finish_reason === "length"). */
  readonly truncated?: boolean;
}

/**
 * Chat function injected into the engine — allows any LLM backend.
 */
export type ChatFn = (
  modelId: string,
  input: string | ChatMessage[],
  params?: GenerationParams,
) => Promise<ChatResult>;
