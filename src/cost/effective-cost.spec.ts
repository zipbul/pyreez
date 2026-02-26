/**
 * Unit tests for effective cost calculation module.
 */

import { describe, it, expect } from "bun:test";
import {
  estimateStaticCost,
  estimateEffectiveCost,
  estimateAmortizedCost,
  PROVIDER_CACHING,
} from "./effective-cost";
import type { ModelInfo } from "../model/types";
import type { ProviderName } from "../llm/types";

/** Minimal ModelInfo stub for cost tests. */
function makeModel(
  provider: ProviderName,
  inputPer1M: number = 2,
  outputPer1M: number = 8,
): ModelInfo {
  return {
    id: `${provider}/test-model`,
    name: "Test Model",
    provider,
    contextWindow: 128_000,
    capabilities: {} as ModelInfo["capabilities"],
    cost: { inputPer1M, outputPer1M },
    supportsToolCalling: true,
  };
}

// -- PROVIDER_CACHING record --

describe("PROVIDER_CACHING", () => {
  it("should have entries for all four providers", () => {
    expect(PROVIDER_CACHING.github).toBeDefined();
    expect(PROVIDER_CACHING.anthropic).toBeDefined();
    expect(PROVIDER_CACHING.google).toBeDefined();
    expect(PROVIDER_CACHING.openai).toBeDefined();
  });

  it("should mark github as unsupported", () => {
    expect(PROVIDER_CACHING.github.supported).toBe(false);
  });

  it("should mark anthropic with 90% read discount and 25% write premium", () => {
    expect(PROVIDER_CACHING.anthropic.readDiscount).toBe(0.9);
    expect(PROVIDER_CACHING.anthropic.writePremium).toBe(0.25);
  });
});

// -- estimateStaticCost --

describe("estimateStaticCost", () => {
  it("should compute (input × inputRate + output × outputRate) / 1M", () => {
    const model = makeModel("openai", 2, 8);
    // 1000 × 2 / 1M + 500 × 8 / 1M = 0.002 + 0.004 = 0.006
    const cost = estimateStaticCost(model, 1000, 500);
    expect(cost).toBeCloseTo(0.006, 6);
  });

  it("should return 0 when tokens are 0", () => {
    const model = makeModel("anthropic", 3, 15);
    expect(estimateStaticCost(model, 0, 0)).toBe(0);
  });

  it("should match the old inline formula exactly", () => {
    const model = makeModel("github", 5, 10);
    const input = 2000;
    const output = 1000;
    const oldFormula =
      (input * model.cost.inputPer1M + output * model.cost.outputPer1M) / 1_000_000;
    expect(estimateStaticCost(model, input, output)).toBe(oldFormula);
  });
});

// -- estimateEffectiveCost --

describe("estimateEffectiveCost", () => {
  it("should equal static cost × 1 for a single round", () => {
    const model = makeModel("anthropic", 3, 15);
    const static1 = estimateStaticCost(model, 1000, 500);
    const effective1 = estimateEffectiveCost({
      model,
      inputTokens: 1000,
      outputTokens: 500,
      rounds: 1,
    });
    expect(effective1).toBeCloseTo(static1, 10);
  });

  it("should equal static cost × N for github (no caching)", () => {
    const model = makeModel("github", 2, 8);
    const static1 = estimateStaticCost(model, 1000, 500);
    const effective3 = estimateEffectiveCost({
      model,
      inputTokens: 1000,
      outputTokens: 500,
      rounds: 3,
    });
    expect(effective3).toBeCloseTo(static1 * 3, 10);
  });

  it("should be cheaper than static × N for anthropic with multiple rounds", () => {
    const model = makeModel("anthropic", 3, 15);
    const static1 = estimateStaticCost(model, 1000, 500);
    const effective3 = estimateEffectiveCost({
      model,
      inputTokens: 1000,
      outputTokens: 500,
      rounds: 3,
    });
    // With 90% read discount on 70% of input, rounds 2-3 save a lot
    expect(effective3).toBeLessThan(static1 * 3);
  });

  it("should be cheaper than static × N for openai with multiple rounds", () => {
    const model = makeModel("openai", 2, 8);
    const static1 = estimateStaticCost(model, 1000, 500);
    const effective3 = estimateEffectiveCost({
      model,
      inputTokens: 1000,
      outputTokens: 500,
      rounds: 3,
    });
    // OpenAI: 50% read discount
    expect(effective3).toBeLessThan(static1 * 3);
  });

  it("should return 0 for 0 rounds", () => {
    const model = makeModel("anthropic", 3, 15);
    expect(estimateEffectiveCost({
      model,
      inputTokens: 1000,
      outputTokens: 500,
      rounds: 0,
    })).toBe(0);
  });

  it("should compute correct value for anthropic 3 rounds", () => {
    const model = makeModel("anthropic", 10, 30);
    const inputTokens = 1000;
    const outputTokens = 200;

    const inputRate = 10 / 1_000_000;
    const outputRate = 30 / 1_000_000;
    const cacheable = 1000 * 0.7;      // 700
    const nonCacheable = 1000 - 700;    // 300

    // Round 1: 300 × rate + 700 × rate × 1.25
    const round1 = nonCacheable * inputRate + cacheable * inputRate * 1.25;
    // Round 2-3: 300 × rate + 700 × rate × 0.1
    const laterRound = nonCacheable * inputRate + cacheable * inputRate * 0.1;
    const totalInput = round1 + 2 * laterRound;
    const totalOutput = 3 * outputTokens * outputRate;
    const expected = totalInput + totalOutput;

    const actual = estimateEffectiveCost({
      model,
      inputTokens,
      outputTokens,
      rounds: 3,
    });
    expect(actual).toBeCloseTo(expected, 10);
  });
});

// -- estimateAmortizedCost --

describe("estimateAmortizedCost", () => {
  it("should equal static cost for 1 round", () => {
    const model = makeModel("google", 1.25, 5);
    const static1 = estimateStaticCost(model, 1000, 500);
    const amortized1 = estimateAmortizedCost(model, 1000, 500, 1);
    expect(amortized1).toBeCloseTo(static1, 10);
  });

  it("should be less than static cost for anthropic multi-round", () => {
    const model = makeModel("anthropic", 3, 15);
    const static1 = estimateStaticCost(model, 1000, 500);
    const amortized3 = estimateAmortizedCost(model, 1000, 500, 3);
    expect(amortized3).toBeLessThan(static1);
  });

  it("should equal static cost for github multi-round (no caching)", () => {
    const model = makeModel("github", 2, 8);
    const static1 = estimateStaticCost(model, 1000, 500);
    const amortized3 = estimateAmortizedCost(model, 1000, 500, 3);
    expect(amortized3).toBeCloseTo(static1, 10);
  });

  it("should return 0 for 0 rounds", () => {
    const model = makeModel("openai", 2, 8);
    expect(estimateAmortizedCost(model, 1000, 500, 0)).toBe(0);
  });
});
