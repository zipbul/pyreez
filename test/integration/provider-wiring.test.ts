/**
 * Integration test — Provider wiring: buildProviders -> ProviderRegistry -> createChatAdapter.
 *
 * SUT boundary (real implementations):
 *   llm/providers/index.ts (buildProviders — actually constructs ClaudeAgentProvider,
 *   GeminiCliProvider, CodexSdkProvider, GrokCliProvider) + llm/registry.ts (ProviderRegistry:
 *   model-to-provider routing, prefix fallback) + llm/capabilities.ts (gateCapabilities) +
 *   deliberation/wire.ts (createChatAdapter).
 *
 * Outside SUT (test-doubled):
 *   each real provider instance's `.chat()` method only (spyOn on the instance — no module
 *   mocking, so this cannot leak into other test files). Construction is real and side-effect-free
 *   (verified: resolves local CLI/SDK paths, makes no network call) — only `.chat()` would ever
 *   place a real, billable call, and that's exactly what's stubbed here.
 */

import { describe, it, expect, spyOn } from "bun:test";
import { buildProviders } from "../../src/llm/providers";
import { ProviderRegistry } from "../../src/llm/registry";
import { createChatAdapter } from "../../src/deliberation/wire";
import type { ChatCompletionRequest, ChatCompletionResponse, ProviderName } from "../../src/llm/types";

function completion(content: string): ChatCompletionResponse {
  return { content,
  };
}

/** All 4 providers constructed for real (no keys: each CLI/SDK authenticates itself; chat is stubbed). */
function buildAllProviders() {
  return buildProviders();
}

describe("Provider wiring — buildProviders through ProviderRegistry to createChatAdapter", () => {
  it("routes a request to the provider registered for its exact model id", async () => {
    const providers = buildAllProviders();
    const claude = providers.find((p) => p.name === "anthropic")!;
    const chatSpy = spyOn(claude, "chat").mockImplementation(async (_req) => completion("claude reply"));

    const modelProviderMap = new Map<string, ProviderName>([["custom-alias", "anthropic"]]);
    const registry = new ProviderRegistry(providers, modelProviderMap);
    const adapter = createChatAdapter((req: ChatCompletionRequest) => registry.chat(req));

    const result = await adapter("custom-alias", [{ role: "user", content: "hi" }]);

    expect(result.content).toBe("claude reply");
    expect(chatSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the id's provider prefix when the id is not in the explicit map", async () => {
    const providers = buildAllProviders();
    const codex = providers.find((p) => p.name === "openai")!;
    const chatSpy = spyOn(codex, "chat").mockImplementation(async (_req) => completion("codex reply"));

    // Empty map — "openai/gpt-6" must resolve via prefix, not an explicit entry.
    const registry = new ProviderRegistry(providers, new Map());
    const adapter = createChatAdapter((req: ChatCompletionRequest) => registry.chat(req));

    const result = await adapter("openai/gpt-6", [{ role: "user", content: "hi" }]);

    expect(result.content).toBe("codex reply");
    expect(chatSpy).toHaveBeenCalledTimes(1);
  });

  it("throws Unknown model when neither the map nor a configured prefix resolves a provider", async () => {
    const providers = buildAllProviders();
    const registry = new ProviderRegistry(providers, new Map());
    const adapter = createChatAdapter((req: ChatCompletionRequest) => registry.chat(req));

    await expect(
      adapter("unknownvendor/some-model", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow(/Unknown model/);
  });

  it("throws provider-not-configured when the map names a provider that was never constructed", async () => {
    // buildProviders() always registers the four CLI/SDK providers, so the only way to name an
    // unconstructed one is a registry built from a narrower provider list.
    const [claudeOnly] = buildProviders();
    const modelProviderMap = new Map<string, ProviderName>([["custom-alias", "xai"]]);
    const registry = new ProviderRegistry([claudeOnly!], modelProviderMap);
    const adapter = createChatAdapter((req: ChatCompletionRequest) => registry.chat(req));

    await expect(
      adapter("custom-alias", [{ role: "user", content: "hi" }]),
    ).rejects.toThrow(/not configured/);
  });

  it("propagates webAccess and fileAccess unmodified to a provider that supports both", async () => {
    const providers = buildAllProviders();
    const claude = providers.find((p) => p.name === "anthropic")!; // capabilities: web+fileAccess+effort all true
    const chatSpy = spyOn(claude, "chat").mockImplementation(async (_req) => completion("ok"));

    const registry = new ProviderRegistry(providers, new Map());
    const adapter = createChatAdapter((req: ChatCompletionRequest) => registry.chat(req));

    await adapter("anthropic/claude-x", [{ role: "user", content: "hi" }], { webAccess: true, fileAccess: "read" });

    const receivedRequest = chatSpy.mock.calls[0]![0];
    expect(receivedRequest.webAccess).toBe(true);
    expect(receivedRequest.fileAccess).toBe("read");
  });

  it("strips reasoning_effort for a provider that does not support it (soft-gated)", async () => {
    const providers = buildAllProviders();
    const gemini = providers.find((p) => p.name === "google")!; // capabilities.effort === false
    const chatSpy = spyOn(gemini, "chat").mockImplementation(async (_req) => completion("ok"));

    const registry = new ProviderRegistry(providers, new Map());
    const adapter = createChatAdapter((req: ChatCompletionRequest) => registry.chat(req));

    await adapter("google/gemini-x", [{ role: "user", content: "hi" }], { reasoning_effort: 8 });

    const receivedRequest = chatSpy.mock.calls[0]![0];
    expect("reasoning_effort" in receivedRequest).toBe(false);
  });

  it("keeps reasoning_effort for a provider that supports it", async () => {
    const providers = buildAllProviders();
    const claude = providers.find((p) => p.name === "anthropic")!; // capabilities.effort === true
    const chatSpy = spyOn(claude, "chat").mockImplementation(async (_req) => completion("ok"));

    const registry = new ProviderRegistry(providers, new Map());
    const adapter = createChatAdapter((req: ChatCompletionRequest) => registry.chat(req));

    await adapter("anthropic/claude-x", [{ role: "user", content: "hi" }], { reasoning_effort: 8 });

    const receivedRequest = chatSpy.mock.calls[0]![0];
    expect(receivedRequest.reasoning_effort).toBe(8);
  });
});
