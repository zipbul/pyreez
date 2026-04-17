/**
 * Unit tests for LLM-judge-based convergence assessment.
 */

import { describe, it, expect } from "bun:test";
import { judgeConvergence } from "./convergence-judge";

describe("judgeConvergence", () => {
  it("returns 'insufficient' for fewer than 2 responses", async () => {
    const chat = async () => ({ content: "<convergence>HIGH</convergence>" });
    const result = await judgeConvergence(
      "test/judge",
      chat,
      "task",
      [{ id: "a", content: "x" }],
    );
    expect(result.level).toBe("insufficient");
    expect(result.reasoning).toBeUndefined();
  });

  it("parses HIGH/MODERATE/DIVERSE from XML", async () => {
    const chat = async () => ({
      content: "<reasoning>All three reach the same conclusion</reasoning><convergence>HIGH</convergence>",
    });
    const result = await judgeConvergence(
      "test/judge", chat, "task",
      [{ id: "a", content: "x" }, { id: "b", content: "y" }],
    );
    expect(result.level).toBe("high");
    expect(result.reasoning).toContain("same conclusion");
  });

  it("parses MODERATE", async () => {
    const chat = async () => ({ content: "<convergence>MODERATE</convergence>" });
    const result = await judgeConvergence(
      "test/judge", chat, "task",
      [{ id: "a", content: "x" }, { id: "b", content: "y" }],
    );
    expect(result.level).toBe("moderate");
  });

  it("parses DIVERSE", async () => {
    const chat = async () => ({ content: "<convergence>DIVERSE</convergence>" });
    const result = await judgeConvergence(
      "test/judge", chat, "task",
      [{ id: "a", content: "x" }, { id: "b", content: "y" }],
    );
    expect(result.level).toBe("diverse");
  });

  it("returns 'unknown' on malformed output", async () => {
    const chat = async () => ({ content: "no tags here" });
    const result = await judgeConvergence(
      "test/judge", chat, "task",
      [{ id: "a", content: "x" }, { id: "b", content: "y" }],
    );
    expect(result.level).toBe("unknown");
  });

  it("identifies dissenter id when judge returns one", async () => {
    const chat = async () => ({
      content: "<reasoning>two converge, one outlier</reasoning><convergence>MODERATE</convergence><dissenter>outlier_b</dissenter>",
    });
    const result = await judgeConvergence(
      "test/judge", chat, "task",
      [{ id: "a", content: "yes" }, { id: "outlier_b", content: "no" }, { id: "c", content: "yes" }],
    );
    expect(result.level).toBe("moderate");
    expect(result.dissenterId).toBe("outlier_b");
  });

  it("ignores dissenter id when not present in candidates", async () => {
    const chat = async () => ({
      content: "<convergence>HIGH</convergence><dissenter>nonexistent</dissenter>",
    });
    const result = await judgeConvergence(
      "test/judge", chat, "task",
      [{ id: "a", content: "x" }, { id: "b", content: "y" }],
    );
    expect(result.dissenterId).toBeUndefined();
  });
});
