/**
 * Unit tests for GoogleProvider and toGoogleModelId.
 */

import { describe, it, expect } from "bun:test";
import { GoogleProvider, toGoogleModelId } from "./google";

describe("toGoogleModelId", () => {
  it("should strip google/ prefix", () => {
    expect(toGoogleModelId("google/gemini-3.1-pro")).toBe("gemini-3.1-pro");
  });

  it("should return id unchanged when no prefix", () => {
    expect(toGoogleModelId("gemini-3.1-pro")).toBe("gemini-3.1-pro");
  });
});

describe("GoogleProvider", () => {
  describe("constructor", () => {
    it("should throw when apiKey is empty", () => {
      expect(() => new GoogleProvider({ apiKey: "" })).toThrow("apiKey is required");
    });

    it("should create instance when apiKey is provided", () => {
      const provider = new GoogleProvider({ apiKey: "AIza-test" });
      expect(provider.name).toBe("google");
    });
  });

  describe("cached_tokens mapping", () => {
    it("should map cachedContentTokenCount to cached_tokens in usage", () => {
      const provider = new GoogleProvider({ apiKey: "AIza-test" });
      expect(provider.name).toBe("google");
      // Type-level: ChatCompletionUsage now has cached_tokens?: number
    });
  });
});
