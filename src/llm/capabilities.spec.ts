import { describe, it, expect } from "bun:test";
import { gateCapabilities } from "./capabilities";
import { LLMClientError } from "./errors";
import type { CapabilitySet, ChatCompletionRequest } from "./types";

const ALL: CapabilitySet = { web: true, effort: true, fileAccess: true };
const NONE: CapabilitySet = { web: false, effort: false, fileAccess: false };
const req = (extra: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest => ({
  model: "x/y",
  messages: [{ role: "user", content: "hi" }],
  ...extra,
});

describe("gateCapabilities", () => {
  it("hard-errors when webAccess is requested but unsupported", () => {
    expect(() => gateCapabilities(req({ webAccess: true }), NONE)).toThrow(LLMClientError);
  });

  it("hard-errors when fileAccess is requested but unsupported", () => {
    expect(() => gateCapabilities(req({ fileAccess: "read" }), { ...ALL, fileAccess: false })).toThrow(
      /fileAccess/,
    );
  });

  it("strips reasoning_effort when unsupported (soft)", () => {
    const { request } = gateCapabilities(req({ reasoning_effort: 7 }), {
      ...ALL,
      effort: false,
    });
    expect(request.reasoning_effort).toBeUndefined();
  });

  it("passes supported capabilities through unchanged", () => {
    const r = req({ webAccess: true, reasoning_effort: 7, fileAccess: "read" });
    const { request } = gateCapabilities(r, ALL);
    expect(request).toBe(r);
  });

  it("does not error when a correctness capability is unsupported but NOT requested", () => {
    expect(() => gateCapabilities(req(), NONE)).not.toThrow();
  });
});
