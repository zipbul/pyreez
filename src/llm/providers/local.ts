/**
 * Local LLM provider.
 * Connects to any OpenAI-compatible local endpoint at /v1/chat/completions.
 * Works with Docker Model Runner, Ollama, LM Studio, vLLM, llama.cpp, etc.
 * Cost is $0 — runs on local hardware.
 */

import { LLMClientError } from "../errors";
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../types";

export interface LocalProviderConfig {
  baseUrl: string;
  /** Unix socket path for Docker Model Runner (e.g., /var/run/docker.sock). */
  socketPath?: string;
  /** Request timeout in milliseconds (default: 120_000 = 2 min). */
  timeoutMs?: number;
}

/** Default request timeout for local LLM inference. */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Validate that a URL is a safe local/known endpoint.
 * Blocks non-HTTP(S) protocols and cloud metadata endpoints (SSRF defense).
 */
export function validateBaseUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid local LLM baseUrl: ${raw}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Local LLM baseUrl must use http or https, got: ${parsed.protocol}`);
  }

  const host = parsed.hostname;
  if (host === "169.254.169.254" || host === "metadata.google.internal") {
    throw new Error(`Local LLM baseUrl points to a blocked metadata endpoint: ${host}`);
  }
}

/**
 * Convert pyreez model ID to local model name.
 * "local/qwen3-coder" → "qwen3-coder"
 */
export function toLocalModelId(pyreezId: string): string {
  return pyreezId.startsWith("local/")
    ? pyreezId.slice("local/".length)
    : pyreezId;
}

export class LocalProvider implements LLMProvider {
  readonly name = "local" as const;
  private readonly baseUrl: string;
  private readonly socketPath: string | undefined;
  private readonly timeoutMs: number;

  constructor(config: LocalProviderConfig) {
    if (!config.baseUrl) {
      throw new Error("baseUrl is required");
    }
    validateBaseUrl(config.baseUrl);
    // Normalize: remove trailing slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.socketPath = config.socketPath;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;

    const body = {
      model: toLocalModelId(request.model),
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content ?? "",
      })),
      temperature: request.temperature,
      top_p: request.top_p,
      max_tokens: request.max_tokens,
      stream: false,
      stop: request.stop,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      const fetchInit: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      };
      // Bun-native Unix socket support for Docker Model Runner
      if (this.socketPath) {
        (fetchInit as RequestInit & { unix: string }).unix = this.socketPath;
      }
      response = await fetch(url, fetchInit);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new LLMClientError(
          504,
          `Local LLM request timed out after ${this.timeoutMs}ms`,
          "timeout_error",
        );
      }
      throw new LLMClientError(
        503,
        `Local LLM connection failed: ${error instanceof Error ? error.message : String(error)}`,
        "connection_error",
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new LLMClientError(
        response.status,
        `Local LLM error: ${text || response.statusText}`,
        response.status === 429 ? "rate_limit_error" : undefined,
      );
    }

    const data = await response.json() as ChatCompletionResponse;
    return data;
  }
}
