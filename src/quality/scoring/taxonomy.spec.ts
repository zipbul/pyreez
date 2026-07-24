/**
 * Unit tests for taxonomy normalization — domain 강제(고정 15종 아니면 general), subtopic kebab-case 강제.
 */

import { describe, it, expect } from "bun:test";
import { normalizeDomain, normalizeSubtopic } from "./taxonomy";
import { DOMAIN_TAXONOMY } from "./constants";

describe("normalizeDomain", () => {
  it("accepts a domain already in the fixed taxonomy", () => {
    expect(normalizeDomain("medicine")).toBe("medicine");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(normalizeDomain("  Medicine  ")).toBe("medicine");
  });

  it("falls back to general for a domain outside the taxonomy", () => {
    expect(normalizeDomain("astrology")).toBe("general");
  });

  it("accepts every fixed taxonomy entry unchanged", () => {
    for (const domain of DOMAIN_TAXONOMY) {
      expect(normalizeDomain(domain)).toBe(domain);
    }
  });
});

describe("normalizeSubtopic", () => {
  it("returns undefined when no subtopic was given", () => {
    expect(normalizeSubtopic(undefined)).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(normalizeSubtopic("")).toBeUndefined();
  });

  it("lowercases and kebab-cases a subtopic", () => {
    expect(normalizeSubtopic("Cardiac Arrhythmia")).toBe("cardiac-arrhythmia");
  });

  it("collapses non-alphanumeric runs into a single hyphen", () => {
    expect(normalizeSubtopic("token__caching!!v2")).toBe("token-caching-v2");
  });

  it("strips leading/trailing hyphens produced by normalization", () => {
    expect(normalizeSubtopic("--edge case--")).toBe("edge-case");
  });

  it("returns undefined when normalization leaves nothing (구분자만)", () => {
    expect(normalizeSubtopic("!!!")).toBeUndefined();
  });
});
