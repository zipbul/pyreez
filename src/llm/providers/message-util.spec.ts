/**
 * Unit tests for the shared message-serialization helpers.
 */

import { describe, it, expect } from "bun:test";
import {
  toCliModelId,
  splitSystemMessages,
  flattenConversation,
  composeSystemPrompt,
  bucketEffort,
} from "./message-util";

describe("bucketEffort", () => {
  const L5 = ["a", "b", "c", "d", "e"] as const;

  it("maps the low end to the first level and the high end to the last", () => {
    expect(bucketEffort(1, L5)).toBe("a");
    expect(bucketEffort(10, L5)).toBe("e");
  });

  it("buckets the mid value to a middle level", () => {
    expect(bucketEffort(5, L5)).toBe("c");
  });

  it("clamps out-of-range values into 1–10", () => {
    expect(bucketEffort(0, L5)).toBe("a");
    expect(bucketEffort(99, L5)).toBe("e");
  });

  it("works for a 5-level set used by codex (minimal..xhigh)", () => {
    const codex = ["minimal", "low", "medium", "high", "xhigh"] as const;
    expect(bucketEffort(1, codex)).toBe("minimal");
    expect(bucketEffort(10, codex)).toBe("xhigh");
  });
});

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

describe("splitSystemMessages", () => {
  it("separates joined system text from the conversation messages", () => {
    const { system, conversation } = splitSystemMessages([
      { role: "system", content: "Rule 1" },
      { role: "system", content: "Rule 2" },
      { role: "user", content: "Hi" },
    ]);
    expect(system).toBe("Rule 1\n\nRule 2");
    expect(conversation).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("returns undefined system + the full list when no system messages", () => {
    const { system, conversation } = splitSystemMessages([{ role: "user", content: "Hello" }]);
    expect(system).toBeUndefined();
    expect(conversation).toEqual([{ role: "user", content: "Hello" }]);
  });
});

describe("flattenConversation", () => {
  it("joins user turns and marks assistant turns", () => {
    expect(
      flattenConversation([
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "4" },
        { role: "user", content: "And 3+3?" },
      ]),
    ).toBe("What is 2+2?\n\n[Assistant]: 4\n\nAnd 3+3?");
  });
});

describe("composeSystemPrompt", () => {
  it("returns just the conversation when there is no system block", () => {
    expect(composeSystemPrompt(undefined, "hello")).toBe("hello");
  });

  it("frames the system block in an XML boundary, raw (no escaping)", () => {
    expect(composeSystemPrompt("<role>critic</role>", "task")).toBe(
      "<system-instructions>\n<role>critic</role>\n</system-instructions>\n\ntask",
    );
  });
});
