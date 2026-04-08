/**
 * Unit tests for GeminiCliProvider, toGeminiCliModelId, and serializeMessages.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { LLMClientError } from "../errors";
import { IdleTimeoutError } from "./spawn-with-idle";
import {
  GeminiCliProvider,
  toGeminiCliModelId,
  serializeMessages,
} from "./gemini-cli";

// -- Pure functions --

describe("toGeminiCliModelId", () => {
  it("should strip google/ prefix", () => {
    expect(toGeminiCliModelId("google/gemini-3.1-pro-preview")).toBe("gemini-3.1-pro-preview");
  });

  it("should return id unchanged when no google/ prefix", () => {
    expect(toGeminiCliModelId("gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });
});

describe("serializeMessages", () => {
  it("should extract system messages separately", () => {
    const result = serializeMessages([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ]);
    expect(result.system).toBe("You are helpful.");
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
      { role: "user", content: "Q?" },
      { role: "assistant", content: "A." },
      { role: "user", content: "Follow up" },
    ]);
    expect(result.prompt).toBe("Q?\n\n[Assistant]: A.\n\nFollow up");
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

  it("should use process.cwd() when fileAccess is true", async () => {
    setSpawnResult(JSON.stringify({ response: "ok" }));
    const provider = new GeminiCliProvider();
    await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }], fileAccess: true });
    const opts = spawnMod.spawnWithIdleTimeout.mock.calls[0]![1] as { cwd: string };
    expect(opts.cwd).toBe(process.cwd());
  });

  // -- Happy path: valid JSON response --

  it("should parse valid JSON response with stats", async () => {
    const output = JSON.stringify({
      response: "Hello from Gemini",
      stats: {
        models: {
          "gemini-3.1-pro": { tokens: { input: 100, candidates: 50 } },
        },
      },
    });
    setSpawnResult(output);
    const provider = new GeminiCliProvider();
    const res = await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
    expect(res.choices[0]!.message.content).toBe("Hello from Gemini");
    expect(res.usage!.prompt_tokens).toBe(100);
    expect(res.usage!.completion_tokens).toBe(50);
    expect(res.model).toBe("google/gemini-3.1-pro-preview");
  });

  it("should sum tokens across multiple models in stats", async () => {
    const output = JSON.stringify({
      response: "ok",
      stats: {
        models: {
          "model-a": { tokens: { input: 100, candidates: 50 } },
          "model-b": { tokens: { input: 200, candidates: 75 } },
        },
      },
    });
    setSpawnResult(output);
    const provider = new GeminiCliProvider();
    const res = await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
    expect(res.usage!.prompt_tokens).toBe(300);
    expect(res.usage!.completion_tokens).toBe(125);
  });

  it("should handle JSON response without stats", async () => {
    setSpawnResult(JSON.stringify({ response: "no stats" }));
    const provider = new GeminiCliProvider();
    const res = await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
    expect(res.choices[0]!.message.content).toBe("no stats");
    expect(res.usage).toBeUndefined();
  });

  it("should use empty string when response field is missing from JSON", async () => {
    setSpawnResult(JSON.stringify({ stats: {} }));
    const provider = new GeminiCliProvider();
    const res = await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
    expect(res.choices[0]!.message.content).toBe("");
  });

  it("should omit usage when both tokens are 0", async () => {
    setSpawnResult(JSON.stringify({ response: "ok" }));
    const provider = new GeminiCliProvider();
    const res = await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
    expect(res.usage).toBeUndefined();
  });

  // -- Happy path: invalid JSON fallback --

  it("should use raw stdout when JSON parsing fails", async () => {
    setSpawnResult("plain text response");
    const provider = new GeminiCliProvider();
    const res = await provider.chat({ model: "google/gemini-3.1-pro-preview", messages: [{ role: "user", content: "Hi" }] });
    expect(res.choices[0]!.message.content).toBe("plain text response");
    expect(res.usage).toBeUndefined();
  });

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
    expect(args).toContain("-y");
  });

  it("should prepend system prompt to the -p value when system messages exist", async () => {
    setSpawnResult(JSON.stringify({ response: "ok" }));
    const provider = new GeminiCliProvider();
    await provider.chat({
      model: "google/gemini-3.1-pro-preview",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ],
    });
    const args = spawnMod.spawnWithIdleTimeout.mock.calls[0]![0] as string[];
    const pIdx = args.indexOf("-p");
    const prompt = args[pIdx + 1]!;
    expect(prompt).toContain("Be concise.");
    expect(prompt).toContain("Hello");
  });
});
