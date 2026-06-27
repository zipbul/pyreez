/**
 * Anthropic provider using the official `@anthropic-ai/claude-agent-sdk` (`query()`).
 * Replaces the hand-rolled `claude -p` spawn. Auth is the installed Claude Code login
 * (subscription) — no ANTHROPIC_API_KEY needed when `claude` is logged in. File/bash tools are
 * disallowed (pure inference); WebSearch/WebFetch are allowed under --web-access so workers verify.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { serializeMessages, toCliModelId } from "./claude-cli";
import { buildSdkResponse, toSdkError } from "./sdk-util";
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../types";

// Block all codebase/command tools — pyreez workers do pure inference (+ optional web verification).
const FILE_TOOLS = ["Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "Glob", "Grep"];

export class ClaudeAgentProvider implements LLMProvider {
  readonly name = "anthropic" as const;

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = toCliModelId(request.model);
    const { system, prompt } = serializeMessages(request.messages);

    const options: Record<string, unknown> = {
      model,
      permissionMode: "bypassPermissions",
      disallowedTools: FILE_TOOLS,
      allowedTools: request.webAccess ? ["WebSearch", "WebFetch"] : [],
    };
    if (system) options.systemPrompt = system;
    if (request.reasoning_effort) options.effort = request.reasoning_effort;

    try {
      let text = "";
      for await (const message of query({ prompt, options } as any)) {
        const msg = message as any;
        if (msg.type === "assistant") {
          for (const block of msg.message?.content ?? []) {
            if (block?.type === "text" && typeof block.text === "string") text += block.text;
          }
        }
      }
      return buildSdkResponse(text, request.model);
    } catch (error) {
      throw toSdkError(error, "claude");
    }
  }
}
