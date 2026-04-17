/**
 * Integration tests for handleAcceptance — meta-critique worker isolation.
 *
 * The original failure: when one worker rejects the task framing entirely
 * (e.g., proposes a different solution rather than answering), acceptance
 * loops forever because that worker can never be reconciled with the
 * synthesis. Fix: classify workers as on-task or meta-critique; meta-critique
 * workers are preserved separately and excluded from action_required.
 */

import { describe, it, expect } from "bun:test";
import { handleAcceptance } from "../src/handlers";
import type { HandlersConfig } from "../src/handlers";

function makeConfig(verdicts: Record<string, string>): HandlersConfig {
  return {
    chatFn: async (model, _messages) => {
      const verdict = verdicts[model] ?? "accept";
      return {
        content: `<verdict>${verdict}</verdict><misrepresented>None.</misrepresented><unresolved>None.</unresolved>`,
        inputTokens: 10,
        outputTokens: 10,
      };
    },
  };
}

describe("handleAcceptance with alignment", () => {
  it("excludes meta-critique workers from action_required even when they would reject", async () => {
    const config = makeConfig({
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
    const config = makeConfig({
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
    const config = makeConfig({
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
    const config = makeConfig({ "model/a": "accept" });

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
});
