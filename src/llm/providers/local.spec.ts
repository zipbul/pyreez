/**
 * Unit tests for LocalProvider, toLocalModelId, and validateBaseUrl.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { LocalProvider, toLocalModelId, validateBaseUrl } from "./local";
import { LLMClientError } from "../errors";
import type { ChatCompletionRequest, ChatCompletionResponse } from "../types";

describe("toLocalModelId", () => {
  it("should strip local/ prefix", () => {
    expect(toLocalModelId("local/qwen3-coder")).toBe("qwen3-coder");
  });

  it("should return id unchanged when no prefix", () => {
    expect(toLocalModelId("deepseek-r1-distill-llama")).toBe("deepseek-r1-distill-llama");
  });

  it("should handle nested slashes after prefix", () => {
    expect(toLocalModelId("local/library/phi4")).toBe("library/phi4");
  });
});

describe("validateBaseUrl", () => {
  it("should accept http://localhost:11434", () => {
    expect(() => validateBaseUrl("http://localhost:11434")).not.toThrow();
  });

  it("should accept https://llm.example.com", () => {
    expect(() => validateBaseUrl("https://llm.example.com")).not.toThrow();
  });

  it("should reject non-URL string", () => {
    expect(() => validateBaseUrl("not-a-url")).toThrow("Invalid local LLM baseUrl");
  });

  it("should reject ftp protocol", () => {
    expect(() => validateBaseUrl("ftp://localhost:11434")).toThrow("must use http or https");
  });

  it("should reject file protocol", () => {
    expect(() => validateBaseUrl("file:///etc/passwd")).toThrow("must use http or https");
  });

  it("should reject AWS metadata endpoint (SSRF)", () => {
    expect(() => validateBaseUrl("http://169.254.169.254")).toThrow("blocked metadata endpoint");
  });

  it("should reject GCP metadata endpoint (SSRF)", () => {
    expect(() => validateBaseUrl("http://metadata.google.internal")).toThrow("blocked metadata endpoint");
  });
});

describe("LocalProvider", () => {
  describe("constructor", () => {
    it("should throw when baseUrl is empty", () => {
      expect(() => new LocalProvider({ baseUrl: "" })).toThrow("baseUrl is required");
    });

    it("should create instance when baseUrl is provided", () => {
      const provider = new LocalProvider({ baseUrl: "http://localhost:11434" });
      expect(provider.name).toBe("local");
    });

    it("should normalize trailing slash", () => {
      const provider = new LocalProvider({ baseUrl: "http://localhost:11434/" });
      expect(provider.name).toBe("local");
    });

    it("should reject invalid URL in constructor", () => {
      expect(() => new LocalProvider({ baseUrl: "not-valid" })).toThrow("Invalid local LLM baseUrl");
    });

    it("should reject metadata endpoint in constructor", () => {
      expect(() => new LocalProvider({ baseUrl: "http://169.254.169.254" })).toThrow("blocked metadata endpoint");
    });

    it("should accept custom timeout", () => {
      const provider = new LocalProvider({ baseUrl: "http://localhost:11434", timeoutMs: 5000 });
      expect(provider.name).toBe("local");
    });

    it("should accept socketPath for Docker Model Runner", () => {
      const provider = new LocalProvider({
        baseUrl: "http://localhost/exp/vDD4.40/engines",
        socketPath: "/var/run/docker.sock",
      });
      expect(provider.name).toBe("local");
    });
  });

  describe("chat()", () => {
    const BASE_URL = "http://localhost:11434";
    let provider: LocalProvider;
    let originalFetch: typeof globalThis.fetch;

    const sampleRequest: ChatCompletionRequest = {
      model: "local/qwen3-coder",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.7,
    };

    const sampleResponse: ChatCompletionResponse = {
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1700000000,
      model: "qwen3-coder",
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
      provider = new LocalProvider({ baseUrl: BASE_URL });
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("should return parsed response on success", async () => {
      // Arrange
      globalThis.fetch = mock(async () =>
        new Response(JSON.stringify(sampleResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ) as any;

      // Act
      const result = await provider.chat(sampleRequest);

      // Assert
      expect(result.choices[0]!.message.content).toBe("hi there");
      expect(result.usage?.prompt_tokens).toBe(5);
    });

    it("should POST to /v1/chat/completions with correct body", async () => {
      // Arrange
      let capturedUrl = "";
      let capturedBody: any;
      globalThis.fetch = mock(async (url: any, init: any) => {
        capturedUrl = String(url);
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify(sampleResponse), { status: 200 });
      }) as any;

      // Act
      await provider.chat(sampleRequest);

      // Assert
      expect(capturedUrl).toBe(`${BASE_URL}/v1/chat/completions`);
      expect(capturedBody.model).toBe("qwen3-coder"); // prefix stripped
      expect(capturedBody.messages[0].content).toBe("hello");
      expect(capturedBody.stream).toBe(false);
    });

    it("should throw LLMClientError on HTTP error", async () => {
      // Arrange
      globalThis.fetch = mock(async () =>
        new Response("model not found", { status: 404 }),
      ) as any;

      // Act & Assert
      try {
        await provider.chat(sampleRequest);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMClientError);
        expect((error as LLMClientError).status).toBe(404);
        expect((error as LLMClientError).message).toContain("model not found");
      }
    });

    it("should set type to rate_limit_error on 429", async () => {
      // Arrange
      globalThis.fetch = mock(async () =>
        new Response("too many requests", { status: 429 }),
      ) as any;

      // Act & Assert
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
      // Arrange
      globalThis.fetch = mock(async () => {
        throw new Error("ECONNREFUSED");
      }) as any;

      // Act & Assert
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

    it("should pass unix option to fetch when socketPath is set", async () => {
      // Arrange
      const socketProvider = new LocalProvider({
        baseUrl: "http://localhost/exp/vDD4.40/engines",
        socketPath: "/var/run/docker.sock",
      });
      let capturedInit: any;
      globalThis.fetch = mock(async (_url: any, init: any) => {
        capturedInit = init;
        return new Response(JSON.stringify(sampleResponse), { status: 200 });
      }) as any;

      // Act
      await socketProvider.chat(sampleRequest);

      // Assert
      expect(capturedInit.unix).toBe("/var/run/docker.sock");
    });

    it("should not pass unix option to fetch when socketPath is not set", async () => {
      // Arrange
      let capturedInit: any;
      globalThis.fetch = mock(async (_url: any, init: any) => {
        capturedInit = init;
        return new Response(JSON.stringify(sampleResponse), { status: 200 });
      }) as any;

      // Act
      await provider.chat(sampleRequest);

      // Assert
      expect(capturedInit.unix).toBeUndefined();
    });

    it("should throw timeout_error when request exceeds timeoutMs", async () => {
      // Arrange — very short timeout
      const fastProvider = new LocalProvider({ baseUrl: BASE_URL, timeoutMs: 1 });
      globalThis.fetch = mock(async (_url: any, init: any) => {
        // Wait until abort signal fires
        await new Promise((_, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        });
        return new Response("never");
      }) as any;

      // Act & Assert
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
