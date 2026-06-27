import { describe, it, expect } from "bun:test";
import { extractProvider, providerGetsWebTools } from "./provider-util";

describe("extractProvider", () => {
  it("returns the prefix before the slash", () => {
    expect(extractProvider("anthropic/claude-opus-4.6")).toBe("anthropic");
  });

  it("returns the whole id when there is no slash", () => {
    expect(extractProvider("gpt-5")).toBe("gpt-5");
  });
});

describe("providerGetsWebTools", () => {
  it("is true for an anthropic model (claude-cli grants WebSearch/WebFetch)", () => {
    expect(providerGetsWebTools("anthropic/claude-sonnet-4.6")).toBe(true);
  });

  it("is true for an openai model (codex-sdk webSearchEnabled)", () => {
    expect(providerGetsWebTools("openai/gpt-5.4")).toBe(true);
  });

  it("is true for a google model (gemini-cli google_web_search on by default)", () => {
    expect(providerGetsWebTools("google/gemini-3.5-flash")).toBe(true);
  });

  it("is true for an xai model (grok-cli has web_search/web_fetch on by default)", () => {
    expect(providerGetsWebTools("xai/grok-4-1-fast")).toBe(true);
  });
});
