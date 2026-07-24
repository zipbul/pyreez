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

/**
 * The slice of the SDK's `query()` result actually used here — narrower than its full `Query`
 * interface (which also carries many control-request methods like interrupt/setPermissionMode)
 * so tests can inject a plain async-generator double instead of implementing all of `Query`.
 * Test seam: constructor/function parameter defaulting to the real `query`, not `mock.module()`
 * (which leaks across test files — see wire.spec.ts's incident).
 */
export type ClaudeQueryFn = (params: { prompt: string | AsyncIterable<unknown>; options?: unknown }) =>
  AsyncIterable<unknown> & { supportedModels?: () => Promise<unknown>; return?: (value?: unknown) => Promise<unknown> };

// Tool groups for fileAccess gating. Workers do pure inference by default; the host opts into
// codebase access per request. Read = inspect-only; Write = mutate (Bash counts as write/exec).
const READ_FILE_TOOLS = ["Read", "Glob", "Grep"];
const WRITE_FILE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"];

/** Shape of the SDK messages this provider reads. */
interface ClaudeSdkMessage {
  readonly type?: string;
  readonly session_id?: string;
  readonly message?: { content?: { type?: string; text?: string }[] };
}



export class ClaudeAgentProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  readonly capabilities = { web: true, effort: true, fileAccess: true } as const;

  constructor(private readonly queryFn: ClaudeQueryFn = query as ClaudeQueryFn) {}

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
      for await (const message of this.queryFn({ prompt, options })) {
        const msg = message as ClaudeSdkMessage;
        // Every SDK message carries the session_id; capture it so the session can be resumed later.
        if (typeof msg.session_id === "string") sessionId = msg.session_id;
        if (msg.type === "assistant") {
          for (const block of msg.message?.content ?? []) {
            if (block?.type === "text" && typeof block.text === "string") text += block.text;
          }
        }
      }
      return buildSdkResponse(text, sessionId);
    } catch (error) {
      throw toSdkError(error, "claude");
    }
  }
}

/**
 * List the models the logged-in Claude account supports, via the agent SDK's `supportedModels()`
 * control request. Verified to return the catalog from the session init handshake WITHOUT running an
 * inference turn (no token cost); ~sub-second. Streaming-input mode is required, so we pass an empty
 * async-iterable prompt and never consume the message stream. Returns [] on any failure.
 */
export async function claudeSupportedModels(
  queryFn: ClaudeQueryFn = query as ClaudeQueryFn,
): Promise<{ value: string; displayName?: string; description?: string }[]> {
  async function* noInput(): AsyncGenerator<never> { /* yields nothing */ }
  const q = queryFn({ prompt: noInput(), options: {} });
  try {
    const models = await q.supportedModels?.();
    return Array.isArray(models) ? models : [];
  } catch {
    return [];
  } finally {
    try { await q.return?.(undefined); } catch { /* close the generator quietly */ }
  }
}
