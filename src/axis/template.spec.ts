import { describe, it, expect, mock } from "bun:test";
import { renderTemplate } from "./template";

describe("renderTemplate", () => {
  // 25. [HP] replaces single {{var}}
  it("should replace a single {{var}} with its value", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  // 26. [HP] replaces multiple different {{vars}}
  it("should replace multiple different {{vars}}", () => {
    const result = renderTemplate("{{greeting}} {{name}}, you have {{count}} items.", {
      greeting: "Hi",
      name: "Alice",
      count: "3",
    });
    expect(result).toBe("Hi Alice, you have 3 items.");
  });

  // 27. [NE] missing variable → placeholder kept
  it("should keep placeholder when variable is missing", () => {
    const result = renderTemplate("Hello {{name}}, your role is {{role}}.", {
      name: "Bob",
    });
    expect(result).toBe("Hello Bob, your role is {{role}}.");
  });

  // 28. [ED] no placeholders → returned as-is
  it("should return template as-is when no placeholders exist", () => {
    const result = renderTemplate("No variables here.", {});
    expect(result).toBe("No variables here.");
  });

  // 29. [ED] empty template → empty string
  it("should return empty string for empty template", () => {
    const result = renderTemplate("", { name: "test" });
    expect(result).toBe("");
  });
});
