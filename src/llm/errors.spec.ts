/**
 * Unit tests for LLMClientError.
 */

import { describe, it, expect } from "bun:test";
import { LLMClientError } from "./errors";

describe("LLMClientError", () => {
  it("should set all fields", () => {
    const err = new LLMClientError(429, "rate limited", "rate_limit_error");
    expect(err.status).toBe(429);
    expect(err.message).toBe("rate limited");
    expect(err.type).toBe("rate_limit_error");
    expect(err.name).toBe("LLMClientError");
    expect(err).toBeInstanceOf(Error);
  });

  it("should allow an undefined type", () => {
    const err = new LLMClientError(500, "server error");
    expect(err.type).toBeUndefined();
  });
});

