/**
 * Unit tests for cli-anonymize — CLI output-boundary anonymization (P5, v5 §1.5).
 * Pure functions only; ModelLabeler's statefulness is exercised through repeated labelOf() calls.
 */

import { describe, it, expect } from "bun:test";
import { ModelLabeler, anonymizeModelFields, nextLabel } from "./cli-anonymize";

describe("nextLabel", () => {
  it("labels a team member by its position in the team array", () => {
    expect(nextLabel(["openai/a", "xai/b"], new Map(), "xai/b")).toBe("worker-1");
  });

  it("labels a model outside the team as fallback-0 when none are assigned yet", () => {
    expect(nextLabel(["openai/a"], new Map(), "google/c")).toBe("fallback-0");
  });

  it("increments the fallback counter based on how many fallback labels are already assigned", () => {
    const assigned = new Map([["google/c", "fallback-0"]]);
    expect(nextLabel(["openai/a"], assigned, "xai/d")).toBe("fallback-1");
  });

  it("does not let an already-assigned model's label change on a later call", () => {
    const assigned = new Map([["google/c", "fallback-0"]]);
    // Even though "google/c" is not in the team, it already has a label -- must be returned as-is.
    expect(nextLabel(["openai/a"], assigned, "google/c")).toBe("fallback-0");
  });

  it("prefers the existing assignment over team position (team membership only matters on first sight)", () => {
    const assigned = new Map([["openai/a", "worker-0"]]);
    expect(nextLabel(["openai/a"], assigned, "openai/a")).toBe("worker-0");
  });
});

describe("ModelLabeler", () => {
  it("returns the same label for the same model across repeated calls", () => {
    const labeler = new ModelLabeler(["openai/a", "xai/b"]);
    expect(labeler.labelOf("openai/a")).toBe("worker-0");
    expect(labeler.labelOf("xai/b")).toBe("worker-1");
    expect(labeler.labelOf("openai/a")).toBe("worker-0");
  });

  it("assigns fallback labels in first-seen order and keeps them stable across calls", () => {
    const labeler = new ModelLabeler(["openai/a"]);
    expect(labeler.labelOf("google/c")).toBe("fallback-0");
    expect(labeler.labelOf("xai/d")).toBe("fallback-1");
    expect(labeler.labelOf("google/c")).toBe("fallback-0"); // stable, not reassigned
  });

  it("never emits a real model name once a label has been assigned", () => {
    const labeler = new ModelLabeler(["openai/a"]);
    const seen = new Set([labeler.labelOf("openai/a"), labeler.labelOf("google/c")]);
    expect([...seen].some((l) => l.includes("openai") || l.includes("google"))).toBe(false);
  });
});

describe("anonymizeModelFields", () => {
  const team = ["openai/a", "xai/b"];
  const labelOf = (m: string) => new ModelLabeler(team).labelOf(m);

  it("relabels modelsUsed", () => {
    const out = anonymizeModelFields({ modelsUsed: ["openai/a", "xai/b"] }, labelOf);
    expect(out.modelsUsed).toEqual(["worker-0", "worker-1"]);
  });

  it("relabels rounds[].responses[].model and preserves other response fields", () => {
    const out = anonymizeModelFields(
      {
        rounds: [
          {
            number: 1,
            protocol: "shared_convergence" as const,
            responses: [{ model: "openai/a", content: "hi", workerIndex: 0, confidence: "high" as const }],
          },
        ],
      },
      labelOf,
    );
    expect(out.rounds![0]!.responses![0]).toEqual({ model: "worker-0", content: "hi", workerIndex: 0, confidence: "high" });
  });

  it("relabels rounds[].failedWorkers[].model", () => {
    const out = anonymizeModelFields(
      {
        rounds: [
          {
            number: 1,
            protocol: "shared_convergence" as const,
            responses: [],
            failedWorkers: [{ model: "google/cold", error: "timeout" }],
          },
        ],
      },
      labelOf,
    );
    expect(out.rounds![0]!.failedWorkers![0]!.model).toBe("fallback-0");
    expect(out.rounds![0]!.failedWorkers![0]!.error).toBe("timeout");
  });

  it("relabels modelSwaps original/replacement, leaving replacement absent when undefined", () => {
    const out = anonymizeModelFields(
      { modelSwaps: [{ original: "openai/a", replacement: "google/cold", round: 1, error: "down" }] },
      labelOf,
    );
    expect(out.modelSwaps![0]).toMatchObject({ original: "worker-0", replacement: "fallback-0", round: 1, error: "down" });
  });

  it("leaves modelSwaps[].replacement undefined untouched (pool exhausted case)", () => {
    const swap: { original: string; replacement?: string; round: number; error: string } = {
      original: "openai/a",
      round: 1,
      error: "no fallback",
    };
    const out = anonymizeModelFields({ modelSwaps: [swap] }, labelOf);
    expect(out.modelSwaps![0]!.replacement).toBeUndefined();
  });

  it("relabels degradation.lostSlots[].model (success payload shape)", () => {
    const out = anonymizeModelFields(
      { degradation: { originalTeamSize: 2, activeTeamSize: 1, lostSlots: [{ model: "xai/b", reason: "cooldown" }] } },
      labelOf,
    );
    expect(out.degradation!.lostSlots[0]).toEqual({ model: "worker-1", reason: "cooldown" });
  });

  it("relabels a top-level lostSlots field (TeamDegradedError's flattened error-JSON shape)", () => {
    const out = anonymizeModelFields(
      { error: "Team degraded", lostSlots: [{ model: "xai/b", reason: "cooldown" }] },
      labelOf,
    );
    expect(out.lostSlots![0]).toEqual({ model: "worker-1", reason: "cooldown" });
    expect(out.error).toBe("Team degraded");
  });

  it("passes through fields with no known model identity unchanged", () => {
    const errorPayload = { code: "NO_MODELS_AVAILABLE", remediation: ["do X"] };
    const out = anonymizeModelFields(errorPayload, labelOf);
    expect(out).toEqual(errorPayload);
  });

  it("is a no-op on an object with none of the known fields present", () => {
    const out = anonymizeModelFields({}, labelOf);
    expect(out).toEqual({});
  });
});
