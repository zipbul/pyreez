/**
 * Unit tests for LLMClient and LLMClientError.
 */

import { describe, it, expect, mock } from "bun:test";
import { LLMClient, LLMClientError } from "./client";
import type { LLMProviderConfig } from "../config";
import type { ChatCompletionResponse } from "./types";

// -- Fixtures --

function validConfig(
  overrides?: Partial<LLMProviderConfig>,
): LLMProviderConfig {
  return {
    baseUrl: "https://models.github.ai",
    apiKey: "test-pat-token",
    model: "gpt-4o",
    headers: {},
    ...overrides,
  };
}

const VALID_RESPONSE: ChatCompletionResponse = {
  id: "chatcmpl-123",
  object: "chat.completion",
  created: 1700000000,
  model: "gpt-4o",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello!" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

function stubFetchOk(body: unknown = VALID_RESPONSE) {
  return mock((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

function stubFetchError(
  status: number,
  body: string,
  headers?: Record<string, string>,
) {
  return mock((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(new Response(body, { status, headers })),
  );
}

function fetchArgs(fn: ReturnType<typeof stubFetchOk>) {
  const [url, init] = fn.mock.calls[0];
  return { url: url as string, init: init as RequestInit };
}

function fetchBody(fn: ReturnType<typeof stubFetchOk>): Record<string, unknown> {
  const { init } = fetchArgs(fn);
  return JSON.parse(init.body as string);
}

function fetchHeaders(fn: ReturnType<typeof stubFetchOk>): Record<string, string> {
  const { init } = fetchArgs(fn);
  return init.headers as Record<string, string>;
}

// -- Tests --

describe("LLMClientError", () => {
  it("should set status, message, and type properties when constructed", () => {
    // Arrange & Act
    const error = new LLMClientError(401, "Unauthorized", "auth_error");

    // Assert
    expect(error.status).toBe(401);
    expect(error.message).toBe("Unauthorized");
    expect(error.type).toBe("auth_error");
  });

  it('should set name to "LLMClientError" when constructed', () => {
    // Arrange & Act
    const error = new LLMClientError(500, "Internal Server Error");

    // Assert
    expect(error.name).toBe("LLMClientError");
  });

  it("should set type to undefined when type is not provided", () => {
    // Arrange & Act
    const error = new LLMClientError(400, "Bad Request");

    // Assert
    expect(error.type).toBeUndefined();
  });
});

describe("LLMClient", () => {
  describe("constructor", () => {
    it("should create instance when valid config is provided", () => {
      // Arrange
      const config = validConfig();
      const fetchFn = stubFetchOk();

      // Act
      const client = new LLMClient(config, fetchFn as unknown as typeof fetch);

      // Assert
      expect(client).toBeInstanceOf(LLMClient);
    });

    it('should throw "baseUrl is required" when baseUrl is empty', () => {
      // Arrange
      const config = validConfig({ baseUrl: "" });

      // Act & Assert
      expect(() => new LLMClient(config)).toThrow("baseUrl is required");
    });

    it('should throw "apiKey is required" when apiKey is empty', () => {
      // Arrange
      const config = validConfig({ apiKey: "" });

      // Act & Assert
      expect(() => new LLMClient(config)).toThrow("apiKey is required");
    });

    it('should throw "model is required" when model is empty', () => {
      // Arrange
      const config = validConfig({ model: "" });

      // Act & Assert
      expect(() => new LLMClient(config)).toThrow("model is required");
    });

    it("should strip trailing slashes from baseUrl when baseUrl has trailing slashes", async () => {
      // Arrange
      const fetchFn = stubFetchOk();
      const client = new LLMClient(
        validConfig({ baseUrl: "https://models.github.ai///" }),
        fetchFn as unknown as typeof fetch,
      );

      // Act
      await client.chat({ messages: [{ role: "user", content: "hi" }] });

      // Assert
      const { url } = fetchArgs(fetchFn);
      expect(url).toBe("https://models.github.ai/inference/chat/completions");
    });

    it("should default extraHeaders to empty object when config.headers is undefined", async () => {
      // Arrange
      const fetchFn = stubFetchOk();
      const client = new LLMClient(
        validConfig({ headers: undefined }),
        fetchFn as unknown as typeof fetch,
      );

      // Act
      await client.chat({ messages: [{ role: "user", content: "hi" }] });

      // Assert
      const headers = fetchHeaders(fetchFn);
      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer test-pat-token",
      });
    });
  });

  describe("chat", () => {
    it("should return ChatCompletionResponse when request is valid", async () => {
      // Arrange
      const fetchFn = stubFetchOk(VALID_RESPONSE);
      const client = new LLMClient(validConfig(), fetchFn as unknown as typeof fetch);

      // Act
      const result = await client.chat({
        messages: [{ role: "user", content: "Hello" }],
      });

      // Assert
      expect(result).toEqual(VALID_RESPONSE);
    });

    it("should use defaultModel when request.model is not provided", async () => {
      // Arrange
      const fetchFn = stubFetchOk();
      const client = new LLMClient(
        validConfig({ model: "my-default-model" }),
        fetchFn as unknown as typeof fetch,
      );

      // Act
      await client.chat({ messages: [{ role: "user", content: "hi" }] });

      // Assert
      expect(fetchBody(fetchFn).model).toBe("my-default-model");
    });

    it("should use provided model when request.model is specified", async () => {
      // Arrange
      const fetchFn = stubFetchOk();
      const client = new LLMClient(
        validConfig({ model: "default-model" }),
        fetchFn as unknown as typeof fetch,
      );

      // Act
      await client.chat({
        messages: [{ role: "user", content: "hi" }],
        model: "override-model",
      });

      // Assert
      expect(fetchBody(fetchFn).model).toBe("override-model");
    });

    it("should force stream to false when building request body", async () => {
      // Arrange
      const fetchFn = stubFetchOk();
      const client = new LLMClient(validConfig(), fetchFn as unknown as typeof fetch);

      // Act
      await client.chat({
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      });

      // Assert
      expect(fetchBody(fetchFn).stream).toBe(false);
    });

    it("should construct URL using default chatEndpoint when config.chatEndpoint is undefined", async () => {
      // Arrange
      const fetchFn = stubFetchOk();
      const client = new LLMClient(
        validConfig({ baseUrl: "https://custom.api.com" }),
        fetchFn as unknown as typeof fetch,
      );

      // Act
      await client.chat({ messages: [{ role: "user", content: "hi" }] });

      // Assert
      const { url } = fetchArgs(fetchFn);
      expect(url).toBe("https://custom.api.com/inference/chat/completions");
    });

    it("should construct URL using chatEndpoint from config when chatEndpoint provided", async () => {
      // Arrange
      const fetchFn = stubFetchOk();
      const client = new LLMClient(
        validConfig({
          baseUrl: "http://localhost:12434",
          chatEndpoint: "/v1/chat/completions",
        }),
        fetchFn as unknown as typeof fetch,
      );

      // Act
      await client.chat({ messages: [{ role: "user", content: "hi" }] });

      // Assert
      const { url } = fetchArgs(fetchFn);
      expect(url).toBe("http://localhost:12434/v1/chat/completions");
    });

    it("should include Authorization Bearer header when called", async () => {
      // Arrange
      const fetchFn = stubFetchOk();
      const client = new LLMClient(
        validConfig({ apiKey: "my-secret-key" }),
        fetchFn as unknown as typeof fetch,
      );

      // Act
      await client.chat({ messages: [{ role: "user", content: "hi" }] });

      // Assert
      expect(fetchHeaders(fetchFn).Authorization).toBe("Bearer my-secret-key");
    });

    it("should merge extraHeaders into request headers when extraHeaders exist", async () => {
      // Arrange
      const fetchFn = stubFetchOk();
      const client = new LLMClient(
        validConfig({ headers: { "X-Custom": "value123" } }),
        fetchFn as unknown as typeof fetch,
      );

      // Act
      await client.chat({ messages: [{ role: "user", content: "hi" }] });

      // Assert
      expect(fetchHeaders(fetchFn)["X-Custom"]).toBe("value123");
    });

    it("should throw LLMClientError with status when response is not ok", async () => {
      // Arrange
      const fetchFn = stubFetchError(403, '{"error":{"message":"Forbidden"}}');
      const client = new LLMClient(validConfig(), fetchFn as unknown as typeof fetch);

      // Act
      const error = await client
        .chat({ messages: [{ role: "user", content: "hi" }] })
        .catch((e: unknown) => e);

      // Assert
      expect(error).toBeInstanceOf(LLMClientError);
      expect((error as LLMClientError).status).toBe(403);
    });

    it("should extract error message and type from JSON error body when error has { error: { message, type } }", async () => {
      // Arrange
      const errorBody = JSON.stringify({
        error: { message: "Rate limit exceeded", type: "rate_limit_error" },
      });
      const fetchFn = stubFetchError(429, errorBody);
      const client = new LLMClient(validConfig(), fetchFn as unknown as typeof fetch);

      // Act
      const error = await client
        .chat({ messages: [{ role: "user", content: "hi" }] })
        .catch((e: unknown) => e);

      // Assert
      const err = error as LLMClientError;
      expect(err.message).toBe("Rate limit exceeded.");
      expect(err.type).toBe("rate_limit_error");
    });

    it("should extract top-level message from JSON error body when error has { message } without error field", async () => {
      // Arrange
      const errorBody = JSON.stringify({ message: "Service unavailable" });
      const fetchFn = stubFetchError(503, errorBody);
      const client = new LLMClient(validConfig(), fetchFn as unknown as typeof fetch);

      // Act
      const error = await client
        .chat({ messages: [{ role: "user", content: "hi" }] })
        .catch((e: unknown) => e);

      // Assert
      expect((error as LLMClientError).message).toBe("Service unavailable");
    });

    it("should use raw text as error message when error body is not valid JSON", async () => {
      // Arrange
      const fetchFn = stubFetchError(500, "Internal Server Error");
      const client = new LLMClient(validConfig(), fetchFn as unknown as typeof fetch);

      // Act
      const error = await client
        .chat({ messages: [{ role: "user", content: "hi" }] })
        .catch((e: unknown) => e);

      // Assert
      expect((error as LLMClientError).message).toBe("Internal Server Error");
    });

    it('should use "HTTP {status}" as error message when error body is empty', async () => {
      // Arrange
      const fetchFn = stubFetchError(502, "");
      const client = new LLMClient(validConfig(), fetchFn as unknown as typeof fetch);

      // Act
      const error = await client
        .chat({ messages: [{ role: "user", content: "hi" }] })
        .catch((e: unknown) => e);

      // Assert
      expect((error as LLMClientError).message).toBe("HTTP 502");
    });

    it("should let extraHeaders override default headers when keys conflict", async () => {
      // Arrange
      const fetchFn = stubFetchOk();
      const client = new LLMClient(
        validConfig({
          headers: { "Content-Type": "text/plain" },
        }),
        fetchFn as unknown as typeof fetch,
      );

      // Act
      await client.chat({ messages: [{ role: "user", content: "hi" }] });

      // Assert
      const headers = fetchHeaders(fetchFn);
      expect(headers["Content-Type"]).toBe("text/plain");
    });

    // -- Rate limit error handling (T4) --

    it("should include retryAfterMs parsed from Retry-After header on 429", async () => {
      // Arrange
      const fetchFn = stubFetchError(
        429,
        JSON.stringify({ error: { message: "limit" } }),
        { "Retry-After": "30" },
      );
      const client = new LLMClient(validConfig(), fetchFn as unknown as typeof fetch);

      // Act
      const error = await client
        .chat({ messages: [{ role: "user", content: "hi" }] })
        .catch((e: unknown) => e);

      // Assert
      const err = error as LLMClientError;
      expect(err.retryAfterMs).toBe(30000);
    });

    it("should standardize 429 error message with retry info", async () => {
      // Arrange
      const fetchFn = stubFetchError(
        429,
        JSON.stringify({ error: { message: "Some long ToS text..." } }),
        { "Retry-After": "15" },
      );
      const client = new LLMClient(validConfig(), fetchFn as unknown as typeof fetch);

      // Act
      const error = await client
        .chat({ messages: [{ role: "user", content: "hi" }] })
        .catch((e: unknown) => e);

      // Assert
      const err = error as LLMClientError;
      expect(err.message).toBe("Rate limit exceeded. Retry after 15s.");
    });

    it("should set retryAfterMs to undefined when no Retry-After header on 429", async () => {
      // Arrange
      const fetchFn = stubFetchError(
        429,
        JSON.stringify({ error: { message: "limit" } }),
      );
      const client = new LLMClient(validConfig(), fetchFn as unknown as typeof fetch);

      // Act
      const error = await client
        .chat({ messages: [{ role: "user", content: "hi" }] })
        .catch((e: unknown) => e);

      // Assert
      const err = error as LLMClientError;
      expect(err.retryAfterMs).toBeUndefined();
    });

    it("should set retryAfterMs to undefined when Retry-After is non-numeric", async () => {
      // Arrange
      const fetchFn = stubFetchError(
        429,
        JSON.stringify({ error: { message: "limit" } }),
        { "Retry-After": "abc" },
      );
      const client = new LLMClient(validConfig(), fetchFn as unknown as typeof fetch);

      // Act
      const error = await client
        .chat({ messages: [{ role: "user", content: "hi" }] })
        .catch((e: unknown) => e);

      // Assert
      const err = error as LLMClientError;
      expect(err.retryAfterMs).toBeUndefined();
    });

    it('should default errorType to "rate_limit_error" on 429 when body has no type', async () => {
      // Arrange
      const fetchFn = stubFetchError(
        429,
        JSON.stringify({ message: "too many requests" }),
      );
      const client = new LLMClient(validConfig(), fetchFn as unknown as typeof fetch);

      // Act
      const error = await client
        .chat({ messages: [{ role: "user", content: "hi" }] })
        .catch((e: unknown) => e);

      // Assert
      const err = error as LLMClientError;
      expect(err.type).toBe("rate_limit_error");
    });
  });
});
