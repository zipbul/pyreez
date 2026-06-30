/**
 * Anthropic provider using the official `@anthropic-ai/claude-agent-sdk` (`query()`).
 * Replaces the hand-rolled `claude -p` spawn. Auth is the installed Claude Code login
 * (subscription) — no ANTHROPIC_API_KEY needed when `claude` is logged in. File/bash tools are
 * disallowed by default (pure inference); the host opts in per request via fileAccess (read|write),
 * which also points cwd at the workspace. WebSearch/WebFetch are allowed under --web-access.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { flattenConversation, toCliModelId, bucketEffort } from "./message-util";

// Claude Agent SDK effort vocabulary (no "minimal"; has "max").
const CLAUDE_EFFORT = ["low", "medium", "high", "xhigh", "max"] as const;
import { buildSdkResponse, toSdkError } from "./sdk-util";
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../types";

// Tool groups for fileAccess gating. Workers do pure inference by default; the host opts into
// codebase access per request. Read = inspect-only; Write = mutate (Bash counts as write/exec).
const READ_FILE_TOOLS = ["Read", "Glob", "Grep"];
const WRITE_FILE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"];

export class ClaudeAgentProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  readonly capabilities = { web: true, effort: true, fileAccess: true } as const;

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = toCliModelId(request.model);
    const prompt = flattenConversation(request.messages);

    const web = request.webAccess ? ["WebSearch", "WebFetch"] : [];
    let allowedTools: string[];
    let disallowedTools: string[];
    if (request.fileAccess === "write") {
      allowedTools = [...READ_FILE_TOOLS, ...WRITE_FILE_TOOLS, ...web];
      disallowedTools = [];
    } else if (request.fileAccess === "read") {
      allowedTools = [...READ_FILE_TOOLS, ...web];
      disallowedTools = WRITE_FILE_TOOLS;
    } else {
      // No file access: pure inference (+ optional web). Block every codebase/command tool.
      allowedTools = web;
      disallowedTools = [...READ_FILE_TOOLS, ...WRITE_FILE_TOOLS];
    }

    const options: Record<string, unknown> = {
      model,
      permissionMode: "bypassPermissions",
      allowedTools,
      disallowedTools,
    };
    // Point the session at the host workspace only when file access is granted.
    if (request.fileAccess) options.cwd = process.cwd();
    if (request.system) options.systemPrompt = request.system;
    if (request.reasoning_effort) options.effort = bucketEffort(request.reasoning_effort, CLAUDE_EFFORT);
    // Resume the recorded session (interrogate) instead of starting fresh; the SDK replays its history.
    if (request.resumeSessionId) options.resume = request.resumeSessionId;

    try {
      let text = "";
      let sessionId: string | undefined;
      for await (const message of query({ prompt, options } as any)) {
        const msg = message as any;
        // Every SDK message carries the session_id; capture it so the session can be resumed later.
        if (typeof msg.session_id === "string") sessionId = msg.session_id;
        if (msg.type === "assistant") {
          for (const block of msg.message?.content ?? []) {
            if (block?.type === "text" && typeof block.text === "string") text += block.text;
          }
        }
      }
      return buildSdkResponse(text, request.model, undefined, sessionId);
    } catch (error) {
      throw toSdkError(error, "claude");
    }
  }
}
