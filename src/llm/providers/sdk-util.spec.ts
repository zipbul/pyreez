/**
 * Unit tests for sdk-util — shared response/error helpers for the agent-SDK providers.
 */

import { describe, it, expect } from "bun:test";
import { buildSdkResponse, toSdkError } from "./sdk-util";
import { LLMClientError } from "../errors";

describe("buildSdkResponse", () => {
  it("wraps the text as the assistant message content", () => {
    const response = buildSdkResponse("Hello world");
    expect(response.content).toBe("Hello world");
  });

  it("handles empty text (boundary)", () => {
    const response = buildSdkResponse("");
    expect(response.content).toBe("");
  });

  it("omits sessionId when not provided", () => {
    const response = buildSdkResponse("hi");
    expect(response.sessionId).toBeUndefined();
  });

  it("includes sessionId when provided", () => {
    const response = buildSdkResponse("hi", "session-123");
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
