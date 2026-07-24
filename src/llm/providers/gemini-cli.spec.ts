/**
 * Unit tests for GeminiCliProvider and toGeminiCliModelId.
 * (serializeMessages is shared in message-util and tested in message-util.spec.)
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { LLMClientError } from "../errors";
import { IdleTimeoutError } from "./spawn-with-idle";
import { GeminiCliProvider, toGeminiCliModelId } from "./gemini-cli";

// -- Pure functions --

describe("toGeminiCliModelId", () => {
  it("should strip google/ prefix", () => {
    expect(toGeminiCliModelId("google/gemini-3.1-pro-preview")).toBe("gemini-3.1-pro-preview");
  });

  it("should return id unchanged when no google/ prefix", () => {
    expect(toGeminiCliModelId("gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });
});

// -- Provider --

describe("GeminiCliProvider", () => {
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

  it("should have name 'google'", () => {
    const provider = new GeminiCliProvider();
    expect(provider.name).toBe("google");
  });

  // -- fileAccess / cwd --

  it("should use cwd /tmp when fileAccess is not set", async () => {
    setSpawnResult(JSON.stringify({ response: "ok" }));
    const provider = new GeminiCliProvider();
    await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
    const opts = spawnMod.spawnWithIdleTimeout.mock.calls[0]![1] as { cwd: string };
    expect(opts.cwd).toBe("/tmp");
  });

  it("should use process.cwd() when fileAccess is set", async () => {
    setSpawnResult(JSON.stringify({ response: "ok" }));
    const provider = new GeminiCliProvider();
    await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }], fileAccess: "read" });
    const opts = spawnMod.spawnWithIdleTimeout.mock.calls[0]![1] as { cwd: string };
    expect(opts.cwd).toBe(process.cwd());
  });

  // -- Happy path: valid JSON response --

  it("should handle a JSON response", async () => {
    setSpawnResult(JSON.stringify({ response: "no stats" }));
    const provider = new GeminiCliProvider();
    const res = await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
    expect(res.content).toBe("no stats");
  });

  it("should use empty string when response field is missing from JSON", async () => {
    setSpawnResult(JSON.stringify({}));
    const provider = new GeminiCliProvider();
    const res = await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
    expect(res.content).toBe("");
  });


  // -- Happy path: invalid JSON fallback --
  // -- Error: exitCode !== 0 --

  it("should throw 429 timeout for stderr containing '429'", async () => {
    setSpawnResult("", 1, "Error 429: quota exceeded");
    const provider = new GeminiCliProvider();
    try {
      await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(LLMClientError);
      const err = e as LLMClientError;
      expect(err.status).toBe(429);
      expect(err.type).toBe("timeout");
    }
  });

  it("should throw 429 timeout for stderr containing 'RESOURCE_EXHAUSTED'", async () => {
    setSpawnResult("", 1, "RESOURCE_EXHAUSTED: limit reached");
    const provider = new GeminiCliProvider();
    try {
      await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(429);
      expect(err.type).toBe("timeout");
    }
  });

  it("should throw 429 timeout for stderr containing 'rateLimitExceeded'", async () => {
    setSpawnResult("", 1, "rateLimitExceeded for this model");
    const provider = new GeminiCliProvider();
    try {
      await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(429);
      expect(err.type).toBe("timeout");
    }
  });

  it("should throw 409 cli_error for EACCES + projects.json file race", async () => {
    setSpawnResult("", 1, "EACCES: permission denied, rename '/home/.gemini/projects.json.tmp'");
    const provider = new GeminiCliProvider();
    try {
      await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(409);
      expect(err.type).toBe("cli_error");
      expect(err.message).toContain("file race");
    }
  });

  it("should throw 500 cli_error for other non-zero exit codes", async () => {
    setSpawnResult("", 2, "unknown error occurred");
    const provider = new GeminiCliProvider();
    try {
      await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
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
    const provider = new GeminiCliProvider();
    try {
      await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(408);
      expect(err.type).toBe("timeout");
    }
  });

  it("should rethrow LLMClientError as-is", async () => {
    const original = new LLMClientError(503, "provider down", "server_error");
    setSpawnThrow(original);
    const provider = new GeminiCliProvider();
    try {
      await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBe(original);
    }
  });

  it("should wrap generic Error as 500 cli_spawn_error", async () => {
    setSpawnThrow(new Error("ENOENT: gemini not found"));
    const provider = new GeminiCliProvider();
    try {
      await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(500);
      expect(err.type).toBe("cli_spawn_error");
      expect(err.message).toContain("ENOENT");
    }
  });

  it("should wrap non-Error throw as 500 cli_spawn_error", async () => {
    spawnMod.spawnWithIdleTimeout.mockImplementation(() => Promise.reject("string error"));
    const provider = new GeminiCliProvider();
    try {
      await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
      expect.unreachable("should throw");
    } catch (e) {
      const err = e as LLMClientError;
      expect(err.status).toBe(500);
      expect(err.type).toBe("cli_spawn_error");
      expect(err.message).toContain("string error");
    }
  });

  // -- CLI args --

  it("should pass correct CLI args including -y and -o json", async () => {
    setSpawnResult(JSON.stringify({ response: "ok" }));
    const provider = new GeminiCliProvider();
    await provider.chat({
      model: "google/gemini-3.1-pro-preview",
      messages: [{ role: "user", content: "test" }],
    });
    const args = spawnMod.spawnWithIdleTimeout.mock.calls[0]![0] as string[];
    expect(args[0]).toBe("gemini");
    expect(args).toContain("-p");
    expect(args).toContain("--model");
    expect(args).toContain("gemini-3.1-pro-preview");
    expect(args).toContain("-o");
    expect(args).toContain("json");
    // Read-only mode (parity with claude/codex), not YOLO auto-approve-all.
    expect(args).toContain("--approval-mode");
    expect(args).toContain("plan");
    expect(args).not.toContain("-y");
    // gemini 0.40+ exits 55 in an untrusted dir; --skip-trust prevents the abort.
    expect(args).toContain("--skip-trust");
  });

  it("frames request.system into the -p value via the XML boundary (no native system flag)", async () => {
    setSpawnResult(JSON.stringify({ response: "ok" }));
    const provider = new GeminiCliProvider();
    await provider.chat({
      model: "google/gemini-3.1-pro-preview",
      system: "Be concise.",
      messages: [{ role: "user", content: "Hello" }],
    });
    const args = spawnMod.spawnWithIdleTimeout.mock.calls[0]![0] as string[];
    const pIdx = args.indexOf("-p");
    const prompt = args[pIdx + 1]!;
    expect(prompt).toContain("<system-instructions>");
    expect(prompt).toContain("Be concise.");
    expect(prompt).toContain("Hello");
  });
});
