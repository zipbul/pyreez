/**
 * Unit tests for CooldownManager.
 */

import { describe, it, expect } from "bun:test";
import { createCooldownManager, classifyError } from "./cooldown";
import { LLMClientError } from "../llm/errors";

describe("createCooldownManager", () => {
  // -- HP: basic cooldown --

  it("should return true for model on cooldown when checked immediately", () => {
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "rate limit");
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(true);
  });

  it("should return false after TTL expires", () => {
    const cm = createCooldownManager(1);
    cm.add("openai/gpt-4.1", "error", undefined, 1);
    const start = Date.now();
    while (Date.now() - start < 5) { /* wait */ }
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(false);
  });

  it("should return active model IDs from getCooledDownIds", () => {
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "error");
    cm.add("anthropic/claude-opus-4.6", "timeout");
    const ids = cm.getCooledDownIds();
    expect(ids.has("openai/gpt-4.1")).toBe(true);
    expect(ids.has("anthropic/claude-opus-4.6")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("should use custom TTL when provided to add", () => {
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "error", undefined, 1);
    const start = Date.now();
    while (Date.now() - start < 5) { /* wait */ }
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(false);
  });

  it("should use custom defaultTtl from constructor", () => {
    const cm = createCooldownManager(1);
    cm.add("openai/gpt-4.1", "error");
    const start = Date.now();
    while (Date.now() - start < 5) { /* wait */ }
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(false);
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

  it("should handle TTL of 0 as immediately expired", () => {
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "error", undefined, 0);
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(false);
  });

  it("should increment failCount when adding same model twice", () => {
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "first error");
    expect(cm.getEntry("openai/gpt-4.1")?.failCount).toBe(1);

    cm.add("openai/gpt-4.1", "second error");
    expect(cm.getEntry("openai/gpt-4.1")?.failCount).toBe(2);
  });

  it("should still be on cooldown after overwrite with long TTL", () => {
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "first error", undefined, 1);
    cm.add("openai/gpt-4.1", "second error", undefined, 60_000);
    const start = Date.now();
    while (Date.now() - start < 5) { /* wait */ }
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(true);
  });

  // -- CO: multiple models --

  it("should track multiple models independently", () => {
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "error");
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(true);
    expect(cm.isOnCooldown("anthropic/claude-opus-4.6")).toBe(false);
  });

  it("should clean expired entries during getCooledDownIds", () => {
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "error", undefined, 1);
    cm.add("anthropic/claude-opus-4.6", "error", undefined, 60_000);
    const start = Date.now();
    while (Date.now() - start < 5) { /* wait */ }
    const ids = cm.getCooledDownIds();
    expect(ids.has("openai/gpt-4.1")).toBe(false);
    expect(ids.has("anthropic/claude-opus-4.6")).toBe(true);
    expect(ids.size).toBe(1);
  });

  // -- ST: state transition --

  it("should transition from active to empty after clear", () => {
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "error");
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(true);
    cm.clear();
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(false);
    expect(cm.getCooledDownIds().size).toBe(0);
  });

  // -- Error-type-aware TTL --

  it("should apply error-type-specific TTL", () => {
    const cm = createCooldownManager();
    cm.add("model-a", "rate limit hit", "rate_limit");
    cm.add("model-b", "internal server error", "server_error");
    const entryA = cm.getEntry("model-a");
    const entryB = cm.getEntry("model-b");
    expect(entryA?.errorType).toBe("rate_limit");
    expect(entryB?.errorType).toBe("server_error");
    // server_error has longer TTL than rate_limit
    expect(entryB!.cooldownUntil).toBeGreaterThan(entryA!.cooldownUntil);
  });

  it("should escalate TTL on repeated failures", () => {
    const cm = createCooldownManager();
    cm.add("model-a", "fail 1", "server_error");
    const entry1 = cm.getEntry("model-a")!;
    const ttl1 = entry1.cooldownUntil - Date.now();

    cm.add("model-a", "fail 2", "server_error");
    const entry2 = cm.getEntry("model-a")!;
    const ttl2 = entry2.cooldownUntil - Date.now();

    expect(entry2.failCount).toBe(2);
    // TTL should roughly double (within timing tolerance)
    expect(ttl2).toBeGreaterThan(ttl1 * 1.5);
  });

  it("should cap escalation at MAX_ESCALATION_FACTOR", () => {
    const cm = createCooldownManager();
    // Add 10 times to hit the cap
    for (let i = 0; i < 10; i++) {
      cm.add("model-a", `fail ${i + 1}`, "rate_limit");
    }
    const entry = cm.getEntry("model-a")!;
    expect(entry.failCount).toBe(10);
    // TTL should not exceed base × 8 (MAX_ESCALATION_FACTOR)
    const maxExpectedTtl = 30_000 * 8; // rate_limit base * cap
    const actualTtl = entry.cooldownUntil - Date.now();
    expect(actualTtl).toBeLessThanOrEqual(maxExpectedTtl + 100); // +100ms timing tolerance
  });

  // -- Provider-level cooldown --

  it("should cool down all models from same provider via addProvider", () => {
    const cm = createCooldownManager(60_000);
    // Pre-register other models from same provider
    cm.add("openai/gpt-4.1", "tracked");
    cm.add("openai/o3", "tracked");
    cm.add("anthropic/claude-opus-4.6", "tracked");

    // Provider-level cooldown triggered by a rate limit
    cm.addProvider("openai/gpt-4.1", "429 rate limit");

    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(true);
    expect(cm.isOnCooldown("openai/o3")).toBe(true);
    // Different provider should not be affected
    expect(cm.isOnCooldown("anthropic/claude-opus-4.6")).toBe(true); // still on from initial add
  });

  // -- getEntry --

  it("should return undefined for expired or non-existent entries", () => {
    const cm = createCooldownManager();
    expect(cm.getEntry("nonexistent")).toBeUndefined();
    cm.add("model-a", "error", undefined, 0);
    expect(cm.getEntry("model-a")).toBeUndefined(); // TTL 0 = expired
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
    expect(entry!.cooldownUntil).toBeGreaterThan(Date.now());
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
