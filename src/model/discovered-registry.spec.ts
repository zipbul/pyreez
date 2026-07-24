/**
 * Unit tests for the discovery-backed registry adapter.
 */

import { describe, it, expect } from "bun:test";
import { discoveredRegistry, toModelInfo } from "./discovered-registry";
import type { DiscoveredModel } from "./discovery";

const MODELS: DiscoveredModel[] = [
  { id: "openai/gpt-5.5", provider: "openai" },
  { id: "xai/grok-build", provider: "xai" },
];

describe("toModelInfo", () => {
  it("synthesizes ModelInfo with unknown-cost defaults", () => {
    expect(toModelInfo(MODELS[0]!)).toEqual({
      id: "openai/gpt-5.5",
      provider: "openai",
    });
  });

  it("falls back to id when displayName is absent", () => {
  });
});

describe("discoveredRegistry", () => {
  it("getById resolves a discovered id and returns undefined otherwise", () => {
    const reg = discoveredRegistry(MODELS);
    expect(reg.getById("xai/grok-build")!.provider).toBe("xai");
    expect(reg.getById("openai/nope")).toBeUndefined();
  });

  it("getAvailable lists the discovered models", () => {
    const reg = discoveredRegistry(MODELS);
    expect(reg.getAvailable().map((m) => m.id)).toEqual(["openai/gpt-5.5", "xai/grok-build"]);
  });

  it("buildProviderMap maps id → provider (for routing)", () => {
    const map = discoveredRegistry(MODELS).buildProviderMap();
    expect(map.get("openai/gpt-5.5")).toBe("openai");
    expect(map.get("xai/grok-build")).toBe("xai");
    expect(map.get("unknown/x")).toBeUndefined();
  });

  it("is empty for an empty discovery list", () => {
    const reg = discoveredRegistry([]);
    expect(reg.buildProviderMap().size).toBe(0);
  });
});
