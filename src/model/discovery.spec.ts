/**
 * Unit tests for live model discovery: per-provider output parsers + the guarded runner.
 * Parsers are pure; probes are guarded so a provider failure/timeout never breaks the caller.
 */

import { describe, it, expect } from "bun:test";
import {
  parseCodexModels,
  parseGrokModels,
  runGuarded,
  discoverAll,
  type DiscoveredModel,
} from "./discovery";

describe("parseCodexModels", () => {
  it("maps codex debug-models JSON to provider-prefixed ids", () => {
    const json = JSON.stringify({
      models: [
        { slug: "gpt-5.5", display_name: "GPT-5.5", description: "Frontier model." },
        { slug: "gpt-5.4-mini", display_name: "GPT-5.4 mini", description: "Fast." },
      ],
    });
    const models = parseCodexModels(json);
    expect(models).toEqual([
      { id: "openai/gpt-5.5", provider: "openai", displayName: "GPT-5.5", description: "Frontier model." },
      { id: "openai/gpt-5.4-mini", provider: "openai", displayName: "GPT-5.4 mini", description: "Fast." },
    ] satisfies DiscoveredModel[]);
  });

  it("drops hidden/internal entries (visibility 'hide')", () => {
    const json = JSON.stringify({
      models: [
        { slug: "gpt-5.5", visibility: "list" },
        { slug: "codex-auto-review", visibility: "hide" },
      ],
    });
    expect(parseCodexModels(json).map((m) => m.id)).toEqual(["openai/gpt-5.5"]);
  });

  it("returns [] on malformed JSON", () => {
    expect(parseCodexModels("not json")).toEqual([]);
    expect(parseCodexModels("{}")).toEqual([]);
  });
});

describe("parseGrokModels", () => {
  it("extracts ids from the 'Available models' list (both - and * markers, strips (default))", () => {
    const text = [
      "You are not authenticated.",
      "",
      "Default model: grok-build",
      "",
      "Available models:",
      "  * grok-build (default)",
      "  - grok-composer-2.5-fast",
    ].join("\n");
    const models = parseGrokModels(text);
    expect(models.map((m) => m.id)).toEqual(["xai/grok-build", "xai/grok-composer-2.5-fast"]);
    expect(models[0]!.provider).toBe("xai");
  });

  it("returns [] when there is no model list", () => {
    expect(parseGrokModels("error: something")).toEqual([]);
  });

  it("stops at a non-bullet line after the list (ignores trailing footer prose)", () => {
    const text = ["Available models:", "  - grok-build", "", "Note: run `grok login` for more."].join("\n");
    expect(parseGrokModels(text).map((m) => m.id)).toEqual(["xai/grok-build"]);
  });
});

describe("runGuarded", () => {
  it("returns the value on success", async () => {
    expect(await runGuarded(async () => 42, 1000, -1)).toBe(42);
  });

  it("returns the fallback when the fn throws", async () => {
    expect(await runGuarded(async () => { throw new Error("boom"); }, 1000, "fb")).toBe("fb");
  });

  it("returns the fallback when the fn exceeds the timeout", async () => {
    const slow = () => new Promise<string>((res) => setTimeout(() => res("late"), 200));
    expect(await runGuarded(slow, 20, "fb")).toBe("fb");
  });
});

describe("discoverAll", () => {
  it("aggregates models and preserves each probe's status (failed is NOT collapsed to empty)", async () => {
    const result = await discoverAll({
      openai: async () => ({ models: [{ id: "openai/gpt-5.5", provider: "openai" }], status: "ok" }),
      xai: async () => ({ models: [], status: "empty" }),          // genuinely no models
      google: async () => ({ models: [], status: "failed" }),      // probe failed (e.g. auth) — must stay "failed"
      anthropic: async () => { throw new Error("probe blew up"); }, // thrown → failed
    });
    expect(result.models.map((m) => m.id)).toEqual(["openai/gpt-5.5"]);
    expect(result.status).toEqual({ openai: "ok", xai: "empty", google: "failed", anthropic: "failed" });
  });
});
