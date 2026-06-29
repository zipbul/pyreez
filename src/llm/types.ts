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

export interface ToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface Tool {
  type: "function";
  function: ToolFunction;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: Tool[];
  tool_choice?: "auto" | "required" | "none";
  seed?: number;
  stop?: string[];
  /** Enable read-only file access tools for this request.
   * CLI providers: switch to read-only tool mode.
   * API providers: include file-access tool definitions. */
  fileAccess?: boolean;
  /** Enable web lookup tools (WebSearch/WebFetch) so the worker can VERIFY citations
   * instead of recalling them. Claude CLI only (other providers ignore). */
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
