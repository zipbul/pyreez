/**
 * Unit tests for config.ts — githubModelsConfig and loadConfigFromEnv.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  githubModelsConfig,
  loadConfigFromEnv,
} from "./config";
import type { LLMProviderConfig } from "./config";

// -- Helpers --

/** Snapshot and restore Bun.env between tests. */
const ENV_KEYS = [
  "PYREEZ_GITHUB_PAT",
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

describe("githubModelsConfig", () => {
  it("should return correct LLMProviderConfig with explicit model when model provided", () => {
    // Arrange & Act
    const config = githubModelsConfig("my-pat", "custom-model");

    // Assert
    expect(config).toEqual({
      baseUrl: "https://models.github.ai",
      apiKey: "my-pat",
      model: "custom-model",
      chatEndpoint: "/inference/chat/completions",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  });

  it('should use default model "openai/gpt-4.1" when model param omitted', () => {
    // Arrange & Act
    const config = githubModelsConfig("my-pat");

    // Assert
    expect(config.model).toBe("openai/gpt-4.1");
  });

  it("should include chatEndpoint and Accept header in config", () => {
    // Arrange & Act
    const config = githubModelsConfig("pat");

    // Assert
    expect(config.chatEndpoint).toBe("/inference/chat/completions");
    expect(config.headers).toHaveProperty(
      "Accept",
      "application/vnd.github+json",
    );
  });
});

describe("factory independence", () => {
  it("should return independent objects on each call (not shared references)", () => {
    // Arrange & Act
    const a = githubModelsConfig("pat");
    const b = githubModelsConfig("pat");

    // Assert — same values but different references
    expect(a).toEqual(b);
    expect(a).not.toBe(b);

    // Mutating one does not affect the other
    a.model = "MUTATED";
    expect(b.model).toBe("openai/gpt-4.1");
  });
});

describe("loadConfigFromEnv", () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = snapshotEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it("should return github config with defaults when PAT is set", () => {
    // Arrange
    Bun.env.PYREEZ_GITHUB_PAT = "test-pat";

    // Act
    const result = loadConfigFromEnv();

    // Assert
    expect(result.llm.baseUrl).toBe("https://models.github.ai");
    expect(result.llm.model).toBe("openai/gpt-4.1");
    expect(result.llm.apiKey).toBe("test-pat");
    expect(result.llm.chatEndpoint).toBe("/inference/chat/completions");
  });

  it("should return github config with PAT and custom model when PYREEZ_MODEL is set", () => {
    // Arrange
    Bun.env.PYREEZ_GITHUB_PAT = "my-pat";
    Bun.env.PYREEZ_MODEL = "openai/gpt-4o";

    // Act
    const result = loadConfigFromEnv();

    // Assert
    expect(result.llm.model).toBe("openai/gpt-4o");
    expect(result.llm.apiKey).toBe("my-pat");
  });

  it("should throw when PYREEZ_GITHUB_PAT is missing", () => {
    // Arrange — no PAT set

    // Act & Assert
    expect(() => loadConfigFromEnv()).toThrow(
      "PYREEZ_GITHUB_PAT is required when using GitHub Models provider",
    );
  });
});
