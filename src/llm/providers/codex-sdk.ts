/**
 * OpenAI provider using the official `@openai/codex-sdk` (drives the Codex agent).
 * Replaces the hand-rolled `codex exec` spawn. Auth is the installed Codex CLI's ChatGPT
 * subscription (`~/.codex/auth.json` via `codex login`) — NO OPENAI_API_KEY. The vendored
 * `@openai/codex` binary is spawned by the SDK. Web search (server-side, live) is enabled
 * under --web-access so workers verify before asserting. Sandbox is read-only by default; the host
 * opts into workspace access per request via fileAccess (read → read-only, write → workspace-write),
 * which also points workingDirectory at the host cwd.
 */

import { Codex } from "@openai/codex-sdk";
import { composeSystemPrompt, flattenConversation, bucketEffort } from "./message-util";

// Codex effort vocabulary (has "minimal"; no "max").
const CODEX_EFFORT = ["minimal", "low", "medium", "high", "xhigh"] as const;
import { buildSdkResponse, toSdkError } from "./sdk-util";
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../types";

/** "openai/gpt-5.5" → "gpt-5.5" */
export function toCodexModelId(pyreezId: string): string {
  return pyreezId.startsWith("openai/") ? pyreezId.slice("openai/".length) : pyreezId;
}

export class CodexSdkProvider implements LLMProvider {
  readonly name = "openai" as const;
  readonly capabilities = { web: true, effort: true, fileAccess: true } as const;
  private readonly codex: Codex;

  constructor() {
    // No apiKey: inherit process.env so the vendored binary uses its ChatGPT subscription login.
    this.codex = new Codex();
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = toCodexModelId(request.model);
    // Codex has no system-prompt option — frame the system block into the prompt.
    const input = composeSystemPrompt(request.system, flattenConversation(request.messages));

    try {
      const threadOptions = {
        model,
        sandboxMode: request.fileAccess === "write" ? "workspace-write" : "read-only",
        webSearchEnabled: request.webAccess ?? false,
        skipGitRepoCheck: true,
        // Anchor at the host workspace only when file access is granted; otherwise leave the SDK default.
        ...(request.fileAccess ? { workingDirectory: process.cwd() } : {}),
        ...(request.reasoning_effort ? { modelReasoningEffort: bucketEffort(request.reasoning_effort, CODEX_EFFORT) } : {}),
      };
      // Resume the recorded thread (interrogate) instead of starting fresh; settings are re-passed.
      const thread: any = request.resumeSessionId
        ? this.codex.resumeThread(request.resumeSessionId, threadOptions as any)
        : this.codex.startThread(threadOptions as any);
      const turn: any = await thread.run(input);
      // thread.id is populated after the first turn — capture it so the thread can be resumed.
      const sessionId: string | undefined = thread.id ?? undefined;
      return buildSdkResponse(turn.finalResponse ?? "", sessionId);
    } catch (error) {
      throw toSdkError(error, "codex");
    }
  }
}
