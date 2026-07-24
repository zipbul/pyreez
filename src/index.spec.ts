/**
 * Unit tests for filterModelsByProviders — provider-based model filtering.
 */

import { describe, it, expect } from "bun:test";
import { filterModelsByProviders } from "./index";
import type { RegistryLike } from "./model/discovered-registry";
import type { ModelInfo } from "./model/types";
import type { LLMProvider, ChatCompletionRequest, ChatCompletionResponse } from "./llm/types";

function fakeProvider(name: string): LLMProvider {
  return {
    name: name as LLMProvider["name"],
    capabilities: { web: true, effort: true, fileAccess: true },
    chat: async (_req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
      throw new Error("not implemented");
    },
  };
}

function model(id: string, provider: ModelInfo["provider"]): ModelInfo {
  return { id, provider };
}

// Representative multi-provider set (the registry is injected — no on-disk catalog to seed from).
function fixtureRegistry(): RegistryLike {
  const models = [
    model("anthropic/opus", "anthropic"),
    model("anthropic/haiku", "anthropic"),
    model("google/gemini", "google"),
    model("openai/gpt", "openai"),
    model("xai/grok", "xai"),
  ];
  return {
    getById: (id: string) => models.find((m) => m.id === id),
    getAvailable: () => models,
    buildProviderMap: () => new Map(models.map((m) => [m.id, m.provider])),
  };
}

describe("filterModelsByProviders", () => {
  it("includes models whose provider is configured", () => {
    const registry = fixtureRegistry();
    const providers = [fakeProvider("anthropic"), fakeProvider("google")];
    const { modelIds, warnings } = filterModelsByProviders(registry, providers);

    expect(warnings).toHaveLength(0);
    expect(modelIds.sort()).toEqual(["anthropic/haiku", "anthropic/opus", "google/gemini"].sort());
  });

  it("excludes models whose provider is not configured", () => {
    const registry = fixtureRegistry();
    const providers = [fakeProvider("anthropic")];
    const { modelIds } = filterModelsByProviders(registry, providers);

    for (const id of modelIds) {
      expect(id.startsWith("anthropic/")).toBe(true);
    }
  });

  it("warns when no configured provider matches any model", () => {
    const registry = fixtureRegistry();
    const { modelIds, warnings } = filterModelsByProviders(registry, [fakeProvider("nonexistent")]);

    expect(modelIds).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("No models match");
  });

  it("warns and returns empty for an empty providers array (boundary)", () => {
    const registry = fixtureRegistry();
    const { modelIds, warnings } = filterModelsByProviders(registry, []);

    expect(modelIds).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("produces disjoint, additive results across independent provider sets", () => {
    const registry = fixtureRegistry();
    const anthropicOnly = filterModelsByProviders(registry, [fakeProvider("anthropic")]);
    const googleOnly = filterModelsByProviders(registry, [fakeProvider("google")]);
    const combined = filterModelsByProviders(registry, [fakeProvider("anthropic"), fakeProvider("google")]);

    expect(combined.modelIds.length).toBe(anthropicOnly.modelIds.length + googleOnly.modelIds.length);
  });
});
