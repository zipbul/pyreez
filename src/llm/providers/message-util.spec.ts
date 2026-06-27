/**
 * Unit tests for the shared message-serialization helpers.
 */

import { describe, it, expect } from "bun:test";
import { toCliModelId, serializeMessages } from "./message-util";

describe("toCliModelId", () => {
  it("should strip anthropic/ prefix and replace dots with dashes", () => {
    expect(toCliModelId("anthropic/claude-opus-4.6")).toBe("claude-opus-4-6");
  });

  it("should replace dots with dashes when no prefix is present", () => {
    expect(toCliModelId("claude-sonnet-4.6")).toBe("claude-sonnet-4-6");
  });

  it("should return id unchanged when no prefix and no dots", () => {
    expect(toCliModelId("claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });
});

describe("serializeMessages", () => {
  it("should extract system messages separately", () => {
    const result = serializeMessages([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ]);
    expect(result.system).toBe("You are a helpful assistant.");
    expect(result.prompt).toBe("Hello");
  });

  it("should join multiple system messages with double newline", () => {
    const result = serializeMessages([
      { role: "system", content: "Rule 1" },
      { role: "system", content: "Rule 2" },
      { role: "user", content: "Hi" },
    ]);
    expect(result.system).toBe("Rule 1\n\nRule 2");
  });

  it("should return undefined system when no system messages", () => {
    const result = serializeMessages([{ role: "user", content: "Hello" }]);
    expect(result.system).toBeUndefined();
  });

  it("should prefix assistant messages with role marker", () => {
    const result = serializeMessages([
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "And 3+3?" },
    ]);
    expect(result.prompt).toBe("What is 2+2?\n\n[Assistant]: 4\n\nAnd 3+3?");
  });

  it("should handle null content gracefully", () => {
    const result = serializeMessages([
      { role: "system", content: null },
      { role: "user", content: null },
    ]);
    expect(result.system).toBe("");
    expect(result.prompt).toBe("");
  });
});
