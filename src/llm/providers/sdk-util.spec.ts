/**
 * Unit tests for sdk-util — shared response/error helpers for the agent-SDK providers.
 */

import { describe, it, expect } from "bun:test";
import { buildSdkResponse, toSdkError } from "./sdk-util";
import { LLMClientError } from "../errors";

describe("buildSdkResponse", () => {
  it("wraps the text as the assistant message content", () => {
    const response = buildSdkResponse("Hello world", "anthropic/claude-sonnet-4.6");
    expect(response.choices[0]!.message.content).toBe("Hello world");
    expect(response.choices[0]!.message.role).toBe("assistant");
    expect(response.choices[0]!.finish_reason).toBe("stop");
  });

  it("handles empty text (boundary)", () => {
    const response = buildSdkResponse("", "anthropic/claude-sonnet-4.6");
    expect(response.choices[0]!.message.content).toBe("");
  });

  it("sets model to the originalModel argument verbatim", () => {
    const response = buildSdkResponse("hi", "openai/gpt-5.5");
    expect(response.model).toBe("openai/gpt-5.5");
  });

  it("omits usage when not provided", () => {
    const response = buildSdkResponse("hi", "m/a");
    expect(response.usage).toBeUndefined();
  });

  it("maps usage.input_tokens/output_tokens into prompt/completion/total tokens", () => {
    const response = buildSdkResponse("hi", "m/a", { input_tokens: 10, output_tokens: 20 });
    expect(response.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 });
  });

  it("defaults missing input_tokens/output_tokens to 0 within a present usage object (boundary)", () => {
    const response = buildSdkResponse("hi", "m/a", {});
    expect(response.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  it("omits sessionId when not provided", () => {
    const response = buildSdkResponse("hi", "m/a");
    expect(response.sessionId).toBeUndefined();
  });

  it("includes sessionId when provided", () => {
    const response = buildSdkResponse("hi", "m/a", undefined, "session-123");
    expect(response.sessionId).toBe("session-123");
  });
});

describe("toSdkError", () => {
  it("returns an existing LLMClientError unchanged (identity), ignoring vendor", () => {
    const original = new LLMClientError(429, "rate limited", "rate_limit");
    const result = toSdkError(original, "codex");
    expect(result).toBe(original);
  });

  it("wraps a generic Error with the vendor name and default status 500", () => {
    const result = toSdkError(new Error("boom"), "codex");
    expect(result).toBeInstanceOf(LLMClientError);
    expect(result.status).toBe(500);
    expect(result.type).toBe("sdk_error");
    expect(result.message).toBe("codex agent SDK error: boom");
  });

  it("wraps a non-Error thrown value using String(error)", () => {
    const result = toSdkError("plain string failure", "claude");
    expect(result.message).toBe("claude agent SDK error: plain string failure");
    expect(result.status).toBe(500);
  });

  it("uses a duck-typed .status property from an Error-like value when present", () => {
    class HttpError extends Error {
      status = 503;
    }
    const result = toSdkError(new HttpError("unavailable"), "gemini");
    expect(result.status).toBe(503);
    expect(result.message).toBe("gemini agent SDK error: unavailable");
  });
});
