/**
 * Unit tests for ClaudeCliProvider, toCliModelId, and serializeMessages.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { LLMClientError } from "../errors";
import { IdleTimeoutError } from "./spawn-with-idle";
import {
  ClaudeCliProvider,
  toCliModelId,
  serializeMessages,
} from "./claude-cli";

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
    const result = serializeMessages([
      { role: "user", content: "Hello" },
    ]);
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

describe("ClaudeCliProvider", () => {
  let spawnMod: { spawnWithIdleTimeout: ReturnType<typeof mock> };

  beforeEach(() => {
    spawnMod = {
      spawnWithIdleTimeout: mock(() => Promise.resolve({ stdout: "{}", stderr: "", exitCode: 0 })),
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

  it("should have name 'anthropic' for provider routing", () => {
    const provider = new ClaudeCliProvider();
    expect(provider.name).toBe("anthropic");
  });

  // -- Happy path --

  it("should return parsed response on success", async () => {
    setSpawnResult(JSON.stringify({
      type: "result",
      result: "Hello from Claude CLI!",
      is_error: false,
      cost_usd: 0,
      duration_ms: 500,
    }));

    const provider = new ClaudeCliProvider();
    const response = await provider.chat({
      model: "anthropic/claude-sonnet-4.6",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.choices[0]!.message.content).toBe("Hello from Claude CLI!");
    expect(response.choices[0]!.finish_reason).toBe("stop");
    expect(response.model).toBe("anthropic/claude-sonnet-4.6");
  });

  it("should pass correct CLI args", async () => {
    setSpawnResult(JSON.stringify({ result: "ok", is_error: false }));

    const provider = new ClaudeCliProvider();
    await provider.chat({
      model: "anthropic/claude-sonnet-4.6",
      messages: [{ role: "user", content: "Hi" }],
    });

    const args = spawnMod.spawnWithIdleTimeout.mock.calls[0]![0] as string[];
    expect(args).toContain("claude");
    expect(args).toContain("-p");
    expect(args).toContain("--model");
    expect(args).toContain("claude-sonnet-4-6");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--tools");
    expect(args).toContain("");
  });

  it("should pass system prompt via --system-prompt flag", async () => {
    setSpawnResult(JSON.stringify({ result: "ok", is_error: false }));

    const provider = new ClaudeCliProvider();
    await provider.chat({
      model: "anthropic/claude-opus-4.6",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
    });

    const args = spawnMod.spawnWithIdleTimeout.mock.calls[0]![0] as string[];
    expect(args).toContain("--system-prompt");
    expect(args).toContain("Be concise.");
  });

  it("should use default system prompt when no system messages", async () => {
    setSpawnResult(JSON.stringify({ result: "ok", is_error: false }));

    const provider = new ClaudeCliProvider();
    await provider.chat({
      model: "anthropic/claude-opus-4.6",
      messages: [{ role: "user", content: "Hi" }],
    });

    const args = spawnMod.spawnWithIdleTimeout.mock.calls[0]![0] as string[];
    expect(args).toContain("--system-prompt");
    expect(args).toContain("You are a helpful assistant. Respond concisely.");
  });

  it("should use plain text fallback when stdout is not valid JSON", async () => {
    setSpawnResult("plain text response");
    const provider = new ClaudeCliProvider();
    const res = await provider.chat({
      model: "anthropic/claude-opus-4.6",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(res.choices[0]!.message.content).toBe("plain text response");
  });

  it("should use empty string when result field is missing", async () => {
    setSpawnResult(JSON.stringify({ is_error: false }));
    const provider = new ClaudeCliProvider();
    const res = await provider.chat({
      model: "anthropic/claude-opus-4.6",
      messages: [{ role: "user", content: "Hi" }],
    });
    expect(res.choices[0]!.message.content).toBe("");
  });

  // -- fileAccess --

  it("should use cwd /tmp when fileAccess is not set", async () => {
    setSpawnResult(JSON.stringify({ result: "ok", is_error: false }));
    const provider = new ClaudeCliProvider();
    await provider.chat({ model: "anthropic/claude-opus-4.6", messages: [{ role: "user", content: "Hi" }] });
    const opts = spawnMod.spawnWithIdleTimeout.mock.calls[0]![1] as { cwd: string };
    expect(opts.cwd).toBe("/tmp");
    const args = spawnMod.spawnWithIdleTimeout.mock.calls[0]![0] as string[];
    expect(args).toContain("");  // --tools ""
  });

  it("should use process.cwd() and file tools when fileAccess is true", async () => {
    setSpawnResult(JSON.stringify({ result: "ok", is_error: false }));
    const provider = new ClaudeCliProvider();
    await provider.chat({ model: "anthropic/claude-opus-4.6", messages: [{ role: "user", content: "Hi" }], fileAccess: true });
    const opts = spawnMod.spawnWithIdleTimeout.mock.calls[0]![1] as { cwd: string };
    expect(opts.cwd).toBe(process.cwd());
    const args = spawnMod.spawnWithIdleTimeout.mock.calls[0]![0] as string[];
    expect(args).toContain("Read,Glob,Grep,Bash(git:*)");
  });

  // -- Error: non-zero exit --

  it("should throw LLMClientError when CLI exits with non-zero code", async () => {
    setSpawnResult("", 1, "Command not found");
    const provider = new ClaudeCliProvider();
    try {
      await provider.chat({ model: "anthropic/claude-opus-4.6", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(500);
      expect(err.type).toBe("cli_error");
      expect(err.message).toContain("exited with code 1");
    }
  });

  it("should throw LLMClientError when CLI returns is_error: true", async () => {
    setSpawnResult(JSON.stringify({ result: "Rate limited", is_error: true }));
    const provider = new ClaudeCliProvider();
    try {
      await provider.chat({ model: "anthropic/claude-opus-4.6", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(500);
      expect(err.type).toBe("cli_runtime_error");
      expect(err.message).toContain("Rate limited");
    }
  });

  // -- Error: spawn exceptions --

  it("should convert IdleTimeoutError to 408 timeout", async () => {
    setSpawnThrow(new IdleTimeoutError(300_000));
    const provider = new ClaudeCliProvider();
    try {
      await provider.chat({ model: "anthropic/claude-opus-4.6", messages: [{ role: "user", content: "Hi" }] });
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
    const provider = new ClaudeCliProvider();
    try {
      await provider.chat({ model: "anthropic/claude-opus-4.6", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBe(original);
    }
  });

  it("should wrap generic Error as 500 cli_spawn_error", async () => {
    setSpawnThrow(new Error("ENOENT: claude not found"));
    const provider = new ClaudeCliProvider();
    try {
      await provider.chat({ model: "anthropic/claude-opus-4.6", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(500);
      expect(err.type).toBe("cli_spawn_error");
      expect(err.message).toContain("ENOENT");
    }
  });

  it("should strip CLAUDECODE env var from spawned process", async () => {
    setSpawnResult(JSON.stringify({ result: "ok", is_error: false }));
    const provider = new ClaudeCliProvider();
    await provider.chat({ model: "anthropic/claude-opus-4.6", messages: [{ role: "user", content: "Hi" }] });
    const opts = spawnMod.spawnWithIdleTimeout.mock.calls[0]![1] as { env: Record<string, string | undefined> };
    expect(opts.env.CLAUDECODE).toBeUndefined();
  });
});
