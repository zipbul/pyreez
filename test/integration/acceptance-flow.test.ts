/**
 * Integration test — Acceptance flow: handleAcceptance through the full stack.
 *
 * SUT boundary (real implementations):
 *   handlers.ts (handleAcceptance) + quality/alignment-classifier.ts (classifyAlignment) +
 *   deliberation/prompts.ts (buildAcceptanceMessages) + deliberation/wire.ts (createChatAdapter).
 *
 * Outside SUT (test-doubled):
 *   raw chat function — the provider-facing (request) => ChatCompletionResponse call, equivalent
 *   to `(req) => providerRegistry.chat(req)` in cli.ts.
 *
 * The original failure this suite guards: when one worker rejects the task framing entirely
 * (e.g., proposes a different solution rather than answering), acceptance loops forever because
 * that worker can never be reconciled with the synthesis. Fix: classify workers as on-task or
 * meta-critique; meta-critique workers are preserved separately and excluded from action_required.
 */

import { describe, it, expect } from "bun:test";
import { handleAcceptance } from "../../src/handlers";
import type { HandlersConfig } from "../../src/handlers";
import { createChatAdapter } from "../../src/deliberation/wire";
import type { ChatCompletionRequest, ChatCompletionResponse } from "../../src/llm/types";

function completion(content: string): ChatCompletionResponse {
  return {
    id: "cmpl-test",
    object: "chat.completion",
    created: Date.now(),
    model: "test",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}

/** Every judge (and classifyAlignment) call returns a verdict keyed by model — the same fixed
 *  reply regardless of what's asked, matching this suite's original coarse-grained fixture. */
function buildConfig(verdicts: Record<string, string>): HandlersConfig {
  const rawChat = async (req: ChatCompletionRequest) => {
    const verdict = verdicts[req.model] ?? "accept";
    return completion(`<verdict>${verdict}</verdict><misrepresented>None.</misrepresented><unresolved>None.</unresolved>`);
  };
  return { chatFn: createChatAdapter(rawChat) };
}

describe("Acceptance flow — handleAcceptance through the full stack", () => {
  it("excludes meta-critique workers from action_required even when they would reject", async () => {
    const config = buildConfig({
      "model/a": "accept",
      "model/b": "reject", // would normally trigger reject
    });

    const result = await handleAcceptance(config, {
      task: "task",
      synthesis: "synth",
      workers: [
        { model: "model/a", original_position: "on-task answer", alignment: "on-task" },
        { model: "model/b", original_position: "frame-rejecting proposal", alignment: "meta-critique" },
      ],
    });

    expect(result.error).toBeUndefined();
    const data = result.data as any;
    // No action_required — on-task workers all accept
    expect(data.action_required).toBeUndefined();
    // Meta-critique preserved separately
    expect(data.metaCritiques).toHaveLength(1);
    expect(data.metaCritiques[0].model).toBe("model/b");
  });

  it("still emits action_required when an on-task worker rejects", async () => {
    const config = buildConfig({
      "model/a": "reject",
      "model/b": "reject",
    });

    const result = await handleAcceptance(config, {
      task: "task",
      synthesis: "synth",
      workers: [
        { model: "model/a", original_position: "on-task answer", alignment: "on-task" },
        { model: "model/b", original_position: "frame-rejecting", alignment: "meta-critique" },
      ],
    });

    const data = (result as any).data;
    expect(data.action_required).toContain("reject");
    expect(data.metaCritiques).toHaveLength(1);
  });

  it("treats workers without alignment as on-task (backward compatible)", async () => {
    const config = buildConfig({
      "model/a": "accept",
      "model/b": "reject",
    });

    const result = await handleAcceptance(config, {
      task: "task",
      synthesis: "synth",
      workers: [
        { model: "model/a", original_position: "answer one" },
        { model: "model/b", original_position: "answer two" },
      ],
    });

    const data = (result as any).data;
    expect(data.action_required).toContain("reject");
    expect(data.metaCritiques).toBeUndefined();
  });

  it("returns no metaCritiques field when there are no meta-critique workers", async () => {
    const config = buildConfig({ "model/a": "accept" });

    const result = await handleAcceptance(config, {
      task: "task",
      synthesis: "synth",
      workers: [
        { model: "model/a", original_position: "on-task", alignment: "on-task" },
      ],
    });

    const data = (result as any).data;
    expect(data.metaCritiques).toBeUndefined();
  });

  // ----------------------------------------------------------
  // Input validation
  // ----------------------------------------------------------
  describe("input validation", () => {
    it("requires task", async () => {
      const result = await handleAcceptance(buildConfig({}), {
        task: "", synthesis: "s", workers: [{ model: "m/a", original_position: "p" }],
      });
      expect(result.error).toBe("Error: task is required");
    });

    it("requires synthesis", async () => {
      const result = await handleAcceptance(buildConfig({}), {
        task: "t", synthesis: "", workers: [{ model: "m/a", original_position: "p" }],
      });
      expect(result.error).toBe("Error: synthesis is required");
    });

    it("requires at least one worker (empty array, boundary)", async () => {
      const result = await handleAcceptance(buildConfig({}), { task: "t", synthesis: "s", workers: [] });
      expect(result.error).toBe("Error: at least one worker is required");
    });

    it("errors when chatFn is not configured", async () => {
      const result = await handleAcceptance({}, {
        task: "t", synthesis: "s", workers: [{ model: "m/a", original_position: "p" }],
      });
      expect(result.error).toBe("Error: acceptance not available (no chatFn configured)");
    });
  });

  // ----------------------------------------------------------
  // Error paths and less common verdict combinations
  // ----------------------------------------------------------
  describe("error paths and verdict combinations", () => {
    it("falls back to on-task alignment when classifyAlignment's chat call throws", async () => {
      const rawChat = async (req: ChatCompletionRequest) => {
        const isAlignmentCall = (req.system ?? "").includes("classifying whether");
        if (isAlignmentCall) throw new Error("classifier unavailable");
        return completion("<verdict>accept</verdict><misrepresented>None.</misrepresented><unresolved>None.</unresolved>");
      };
      const config: HandlersConfig = { chatFn: createChatAdapter(rawChat) };

      const result = await handleAcceptance(config, {
        task: "task",
        synthesis: "synth",
        workers: [{ model: "model/a", original_position: "answer" }], // no alignment -> classifyAlignment runs
      });

      expect(result.error).toBeUndefined();
      const data = result.data as any;
      // Fell back to on-task (fail-safe default), so the worker participates in action_required voting.
      expect(data.metaCritiques).toBeUndefined();
      expect(data.workers[0].verdict).toBe("accept");
    });

    it("errors when every acceptance check fails", async () => {
      const rawChat = async () => { throw new Error("provider down"); };
      const config: HandlersConfig = { chatFn: createChatAdapter(rawChat) };

      const result = await handleAcceptance(config, {
        task: "task",
        synthesis: "synth",
        workers: [
          { model: "model/a", original_position: "answer a", alignment: "on-task" },
          { model: "model/b", original_position: "answer b", alignment: "on-task" },
        ],
      });

      expect(result.error).toBeDefined();
      const parsed = JSON.parse(result.error!);
      expect(parsed.error).toBe("All 2 acceptance check(s) failed");
      expect(parsed.failedModels.sort()).toEqual(["model/a", "model/b"]);
    });

    it("emits a partial action_required when the worst verdict is partial (no reject)", async () => {
      const config = buildConfig({ "model/a": "accept", "model/b": "partial" });

      const result = await handleAcceptance(config, {
        task: "task",
        synthesis: "synth",
        workers: [
          { model: "model/a", original_position: "answer a", alignment: "on-task" },
          { model: "model/b", original_position: "answer b", alignment: "on-task" },
        ],
      });

      const data = (result as any).data;
      expect(data.action_required).toContain("partial");
    });
  });
});
