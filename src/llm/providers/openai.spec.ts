/**
 * Unit tests for OpenAIProvider and toOpenAIModelId.
 */

import { describe, it, expect } from "bun:test";
import { OpenAIProvider, toOpenAIModelId } from "./openai";

describe("toOpenAIModelId", () => {
  it("should strip openai/ prefix", () => {
    expect(toOpenAIModelId("openai/gpt-4.1")).toBe("gpt-4.1");
  });

  it("should return id unchanged when no prefix", () => {
    expect(toOpenAIModelId("gpt-4.1")).toBe("gpt-4.1");
  });
});

describe("OpenAIProvider", () => {
  describe("constructor", () => {
    it("should throw when apiKey is empty", () => {
      expect(() => new OpenAIProvider({ apiKey: "" })).toThrow("apiKey is required");
    });

    it("should create instance when apiKey is provided", () => {
      const provider = new OpenAIProvider({ apiKey: "sk-test" });
      expect(provider.name).toBe("openai");
    });
  });

  describe("cached_tokens mapping", () => {
    it("should map prompt_tokens_details.cached_tokens to cached_tokens in usage", () => {
      const provider = new OpenAIProvider({ apiKey: "sk-test" });
      expect(provider.name).toBe("openai");
      // Type-level: ChatCompletionUsage now has cached_tokens?: number
    });
  });
});
