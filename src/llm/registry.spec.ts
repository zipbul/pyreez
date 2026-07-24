/**
 * Unit tests for ProviderRegistry.
 */

import { describe, it, expect, mock } from "bun:test";
import { ProviderRegistry } from "./registry";
import { LLMClientError } from "./errors";
import type {
  LLMProvider,
  ProviderName,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "./types";

// -- Fixtures --

function makeResponse(model: string): ChatCompletionResponse {
  return { content: `Response from ${model}` };
}

function makeProvider(name: ProviderName, chatImpl?: LLMProvider["chat"]): LLMProvider {
  return {
    name,
    capabilities: { web: true, effort: true, fileAccess: true },
    chat: chatImpl ?? mock((req: ChatCompletionRequest) => Promise.resolve(makeResponse(req.model))),
  };
}

function makeProviderMap(entries: [string, ProviderName][]): ReadonlyMap<string, ProviderName> {
  return new Map(entries);
}

// -- Tests --

describe("ProviderRegistry", () => {
  it("should route to correct provider based on model-provider map", async () => {
    // Arrange
    const openai = makeProvider("openai");
    const anthropic = makeProvider("anthropic");
    const map = makeProviderMap([
      ["anthropic/claude-sonnet-4.6", "openai"],
      ["anthropic/claude-opus-4.6", "anthropic"],
    ]);
    const registry = new ProviderRegistry([openai, anthropic], map);

    // Act
      await registry.chat({
      model: "anthropic/claude-opus-4.6",
      messages: [{ role: "user", content: "hi" }],
    });

    // Assert
    expect((anthropic.chat as ReturnType<typeof mock>)).toHaveBeenCalledTimes(1);
    expect((openai.chat as ReturnType<typeof mock>)).not.toHaveBeenCalled();
  });

  it("should throw LLMClientError with 400 when model is not in map", async () => {
    // Arrange
    const openai = makeProvider("openai");
    const map = makeProviderMap([["anthropic/claude-sonnet-4.6", "openai"]]);
    const registry = new ProviderRegistry([openai], map);

    // Act & Assert
    try {
      await registry.chat({
        model: "unknown/model",
        messages: [{ role: "user", content: "hi" }],
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LLMClientError);
      const err = error as LLMClientError;
      expect(err.status).toBe(400);
      expect(err.type).toBe("unknown_model");
      expect(err.message).toContain("unknown/model");
    }
  });

  it("routes an id absent from the map by its provider prefix when that provider is configured", async () => {
    // discovered-only id: not in the map, but "openai/" names a configured provider
    const openai = makeProvider("openai");
    const registry = new ProviderRegistry([openai], makeProviderMap([]));
      await registry.chat({
      model: "openai/gpt-5.5-newly-discovered",
      messages: [{ role: "user", content: "hi" }],
    });
    expect((openai.chat as ReturnType<typeof mock>)).toHaveBeenCalledTimes(1);
  });

  it("still throws unknown_model when the prefix is not a configured provider", async () => {
    const openai = makeProvider("openai");
    const registry = new ProviderRegistry([openai], makeProviderMap([]));
    try {
      await registry.chat({ model: "xai/grok-build", messages: [{ role: "user", content: "hi" }] });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as LLMClientError).type).toBe("unknown_model");
    }
  });

  it("should throw LLMClientError with 503 when provider is not configured", async () => {
    // Arrange — map points to anthropic, but no anthropic provider registered
    const openai = makeProvider("openai");
    const map = makeProviderMap([
      ["anthropic/claude-sonnet-4.6", "openai"],
      ["anthropic/claude-opus-4.6", "anthropic"],
    ]);
    const registry = new ProviderRegistry([openai], map);

    // Act & Assert
    try {
      await registry.chat({
        model: "anthropic/claude-opus-4.6",
        messages: [{ role: "user", content: "hi" }],
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LLMClientError);
      const err = error as LLMClientError;
      expect(err.status).toBe(503);
      expect(err.type).toBe("provider_not_configured");
      expect(err.message).toContain("anthropic");
    }
  });

  it("should pass full request to provider", async () => {
    // Arrange
    const chatMock = mock((req: ChatCompletionRequest) => Promise.resolve(makeResponse(req.model)));
    const openai = makeProvider("openai", chatMock);
    const map = makeProviderMap([["anthropic/claude-sonnet-4.6", "openai"]]);
    const registry = new ProviderRegistry([openai], map);

    const messages = [
      { role: "system" as const, content: "Be helpful" },
      { role: "user" as const, content: "hi" },
    ];

    // Act
    await registry.chat({
      model: "anthropic/claude-sonnet-4.6",
      messages,
      reasoning_effort: 7,
    });

    // Assert
    const call = chatMock.mock.calls[0]![0] as ChatCompletionRequest;
    expect(call.messages).toEqual(messages);
    expect(call.reasoning_effort).toBe(7);
  });

  it("should handle multiple providers correctly", async () => {
    // Arrange
    const openai = makeProvider("openai");
    const anthropic = makeProvider("anthropic");
    const google = makeProvider("google");
    const map = makeProviderMap([
      ["anthropic/claude-sonnet-4.6", "openai"],
      ["anthropic/claude-opus-4.6", "anthropic"],
      ["google/gemini-3.1-pro", "google"],
    ]);
    const registry = new ProviderRegistry([openai, anthropic, google], map);

    // Act
      await registry.chat({
      model: "anthropic/claude-sonnet-4.6",
      messages: [{ role: "user", content: "hi" }],
    });
      await registry.chat({
      model: "google/gemini-3.1-pro",
      messages: [{ role: "user", content: "hi" }],
    });

    // Assert
    expect((openai.chat as ReturnType<typeof mock>)).toHaveBeenCalledTimes(1);
    expect((google.chat as ReturnType<typeof mock>)).toHaveBeenCalledTimes(1);
    expect((anthropic.chat as ReturnType<typeof mock>)).not.toHaveBeenCalled();
  });
});
