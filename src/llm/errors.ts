/**
 * LLM client error types.
 * Shared across all provider implementations.
 */

export class LLMClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly type?: string,
  ) {
    super(message);
    this.name = "LLMClientError";
  }
}

