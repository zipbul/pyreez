/**
 * Unit tests for ClaudeCliProvider, toCliModelId, and serializeMessages.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
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
  it("should have name 'anthropic' for provider routing", () => {
    const provider = new ClaudeCliProvider();
    expect(provider.name).toBe("anthropic");
  });

  describe("chat", () => {
    let originalSpawn: typeof Bun.spawn;

    beforeEach(() => {
      originalSpawn = Bun.spawn;
    });

    function mockSpawn(
      jsonOutput: Record<string, unknown>,
      exitCode = 0,
      stderr = "",
    ) {
      const stdout = JSON.stringify(jsonOutput);
      // @ts-expect-error — mock Bun.spawn for testing
      Bun.spawn = mock((_cmd: string[], _opts: unknown) => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(stdout));
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(stderr));
            controller.close();
          },
        }),
        exited: Promise.resolve(exitCode),
      }));
    }

    function restoreSpawn() {
      Bun.spawn = originalSpawn;
    }

    it("should return parsed response on success", async () => {
      mockSpawn({
        type: "result",
        result: "Hello from Claude CLI!",
        is_error: false,
        cost_usd: 0,
        duration_ms: 500,
      });

      try {
        const provider = new ClaudeCliProvider();
        const response = await provider.chat({
          model: "anthropic/claude-sonnet-4.6",
          messages: [{ role: "user", content: "Hi" }],
        });

        const choice = response.choices[0]!;
        expect(choice.message.content).toBe("Hello from Claude CLI!");
        expect(choice.finish_reason).toBe("stop");
        expect(response.model).toBe("anthropic/claude-sonnet-4.6");

        // Verify spawn was called with correct args
        const spawnMock = Bun.spawn as ReturnType<typeof mock>;
        const callArgs = spawnMock.mock.calls[0]![0] as string[];
        expect(callArgs).toContain("claude");
        expect(callArgs).toContain("-p");
        expect(callArgs).toContain("--model");
        expect(callArgs).toContain("claude-sonnet-4-6");
        expect(callArgs).toContain("--output-format");
        expect(callArgs).toContain("json");
        expect(callArgs).toContain("--max-turns");
        expect(callArgs).toContain("1");
      } finally {
        restoreSpawn();
      }
    });

    it("should pass system prompt via --system-prompt flag", async () => {
      mockSpawn({ result: "ok", is_error: false });

      try {
        const provider = new ClaudeCliProvider();
        await provider.chat({
          model: "anthropic/claude-opus-4.6",
          messages: [
            { role: "system", content: "Be concise." },
            { role: "user", content: "Hello" },
          ],
        });

        const spawnMock = Bun.spawn as ReturnType<typeof mock>;
        const callArgs = spawnMock.mock.calls[0]![0] as string[];
        expect(callArgs).toContain("--system-prompt");
        expect(callArgs).toContain("Be concise.");
      } finally {
        restoreSpawn();
      }
    });

    it("should throw LLMClientError when CLI exits with non-zero code", async () => {
      mockSpawn({}, 1, "Command not found");

      try {
        const provider = new ClaudeCliProvider();
        await expect(
          provider.chat({
            model: "anthropic/claude-opus-4.6",
            messages: [{ role: "user", content: "Hi" }],
          }),
        ).rejects.toThrow("claude CLI exited with code 1");
      } finally {
        restoreSpawn();
      }
    });

    it("should throw LLMClientError when CLI returns is_error: true", async () => {
      mockSpawn({ result: "Rate limited", is_error: true });

      try {
        const provider = new ClaudeCliProvider();
        await expect(
          provider.chat({
            model: "anthropic/claude-opus-4.6",
            messages: [{ role: "user", content: "Hi" }],
          }),
        ).rejects.toThrow("claude CLI error: Rate limited");
      } finally {
        restoreSpawn();
      }
    });
  });
});
