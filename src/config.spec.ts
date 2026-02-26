/**
 * Unit tests for config.ts — loadConfigFromEnv.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfigFromEnv } from "./config";

// -- Helpers --

const ENV_KEYS = [
  "PYREEZ_ANTHROPIC_KEY",
  "PYREEZ_GOOGLE_API_KEY",
  "PYREEZ_OPENAI_KEY",
  "PYREEZ_CLAUDE_CLI",
  "PYREEZ_LOCAL_URL",
  "PYREEZ_LOCAL_SOCKET",
  "PYREEZ_MODEL",
] as const;

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const key of ENV_KEYS) {
    snap[key] = Bun.env[key];
  }
  return snap;
}

function restoreEnv(snap: EnvSnapshot) {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = snap[key];
    }
  }
}

function clearEnv() {
  for (const key of ENV_KEYS) {
    delete Bun.env[key];
  }
}

// -- Tests --

describe("loadConfigFromEnv", () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = snapshotEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it("should return anthropic provider when key is set", () => {
    Bun.env.PYREEZ_ANTHROPIC_KEY = "test-key";

    const result = loadConfigFromEnv();

    expect(result.providers.anthropic).toEqual({ apiKey: "test-key" });
    expect(result.defaultModel).toBe("anthropic/claude-sonnet-4.6");
  });

  it("should use custom defaultModel when PYREEZ_MODEL is set", () => {
    Bun.env.PYREEZ_ANTHROPIC_KEY = "my-key";
    Bun.env.PYREEZ_MODEL = "openai/gpt-4o";

    const result = loadConfigFromEnv();

    expect(result.defaultModel).toBe("openai/gpt-4o");
  });

  it("should throw when no provider keys are set", () => {
    expect(() => loadConfigFromEnv()).toThrow("No LLM providers configured");
  });

  it("should configure anthropic provider when PYREEZ_ANTHROPIC_KEY is set", () => {
    Bun.env.PYREEZ_ANTHROPIC_KEY = "sk-ant-test";

    const result = loadConfigFromEnv();

    expect(result.providers.anthropic).toEqual({ apiKey: "sk-ant-test" });
  });

  it("should configure google provider when PYREEZ_GOOGLE_API_KEY is set", () => {
    Bun.env.PYREEZ_GOOGLE_API_KEY = "goog-key";

    const result = loadConfigFromEnv();

    expect(result.providers.google).toEqual({ apiKey: "goog-key" });
  });

  it("should configure openai provider when PYREEZ_OPENAI_KEY is set", () => {
    Bun.env.PYREEZ_OPENAI_KEY = "sk-test";

    const result = loadConfigFromEnv();

    expect(result.providers.openai).toEqual({ apiKey: "sk-test" });
  });

  it("should configure multiple providers when multiple keys are set", () => {
    Bun.env.PYREEZ_ANTHROPIC_KEY = "sk-ant";
    Bun.env.PYREEZ_OPENAI_KEY = "sk-openai";

    const result = loadConfigFromEnv();

    expect(result.providers.anthropic).toBeDefined();
    expect(result.providers.openai).toBeDefined();
    expect(result.providers.google).toBeUndefined();
  });
});
