/**
 * Unit tests for alignment classifier.
 */

import { describe, it, expect } from "bun:test";
import { classifyAlignment } from "./alignment-classifier";

describe("classifyAlignment", () => {
  it("returns 'on-task' when judge says ON-TASK", async () => {
    const chat = async () => ({ content: "<alignment>ON-TASK</alignment>" });
    const result = await classifyAlignment("test/judge", chat, "task", "answer to the task");
    expect(result).toBe("on-task");
  });

  it("returns 'meta-critique' when judge says META-CRITIQUE", async () => {
    const chat = async () => ({ content: "<alignment>META-CRITIQUE</alignment>" });
    const result = await classifyAlignment("test/judge", chat, "task", "your question is wrong");
    expect(result).toBe("meta-critique");
  });

  it("defaults to 'on-task' on malformed output (least surprising for downstream)", async () => {
    const chat = async () => ({ content: "no tags" });
    const result = await classifyAlignment("test/judge", chat, "task", "x");
    expect(result).toBe("on-task");
  });

  it("case-insensitive parse", async () => {
    const chat = async () => ({ content: "<alignment>meta-critique</alignment>" });
    const result = await classifyAlignment("test/judge", chat, "task", "x");
    expect(result).toBe("meta-critique");
  });
});
