/**
 * Unit tests for CodexCliProvider, toCodexCliModelId, and serializeMessages.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { LLMClientError } from "../errors";
import { IdleTimeoutError } from "./spawn-with-idle";
import {
  CodexCliProvider,
  toCodexCliModelId,
  serializeMessages,
} from "./codex-cli";

// -- Pure functions --

describe("toCodexCliModelId", () => {
  it("should strip openai/ prefix", () => {
    expect(toCodexCliModelId("openai/gpt-5.4")).toBe("gpt-5.4");
  });

  it("should return id unchanged when no openai/ prefix", () => {
    expect(toCodexCliModelId("gpt-5")).toBe("gpt-5");
  });
});

describe("serializeMessages", () => {
  it("should include system messages as-is", () => {
    const result = serializeMessages([
      { role: "system", content: "Be concise." },
      { role: "user", content: "Hello" },
    ]);
    expect(result).toBe("Be concise.\n\nHello");
  });

  it("should include user messages as-is", () => {
    const result = serializeMessages([
      { role: "user", content: "First" },
      { role: "user", content: "Second" },
    ]);
    expect(result).toBe("First\n\nSecond");
  });

  it("should prefix assistant messages with role marker", () => {
    const result = serializeMessages([
      { role: "user", content: "Q?" },
      { role: "assistant", content: "A." },
      { role: "user", content: "Follow up" },
    ]);
    expect(result).toBe("Q?\n\n[Assistant]: A.\n\nFollow up");
  });

  it("should handle null content gracefully", () => {
    const result = serializeMessages([
      { role: "system", content: null },
      { role: "user", content: null },
    ]);
    expect(result).toBe("\n\n");
  });
});

// -- Provider --

describe("CodexCliProvider", () => {
  let spawnMod: { spawnWithIdleTimeout: ReturnType<typeof mock> };

  beforeEach(() => {
    spawnMod = {
      spawnWithIdleTimeout: mock(() => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })),
    };
    mock.module("./spawn-with-idle", () => spawnMod);
  });

  function setSpawnResult(stdout: string, exitCode = 0, stderr = "") {
    spawnMod.spawnWithIdleTimeout.mockImplementation(() =>
      Promise.resolve({ stdout, stderr, exitCode }),
    );
  }

  function setSpawnThrow(error: Error) {
    spawnMod.spawnWithIdleTimeout.mockImplementation(() => Promise.reject(error));
  }

  it("should have name 'openai'", () => {
    const provider = new CodexCliProvider();
    expect(provider.name).toBe("openai");
  });

  // -- fileAccess / cwd --

  it("should use cwd /tmp when fileAccess is not set", async () => {
    setSpawnResult(JSON.stringify({ type: "item.completed", item: { text: "ok" } }));
    const provider = new CodexCliProvider();
    await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
    const opts = spawnMod.spawnWithIdleTimeout.mock.calls[0]![1] as { cwd: string };
    expect(opts.cwd).toBe("/tmp");
    const args = spawnMod.spawnWithIdleTimeout.mock.calls[0]![0] as string[];
    expect(args).not.toContain("--sandbox");
  });

  it("should use process.cwd() and --sandbox read-only when fileAccess is true", async () => {
    setSpawnResult(JSON.stringify({ type: "item.completed", item: { text: "ok" } }));
    const provider = new CodexCliProvider();
    await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }], fileAccess: true });
    const opts = spawnMod.spawnWithIdleTimeout.mock.calls[0]![1] as { cwd: string };
    expect(opts.cwd).toBe(process.cwd());
    const args = spawnMod.spawnWithIdleTimeout.mock.calls[0]![0] as string[];
    expect(args).toContain("--sandbox");
    expect(args).toContain("read-only");
  });

  // -- Happy path: structured event parsing --

  it("should extract text from item.completed event", async () => {
    const stdout = JSON.stringify({ type: "item.completed", item: { text: "Hello from Codex" } });
    setSpawnResult(stdout);
    const provider = new CodexCliProvider();
    const res = await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
    expect(res.choices[0]!.message.content).toBe("Hello from Codex");
    expect(res.model).toBe("openai/gpt-5.4");
  });

  it("should extract tokens from turn.completed event", async () => {
    const lines = [
      JSON.stringify({ type: "item.completed", item: { text: "result" } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 200, output_tokens: 80 } }),
    ].join("\n");
    setSpawnResult(lines);
    const provider = new CodexCliProvider();
    const res = await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
    expect(res.choices[0]!.message.content).toBe("result");
    expect(res.usage!.prompt_tokens).toBe(200);
    expect(res.usage!.completion_tokens).toBe(80);
  });

  it("should use last item.completed when multiple exist", async () => {
    const lines = [
      JSON.stringify({ type: "item.completed", item: { text: "first" } }),
      JSON.stringify({ type: "item.completed", item: { text: "second" } }),
    ].join("\n");
    setSpawnResult(lines);
    const provider = new CodexCliProvider();
    const res = await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
    expect(res.choices[0]!.message.content).toBe("second");
  });

  it("should skip non-JSON lines gracefully", async () => {
    const lines = [
      "some debug output",
      JSON.stringify({ type: "item.completed", item: { text: "ok" } }),
      "another debug line",
    ].join("\n");
    setSpawnResult(lines);
    const provider = new CodexCliProvider();
    const res = await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
    expect(res.choices[0]!.message.content).toBe("ok");
  });

  it("should fall back to raw stdout when no structured events found", async () => {
    setSpawnResult("raw text output");
    const provider = new CodexCliProvider();
    const res = await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
    expect(res.choices[0]!.message.content).toBe("raw text output");
  });

  it("should default tokens to 0 when usage fields are undefined", async () => {
    const lines = [
      JSON.stringify({ type: "item.completed", item: { text: "ok" } }),
      JSON.stringify({ type: "turn.completed", usage: {} }),
    ].join("\n");
    setSpawnResult(lines);
    const provider = new CodexCliProvider();
    const res = await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
    expect(res.usage).toBeUndefined();
  });

  it("should omit usage when both tokens are 0", async () => {
    setSpawnResult(JSON.stringify({ type: "item.completed", item: { text: "ok" } }));
    const provider = new CodexCliProvider();
    const res = await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
    expect(res.usage).toBeUndefined();
  });

  it("should include usage when at least one token count is > 0", async () => {
    const lines = [
      JSON.stringify({ type: "item.completed", item: { text: "ok" } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 50, output_tokens: 0 } }),
    ].join("\n");
    setSpawnResult(lines);
    const provider = new CodexCliProvider();
    const res = await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
    expect(res.usage).toBeDefined();
    expect(res.usage!.prompt_tokens).toBe(50);
  });

  // -- Error: exitCode !== 0 --

  it("should throw 429 rate_limit for stdout containing 'usage limit'", async () => {
    setSpawnResult("usage limit exceeded", 1);
    const provider = new CodexCliProvider();
    try {
      await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(429);
      expect(err.type).toBe("rate_limit");
    }
  });

  it("should throw 429 rate_limit for stdout containing 'purchase more credits'", async () => {
    setSpawnResult("please purchase more credits", 1);
    const provider = new CodexCliProvider();
    try {
      await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(429);
      expect(err.type).toBe("rate_limit");
    }
  });

  it("should throw 429 rate_limit for stdout containing 'rate limit'", async () => {
    setSpawnResult("rate limit hit", 1);
    const provider = new CodexCliProvider();
    try {
      await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(429);
      expect(err.type).toBe("rate_limit");
    }
  });

  it("should throw 429 rate_limit for stdout containing 'too many requests'", async () => {
    setSpawnResult("too many requests", 1);
    const provider = new CodexCliProvider();
    try {
      await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(429);
      expect(err.type).toBe("rate_limit");
    }
  });

  it("should throw 500 cli_error for other non-zero exit codes", async () => {
    setSpawnResult("", 2, "segfault");
    const provider = new CodexCliProvider();
    try {
      await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(500);
      expect(err.type).toBe("cli_error");
      expect(err.message).toContain("exited with code 2");
    }
  });

  // -- Error: spawn exceptions --

  it("should convert IdleTimeoutError to 408 timeout", async () => {
    setSpawnThrow(new IdleTimeoutError(300_000));
    const provider = new CodexCliProvider();
    try {
      await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(408);
      expect(err.type).toBe("timeout");
    }
  });

  it("should rethrow LLMClientError as-is", async () => {
    const original = new LLMClientError(503, "down", "server_error");
    setSpawnThrow(original);
    const provider = new CodexCliProvider();
    try {
      await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBe(original);
    }
  });

  it("should wrap generic Error as 500 cli_spawn_error", async () => {
    setSpawnThrow(new Error("ENOENT: codex not found"));
    const provider = new CodexCliProvider();
    try {
      await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(500);
      expect(err.type).toBe("cli_spawn_error");
      expect(err.message).toContain("ENOENT");
    }
  });

  it("should wrap non-Error throw as 500 cli_spawn_error", async () => {
    spawnMod.spawnWithIdleTimeout.mockImplementation(() => Promise.reject("raw string"));
    const provider = new CodexCliProvider();
    try {
      await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(500);
      expect(err.type).toBe("cli_spawn_error");
      expect(err.message).toContain("raw string");
    }
  });

  // -- CLI args --

  it("should pass correct CLI args with --json and --full-auto", async () => {
    setSpawnResult(JSON.stringify({ type: "item.completed", item: { text: "ok" } }));
    const provider = new CodexCliProvider();
    await provider.chat({ model: "openai/gpt-5.4", messages: [{ role: "user", content: "test" }] });
    const args = spawnMod.spawnWithIdleTimeout.mock.calls[0]![0] as string[];
    expect(args[0]).toBe("codex");
    expect(args).toContain("exec");
    expect(args).toContain("--json");
    expect(args).toContain("-m");
    expect(args).toContain("gpt-5.4");
    expect(args).toContain("--full-auto");
    expect(args).toContain("--skip-git-repo-check");
  });
});
