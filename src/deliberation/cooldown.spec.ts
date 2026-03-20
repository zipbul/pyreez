/**
 * Unit tests for CooldownManager (session-level permanent exclusion).
 */

import { describe, it, expect } from "bun:test";
import { createCooldownManager, classifyError, normalizeErrorMessage, isRetryableError } from "./cooldown";
import { LLMClientError } from "../llm/errors";

describe("createCooldownManager", () => {
  // -- HP: basic cooldown --

  it("should return true for model on cooldown when checked immediately", () => {
    const cm = createCooldownManager();
    cm.add("openai/gpt-4.1", "rate limit");
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(true);
  });

  it("should remain on cooldown permanently within session (no TTL expiry)", () => {
    const cm = createCooldownManager();
    cm.add("openai/gpt-4.1", "error");
    // Session-level: stays on cooldown regardless of time
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(true);
  });

  it("should return active model IDs from getCooledDownIds", () => {
    const cm = createCooldownManager();
    cm.add("openai/gpt-4.1", "error");
    cm.add("anthropic/claude-opus-4.6", "timeout");
    const ids = cm.getCooledDownIds();
    expect(ids.has("openai/gpt-4.1")).toBe(true);
    expect(ids.has("anthropic/claude-opus-4.6")).toBe(true);
    expect(ids.size).toBe(2);
  });

  // -- NE: model not present --

  it("should return false for model never added", () => {
    const cm = createCooldownManager();
    expect(cm.isOnCooldown("nonexistent/model")).toBe(false);
  });

  it("should return empty set when no models on cooldown", () => {
    const cm = createCooldownManager();
    expect(cm.getCooledDownIds().size).toBe(0);
  });

  // -- ED: boundary --

  it("should increment failCount when adding same model twice", () => {
    const cm = createCooldownManager();
    cm.add("openai/gpt-4.1", "first error");
    expect(cm.getEntry("openai/gpt-4.1")?.failCount).toBe(1);

    cm.add("openai/gpt-4.1", "second error");
    expect(cm.getEntry("openai/gpt-4.1")?.failCount).toBe(2);
  });

  // -- CO: multiple models --

  it("should track multiple models independently", () => {
    const cm = createCooldownManager();
    cm.add("openai/gpt-4.1", "error");
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(true);
    expect(cm.isOnCooldown("anthropic/claude-opus-4.6")).toBe(false);
  });

  // -- ST: state transition --

  it("should transition from active to empty after clear", () => {
    const cm = createCooldownManager();
    cm.add("openai/gpt-4.1", "error");
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(true);
    cm.clear();
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(false);
    expect(cm.getCooledDownIds().size).toBe(0);
  });

  // -- Error-type tracking --

  it("should store error type in entry", () => {
    const cm = createCooldownManager();
    cm.add("model-a", "rate limit hit", "rate_limit");
    cm.add("model-b", "internal server error", "server_error");
    const entryA = cm.getEntry("model-a");
    const entryB = cm.getEntry("model-b");
    expect(entryA?.errorType).toBe("rate_limit");
    expect(entryB?.errorType).toBe("server_error");
  });

  // -- Provider-level cooldown --

  it("should cool down all models from same provider via addProvider", () => {
    const cm = createCooldownManager();
    // Provider-level cooldown triggered by a rate limit
    cm.addProvider("openai/gpt-4.1", "429 spending cap");

    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(true);
    // Untracked model from same provider should also be cooled
    expect(cm.isOnCooldown("openai/o3")).toBe(true);
    // Different provider should not be affected
    expect(cm.isOnCooldown("anthropic/claude-opus-4.6")).toBe(false);
  });

  // -- getEntry --

  it("should return undefined for non-existent entries", () => {
    const cm = createCooldownManager();
    expect(cm.getEntry("nonexistent")).toBeUndefined();
  });

  it("should return entry with correct fields", () => {
    const cm = createCooldownManager();
    cm.add("model-a", "auth failure", "auth_error");
    const entry = cm.getEntry("model-a");
    expect(entry).toBeDefined();
    expect(entry!.modelId).toBe("model-a");
    expect(entry!.reason).toBe("auth failure");
    expect(entry!.errorType).toBe("auth_error");
    expect(entry!.failCount).toBe(1);
  });

  it("should synthesize entry for provider-level cooldown on untracked model", () => {
    const cm = createCooldownManager();
    cm.addProvider("openai/gpt-4.1", "spending cap");
    const entry = cm.getEntry("openai/o3");
    expect(entry).toBeDefined();
    expect(entry!.errorType).toBe("rate_limit");
    expect(entry!.reason).toContain("provider cooldown");
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

describe("cooldown persistence (serialize/restore)", () => {
  it("should serialize and restore model cooldowns", () => {
    const cm1 = createCooldownManager();
    cm1.add("openai/gpt-4.1", "rate limit", "rate_limit");
    cm1.add("anthropic/claude-opus-4.6", "timeout", "timeout");

    const state = cm1.serialize();

    const cm2 = createCooldownManager();
    cm2.restore(state);

    expect(cm2.isOnCooldown("openai/gpt-4.1")).toBe(true);
    expect(cm2.isOnCooldown("anthropic/claude-opus-4.6")).toBe(true);
    expect(cm2.getEntry("openai/gpt-4.1")?.errorType).toBe("rate_limit");
    expect(cm2.getEntry("anthropic/claude-opus-4.6")?.errorType).toBe("timeout");
  });

  it("should serialize and restore provider cooldowns", () => {
    const cm1 = createCooldownManager();
    cm1.addProvider("google/gemini-2.5-pro", "spending cap");

    const state = cm1.serialize();

    const cm2 = createCooldownManager();
    cm2.restore(state);

    expect(cm2.isOnCooldown("google/gemini-2.5-pro")).toBe(true);
    expect(cm2.isOnCooldown("google/other-model")).toBe(true); // provider-level
  });

  it("should ignore expired state (older than maxAgeMs)", () => {
    const cm1 = createCooldownManager();
    cm1.add("openai/gpt-4.1", "rate limit", "rate_limit");
    const state = cm1.serialize();
    // Artificially age the state
    (state as any).savedAt = Date.now() - 7_200_000; // 2 hours ago

    const cm2 = createCooldownManager();
    cm2.restore(state, 3_600_000); // 1 hour max age

    expect(cm2.isOnCooldown("openai/gpt-4.1")).toBe(false);
  });

  it("should preserve failCount across sessions", () => {
    const cm1 = createCooldownManager();
    cm1.add("model-a", "first", "unknown");
    cm1.add("model-a", "second", "unknown");
    expect(cm1.getEntry("model-a")?.failCount).toBe(2);

    const state = cm1.serialize();
    const cm2 = createCooldownManager();
    cm2.restore(state);

    expect(cm2.getEntry("model-a")?.failCount).toBe(2);
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
