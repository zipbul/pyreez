/**
 * Unit tests for task-nature.ts — TaskNature resolution.
 *
 * SUT: resolveTaskNature
 */

import { describe, it, expect } from "bun:test";
import { resolveTaskNature } from "./task-nature";

describe("resolveTaskNature", () => {
  it("should return artifact for IMPLEMENT_FEATURE", () => {
    expect(resolveTaskNature("IMPLEMENT_FEATURE")).toBe("artifact");
  });

  it("should return critique for CODE_REVIEW", () => {
    expect(resolveTaskNature("CODE_REVIEW")).toBe("critique");
  });

  it("should return artifact for SYSTEM_DESIGN", () => {
    expect(resolveTaskNature("SYSTEM_DESIGN")).toBe("artifact");
  });

  it("should return critique when taskType is undefined", () => {
    expect(resolveTaskNature(undefined)).toBe("critique");
  });

  it("should return critique for unknown task types", () => {
    expect(resolveTaskNature("UNKNOWN_TASK")).toBe("critique");
  });
});
