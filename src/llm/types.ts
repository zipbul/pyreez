/**
 * OpenAI-compatible chat completion types.
 * Used across all providers — each provider normalizes to this format.
 */

// --- Provider Types ---

export type ProviderName =
  | "anthropic"
  | "google"
  | "openai"
  | "xai";

/**
 * What a provider can honor. Declared per provider so the registry can gate requests
 * instead of letting providers silently ignore unsupported capabilities.
 * - web/fileAccess are correctness-affecting → gate hard-errors if requested but unsupported.
 * - effort is a soft tuning knob → gate strips + records (degraded, not wrong).
 */
export interface CapabilitySet {
  readonly web: boolean;
  readonly effort: boolean;
  readonly fileAccess: boolean;
}

export interface LLMProvider {
  readonly name: ProviderName;
  readonly capabilities: CapabilitySet;
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

// --- Request Types ---

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  /** Standing instructions, hoisted out of `messages` at the adapter. Each provider injects it its
   * own way: a native system param (claude, grok) or framed into the prompt (codex, gemini). */
  system?: string;
  messages: ChatMessage[];
  /** Enable read-only file access for this request (provider maps to its own mechanism). */
  fileAccess?: boolean;
  /** Enable web search/fetch so the worker can VERIFY claims instead of recalling them. */
  webAccess?: boolean;
  /** Reasoning effort on a 1–10 scale. Each provider buckets it to its own level set. */
  reasoning_effort?: number;
}

// --- Response Types ---

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | null;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Number of input tokens served from provider cache (observation/reporting only). */
  cached_tokens?: number;
  /** Reasoning-only output tokens (OpenAI reasoning models). Already included in completion_tokens; surfaced separately for cost attribution. */
  reasoning_tokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
}

// --- Error Types ---

export interface LLMError {
  status: number;
  message: string;
  type?: string;
}
