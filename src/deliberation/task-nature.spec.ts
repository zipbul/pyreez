/**
 * Unit tests for task-nature.ts — TaskNature resolution.
 *
 * SUT: resolveTaskNature
 */

import { describe, it, expect } from "bun:test";
import { resolveTaskNature, shouldAutoDebate } from "./task-nature";

describe("resolveTaskNature", () => {
  it("should return artifact for IMPLEMENT_FEATURE", () => {
    expect(resolveTaskNature("CODING", "IMPLEMENT_FEATURE")).toBe("artifact");
  });

  it("should return critique for CODE_REVIEW", () => {
    expect(resolveTaskNature("REVIEW", "CODE_REVIEW")).toBe("critique");
  });

  it("should return artifact for SYSTEM_DESIGN", () => {
    expect(resolveTaskNature("ARCHITECTURE", "SYSTEM_DESIGN")).toBe("artifact");
  });

  it("should return critique when both domain and taskType are undefined", () => {
    expect(resolveTaskNature(undefined, undefined)).toBe("critique");
  });

  it("should return artifact for CODING domain when taskType is undefined", () => {
    expect(resolveTaskNature("CODING", undefined)).toBe("artifact");
  });

  it("should return critique when taskType overrides domain (CODING + CODE_REVIEW)", () => {
    expect(resolveTaskNature("CODING", "CODE_REVIEW")).toBe("critique");
  });
});

describe("shouldAutoDebate", () => {
  it("should return true for complex CODE_REVIEW", () => {
    expect(shouldAutoDebate("REVIEW", "CODE_REVIEW", "complex")).toBe(true);
  });

  it("should return true for complex SECURITY_REVIEW", () => {
    expect(shouldAutoDebate("REVIEW", "SECURITY_REVIEW", "complex")).toBe(true);
  });

  it("should return true for complex CRITIQUE", () => {
    expect(shouldAutoDebate("REVIEW", "CRITIQUE", "complex")).toBe(true);
  });

  it("should return false for moderate complexity", () => {
    expect(shouldAutoDebate("REVIEW", "CODE_REVIEW", "moderate")).toBe(false);
  });

  it("should return false for simple complexity", () => {
    expect(shouldAutoDebate("REVIEW", "CODE_REVIEW", "simple")).toBe(false);
  });

  it("should return false for artifact tasks even if complex", () => {
    expect(shouldAutoDebate("CODING", "IMPLEMENT_FEATURE", "complex")).toBe(false);
  });

  it("should return false when taskType is not in debate set", () => {
    expect(shouldAutoDebate("RESEARCH", "TECH_RESEARCH", "complex")).toBe(false);
  });

  it("should return false when taskType is undefined", () => {
    expect(shouldAutoDebate("REVIEW", undefined, "complex")).toBe(false);
  });

  it("should return false for COMPARISON with complex", () => {
    expect(shouldAutoDebate("REVIEW", "COMPARISON", "complex")).toBe(true);
  });
});
