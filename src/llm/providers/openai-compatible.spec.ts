/**
 * Unit tests for OpenAICompatibleProvider and stripProviderPrefix.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { OpenAICompatibleProvider, stripProviderPrefix } from "./openai-compatible";
import { LLMClientError } from "../errors";
import type { ChatCompletionRequest, ChatCompletionResponse } from "../types";

describe("stripProviderPrefix", () => {
  it("should strip deepseek/ prefix", () => {
    expect(stripProviderPrefix("deepseek/deepseek-r1")).toBe("deepseek-r1");
  });

  it("should strip groq/ prefix", () => {
    expect(stripProviderPrefix("groq/llama-4-scout")).toBe("llama-4-scout");
  });

  it("should return id unchanged when no slash", () => {
    expect(stripProviderPrefix("deepseek-r1")).toBe("deepseek-r1");
  });

  it("should only strip up to the first slash", () => {
    expect(stripProviderPrefix("xai/grok-4.1-fast")).toBe("grok-4.1-fast");
  });
});

describe("OpenAICompatibleProvider", () => {
  describe("constructor", () => {
    it("should throw when apiKey is empty", () => {
      expect(
        () => new OpenAICompatibleProvider({ name: "deepseek", baseUrl: "https://api.deepseek.com", apiKey: "" }),
      ).toThrow("apiKey is required");
    });

    it("should throw when baseUrl is empty", () => {
      expect(
        () => new OpenAICompatibleProvider({ name: "deepseek", baseUrl: "", apiKey: "sk-test" }),
      ).toThrow("baseUrl is required");
    });

    it("should create instance with valid config", () => {
      const provider = new OpenAICompatibleProvider({
        name: "deepseek",
        baseUrl: "https://api.deepseek.com",
        apiKey: "sk-test",
      });
      expect(provider.name).toBe("deepseek");
    });

    it("should normalize trailing slash from baseUrl", () => {
      const provider = new OpenAICompatibleProvider({
        name: "xai",
        baseUrl: "https://api.x.ai/",
        apiKey: "sk-test",
      });
      expect(provider.name).toBe("xai");
    });

    it("should include provider name in error message", () => {
      expect(
        () => new OpenAICompatibleProvider({ name: "mistral", baseUrl: "https://x.ai", apiKey: "" }),
      ).toThrow("mistral provider");
    });
  });

  describe("chat()", () => {
    const BASE_URL = "https://api.deepseek.com";
    let provider: OpenAICompatibleProvider;
    let originalFetch: typeof globalThis.fetch;

    const sampleRequest: ChatCompletionRequest = {
      model: "deepseek/deepseek-v3.2",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.7,
    };

    const sampleResponse: ChatCompletionResponse = {
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1700000000,
      model: "deepseek-v3.2",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hi there" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    };

    beforeEach(() => {
      provider = new OpenAICompatibleProvider({
        name: "deepseek",
        baseUrl: BASE_URL,
        apiKey: "sk-test-key",
      });
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("should return parsed response on success", async () => {
      globalThis.fetch = mock(async () =>
        new Response(JSON.stringify(sampleResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ) as any;

      const result = await provider.chat(sampleRequest);

      expect(result.choices[0]!.message.content).toBe("hi there");
      expect(result.usage?.prompt_tokens).toBe(5);
    });

    it("should POST to /v1/chat/completions with correct body and auth", async () => {
      let capturedUrl = "";
      let capturedHeaders: any;
      let capturedBody: any;
      globalThis.fetch = mock(async (url: any, init: any) => {
        capturedUrl = String(url);
        capturedHeaders = init.headers;
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify(sampleResponse), { status: 200 });
      }) as any;

      await provider.chat(sampleRequest);

      expect(capturedUrl).toBe(`${BASE_URL}/v1/chat/completions`);
      expect(capturedBody.model).toBe("deepseek-v3.2"); // prefix stripped
      expect(capturedBody.messages[0].content).toBe("hello");
      expect(capturedBody.stream).toBe(false);
      expect(capturedHeaders.Authorization).toBe("Bearer sk-test-key");
    });

    it("should throw LLMClientError on HTTP error", async () => {
      globalThis.fetch = mock(async () =>
        new Response("model not found", { status: 404 }),
      ) as any;

      try {
        await provider.chat(sampleRequest);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMClientError);
        expect((error as LLMClientError).status).toBe(404);
      }
    });

    it("should parse rate_limit_error on 429", async () => {
      globalThis.fetch = mock(async () =>
        new Response("too many requests", { status: 429 }),
      ) as any;

      try {
        await provider.chat(sampleRequest);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMClientError);
        expect((error as LLMClientError).status).toBe(429);
        expect((error as LLMClientError).type).toBe("rate_limit_error");
      }
    });

    it("should throw connection_error when fetch rejects", async () => {
      globalThis.fetch = mock(async () => {
        throw new Error("ECONNREFUSED");
      }) as any;

      try {
        await provider.chat(sampleRequest);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMClientError);
        expect((error as LLMClientError).status).toBe(503);
        expect((error as LLMClientError).type).toBe("connection_error");
        expect((error as LLMClientError).message).toContain("ECONNREFUSED");
      }
    });

    it("should throw timeout_error when request exceeds timeoutMs", async () => {
      const fastProvider = new OpenAICompatibleProvider({
        name: "deepseek",
        baseUrl: BASE_URL,
        apiKey: "sk-test-key",
        timeoutMs: 1,
      });
      globalThis.fetch = mock(async (_url: any, init: any) => {
        await new Promise((_, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        });
        return new Response("never");
      }) as any;

      try {
        await fastProvider.chat(sampleRequest);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMClientError);
        expect((error as LLMClientError).status).toBe(504);
        expect((error as LLMClientError).type).toBe("timeout_error");
      }
    });
  });
});
