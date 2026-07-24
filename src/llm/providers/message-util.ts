/**
 * Shared message-serialization helpers for the agent-SDK / CLI providers.
 * (Extracted from the retired claude-cli provider; claude-agent, codex-sdk, and grok-cli use these.)
 */

import type { ChatMessage } from "../types";

/**
 * Bucket a 1–10 reasoning-effort value onto a provider's ordered level set (even split).
 * Lets each provider absorb its own effort vocabulary (claude/grok low..max, codex minimal..xhigh).
 */
export function bucketEffort(n: number, levels: readonly string[]): string {
  const clamped = Math.min(10, Math.max(1, n));
  const idx = Math.min(levels.length - 1, Math.ceil((clamped / 10) * levels.length) - 1);
  return levels[idx]!;
}

/**
 * Convert pyreez model ID to a bare CLI/SDK --model value.
 * "anthropic/claude-opus-4.6" → "claude-opus-4-6"
 */
export function toCliModelId(pyreezId: string): string {
  const bare = pyreezId.startsWith("anthropic/")
    ? pyreezId.slice("anthropic/".length)
    : pyreezId;
  return bare.replace(/\./g, "-");
}

/**
 * Separate system messages from the conversation. Returns the joined system block (if any) and the
 * remaining conversation as a message list. Called once at the adapter boundary to hoist system out.
 */
export function splitSystemMessages(messages: ChatMessage[]): {
  system?: string;
  conversation: ChatMessage[];
} {
  const systemParts: string[] = [];
  const conversation: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "system") systemParts.push(msg.content ?? "");
    else conversation.push(msg);
  }
  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    conversation,
  };
}

/**
 * Flatten a conversation (user/assistant turns) into one prompt string. Assistant turns keep a
 * role marker so multi-turn context (re-sent every round during session continuation) survives.
 */
export function flattenConversation(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => (m.role === "assistant" ? `[Assistant]: ${m.content ?? ""}` : (m.content ?? "")))
    .join("\n\n");
}

/**
 * Compose a system block + conversation into ONE prompt for providers with no native system param
 * (codex, gemini). The system block is framed in an XML boundary so the model treats it as
 * authoritative standing instructions, not just leading prose. The system body is wrapped raw — it
 * already contains intentional XML tags (<role>, <task>) and must NOT be escaped.
 */
export function composeSystemPrompt(system: string | undefined, conversation: string): string {
  if (!system) return conversation;
  return `<system-instructions>\n${system}\n</system-instructions>\n\n${conversation}`;
}
