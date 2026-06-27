import { describe, it, expect } from "bun:test";
import { extractProvider } from "./provider-util";

describe("extractProvider", () => {
  it("returns the prefix before the slash", () => {
    expect(extractProvider("anthropic/claude-opus-4.6")).toBe("anthropic");
  });

  it("returns the whole id when there is no slash", () => {
    expect(extractProvider("gpt-5")).toBe("gpt-5");
  });
});
