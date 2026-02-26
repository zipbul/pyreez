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
  return {
    id: `resp-${model}`,
    object: "chat.completion",
    created: 1700000000,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: `Response from ${model}` },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  };
}

function makeProvider(name: ProviderName, chatImpl?: LLMProvider["chat"]): LLMProvider {
  return {
    name,
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
    const result = await registry.chat({
      model: "anthropic/claude-opus-4.6",
      messages: [{ role: "user", content: "hi" }],
    });

    // Assert
    expect(result.id).toBe("resp-anthropic/claude-opus-4.6");
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
      temperature: 0.5,
      max_tokens: 100,
    });

    // Assert
    const call = chatMock.mock.calls[0]![0] as ChatCompletionRequest;
    expect(call.model).toBe("anthropic/claude-sonnet-4.6");
    expect(call.messages).toEqual(messages);
    expect(call.temperature).toBe(0.5);
    expect(call.max_tokens).toBe(100);
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
    const r1 = await registry.chat({
      model: "anthropic/claude-sonnet-4.6",
      messages: [{ role: "user", content: "hi" }],
    });
    const r2 = await registry.chat({
      model: "google/gemini-3.1-pro",
      messages: [{ role: "user", content: "hi" }],
    });

    // Assert
    expect(r1.id).toBe("resp-anthropic/claude-sonnet-4.6");
    expect(r2.id).toBe("resp-google/gemini-3.1-pro");
    expect((openai.chat as ReturnType<typeof mock>)).toHaveBeenCalledTimes(1);
    expect((google.chat as ReturnType<typeof mock>)).toHaveBeenCalledTimes(1);
    expect((anthropic.chat as ReturnType<typeof mock>)).not.toHaveBeenCalled();
  });
});
