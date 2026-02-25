/**
 * step-types.ts unit tests — WorkflowStep vocabulary, profiles, mappings.
 */
import { describe, it, expect } from "bun:test";
import {
  ALL_STEPS,
  STEP_PROFILES,
  STEP_DOMAIN,
  STEP_KEYWORD_MAP,
  stepToDimensions,
} from "./step-types";
import type { WorkflowStep } from "./step-types";

describe("stepToDimensions", () => {
  it("should return CODE_GENERATION and REASONING for CODE step", () => {
    const dims = stepToDimensions("CODE");
    expect(dims).toContain("CODE_GENERATION");
    expect(dims).toContain("REASONING");
  });

  it("should return DEBUGGING and CODE_UNDERSTANDING for DEBUG step", () => {
    const dims = stepToDimensions("DEBUG");
    expect(dims).toContain("DEBUGGING");
    expect(dims).toContain("CODE_UNDERSTANDING");
  });

  it("should return CREATIVITY and REASONING for IDEATE step", () => {
    const dims = stepToDimensions("IDEATE");
    expect(dims).toContain("CREATIVITY");
    expect(dims).toContain("REASONING");
  });

  it("should return fallback [REASONING] for unknown step string", () => {
    const dims = stepToDimensions("UNKNOWN_STEP_XYZ");
    expect(dims).toEqual(["REASONING"]);
  });

  it("should return fallback [REASONING] for empty string", () => {
    const dims = stepToDimensions("");
    expect(dims).toEqual(["REASONING"]);
  });

  it("should return identical result on repeated calls (idempotent)", () => {
    const first = stepToDimensions("CODE");
    const second = stepToDimensions("CODE");
    expect(first).toEqual(second);
  });
});

describe("ALL_STEPS", () => {
  it("should contain exactly 20 elements", () => {
    expect(ALL_STEPS).toHaveLength(20);
  });
});

describe("STEP_PROFILES", () => {
  it("should have weights summing to ~1.0 for every step", () => {
    for (const step of ALL_STEPS) {
      const profile = STEP_PROFILES[step];
      const sum = Object.values(profile).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 2);
    }
  });

  it("should have an entry for every step in ALL_STEPS", () => {
    for (const step of ALL_STEPS) {
      expect(STEP_PROFILES[step]).toBeDefined();
      expect(Object.keys(STEP_PROFILES[step]).length).toBeGreaterThan(0);
    }
  });
});

describe("STEP_DOMAIN", () => {
  it("should have an entry for every step in ALL_STEPS", () => {
    for (const step of ALL_STEPS) {
      expect(STEP_DOMAIN[step]).toBeDefined();
      expect(STEP_DOMAIN[step].length).toBeGreaterThan(0);
    }
  });
});

describe("STEP_KEYWORD_MAP", () => {
  it("should cover at least 15 steps", () => {
    const coveredSteps = new Set(STEP_KEYWORD_MAP.map(([step]) => step));
    expect(coveredSteps.size).toBeGreaterThanOrEqual(15);
  });
});
