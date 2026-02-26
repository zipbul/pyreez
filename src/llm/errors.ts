/**
 * LLM client error types.
 * Shared across all provider implementations.
 */

export class LLMClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly type?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LLMClientError";
  }
}

/**
 * Parse an HTTP error response into an LLMClientError.
 * Handles OpenAI-format JSON errors, raw text, rate limits, and Retry-After headers.
 */
export async function parseHttpError(response: Response): Promise<LLMClientError> {
  const retryAfterHeader = response.headers.get("Retry-After");
  const retryAfterSec = retryAfterHeader
    ? parseInt(retryAfterHeader, 10)
    : NaN;
  const retryAfterMs = Number.isFinite(retryAfterSec)
    ? retryAfterSec * 1000
    : undefined;

  const errorBody = await response.text();
  let errorMessage: string;
  let errorType: string | undefined;

  try {
    const parsed = JSON.parse(errorBody) as {
      error?: { message?: string; type?: string };
      message?: string;
    };
    errorMessage =
      parsed.error?.message ?? parsed.message ?? errorBody;
    errorType = parsed.error?.type;
  } catch {
    errorMessage = errorBody || `HTTP ${response.status}`;
  }

  if (response.status === 429) {
    const retryPart = retryAfterMs
      ? ` Retry after ${retryAfterMs / 1000}s.`
      : "";
    errorMessage = `Rate limit exceeded.${retryPart}`;
    errorType = errorType ?? "rate_limit_error";
  }

  return new LLMClientError(
    response.status,
    errorMessage,
    errorType,
    retryAfterMs,
  );
}
