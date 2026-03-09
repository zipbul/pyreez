/**
 * Unit tests for task-nature.ts — TaskNature resolution.
 *
 * SUT: resolveTaskNature
 */

import { describe, it, expect } from "bun:test";
import { resolveTaskNature } from "./task-nature";

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
