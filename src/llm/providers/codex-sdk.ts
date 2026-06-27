/**
 * OpenAI provider using the official `@openai/codex-sdk` (drives the Codex agent).
 * Replaces the hand-rolled `codex exec` spawn. Auth is the installed Codex CLI's ChatGPT
 * subscription (`~/.codex/auth.json` via `codex login`) — NO OPENAI_API_KEY. The vendored
 * `@openai/codex` binary is spawned by the SDK. Web search (server-side, live) is enabled
 * under --web-access so workers verify before asserting; sandbox is read-only (no file edits).
 */

import { Codex } from "@openai/codex-sdk";
import { serializeMessages } from "./message-util";
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
  readonly capabilities = { web: true, effort: true, fileAccess: false } as const;
  private readonly codex: Codex;

  constructor() {
    // No apiKey: inherit process.env so the vendored binary uses its ChatGPT subscription login.
    this.codex = new Codex();
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = toCodexModelId(request.model);
    // Codex has no system-prompt option — prepend the system block to the prompt text.
    const { system, prompt } = serializeMessages(request.messages);
    const input = system ? `${system}\n\n${prompt}` : prompt;

    try {
      const thread = this.codex.startThread({
        model,
        sandboxMode: "read-only",
        webSearchEnabled: request.webAccess ?? false,
        skipGitRepoCheck: true,
        ...(request.reasoning_effort ? { modelReasoningEffort: request.reasoning_effort } : {}),
      } as any);
      const turn: any = await thread.run(input);
      return buildSdkResponse(turn.finalResponse ?? "", request.model, turn.usage ?? undefined);
    } catch (error) {
      throw toSdkError(error, "codex");
    }
  }
}
