/**
 * Unit tests for ClaudeAgentProvider + claudeSupportedModels.
 *
 * SUT: ClaudeAgentProvider.chat(), claudeSupportedModels()
 * External SDK boundary (`@anthropic-ai/claude-agent-sdk`'s `query()`) is test-doubled via the
 * DI seam (constructor / function parameter) — not mock.module(), which leaks across test files.
 */

import { describe, it, expect } from "bun:test";
import { ClaudeAgentProvider, claudeSupportedModels } from "./claude-agent";
import type { ClaudeQueryFn } from "./claude-agent";
import { LLMClientError } from "../errors";
import type { ChatCompletionRequest } from "../types";

function assistantMessage(text: string, sessionId?: string) {
  return {
    type: "assistant",
    ...(sessionId ? { session_id: sessionId } : {}),
    message: { content: [{ type: "text", text }] },
  };
}

/** Build a ClaudeQueryFn double that yields the given messages and captures the params it was called with. */
function fakeQuery(
  messages: unknown[],
  extra: { supportedModels?: () => Promise<unknown>; returnFn?: () => Promise<unknown> } = {},
): { queryFn: ClaudeQueryFn; calls: { prompt: unknown; options?: unknown }[] } {
  const calls: { prompt: unknown; options?: unknown }[] = [];
  const queryFn: ClaudeQueryFn = (params) => {
    calls.push(params);
    return {
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          async next() {
            if (i < messages.length) return { value: messages[i++], done: false as const };
            return { value: undefined, done: true as const };
          },
        };
      },
      ...(extra.supportedModels ? { supportedModels: extra.supportedModels } : {}),
      ...(extra.returnFn ? { return: extra.returnFn } : {}),
    } as ReturnType<ClaudeQueryFn>;
  };
  return { queryFn, calls };
}

function baseRequest(overrides: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest {
  return { model: "anthropic/claude-sonnet-4.6", messages: [{ role: "user", content: "hi" }], ...overrides };
}

describe("ClaudeAgentProvider.chat", () => {
  it("concatenates text blocks from streamed assistant messages", async () => {
    const { queryFn } = fakeQuery([assistantMessage("Hello "), assistantMessage("world")]);
    const provider = new ClaudeAgentProvider(queryFn);

    const response = await provider.chat(baseRequest());

    expect(response.choices[0]!.message.content).toBe("Hello world");
  });

  it("ignores non-text content blocks", async () => {
    const { queryFn } = fakeQuery([
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }, { type: "text", text: "ok" }] } },
    ]);
    const provider = new ClaudeAgentProvider(queryFn);

    const response = await provider.chat(baseRequest());

    expect(response.choices[0]!.message.content).toBe("ok");
  });

  it("captures the last session_id seen across streamed messages", async () => {
    const { queryFn } = fakeQuery([
      assistantMessage("part1", "session-A"),
      assistantMessage("part2", "session-B"),
    ]);
    const provider = new ClaudeAgentProvider(queryFn);

    const response = await provider.chat(baseRequest());

    expect(response.sessionId).toBe("session-B");
  });

  it("blocks all file/codebase tools and allows no web tools with no fileAccess/webAccess (default)", async () => {
    const { queryFn, calls } = fakeQuery([assistantMessage("ok")]);
    const provider = new ClaudeAgentProvider(queryFn);

    await provider.chat(baseRequest());

    const options = calls[0]!.options as any;
    expect(options.allowedTools).toEqual([]);
    expect(options.disallowedTools).toEqual(["Read", "Glob", "Grep", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"]);
    expect(options.cwd).toBeUndefined();
  });

  it("allows read-only tools and disallows write tools when fileAccess is 'read'", async () => {
    const { queryFn, calls } = fakeQuery([assistantMessage("ok")]);
    const provider = new ClaudeAgentProvider(queryFn);

    await provider.chat(baseRequest({ fileAccess: "read" }));

    const options = calls[0]!.options as any;
    expect(options.allowedTools).toEqual(["Read", "Glob", "Grep"]);
    expect(options.disallowedTools).toEqual(["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"]);
    expect(options.cwd).toBe(process.cwd());
  });

  it("allows both read and write tools with no disallowed tools when fileAccess is 'write'", async () => {
    const { queryFn, calls } = fakeQuery([assistantMessage("ok")]);
    const provider = new ClaudeAgentProvider(queryFn);

    await provider.chat(baseRequest({ fileAccess: "write" }));

    const options = calls[0]!.options as any;
    expect(options.allowedTools).toEqual(["Read", "Glob", "Grep", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"]);
    expect(options.disallowedTools).toEqual([]);
    expect(options.cwd).toBe(process.cwd());
  });

  it("adds WebSearch/WebFetch to allowedTools when webAccess is true, regardless of fileAccess", async () => {
    const { queryFn, calls } = fakeQuery([assistantMessage("ok")]);
    const provider = new ClaudeAgentProvider(queryFn);

    await provider.chat(baseRequest({ webAccess: true }));

    const options = calls[0]!.options as any;
    expect(options.allowedTools).toEqual(["WebSearch", "WebFetch"]);
  });

  it("sets systemPrompt only when request.system is present", async () => {
    const { queryFn: qWith, calls: callsWith } = fakeQuery([assistantMessage("ok")]);
    await new ClaudeAgentProvider(qWith).chat(baseRequest({ system: "Be terse." }));
    expect((callsWith[0]!.options as any).systemPrompt).toBe("Be terse.");

    const { queryFn: qWithout, calls: callsWithout } = fakeQuery([assistantMessage("ok")]);
    await new ClaudeAgentProvider(qWithout).chat(baseRequest());
    expect((callsWithout[0]!.options as any).systemPrompt).toBeUndefined();
  });

  it("buckets reasoning_effort into the Claude effort vocabulary only when provided", async () => {
    const { queryFn: qWith, calls: callsWith } = fakeQuery([assistantMessage("ok")]);
    await new ClaudeAgentProvider(qWith).chat(baseRequest({ reasoning_effort: 5 }));
    expect((callsWith[0]!.options as any).effort).toBe("high"); // bucketEffort(5, [low,medium,high,xhigh,max])

    const { queryFn: qWithout, calls: callsWithout } = fakeQuery([assistantMessage("ok")]);
    await new ClaudeAgentProvider(qWithout).chat(baseRequest());
    expect((callsWithout[0]!.options as any).effort).toBeUndefined();
  });

  it("sets resume only when resumeSessionId is provided", async () => {
    const { queryFn: qWith, calls: callsWith } = fakeQuery([assistantMessage("ok")]);
    await new ClaudeAgentProvider(qWith).chat(baseRequest({ resumeSessionId: "S1" }));
    expect((callsWith[0]!.options as any).resume).toBe("S1");

    const { queryFn: qWithout, calls: callsWithout } = fakeQuery([assistantMessage("ok")]);
    await new ClaudeAgentProvider(qWithout).chat(baseRequest());
    expect((callsWithout[0]!.options as any).resume).toBeUndefined();
  });

  it("wraps a thrown error via toSdkError with vendor 'claude'", async () => {
    const throwingQueryFn: ClaudeQueryFn = () => ({
      [Symbol.asyncIterator]() {
        return { async next(): Promise<IteratorResult<unknown>> { throw new Error("stream broke"); } };
      },
    });
    const provider = new ClaudeAgentProvider(throwingQueryFn);

    await expect(provider.chat(baseRequest())).rejects.toThrow(LLMClientError);
    await expect(provider.chat(baseRequest())).rejects.toThrow(/claude agent SDK error: stream broke/);
  });
});

describe("claudeSupportedModels", () => {
  it("returns the array resolved by supportedModels()", async () => {
    const { queryFn } = fakeQuery([], { supportedModels: async () => [{ value: "opus" }, { value: "sonnet" }] });

    const models = await claudeSupportedModels(queryFn);

    expect(models).toEqual([{ value: "opus" }, { value: "sonnet" }]);
  });

  it("returns [] when supportedModels() resolves to a non-array (defensive)", async () => {
    const { queryFn } = fakeQuery([], { supportedModels: async () => ({ not: "an array" }) });

    const models = await claudeSupportedModels(queryFn);

    expect(models).toEqual([]);
  });

  it("returns [] when supportedModels() throws", async () => {
    const { queryFn } = fakeQuery([], {
      supportedModels: async () => { throw new Error("control request failed"); },
    });

    const models = await claudeSupportedModels(queryFn);

    expect(models).toEqual([]);
  });

  it("always calls return() to close the generator, on both success and failure", async () => {
    let returnCalls = 0;
    const { queryFn: qOk } = fakeQuery([], {
      supportedModels: async () => [],
      returnFn: async () => { returnCalls++; },
    });
    await claudeSupportedModels(qOk);
    expect(returnCalls).toBe(1);

    const { queryFn: qFail } = fakeQuery([], {
      supportedModels: async () => { throw new Error("boom"); },
      returnFn: async () => { returnCalls++; },
    });
    await claudeSupportedModels(qFail);
    expect(returnCalls).toBe(2);
  });
});
