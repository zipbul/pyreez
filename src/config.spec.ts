/**
 * Unit tests for config.ts — loadConfigFromEnv + loadRoutingConfig.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfigFromEnv, loadRoutingConfig, DEFAULT_ROUTING_CONFIG } from "./config";

// -- Helpers --

const ENV_KEYS = [
  "PYREEZ_XAI_KEY",
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

  it("should use custom defaultModel when PYREEZ_MODEL is set", () => {
    Bun.env.PYREEZ_XAI_KEY = "xai-key";
    Bun.env.PYREEZ_MODEL = "openai/gpt-5.4";

    const result = loadConfigFromEnv();

    expect(result.defaultModel).toBe("openai/gpt-5.4");
  });

  it("should throw when no provider keys are set", () => {
    expect(() => loadConfigFromEnv()).toThrow("No LLM providers configured");
  });

  it("should configure xai provider when PYREEZ_XAI_KEY is set", () => {
    Bun.env.PYREEZ_XAI_KEY = "xai-key";

    const result = loadConfigFromEnv();

    expect(result.providers.xai).toEqual({ apiKey: "xai-key" });
  });


  it("should use default routing config when no routing param provided", () => {
    Bun.env.PYREEZ_XAI_KEY = "test-key";

    const result = loadConfigFromEnv();

    expect(result.routing).toEqual(DEFAULT_ROUTING_CONFIG);
  });

  it("should use provided routing config when passed", () => {
    Bun.env.PYREEZ_XAI_KEY = "test-key";
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
