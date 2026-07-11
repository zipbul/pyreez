/**
 * Unit tests for GrokCliProvider and toGrokCliModelId.
 * Spawn is mocked via mock.module("./spawn-with-idle"); we assert the constructed argv + cwd.
 * fileAccess semantics (plan = read-only, bypassPermissions = write) were verified live against
 * the installed grok CLI; these tests lock in the argv this provider emits for each level.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { LLMClientError } from "../errors";
import { IdleTimeoutError } from "./spawn-with-idle";
import { GrokCliProvider, toGrokCliModelId } from "./grok-cli";
import type { ChatCompletionRequest } from "../types";

// -- Pure functions --

describe("toGrokCliModelId", () => {
  it("should strip xai/ prefix", () => {
    expect(toGrokCliModelId("xai/grok-4-1-fast")).toBe("grok-4-1-fast");
  });

  it("should return id unchanged when no xai/ prefix", () => {
    expect(toGrokCliModelId("grok-build")).toBe("grok-build");
  });
});

// -- Provider --

describe("GrokCliProvider", () => {
  let spawnMod: { spawnWithIdleTimeout: ReturnType<typeof mock>; IdleTimeoutError: typeof IdleTimeoutError };

  beforeEach(() => {
    spawnMod = {
      spawnWithIdleTimeout: mock(() => Promise.resolve({ stdout: "ok", stderr: "", exitCode: 0 })),
      IdleTimeoutError,
    };
    mock.module("./spawn-with-idle", () => spawnMod);
  });

  function provider() {
    return new GrokCliProvider({ apiKey: "test-key" });
  }

  function baseReq(over: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest {
    return { model: "xai/grok-build", messages: [{ role: "user", content: "Hi" }], ...over };
  }

  /** argv passed to spawn on the first call. */
  function argv(): string[] {
    return spawnMod.spawnWithIdleTimeout.mock.calls[0]![0] as string[];
  }
  function spawnOpts(): { cwd: string; env: Record<string, string | undefined> } {
    return spawnMod.spawnWithIdleTimeout.mock.calls[0]![1] as { cwd: string; env: Record<string, string | undefined> };
  }

  it("should have name 'xai' and declare fileAccess capability", () => {
    expect(provider().name).toBe("xai");
    expect(provider().capabilities.fileAccess).toBe(true);
  });

  // -- fileAccess → cwd + permission-mode --

  it("no fileAccess: cwd /tmp, bypassPermissions + --no-plan", async () => {
    await provider().chat(baseReq());
    expect(spawnOpts().cwd).toBe("/tmp");
    const a = argv();
    const pm = a.indexOf("--permission-mode");
    expect(a[pm + 1]).toBe("bypassPermissions");
    expect(a).toContain("--no-plan");
  });

  it("fileAccess read: cwd process.cwd(), permission-mode plan, no --no-plan", async () => {
    await provider().chat(baseReq({ fileAccess: "read" }));
    expect(spawnOpts().cwd).toBe(process.cwd());
    const a = argv();
    const pm = a.indexOf("--permission-mode");
    expect(a[pm + 1]).toBe("plan");
    expect(a).not.toContain("--no-plan");
  });

  it("fileAccess write: cwd process.cwd(), bypassPermissions, no --no-plan", async () => {
    await provider().chat(baseReq({ fileAccess: "write" }));
    expect(spawnOpts().cwd).toBe(process.cwd());
    const a = argv();
    const pm = a.indexOf("--permission-mode");
    expect(a[pm + 1]).toBe("bypassPermissions");
    expect(a).not.toContain("--no-plan");
  });

  // -- session id capture / resume --

  it("names a fresh session with a generated UUID and returns it", async () => {
    const res = await provider().chat(baseReq());
    const a = argv();
    const i = a.indexOf("--session-id");
    expect(i).toBeGreaterThan(-1);
    expect(a).not.toContain("--resume");
    // the id passed to the CLI is the id returned for later resume
    expect(res.sessionId).toBe(a[i + 1]);
    expect(res.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("resumes the given session id via --resume (not --session-id) and echoes it back", async () => {
    const res = await provider().chat(baseReq({ resumeSessionId: "fixed-session-123" }));
    const a = argv();
    const r = a.indexOf("--resume");
    expect(r).toBeGreaterThan(-1);
    expect(a[r + 1]).toBe("fixed-session-123");
    expect(a).not.toContain("--session-id");
    expect(res.sessionId).toBe("fixed-session-123");
  });

  // -- web / effort / system --

  it("keeps web search on by default (webAccess undefined)", async () => {
    // Grok confabulates in no-lookup mode (~8% floor even after prompt discipline), so this
    // provider defaults its web tools ON; a host opts out per run with an explicit false.
    await provider().chat(baseReq());
    expect(argv()).not.toContain("--disable-web-search");
  });

  it("disables web search only on explicit webAccess: false", async () => {
    await provider().chat(baseReq({ webAccess: false }));
    expect(argv()).toContain("--disable-web-search");
  });

  it("keeps web search on when webAccess is true", async () => {
    await provider().chat(baseReq({ webAccess: true }));
    expect(argv()).not.toContain("--disable-web-search");
  });

  it("passes system block via --system-prompt-override", async () => {
    await provider().chat(baseReq({ system: "You are terse." }));
    const a = argv();
    const i = a.indexOf("--system-prompt-override");
    expect(a[i + 1]).toBe("You are terse.");
  });

  it("buckets reasoning_effort onto --reasoning-effort", async () => {
    await provider().chat(baseReq({ reasoning_effort: 10 }));
    const a = argv();
    const i = a.indexOf("--reasoning-effort");
    expect(i).toBeGreaterThan(-1);
    expect(a[i + 1]).toBe("max");
  });

  it("injects the api key into spawn env", async () => {
    await provider().chat(baseReq());
    expect(spawnOpts().env.XAI_API_KEY).toBe("test-key");
    expect(spawnOpts().env.GROK_CODE_XAI_API_KEY).toBe("test-key");
  });

  // -- response + errors --

  it("returns trimmed stdout as assistant content", async () => {
    spawnMod.spawnWithIdleTimeout.mockImplementation(() =>
      Promise.resolve({ stdout: "  answer  ", stderr: "", exitCode: 0 }));
    const res = await provider().chat(baseReq());
    expect(res.choices[0]!.message.content).toBe("answer");
  });

  it("throws 500 cli_error on non-zero exit", async () => {
    spawnMod.spawnWithIdleTimeout.mockImplementation(() =>
      Promise.resolve({ stdout: "", stderr: "boom", exitCode: 1 }));
    try {
      await provider().chat(baseReq());
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(LLMClientError);
      expect((e as LLMClientError).status).toBe(500);
    }
  });

  it("maps IdleTimeoutError to 408 timeout", async () => {
    spawnMod.spawnWithIdleTimeout.mockImplementation(() =>
      Promise.reject(new IdleTimeoutError(300_000)));
    try {
      await provider().chat(baseReq());
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(LLMClientError);
      expect((e as LLMClientError).status).toBe(408);
    }
  });
});
