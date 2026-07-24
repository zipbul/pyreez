/**
 * Unit tests for CooldownManager (session-level permanent exclusion).
 */

import { describe, it, expect } from "bun:test";
import { createCooldownManager, classifyError, normalizeErrorMessage, isRetryableError } from "./cooldown";
import { LLMClientError } from "../llm/errors";

describe("createCooldownManager", () => {
  it("excludes a model once it is added", () => {
    const cd = createCooldownManager();
    cd.add("openai/gpt-5", "500 error");
    expect(cd.isOnCooldown("openai/gpt-5")).toBe(true);
  });

  it("does not exclude a model that was never added", () => {
    const cd = createCooldownManager();
    cd.add("openai/gpt-5", "500 error");
    expect(cd.isOnCooldown("anthropic/opus")).toBe(false);
  });

  it("stays excluded for the rest of the run — exclusion never expires", () => {
    const cd = createCooldownManager();
    cd.add("openai/gpt-5", "500 error");
    expect(cd.isOnCooldown("openai/gpt-5")).toBe(true);
    expect(cd.isOnCooldown("openai/gpt-5")).toBe(true);
  });

  it("tracks models independently", () => {
    const cd = createCooldownManager();
    cd.add("openai/gpt-5", "500");
    cd.add("xai/grok-4.5", "429");
    expect(cd.isOnCooldown("openai/gpt-5")).toBe(true);
    expect(cd.isOnCooldown("xai/grok-4.5")).toBe(true);
    expect(cd.isOnCooldown("anthropic/opus")).toBe(false);
  });

  it("addProvider takes down every model of that provider, not just the one that failed", () => {
    const cd = createCooldownManager();
    cd.addProvider("openai/gpt-5", "rate limited");
    expect(cd.isOnCooldown("openai/gpt-5")).toBe(true);
    expect(cd.isOnCooldown("openai/gpt-5-mini")).toBe(true);
    expect(cd.isOnCooldown("anthropic/opus")).toBe(false);
  });

  it("records the reason and error type on the entry", () => {
    const cd = createCooldownManager();
    cd.add("openai/gpt-5", "boom", "server_error");
    const entry = cd.getEntry("openai/gpt-5");
    expect(entry).toEqual({ modelId: "openai/gpt-5", reason: "boom", errorType: "server_error" });
  });

  it("defaults the error type to unknown when none is given", () => {
    const cd = createCooldownManager();
    cd.add("openai/gpt-5", "boom");
    expect(cd.getEntry("openai/gpt-5")?.errorType).toBe("unknown");
  });

  it("returns no entry for a model that is not excluded", () => {
    const cd = createCooldownManager();
    expect(cd.getEntry("openai/gpt-5")).toBeUndefined();
  });

  it("synthesizes an entry for a model caught by its provider's cooldown", () => {
    const cd = createCooldownManager();
    cd.addProvider("openai/gpt-5", "rate limited");
    const entry = cd.getEntry("openai/gpt-5-mini");
    expect(entry?.errorType).toBe("rate_limit");
    expect(entry?.reason).toContain("openai");
  });
});

describe("classifyError", () => {
  it("should classify LLMClientError with 429 as rate_limit", () => {
    const error = new LLMClientError(429, "Rate limit", "rate_limit_error");
    expect(classifyError(error)).toBe("rate_limit");
  });

  it("should classify LLMClientError with 401 as auth_error", () => {
    const error = new LLMClientError(401, "Unauthorized", "authentication_error");
    expect(classifyError(error)).toBe("auth_error");
  });

  it("should classify LLMClientError with 500 as server_error", () => {
    const error = new LLMClientError(500, "Internal Server Error");
    expect(classifyError(error)).toBe("server_error");
  });

  it("should classify timeout errors", () => {
    const error = new LLMClientError(408, "Timeout", "timeout_error");
    expect(classifyError(error)).toBe("timeout");
  });

  it("should walk cause chain to find LLMClientError", () => {
    const llmError = new LLMClientError(429, "Rate limit");
    const wrapper = new Error("Wrapped error");
    (wrapper as any).cause = llmError;
    expect(classifyError(wrapper)).toBe("rate_limit");
  });

  it("should classify degenerate responses", () => {
    const error = new Error("All workers produced degenerate responses");
    expect(classifyError(error)).toBe("degenerate");
  });

  it("should return unknown for unrecognized errors", () => {
    expect(classifyError(new Error("something else"))).toBe("unknown");
    expect(classifyError("string error")).toBe("unknown");
  });
});
describe("normalizeErrorMessage", () => {
  it("should extract message from OpenAI-style JSON error body", () => {
    const raw = '{"error":{"code":429,"message":"Your project has exceeded its spending cap.","status":"RESOURCE_EXHAUSTED"}}';
    expect(normalizeErrorMessage(raw)).toBe("Your project has exceeded its spending cap.");
  });

  it("should extract message from flat JSON error", () => {
    const raw = '{"message":"Model not found","code":404}';
    expect(normalizeErrorMessage(raw)).toBe("Model not found");
  });

  it("should return plain string as-is", () => {
    expect(normalizeErrorMessage("Rate limit exceeded")).toBe("Rate limit exceeded");
  });

  it("should return raw JSON if no message field found", () => {
    const raw = '{"code":500}';
    expect(normalizeErrorMessage(raw)).toBe(raw);
  });

  it("should handle empty string", () => {
    expect(normalizeErrorMessage("")).toBe("");
  });
});

describe("isRetryableError", () => {
  it("should return true for rate_limit", () => {
    expect(isRetryableError("rate_limit")).toBe(true);
  });

  it("should return true for timeout", () => {
    expect(isRetryableError("timeout")).toBe(true);
  });

  it("should return false for server_error", () => {
    expect(isRetryableError("server_error")).toBe(false);
  });

  it("should return false for auth_error", () => {
    expect(isRetryableError("auth_error")).toBe(false);
  });

  it("should return false for unknown", () => {
    expect(isRetryableError("unknown")).toBe(false);
  });

  it("should return false for degenerate", () => {
    expect(isRetryableError("degenerate")).toBe(false);
  });
});
