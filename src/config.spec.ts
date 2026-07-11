/**
 * Unit tests for config.ts — loadConfigFromEnv (provider keys from env).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfigFromEnv } from "./config";

const ENV_KEYS = ["PYREEZ_XAI_KEY"] as const;
type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const key of ENV_KEYS) snap[key] = Bun.env[key];
  return snap;
}
function restoreEnv(snap: EnvSnapshot) {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete Bun.env[key];
    else Bun.env[key] = snap[key];
  }
}
function clearEnv() {
  for (const key of ENV_KEYS) delete Bun.env[key];
}

describe("loadConfigFromEnv", () => {
  let envSnap: EnvSnapshot;
  beforeEach(() => { envSnap = snapshotEnv(); clearEnv(); });
  afterEach(() => { restoreEnv(envSnap); });

  it("configures the xai provider when PYREEZ_XAI_KEY is set", () => {
    Bun.env.PYREEZ_XAI_KEY = "xai-key";
    expect(loadConfigFromEnv().providers.xai).toEqual({ apiKey: "xai-key" });
  });

  it("leaves providers empty when no key is set (subscription providers need none)", () => {
    expect(loadConfigFromEnv().providers).toEqual({});
  });
});
