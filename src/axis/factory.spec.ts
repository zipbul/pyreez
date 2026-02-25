/**
 * createEngine factory — config validation and wiring tests.
 */
import { describe, it, expect } from "bun:test";
import { createEngine, DEFAULT_CONFIG } from "./factory";
import { PyreezEngine } from "./engine";
import type { AxisConfig } from "./types";

describe("createEngine", () => {
  it("returns PyreezEngine instance with DEFAULT_CONFIG", () => {
    const engine = createEngine(DEFAULT_CONFIG);
    expect(engine).toBeInstanceOf(PyreezEngine);
  });

  it("throws when classifier=keyword and profiler=step-profile (R-A1 + R-B2 vocab mismatch)", () => {
    const config: AxisConfig = {
      ...DEFAULT_CONFIG,
      classifier: "keyword",
      profiler: "step-profile",
    };
    expect(() => createEngine(config)).toThrow();
  });

  it("throws when classifier=step-declare and profiler=domain-override (R-A2 + R-B1 vocab mismatch)", () => {
    const config: AxisConfig = {
      ...DEFAULT_CONFIG,
      classifier: "step-declare",
      profiler: "domain-override",
    };
    expect(() => createEngine(config)).toThrow();
  });

  it("does not throw for R-A1 + R-B3 (MoE, compatible)", () => {
    const config: AxisConfig = {
      ...DEFAULT_CONFIG,
      classifier: "keyword",
      profiler: "moe-gating",
    };
    expect(() => createEngine(config)).not.toThrow();
  });

  it("does not throw for R-A2 + R-B3 (MoE, compatible)", () => {
    const config: AxisConfig = {
      ...DEFAULT_CONFIG,
      classifier: "step-declare",
      profiler: "moe-gating",
    };
    expect(() => createEngine(config)).not.toThrow();
  });

  it("creates engine with full PLAN.md config (step-declare + step-profile + bt-step + 4strategy)", () => {
    const config: AxisConfig = {
      ...DEFAULT_CONFIG,
      scoring: "bt-step",
      classifier: "step-declare",
      profiler: "step-profile",
      selector: "4strategy",
    };
    const engine = createEngine(config);
    expect(engine).toBeInstanceOf(PyreezEngine);
  });

  it("creates engine with step-declare + moe-gating + 4strategy (cross-vocab via MoE)", () => {
    const config: AxisConfig = {
      ...DEFAULT_CONFIG,
      classifier: "step-declare",
      profiler: "moe-gating",
      selector: "4strategy",
    };
    const engine = createEngine(config);
    expect(engine).toBeInstanceOf(PyreezEngine);
  });

  it("creates engine with bt-step scoring alone (other slots default)", () => {
    const config: AxisConfig = {
      ...DEFAULT_CONFIG,
      scoring: "bt-step",
    };
    const engine = createEngine(config);
    expect(engine).toBeInstanceOf(PyreezEngine);
  });
});
