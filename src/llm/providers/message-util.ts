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
 * Split chat messages into a system block + a single conversation prompt string.
 * System messages are joined separately (passed via the provider's system-prompt option);
 * assistant turns are prefixed with a role marker so multi-turn context survives flattening.
 */
export function serializeMessages(messages: ChatMessage[]): {
  system: string | undefined;
  prompt: string;
} {
  const systemParts: string[] = [];
  const conversationParts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push(msg.content ?? "");
    } else if (msg.role === "user") {
      conversationParts.push(msg.content ?? "");
    } else if (msg.role === "assistant") {
      conversationParts.push(`[Assistant]: ${msg.content ?? ""}`);
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    prompt: conversationParts.join("\n\n"),
  };
}
