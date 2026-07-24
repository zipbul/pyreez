/**
 * Unit tests for CodexSdkProvider + toCodexModelId.
 *
 * SUT: CodexSdkProvider.chat()
 * External SDK boundary: the provider owns a `Codex` instance (`this.codex`), so the SDK is
 * test-doubled via `spyOn` on that owned instance's `startThread`/`resumeThread` methods —
 * no mock.module() (which leaks across test files) and no DI seam needed here, unlike
 * claude-agent.ts where the SDK is called as a free function import.
 */

import { describe, it, expect, spyOn } from "bun:test";
import { CodexSdkProvider, toCodexModelId } from "./codex-sdk";
import { LLMClientError } from "../errors";
import type { ChatCompletionRequest } from "../types";

function fakeThread(overrides: { id?: string | null; finalResponse?: string; usage?: unknown } = {}) {
  return {
    id: overrides.id ?? "thread-1",
    run: async (_input: string) => ({
      items: [],
      finalResponse: overrides.finalResponse ?? "final answer",
      usage: overrides.usage ?? null,
    }),
  };
}

function baseRequest(overrides: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest {
  return { model: "openai/gpt-5.5", messages: [{ role: "user", content: "hi" }], ...overrides };
}

/** Extract the thread-options object passed to a spied startThread/resumeThread call.
 *  spyOn on an `(provider as any).codex` property loses static typing, so this centralizes the cast. */
function optionsArg(spy: { mock: { calls: unknown[][] } }, callIndex = 0): any {
  return (spy.mock.calls[callIndex] as any[])[0];
}

describe("CodexSdkProvider.chat", () => {
  it("starts a new thread and returns the finalResponse/id/usage as a ChatCompletionResponse", async () => {
    const provider = new CodexSdkProvider();
    const thread = fakeThread({ id: "thread-abc", finalResponse: "hello", usage: { input_tokens: 3, output_tokens: 4 } });
    const startThreadSpy = spyOn((provider as any).codex, "startThread").mockReturnValue(thread);

    const response = await provider.chat(baseRequest());

    expect(startThreadSpy).toHaveBeenCalledTimes(1);
    expect(response.choices[0]!.message.content).toBe("hello");
    expect(response.sessionId).toBe("thread-abc");
    expect(response.usage).toEqual({ prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 });
  });

  it("resumes a thread (not startThread) when resumeSessionId is provided", async () => {
    const provider = new CodexSdkProvider();
    const startThreadSpy = spyOn((provider as any).codex, "startThread");
    const resumeThreadSpy = spyOn((provider as any).codex, "resumeThread").mockReturnValue(fakeThread());

    await provider.chat(baseRequest({ resumeSessionId: "prior-thread" }));

    expect(resumeThreadSpy).toHaveBeenCalledTimes(1);
    expect(resumeThreadSpy.mock.calls[0]![0]).toBe("prior-thread");
    expect(startThreadSpy).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "read-only"],
    ["read", "read-only"],
    ["write", "workspace-write"],
  ] as const)("maps fileAccess=%s to sandboxMode=%s", async (fileAccess, expectedSandbox) => {
    const provider = new CodexSdkProvider();
    const startThreadSpy = spyOn((provider as any).codex, "startThread").mockReturnValue(fakeThread());

    await provider.chat(baseRequest(fileAccess ? { fileAccess } : {}));

    expect(optionsArg(startThreadSpy).sandboxMode).toBe(expectedSandbox);
  });

  it.each([
    [undefined, false],
    [false, false],
    [true, true],
  ] as const)("maps webAccess=%s to webSearchEnabled=%s (default false)", async (webAccess, expected) => {
    const provider = new CodexSdkProvider();
    const startThreadSpy = spyOn((provider as any).codex, "startThread").mockReturnValue(fakeThread());

    await provider.chat(baseRequest(webAccess !== undefined ? { webAccess } : {}));

    expect(optionsArg(startThreadSpy).webSearchEnabled).toBe(expected);
  });

  it("sets workingDirectory only when fileAccess is granted", async () => {
    const provider = new CodexSdkProvider();
    const startThreadSpy = spyOn((provider as any).codex, "startThread").mockReturnValue(fakeThread());

    await provider.chat(baseRequest());
    expect(optionsArg(startThreadSpy, 0).workingDirectory).toBeUndefined();

    await provider.chat(baseRequest({ fileAccess: "read" }));
    expect(optionsArg(startThreadSpy, 1).workingDirectory).toBe(process.cwd());
  });

  it("buckets reasoning_effort into the Codex effort vocabulary only when provided", async () => {
    const provider = new CodexSdkProvider();
    const startThreadSpy = spyOn((provider as any).codex, "startThread").mockReturnValue(fakeThread());

    await provider.chat(baseRequest({ reasoning_effort: 5 }));
    expect(optionsArg(startThreadSpy, 0).modelReasoningEffort).toBe("medium"); // bucketEffort(5, [minimal,low,medium,high,xhigh])

    await provider.chat(baseRequest());
    expect(optionsArg(startThreadSpy, 1).modelReasoningEffort).toBeUndefined();
  });

  it("converts the pyreez model id via toCodexModelId before passing it to the thread options", async () => {
    const provider = new CodexSdkProvider();
    const startThreadSpy = spyOn((provider as any).codex, "startThread").mockReturnValue(fakeThread());

    await provider.chat(baseRequest({ model: "openai/gpt-6-mini" }));

    expect(optionsArg(startThreadSpy).model).toBe("gpt-6-mini");
  });

  it("frames the system block into the prompt only when request.system is present", async () => {
    const provider = new CodexSdkProvider();

    let capturedInput: string | undefined;
    spyOn((provider as any).codex, "startThread").mockReturnValue({
      id: "t1",
      run: async (input: string) => { capturedInput = input; return { items: [], finalResponse: "ok", usage: null }; },
    });
    await provider.chat(baseRequest({ system: "Be terse." }));
    expect(capturedInput).toContain("<system-instructions>\nBe terse.\n</system-instructions>");

    let capturedInputNoSystem: string | undefined;
    spyOn((provider as any).codex, "startThread").mockReturnValue({
      id: "t2",
      run: async (input: string) => { capturedInputNoSystem = input; return { items: [], finalResponse: "ok", usage: null }; },
    });
    await provider.chat(baseRequest());
    expect(capturedInputNoSystem).not.toContain("<system-instructions>");
  });

  it("wraps a thrown error via toSdkError with vendor 'codex'", async () => {
    const provider = new CodexSdkProvider();
    spyOn((provider as any).codex, "startThread").mockReturnValue({
      id: "t1",
      run: async () => { throw new Error("thread run failed"); },
    });

    await expect(provider.chat(baseRequest())).rejects.toThrow(LLMClientError);
    await expect(provider.chat(baseRequest())).rejects.toThrow(/codex agent SDK error: thread run failed/);
  });

  it("always requests skipGitRepoCheck", async () => {
    const provider = new CodexSdkProvider();
    const startThreadSpy = spyOn((provider as any).codex, "startThread").mockReturnValue(fakeThread());

    await provider.chat(baseRequest());

    expect(optionsArg(startThreadSpy).skipGitRepoCheck).toBe(true);
  });
});

describe("toCodexModelId", () => {
  it("strips the openai/ prefix", () => {
    expect(toCodexModelId("openai/gpt-5.5")).toBe("gpt-5.5");
  });

  it("passes through ids without the openai/ prefix unchanged", () => {
    expect(toCodexModelId("anthropic/claude-sonnet-4.6")).toBe("anthropic/claude-sonnet-4.6");
  });
});
