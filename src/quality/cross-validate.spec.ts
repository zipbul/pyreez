/**
 * Unit tests for cross-validation of factual claims.
 */

import { describe, it, expect, mock } from "bun:test";
import { crossValidate, type ResponseUnderReview, type CrossValidateFn } from "./cross-validate";

describe("crossValidate", () => {
  it("returns empty findings for single response (nothing to cross-check against)", async () => {
    const judge = mock(async () => ({ unsupportedClaims: [], contradictedClaims: [] }));
    const result = await crossValidate([
      { id: "a", content: "Bun is fast." },
    ], judge);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.id).toBe("a");
    expect(result.findings[0]!.unsupported).toEqual([]);
    expect(result.findings[0]!.contradicted).toEqual([]);
    expect(judge).not.toHaveBeenCalled();
  });

  it("calls judge once per response when 2+ responses present", async () => {
    const judge = mock(async () => ({ unsupportedClaims: [], contradictedClaims: [] }));
    const responses: ResponseUnderReview[] = [
      { id: "a", content: "Bun is fast." },
      { id: "b", content: "Bun has built-in TypeScript." },
      { id: "c", content: "Bun supports SQLite natively." },
    ];
    await crossValidate(responses, judge);
    expect(judge).toHaveBeenCalledTimes(3);
  });

  it("aggregates findings per response", async () => {
    const judge: CrossValidateFn = mock(async (subject) => {
      if (subject.id === "a") {
        return {
          unsupportedClaims: ["Bun was created in 2020"],
          contradictedClaims: ["Bun is slower than Node"],
        };
      }
      return { unsupportedClaims: [], contradictedClaims: [] };
    });
    const responses: ResponseUnderReview[] = [
      { id: "a", content: "Bun was created in 2020. Bun is slower than Node." },
      { id: "b", content: "Bun was released in 2021 and is faster than Node." },
    ];
    const result = await crossValidate(responses, judge);
    const a = result.findings.find((f) => f.id === "a")!;
    expect(a.unsupported).toEqual(["Bun was created in 2020"]);
    expect(a.contradicted).toEqual(["Bun is slower than Node"]);
    const b = result.findings.find((f) => f.id === "b")!;
    expect(b.unsupported).toEqual([]);
    expect(b.contradicted).toEqual([]);
  });

  it("passes the subject and the other responses to judge (excludes self)", async () => {
    const calls: { subject: string; others: string[] }[] = [];
    const judge: CrossValidateFn = async (subject, others) => {
      calls.push({ subject: subject.id, others: others.map((o) => o.id) });
      return { unsupportedClaims: [], contradictedClaims: [] };
    };
    const responses: ResponseUnderReview[] = [
      { id: "a", content: "x" },
      { id: "b", content: "y" },
      { id: "c", content: "z" },
    ];
    await crossValidate(responses, judge);
    expect(calls).toHaveLength(3);
    const callA = calls.find((c) => c.subject === "a")!;
    expect(callA.others.sort()).toEqual(["b", "c"]);
    const callB = calls.find((c) => c.subject === "b")!;
    expect(callB.others.sort()).toEqual(["a", "c"]);
  });

  it("propagates judge errors", async () => {
    const judge: CrossValidateFn = async () => {
      throw new Error("judge failed");
    };
    const responses: ResponseUnderReview[] = [
      { id: "a", content: "x" },
      { id: "b", content: "y" },
    ];
    await expect(crossValidate(responses, judge)).rejects.toThrow("judge failed");
  });
});
