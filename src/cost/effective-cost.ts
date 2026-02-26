/**
 * Provider caching metadata and effective cost estimation.
 *
 * Multi-round deliberation benefits significantly from prompt caching:
 * - Anthropic: 90% read discount, 25% write premium
 * - Google: 75% read discount, automatic caching
 * - OpenAI: 50% read discount, automatic caching
 *
 * This module consolidates the cost formula previously duplicated across
 * selector.ts and wrappers.ts into three shared functions.
 */

import type { ProviderName } from "../llm/types";
import type { ModelInfo } from "../model/types";

// -- Provider caching metadata --

export interface ProviderCachingInfo {
  readonly supported: boolean;
  /** Fraction of input cost saved on cache read (0.9 = 90% discount). */
  readonly readDiscount: number;
  /** Fraction of input cost added on cache write (0.25 = 25% premium). */
  readonly writePremium: number;
  /** Whether caching is automatic (no explicit API action needed). */
  readonly automatic: boolean;
}

export const PROVIDER_CACHING: Record<ProviderName, ProviderCachingInfo> = {
  anthropic: { supported: true,  readDiscount: 0.9,  writePremium: 0.25, automatic: false },
  google:    { supported: true,  readDiscount: 0.75, writePremium: 0,    automatic: true  },
  openai:    { supported: true,  readDiscount: 0.5,  writePremium: 0,    automatic: true  },
};

/** Fraction of input tokens that are cacheable (system prompt + task context). */
const CACHEABLE_RATIO = 0.7;

// -- Cost functions --

/**
 * Static cost estimate (no caching). Drop-in replacement for the inline formula
 * `(inputTokens * inputPer1M + outputTokens * outputPer1M) / 1_000_000`.
 */
export function estimateStaticCost(
  model: ModelInfo,
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    (inputTokens * model.cost.inputPer1M +
      outputTokens * model.cost.outputPer1M) /
    1_000_000
  );
}

export interface EffectiveCostParams {
  model: ModelInfo;
  inputTokens: number;
  outputTokens: number;
  rounds: number;
}

/**
 * Effective total cost across N rounds, accounting for provider prompt caching.
 *
 * Round 1:
 *   inputCost = nonCacheable × rate + cacheable × rate × (1 + writePremium)
 * Round 2..N:
 *   inputCost = nonCacheable × rate + cacheable × rate × (1 - readDiscount)
 * Output cost = rounds × outputTokens × outputRate
 *
 * When rounds ≤ 1 or caching is unsupported, falls back to static cost × rounds.
 */
export function estimateEffectiveCost(params: EffectiveCostParams): number {
  const { model, inputTokens, outputTokens, rounds } = params;

  if (rounds <= 0) return 0;

  const inputRate = model.cost.inputPer1M / 1_000_000;
  const outputRate = model.cost.outputPer1M / 1_000_000;
  const outputCost = rounds * outputTokens * outputRate;

  const caching = PROVIDER_CACHING[model.provider];

  if (!caching.supported || rounds <= 1) {
    return rounds * inputTokens * inputRate + outputCost;
  }

  const cacheable = inputTokens * CACHEABLE_RATIO;
  const nonCacheable = inputTokens - cacheable;

  // Round 1: cache write
  const round1Input =
    nonCacheable * inputRate +
    cacheable * inputRate * (1 + caching.writePremium);

  // Rounds 2..N: cache read
  const laterRoundInput =
    nonCacheable * inputRate +
    cacheable * inputRate * (1 - caching.readDiscount);

  const totalInput = round1Input + (rounds - 1) * laterRoundInput;

  return totalInput + outputCost;
}

/**
 * Amortized per-round cost (effective cost / rounds).
 * Used for cost-efficiency ranking in Selectors.
 */
export function estimateAmortizedCost(
  model: ModelInfo,
  inputTokens: number,
  outputTokens: number,
  rounds: number,
): number {
  if (rounds <= 0) return 0;
  return estimateEffectiveCost({ model, inputTokens, outputTokens, rounds }) / rounds;
}
