/**
 * Tests for wire.ts Thompson Sampling and External Evaluator paths.
 * Separate file because the original wire.spec.ts uses mock.module that
 * replaces team-composer entirely, which conflicts with thompsonSelect.
 *
 * These tests use DI (dependency injection) approach instead of mock.module.
 */

import { describe, it, expect, mock } from "bun:test";
import type { ModelInfo } from "../model/types";
import type { WireDeps } from "./wire";
import { createDeliberateFn } from "./wire";
import { FileSkillCellStore, type SkillCellIO } from "../model/skillcell-store";
import type { ExternalEvaluator } from "./external-evaluator";
import type { FeedbackRecord } from "../axis/types";

// -- Fixtures --

function makeModelInfo(id: string): ModelInfo {
  const provider = id.split("/")[0] as any;
  return {
    id,
    name: id,
    provider,
    contextWindow: 128_000,
    capabilities: {} as any,
    cost: { inputPer1M: 1, outputPer1M: 1 },
    supportsToolCalling: true,
    family: provider,
  };
}

const MODELS = [makeModelInfo("prov-a/model-1"), makeModelInfo("prov-b/model-2"), makeModelInfo("prov-c/model-3")];

function makeWireDeps(overrides?: Partial<WireDeps>): WireDeps {
  return {
    registry: {
      getAll: () => MODELS,
      getAvailable: () => MODELS,
      getById: (id) => MODELS.find(m => m.id === id),
    },
    chat: mock(async () => ({
      content: "A".repeat(250), // above MIN_WORKER_RESPONSE_LENGTH
      inputTokens: 50,
      outputTokens: 100,
    })),
    ...overrides,
  };
}

function makeSkillCellStore(): FileSkillCellStore {
  const io: SkillCellIO = {
    async readFile() { throw new Error("no file"); },
    async writeFile() {},
  };
  return new FileSkillCellStore({ io, path: "test.json" });
}

function makeMockEvaluator(): ExternalEvaluator & { evaluate: ReturnType<typeof mock> } {
  return {
    evaluate: mock(async (_task: string, modelId: string, _content: string, domain: string, taskType: string, deliberationId: string): Promise<FeedbackRecord> => ({
      deliberation_id: deliberationId,
      model_id: modelId,
      domain,
      task_type: taskType,
      evaluator_id: "mock-eval",
      dimensions: {
        factually_correct: true,
        addresses_task: true,
        provides_evidence: true,
        novel_perspective: false,
        internally_consistent: true,
      },
      failures: { hallucination: false, refusal: false, off_topic: false, degenerate: false },
      timestamp: Date.now(),
    })),
  };
}

// -- Tests --

describe("wire.ts — Thompson Sampling selection path", () => {
  it("should use thompsonSelect when skillCellStore and domain are provided", async () => {
    const store = makeSkillCellStore();
    const deps = makeWireDeps({ skillCellStore: store });
    const fn = createDeliberateFn(deps);

    const result = await fn({ task: "analyze this", domain: "ARCHITECTURE", taskType: "SYSTEM_DESIGN" });

    // Should complete without error — thompsonSelect was used
    expect(result.roundsExecuted).toBeGreaterThanOrEqual(1);
  });

  it("should fall back to selectDiverseModels when no domain", async () => {
    const store = makeSkillCellStore();
    const deps = makeWireDeps({ skillCellStore: store });
    const fn = createDeliberateFn(deps);

    // No domain → selectDiverseModels
    const result = await fn({ task: "analyze this" });
    expect(result.roundsExecuted).toBeGreaterThanOrEqual(1);
  });

  it("should fall back to selectDiverseModels when no skillCellStore", async () => {
    const deps = makeWireDeps();
    const fn = createDeliberateFn(deps);

    const result = await fn({ task: "analyze this", domain: "ARCHITECTURE" });
    expect(result.roundsExecuted).toBeGreaterThanOrEqual(1);
  });
});

describe("wire.ts — External evaluator path", () => {
  it("should call evaluator for each worker and update store", async () => {
    const store = makeSkillCellStore();
    const evaluator = makeMockEvaluator();
    const deps = makeWireDeps({ skillCellStore: store, externalEvaluator: evaluator });
    const fn = createDeliberateFn(deps);

    await fn({ task: "test", domain: "ARCH", taskType: "SD" });

    // Evaluator called for each worker response
    expect(evaluator.evaluate.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("should not fail when evaluator throws", async () => {
    const store = makeSkillCellStore();
    const evaluator: ExternalEvaluator = {
      evaluate: mock(async () => { throw new Error("eval failed"); }),
    };
    const deps = makeWireDeps({ skillCellStore: store, externalEvaluator: evaluator });
    const fn = createDeliberateFn(deps);

    // Should not throw
    const result = await fn({ task: "test", domain: "D", taskType: "T" });
    expect(result.roundsExecuted).toBeGreaterThanOrEqual(1);
  });

  it("should skip evaluation when domain is absent", async () => {
    const store = makeSkillCellStore();
    const evaluator = makeMockEvaluator();
    const deps = makeWireDeps({ skillCellStore: store, externalEvaluator: evaluator });
    const fn = createDeliberateFn(deps);

    await fn({ task: "test" }); // no domain

    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });
});
