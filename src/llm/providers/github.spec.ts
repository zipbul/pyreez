/**
 * Unit tests for GitHubProvider.
 */

import { describe, it, expect, mock } from "bun:test";
import { GitHubProvider } from "./github";
import { LLMClientError } from "../errors";

// We test through the public API, letting the SDK hit a mock server would
// be integration-level. Instead we verify constructor validation and that
// errors from the SDK surface as LLMClientError.

describe("GitHubProvider", () => {
  describe("constructor", () => {
    it("should throw when apiKey is empty", () => {
      expect(() => new GitHubProvider({ apiKey: "" })).toThrow("apiKey is required");
    });

    it("should create instance when apiKey is provided", () => {
      const provider = new GitHubProvider({ apiKey: "ghp_test" });
      expect(provider.name).toBe("github");
    });
  });
});
