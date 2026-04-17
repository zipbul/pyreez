/**
 * Unit tests for evidence overlap (Aragora component).
 */

import { describe, it, expect } from "bun:test";
import { extractEvidenceTokens, computeEvidenceOverlap } from "./evidence-overlap";

describe("extractEvidenceTokens", () => {
  it("extracts URLs", () => {
    const t = extractEvidenceTokens("see https://example.com/foo and http://bar.com");
    expect(t).toContain("https://example.com/foo");
    expect(t).toContain("http://bar.com");
  });

  it("extracts arXiv ids", () => {
    const t = extractEvidenceTokens("references arXiv 2305.14251 and arXiv:2509.14034");
    expect(t).toContain("arxiv:2305.14251");
    expect(t).toContain("arxiv:2509.14034");
  });

  it("extracts venue+year (e.g. ACL 2023, NeurIPS 2023)", () => {
    const t = extractEvidenceTokens("per ACL 2023 and NeurIPS 2023 results");
    expect(t).toContain("acl:2023");
    expect(t).toContain("neurips:2023");
  });

  it("returns empty set when no recognized evidence", () => {
    const t = extractEvidenceTokens("this is just opinion text");
    expect(t.size).toBe(0);
  });
});

describe("computeEvidenceOverlap", () => {
  it("returns 1.0 when all responses cite the same evidence (jaccard)", () => {
    const responses = [
      "per arXiv 2305.14251",
      "see arXiv:2305.14251 for details",
    ];
    expect(computeEvidenceOverlap(responses)).toBe(1.0);
  });

  it("returns 0 when no overlap (or no evidence at all)", () => {
    const responses = [
      "per arXiv 2305.14251",
      "see arXiv 2509.14034",
    ];
    // jaccard = |intersect|/|union| = 0/2 = 0
    expect(computeEvidenceOverlap(responses)).toBe(0);
  });

  it("returns 0.5 for partial overlap", () => {
    const responses = [
      "per arXiv 2305.14251 and ACL 2023",
      "see arXiv 2305.14251 and NeurIPS 2023",
    ];
    // intersect: {arxiv:2305.14251} = 1
    // union: {arxiv:2305.14251, acl:2023, neurips:2023} = 3
    // jaccard = 1/3 ≈ 0.333
    expect(computeEvidenceOverlap(responses)).toBeCloseTo(1 / 3, 2);
  });

  it("returns 0 when evidence-less", () => {
    const responses = ["just an opinion", "another opinion"];
    expect(computeEvidenceOverlap(responses)).toBe(0);
  });

  it("handles single response (returns 0 — no overlap measurable)", () => {
    expect(computeEvidenceOverlap(["arXiv 2305.14251"])).toBe(0);
  });
});
