/**
 * Unit tests for LLMClientError and parseHttpError.
 */

import { describe, it, expect } from "bun:test";
import { LLMClientError, parseHttpError } from "./errors";

describe("LLMClientError", () => {
  it("should set all fields", () => {
    const err = new LLMClientError(429, "rate limited", "rate_limit_error", 5000);
    expect(err.status).toBe(429);
    expect(err.message).toBe("rate limited");
    expect(err.type).toBe("rate_limit_error");
    expect(err.retryAfterMs).toBe(5000);
    expect(err.name).toBe("LLMClientError");
    expect(err).toBeInstanceOf(Error);
  });

  it("should allow undefined type and retryAfterMs", () => {
    const err = new LLMClientError(500, "server error");
    expect(err.type).toBeUndefined();
    expect(err.retryAfterMs).toBeUndefined();
  });
});

describe("parseHttpError", () => {
  function makeResponse(status: number, body: string, headers?: Record<string, string>): Response {
    return new Response(body, { status, headers });
  }

  // -- Retry-After header --

  it("should parse valid Retry-After header to retryAfterMs", async () => {
    const res = makeResponse(429, "{}", { "Retry-After": "30" });
    const err = await parseHttpError(res);
    expect(err.retryAfterMs).toBe(30_000);
  });

  it("should set retryAfterMs undefined for non-numeric Retry-After", async () => {
    const res = makeResponse(429, "{}", { "Retry-After": "not-a-number" });
    const err = await parseHttpError(res);
    expect(err.retryAfterMs).toBeUndefined();
  });

  it("should set retryAfterMs undefined when no Retry-After header", async () => {
    const res = makeResponse(500, "{}");
    const err = await parseHttpError(res);
    expect(err.retryAfterMs).toBeUndefined();
  });

  // -- JSON body parsing --

  it("should extract error.message from OpenAI-format JSON", async () => {
    const body = JSON.stringify({ error: { message: "quota exceeded", type: "insufficient_quota" } });
    const res = makeResponse(403, body);
    const err = await parseHttpError(res);
    expect(err.message).toBe("quota exceeded");
    expect(err.type).toBe("insufficient_quota");
  });

  it("should extract top-level message from JSON when error.message absent", async () => {
    const body = JSON.stringify({ message: "something went wrong" });
    const res = makeResponse(500, body);
    const err = await parseHttpError(res);
    expect(err.message).toBe("something went wrong");
  });

  it("should fall back to raw body when JSON has no message fields", async () => {
    const body = JSON.stringify({ code: 500 });
    const res = makeResponse(500, body);
    const err = await parseHttpError(res);
    expect(err.message).toBe(body);
  });

  it("should use raw body for invalid JSON", async () => {
    const res = makeResponse(502, "Bad Gateway");
    const err = await parseHttpError(res);
    expect(err.message).toBe("Bad Gateway");
    expect(err.status).toBe(502);
  });

  it("should fall back to HTTP status string for empty body with invalid JSON", async () => {
    const res = makeResponse(503, "");
    const err = await parseHttpError(res);
    expect(err.message).toBe("HTTP 503");
  });

  // -- 429 handling --

  it("should override message for 429 with retryAfterMs", async () => {
    const body = JSON.stringify({ error: { message: "ignored" } });
    const res = makeResponse(429, body, { "Retry-After": "10" });
    const err = await parseHttpError(res);
    expect(err.message).toBe("Rate limit exceeded. Retry after 10s.");
    expect(err.retryAfterMs).toBe(10_000);
  });

  it("should override message for 429 without retryAfterMs", async () => {
    const res = makeResponse(429, "{}");
    const err = await parseHttpError(res);
    expect(err.message).toBe("Rate limit exceeded.");
  });

  it("should preserve existing errorType on 429", async () => {
    const body = JSON.stringify({ error: { type: "tokens_exceeded" } });
    const res = makeResponse(429, body);
    const err = await parseHttpError(res);
    expect(err.type).toBe("tokens_exceeded");
  });

  it("should default errorType to rate_limit_error on 429 when no type in body", async () => {
    const res = makeResponse(429, "{}");
    const err = await parseHttpError(res);
    expect(err.type).toBe("rate_limit_error");
  });

  // -- Non-429 --

  it("should pass through errorMessage and errorType for non-429 status", async () => {
    const body = JSON.stringify({ error: { message: "not found", type: "invalid_model" } });
    const res = makeResponse(404, body);
    const err = await parseHttpError(res);
    expect(err.status).toBe(404);
    expect(err.message).toBe("not found");
    expect(err.type).toBe("invalid_model");
  });
});
