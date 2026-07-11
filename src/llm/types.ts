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

/** File access level for a request (undefined = none). Provider maps to its own mechanism. */
export type FileAccess = "read" | "write";

/**
 * Per-request capabilities the caller asks for. Shared by the LLM request and the deliberation-layer
 * GenerationParams so there is one source of truth. Each provider maps these to its own SDK/CLI knobs.
 */
export interface Capabilities {
  /** Web search/fetch so the worker can VERIFY claims instead of recalling them.
   *  Tri-state: true = force on, false = force no-lookup, undefined = provider default
   *  (xai defaults web ON because of its no-lookup confabulation floor; others default off). */
  webAccess?: boolean;
  /** Reasoning effort on a 1–10 scale; each provider buckets it to its own level set. */
  reasoning_effort?: number;
  /** File access level (read / write) for host-delegated review; undefined = no file access. */
  fileAccess?: FileAccess;
}

export interface ChatCompletionRequest extends Capabilities {
  model: string;
  /** Standing instructions, hoisted out of `messages` at the adapter. Each provider injects it its
   * own way: a native system param (claude, grok) or framed into the prompt (codex, gemini). */
  system?: string;
  messages: ChatMessage[];
  /** Resume an existing provider session by id instead of starting fresh (debugging/interrogate).
   * The provider re-enters the recorded session; `messages` then carries only the new turn. */
  resumeSessionId?: string;
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
  /** Provider session id for this call, captured so the session can be resumed later (interrogate).
   * undefined when the provider exposes none. */
  sessionId?: string;
}

// --- Error Types ---

export interface LLMError {
  status: number;
  message: string;
  type?: string;
}
