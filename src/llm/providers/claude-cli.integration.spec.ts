/**
 * Integration test: ClaudeCliProvider with actual worker prompts.
 * Tests the real `claude -p` command with deliberation-style prompts.
 * Requires `claude` CLI to be available in PATH.
 *
 * Run: bun test src/llm/providers/claude-cli.integration.spec.ts
 */

import { describe, it, expect } from "bun:test";
import { ClaudeCliProvider, serializeMessages } from "./claude-cli";
import { buildWorkerMessages } from "../../deliberation/prompts";
import { createSharedContext } from "../../deliberation/shared-context";
import { MIN_WORKER_RESPONSE_LENGTH } from "../../deliberation/engine";

// Skip if claude CLI is not available
const cliAvailable = await Bun.spawn(["which", "claude"], { stdout: "pipe" })
  .exited.then((code) => code === 0)
  .catch(() => false);

describe.skipIf(!cliAvailable)("ClaudeCliProvider integration with worker prompts", () => {
  const provider = new ClaudeCliProvider();

  it("should return non-degenerate response for critique worker prompt", async () => {
    const ctx = createSharedContext(
      "Can quantum computers break RSA-2048 by 2030? Analyze current technology, required qubits, error correction overhead, and company roadmaps.",
      { workers: [{ model: "anthropic/claude-opus-4.6", role: "worker" }] },
      "critique",
    );

    const messages = buildWorkerMessages(ctx, undefined, { current: 1, max: 2 }, 0);
    const { system, prompt } = serializeMessages(messages);

    console.log("--- System prompt length:", system?.length ?? 0);
    console.log("--- User prompt length:", prompt.length);

    const response = await provider.chat({
      model: "anthropic/claude-opus-4.6",
      messages,
    });

    const content = response.choices[0]!.message.content ?? "";
    console.log("--- Response length:", content.length);
    console.log("--- First 200 chars:", content.slice(0, 200));

    expect(content.length).toBeGreaterThanOrEqual(MIN_WORKER_RESPONSE_LENGTH);
  }, 120_000); // 2 min timeout for CLI

  it("should return non-degenerate response for artifact worker prompt", async () => {
    const ctx = createSharedContext(
      "Design a feedback system that replaces Bradley-Terry win/loss scoring with contribution-based profiling for multi-model deliberation.",
      { workers: [{ model: "anthropic/claude-opus-4.6", role: "worker" }] },
      "artifact",
    );

    const messages = buildWorkerMessages(ctx, undefined, { current: 1, max: 1 }, 0);
    const { system, prompt } = serializeMessages(messages);

    console.log("--- System prompt length:", system?.length ?? 0);
    console.log("--- User prompt length:", prompt.length);

    const response = await provider.chat({
      model: "anthropic/claude-opus-4.6",
      messages,
    });

    const content = response.choices[0]!.message.content ?? "";
    console.log("--- Response length:", content.length);
    console.log("--- First 200 chars:", content.slice(0, 200));

    expect(content.length).toBeGreaterThanOrEqual(MIN_WORKER_RESPONSE_LENGTH);
  }, 300_000); // 5 min — artifact prompts produce longer responses
});
