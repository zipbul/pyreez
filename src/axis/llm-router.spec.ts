import { describe, it, expect, mock } from "bun:test";
import { LlmRouter } from "./llm-router";
import type { ChatFn } from "./types";

function makeMockChat(response: string): ChatFn {
  return mock(async (_model: string, _input: string | any[]) => response) as any;
}

const TEST_MODELS = ["claude-sonnet", "gpt-4.1", "gemini-2.5-pro"];

describe("LlmRouter", () => {
  // 9. [HP] valid model → returns EnsemblePlan
  it("should return EnsemblePlan for valid model recommendation", async () => {
    const chat = makeMockChat('{"model": "claude-sonnet"}');
    const router = new LlmRouter({
      chatFn: chat,
      routerModel: "gpt-4.1-nano",
      modelIds: TEST_MODELS,
    });

    const plan = await router.route("Write a function");
    expect(plan).not.toBeNull();
    expect(plan!.models[0]!.modelId).toBe("claude-sonnet");
    expect(plan!.strategy).toBe("llm-router");
  });

  // 10. [HP] multi-model recommendation → plan with multiple
  it("should return plan with multiple models when recommended", async () => {
    const chat = makeMockChat('{"models": ["claude-sonnet", "gpt-4.1"]}');
    const router = new LlmRouter({
      chatFn: chat,
      routerModel: "gpt-4.1-nano",
      modelIds: TEST_MODELS,
    });

    const plan = await router.route("Complex refactoring task");
    expect(plan).not.toBeNull();
    expect(plan!.models.length).toBe(2);
  });

  // 11. [NE] chat error → returns null
  it("should return null when chat throws error", async () => {
    const chat = mock(async () => {
      throw new Error("API down");
    }) as any;
    const router = new LlmRouter({
      chatFn: chat,
      routerModel: "gpt-4.1-nano",
      modelIds: TEST_MODELS,
    });

    const plan = await router.route("task");
    expect(plan).toBeNull();
  });

  // 12. [NE] unknown model → returns null
  it("should return null when recommended model is not in list", async () => {
    const chat = makeMockChat('{"model": "unknown-model-xyz"}');
    const router = new LlmRouter({
      chatFn: chat,
      routerModel: "gpt-4.1-nano",
      modelIds: TEST_MODELS,
    });

    const plan = await router.route("task");
    expect(plan).toBeNull();
  });

  // 13. [NE] empty response → returns null
  it("should return null for empty response", async () => {
    const chat = makeMockChat("");
    const router = new LlmRouter({
      chatFn: chat,
      routerModel: "gpt-4.1-nano",
      modelIds: TEST_MODELS,
    });

    const plan = await router.route("task");
    expect(plan).toBeNull();
  });

  // 14. [ED] model not in list → null (text mention)
  it("should return null when text mentions model not in list", async () => {
    const chat = makeMockChat("I recommend using deepseek-r1 for this task.");
    const router = new LlmRouter({
      chatFn: chat,
      routerModel: "gpt-4.1-nano",
      modelIds: TEST_MODELS,
    });

    const plan = await router.route("task");
    expect(plan).toBeNull();
  });

  // 15. [CO] JSON with extra fields → still extracts model
  it("should extract model from JSON with extra fields", async () => {
    const chat = makeMockChat('{"model": "gpt-4.1", "reason": "best for code", "confidence": 0.9}');
    const router = new LlmRouter({
      chatFn: chat,
      routerModel: "gpt-4.1-nano",
      modelIds: TEST_MODELS,
    });

    const plan = await router.route("task");
    expect(plan).not.toBeNull();
    expect(plan!.models[0]!.modelId).toBe("gpt-4.1");
  });

  // 16. [ID] same prompt → same plan
  it("should return consistent plan for same prompt", async () => {
    const chat = makeMockChat('{"model": "gemini-2.5-pro"}');
    const router = new LlmRouter({
      chatFn: chat,
      routerModel: "gpt-4.1-nano",
      modelIds: TEST_MODELS,
    });

    const p1 = await router.route("task");
    const p2 = await router.route("task");
    expect(p1).toEqual(p2);
  });
});
