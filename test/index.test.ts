/**
 * Integration tests for src/index.ts — provider filtering + engine wiring.
 */

import { describe, it, expect } from "bun:test";
import { filterModelsByProviders } from "../src/index";
import { ModelRegistry } from "../src/model/registry";
import type { LLMProvider, ChatCompletionRequest, ChatCompletionResponse } from "../src/llm/types";

function fakeProvider(name: string): LLMProvider {
  return {
    name: name as LLMProvider["name"],
    chat: async (_req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
      throw new Error("not implemented");
    },
  };
}

describe("filterModelsByProviders", () => {
  const registry = new ModelRegistry();

  it("should return only models from configured providers", () => {
    const providers = [fakeProvider("anthropic"), fakeProvider("google")];
    const { modelIds, warnings } = filterModelsByProviders(registry, providers);

    expect(modelIds.length).toBeGreaterThan(0);
    expect(warnings).toHaveLength(0);

    // Every returned model should be from anthropic or google
    for (const id of modelIds) {
      const provider = id.split("/")[0]!;
      expect(["anthropic", "google"]).toContain(provider);
    }
  });

  it("should exclude unconfigured provider models", () => {
    const providers = [fakeProvider("anthropic")];
    const { modelIds } = filterModelsByProviders(registry, providers);

    // Should not contain any google/openai/deepseek/xai models
    for (const id of modelIds) {
      expect(id.startsWith("anthropic/")).toBe(true);
    }
  });

  it("should warn when no models match", () => {
    const providers = [fakeProvider("nonexistent")];
    const { modelIds, warnings } = filterModelsByProviders(registry, providers);

    expect(modelIds).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("No models match");
  });

  it("should handle empty providers array", () => {
    const { modelIds, warnings } = filterModelsByProviders(registry, []);

    expect(modelIds).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("should include local models when local provider is configured", () => {
    const providers = [fakeProvider("local")];
    const { modelIds } = filterModelsByProviders(registry, providers);

    expect(modelIds.length).toBeGreaterThan(0);
    for (const id of modelIds) {
      expect(id.startsWith("local/")).toBe(true);
    }
  });

  it("should only return available models (not unavailable)", () => {
    const providers = [fakeProvider("anthropic"), fakeProvider("google"), fakeProvider("openai")];
    const { modelIds } = filterModelsByProviders(registry, providers);

    const allAvailable = registry.getAvailable();
    const allAvailableIds = new Set(allAvailable.map((m) => m.id));

    // Every returned model should be in the available set
    for (const id of modelIds) {
      expect(allAvailableIds.has(id)).toBe(true);
    }
  });

  it("should produce disjoint sets for different providers", () => {
    const anthropicOnly = filterModelsByProviders(registry, [fakeProvider("anthropic")]);
    const googleOnly = filterModelsByProviders(registry, [fakeProvider("google")]);
    const combined = filterModelsByProviders(registry, [fakeProvider("anthropic"), fakeProvider("google")]);

    // Combined should equal anthropic + google
    const expectedCount = anthropicOnly.modelIds.length + googleOnly.modelIds.length;
    expect(combined.modelIds.length).toBe(expectedCount);
  });
});
