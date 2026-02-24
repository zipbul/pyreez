/**
 * Unit tests for CooldownManager.
 */

import { describe, it, expect } from "bun:test";
import { createCooldownManager } from "./cooldown";

describe("createCooldownManager", () => {
  // -- HP: basic cooldown --

  it("should return true for model on cooldown when checked immediately", () => {
    // Arrange
    const cm = createCooldownManager(60_000);

    // Act
    cm.add("openai/gpt-4.1", "rate limit");

    // Assert
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(true);
  });

  it("should return false after TTL expires", () => {
    // Arrange — use TTL of 1ms and wait
    const cm = createCooldownManager(1);
    cm.add("openai/gpt-4.1", "error");

    // Act — spin until expired
    const start = Date.now();
    while (Date.now() - start < 5) { /* wait */ }

    // Assert
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(false);
  });

  it("should return active model IDs from getCooledDownIds", () => {
    // Arrange
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "error");
    cm.add("anthropic/claude-opus-4.6", "timeout");

    // Act
    const ids = cm.getCooledDownIds();

    // Assert
    expect(ids.has("openai/gpt-4.1")).toBe(true);
    expect(ids.has("anthropic/claude-opus-4.6")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("should use custom TTL when provided to add", () => {
    // Arrange — default TTL is large, but per-add TTL is 1ms
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "error", 1);

    // Act — spin until expired
    const start = Date.now();
    while (Date.now() - start < 5) { /* wait */ }

    // Assert
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(false);
  });

  it("should use custom defaultTtl from constructor", () => {
    // Arrange — very short default TTL
    const cm = createCooldownManager(1);
    cm.add("openai/gpt-4.1", "error");

    // Act — spin until expired
    const start = Date.now();
    while (Date.now() - start < 5) { /* wait */ }

    // Assert
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(false);
  });

  // -- NE: model not present --

  it("should return false for model never added", () => {
    // Arrange
    const cm = createCooldownManager();

    // Assert
    expect(cm.isOnCooldown("nonexistent/model")).toBe(false);
  });

  it("should return empty set when no models on cooldown", () => {
    // Arrange
    const cm = createCooldownManager();

    // Assert
    expect(cm.getCooledDownIds().size).toBe(0);
  });

  // -- ED: boundary --

  it("should handle TTL of 0 as immediately expired", () => {
    // Arrange
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "error", 0);

    // Assert — TTL 0 means cooldownUntil = now, so immediately expired
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(false);
  });

  it("should overwrite entry when adding same model twice", () => {
    // Arrange — first add with short TTL, then long TTL
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "first error", 1);

    // Act — overwrite with long TTL
    cm.add("openai/gpt-4.1", "second error", 60_000);

    // Assert — should still be on cooldown (long TTL)
    const start = Date.now();
    while (Date.now() - start < 5) { /* wait */ }
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(true);
  });

  // -- CO: multiple models --

  it("should track multiple models independently", () => {
    // Arrange
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "error");

    // Assert
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(true);
    expect(cm.isOnCooldown("anthropic/claude-opus-4.6")).toBe(false);
  });

  it("should clean expired entries during getCooledDownIds", () => {
    // Arrange — one model with very short TTL, one with long
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "error", 1);
    cm.add("anthropic/claude-opus-4.6", "error", 60_000);

    // Act — wait for short TTL to expire
    const start = Date.now();
    while (Date.now() - start < 5) { /* wait */ }
    const ids = cm.getCooledDownIds();

    // Assert — only long-TTL model remains
    expect(ids.has("openai/gpt-4.1")).toBe(false);
    expect(ids.has("anthropic/claude-opus-4.6")).toBe(true);
    expect(ids.size).toBe(1);
  });

  // -- ST: state transition --

  it("should transition from active to empty after clear", () => {
    // Arrange
    const cm = createCooldownManager(60_000);
    cm.add("openai/gpt-4.1", "error");
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(true);

    // Act
    cm.clear();

    // Assert
    expect(cm.isOnCooldown("openai/gpt-4.1")).toBe(false);
    expect(cm.getCooledDownIds().size).toBe(0);
  });
});
