/**
 * Unit tests for LLM cross-validator: parsing of judge output.
 */

import { describe, it, expect } from "bun:test";
import { createLLMCrossValidator } from "./llm-cross-validator";

describe("createLLMCrossValidator", () => {
  it("parses unsupported and contradicted claims from XML output", async () => {
    const chat = async () => ({
      content: `<unsupported>
- Bun was created in 2019
- Bun has 50 million weekly downloads
</unsupported>
<contradicted>
- Bun is slower than Node (contradicted by: "Bun is faster than Node")
</contradicted>`,
    });
    const judge = createLLMCrossValidator("test/judge", chat);
    const result = await judge(
      { id: "a", content: "Bun was created in 2019. Bun has 50M weekly downloads. Bun is slower than Node." },
      [{ id: "b", content: "Bun is faster than Node." }],
    );
    expect(result.unsupportedClaims).toHaveLength(2);
    expect(result.unsupportedClaims[0]).toContain("created in 2019");
    expect(result.contradictedClaims).toHaveLength(1);
    expect(result.contradictedClaims[0]).toContain("slower");
  });

  it("returns empty arrays when judge says 'none' in both sections", async () => {
    const chat = async () => ({
      content: `<unsupported>
- none
</unsupported>
<contradicted>
- none
</contradicted>`,
    });
    const judge = createLLMCrossValidator("test/judge", chat);
    const result = await judge({ id: "a", content: "x" }, [{ id: "b", content: "y" }]);
    expect(result.unsupportedClaims).toEqual([]);
    expect(result.contradictedClaims).toEqual([]);
  });

  it("returns empty when judge produces malformed output (no tags)", async () => {
    const chat = async () => ({ content: "garbled output without tags" });
    const judge = createLLMCrossValidator("test/judge", chat);
    const result = await judge({ id: "a", content: "x" }, [{ id: "b", content: "y" }]);
    expect(result.unsupportedClaims).toEqual([]);
    expect(result.contradictedClaims).toEqual([]);
  });
});
