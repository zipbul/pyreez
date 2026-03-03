/**
 * Unit tests for config.ts — loadConfigFromEnv + loadRoutingConfig.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfigFromEnv, loadRoutingConfig, DEFAULT_ROUTING_CONFIG } from "./config";

// -- Helpers --

const ENV_KEYS = [
  "PYREEZ_ANTHROPIC_KEY",
  "PYREEZ_GOOGLE_API_KEY",
  "PYREEZ_OPENAI_KEY",
  "PYREEZ_DEEPSEEK_KEY",
  "PYREEZ_XAI_KEY",
  "PYREEZ_MISTRAL_KEY",
  "PYREEZ_QWEN_KEY",
  "PYREEZ_GROQ_KEY",
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

  it("should configure deepseek provider when PYREEZ_DEEPSEEK_KEY is set", () => {
    Bun.env.PYREEZ_DEEPSEEK_KEY = "sk-ds";

    const result = loadConfigFromEnv();

    expect(result.providers.deepseek).toEqual({ apiKey: "sk-ds" });
  });

  it("should configure xai provider when PYREEZ_XAI_KEY is set", () => {
    Bun.env.PYREEZ_XAI_KEY = "xai-key";

    const result = loadConfigFromEnv();

    expect(result.providers.xai).toEqual({ apiKey: "xai-key" });
  });

  it("should configure mistral provider when PYREEZ_MISTRAL_KEY is set", () => {
    Bun.env.PYREEZ_MISTRAL_KEY = "mist-key";

    const result = loadConfigFromEnv();

    expect(result.providers.mistral).toEqual({ apiKey: "mist-key" });
  });

  it("should configure qwen provider when PYREEZ_QWEN_KEY is set", () => {
    Bun.env.PYREEZ_QWEN_KEY = "qwen-key";

    const result = loadConfigFromEnv();

    expect(result.providers.qwen).toEqual({ apiKey: "qwen-key" });
  });

  it("should configure groq provider when PYREEZ_GROQ_KEY is set", () => {
    Bun.env.PYREEZ_GROQ_KEY = "groq-key";

    const result = loadConfigFromEnv();

    expect(result.providers.groq).toEqual({ apiKey: "groq-key" });
  });

  it("should use default routing config when no routing param provided", () => {
    Bun.env.PYREEZ_ANTHROPIC_KEY = "test-key";

    const result = loadConfigFromEnv();

    expect(result.routing).toEqual(DEFAULT_ROUTING_CONFIG);
  });

  it("should use provided routing config when passed", () => {
    Bun.env.PYREEZ_ANTHROPIC_KEY = "test-key";
    const custom = { qualityWeight: 0.9, costWeight: 0.1 };

    const result = loadConfigFromEnv(custom);

    expect(result.routing).toEqual(custom);
  });
});

describe("loadRoutingConfig", () => {
  it("should return defaults when file does not exist", async () => {
    const result = await loadRoutingConfig("/tmp/nonexistent-pyreez-config.jsonc");

    expect(result).toEqual(DEFAULT_ROUTING_CONFIG);
  });

  it("should parse JSONC file with comments", async () => {
    const path = `/tmp/pyreez-test-config-${Date.now()}.jsonc`;
    await Bun.write(path, `{
      // routing weights
      "routing": {
        "qualityWeight": 0.5,
        "costWeight": 0.5
      }
    }`);

    const result = await loadRoutingConfig(path);

    expect(result.qualityWeight).toBe(0.5);
    expect(result.costWeight).toBe(0.5);
  });

  it("should return defaults when routing key is missing", async () => {
    const path = `/tmp/pyreez-test-config-${Date.now()}.jsonc`;
    await Bun.write(path, `{ "other": true }`);

    const result = await loadRoutingConfig(path);

    expect(result).toEqual(DEFAULT_ROUTING_CONFIG);
  });

  it("should fill missing fields with defaults", async () => {
    const path = `/tmp/pyreez-test-config-${Date.now()}.jsonc`;
    await Bun.write(path, `{ "routing": { "qualityWeight": 0.9 } }`);

    const result = await loadRoutingConfig(path);

    expect(result.qualityWeight).toBe(0.9);
    expect(result.costWeight).toBe(DEFAULT_ROUTING_CONFIG.costWeight);
  });

  it("should return defaults when file contains invalid JSON", async () => {
    const path = `/tmp/pyreez-test-config-${Date.now()}.jsonc`;
    await Bun.write(path, `not valid json {{{`);

    const result = await loadRoutingConfig(path);

    expect(result).toEqual(DEFAULT_ROUTING_CONFIG);
  });

  it("should clamp negative weights to 0", async () => {
    const path = `/tmp/pyreez-test-config-${Date.now()}.jsonc`;
    await Bun.write(path, JSON.stringify({ routing: { qualityWeight: -0.5, costWeight: -1 } }));

    const result = await loadRoutingConfig(path);

    expect(result.qualityWeight).toBe(0);
    expect(result.costWeight).toBe(0);
  });
});
