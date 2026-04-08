/**
 * Unit tests for XaiProvider.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { LLMClientError } from "../errors";

// Mock ai SDK
let mockGenerateText: ReturnType<typeof mock>;

beforeEach(() => {
  mockGenerateText = mock(() => Promise.resolve({
    text: "default response",
    response: { id: "resp-123" },
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    finishReason: "stop",
  }));

  mock.module("ai", () => ({
    generateText: mockGenerateText,
  }));

  mock.module("@ai-sdk/xai", () => ({
    createXai: () => (model: string) => ({ model }),
  }));
});

// Must import after mock setup
async function createProvider() {
  const { XaiProvider } = await import("./xai");
  return new XaiProvider({ apiKey: "test-key" });
}

describe("XaiProvider", () => {
  it("should have name 'xai'", async () => {
    const provider = await createProvider();
    expect(provider.name).toBe("xai");
  });

  // -- Constructor --

  it("should throw on empty apiKey", async () => {
    const { XaiProvider } = await import("./xai");
    expect(() => new XaiProvider({ apiKey: "" })).toThrow("apiKey is required");
  });

  // -- Happy path --

  it("should return parsed response with response.id", async () => {
    const provider = await createProvider();
    const res = await provider.chat({
      model: "xai/grok-4",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(res.choices[0]!.message.content).toBe("default response");
    expect(res.id).toBe("resp-123");
    expect(res.model).toBe("grok-4");
  });

  it("should fallback to xai-timestamp id when response.id is absent", async () => {
    mockGenerateText.mockImplementation(() => Promise.resolve({
      text: "ok",
      response: {},
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      finishReason: "stop",
    }));
    const provider = await createProvider();
    const res = await provider.chat({
      model: "xai/grok-4",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(res.id).toMatch(/^xai-\d+$/);
  });

  it("should extract token usage when present", async () => {
    const provider = await createProvider();
    const res = await provider.chat({
      model: "xai/grok-4",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(res.usage!.prompt_tokens).toBe(100);
    expect(res.usage!.completion_tokens).toBe(50);
    expect(res.usage!.total_tokens).toBe(150);
  });

  it("should default tokens to 0 when usage is undefined", async () => {
    mockGenerateText.mockImplementation(() => Promise.resolve({
      text: "ok",
      response: {},
      usage: undefined,
      finishReason: "stop",
    }));
    const provider = await createProvider();
    const res = await provider.chat({
      model: "xai/grok-4",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(res.usage!.prompt_tokens).toBe(0);
    expect(res.usage!.completion_tokens).toBe(0);
  });

  it("should set finish_reason to stop regardless of finishReason value", async () => {
    mockGenerateText.mockImplementation(() => Promise.resolve({
      text: "ok",
      response: {},
      usage: {},
      finishReason: "length",
    }));
    const provider = await createProvider();
    const res = await provider.chat({
      model: "xai/grok-4",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(res.choices[0]!.finish_reason).toBe("stop");
  });

  it("should strip provider prefix from model id", async () => {
    const provider = await createProvider();
    const res = await provider.chat({
      model: "xai/grok-4",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(res.model).toBe("grok-4");
  });

  it("should pass model id unchanged when no prefix", async () => {
    const provider = await createProvider();
    const res = await provider.chat({
      model: "grok-4",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(res.model).toBe("grok-4");
  });

  // -- Error: AbortError / TimeoutError --

  it("should convert AbortError to 408 timeout", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    mockGenerateText.mockImplementation(() => Promise.reject(err));
    const provider = await createProvider();
    try {
      await provider.chat({ model: "xai/grok-4", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const llmErr = e as LLMClientError;
      expect(llmErr.status).toBe(408);
      expect(llmErr.type).toBe("timeout");
    }
  });

  it("should convert TimeoutError to 408 timeout", async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    mockGenerateText.mockImplementation(() => Promise.reject(err));
    const provider = await createProvider();
    try {
      await provider.chat({ model: "xai/grok-4", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const llmErr = e as LLMClientError;
      expect(llmErr.status).toBe(408);
      expect(llmErr.type).toBe("timeout");
    }
  });

  // -- Error: Error with status --

  it("should use status from Error when available", async () => {
    const err = new Error("bad request") as Error & { status: number };
    err.status = 400;
    mockGenerateText.mockImplementation(() => Promise.reject(err));
    const provider = await createProvider();
    try {
      await provider.chat({ model: "xai/grok-4", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const llmErr = e as LLMClientError;
      expect(llmErr.status).toBe(400);
      expect(llmErr.type).toBe("api_error");
    }
  });

  it("should default to 500 when Error has no status", async () => {
    mockGenerateText.mockImplementation(() => Promise.reject(new Error("generic failure")));
    const provider = await createProvider();
    try {
      await provider.chat({ model: "xai/grok-4", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const llmErr = e as LLMClientError;
      expect(llmErr.status).toBe(500);
      expect(llmErr.type).toBe("api_error");
      expect(llmErr.message).toContain("generic failure");
    }
  });

  // -- Error: non-Error throw --

  it("should wrap non-Error throw as 500 api_error", async () => {
    mockGenerateText.mockImplementation(() => Promise.reject("string error"));
    const provider = await createProvider();
    try {
      await provider.chat({ model: "xai/grok-4", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const llmErr = e as LLMClientError;
      expect(llmErr.status).toBe(500);
      expect(llmErr.type).toBe("api_error");
      expect(llmErr.message).toContain("string error");
    }
  });
});
