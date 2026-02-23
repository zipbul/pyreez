/**
 * Pairwise comparison — position swap, outcome reconciliation, round-robin pairing.
 */

import type {
  EvalPrompt,
  EvalResponse,
  PairwiseResult,
  PairwiseOutcome,
  PairwiseJudge,
  JudgeConfig,
  OUTCOME_SIGNAL,
} from "./types";

// -- Outcome Utilities --

/**
 * Flip a pairwise outcome (swap A↔B).
 */
export function flipOutcome(outcome: PairwiseOutcome): PairwiseOutcome {
  switch (outcome) {
    case "A>>B":
      return "B>>A";
    case "A>B":
      return "B>A";
    case "A=B":
      return "A=B";
    case "B>A":
      return "A>B";
    case "B>>A":
      return "A>>B";
  }
}

/**
 * Check if two outcomes (original + swapped) are consistent.
 * Consistent = same direction after flipping the swapped result.
 */
export function isConsistent(
  original: PairwiseOutcome,
  swapped: PairwiseOutcome,
): boolean {
  // swapped result should be flipped to compare with original
  return flipOutcome(swapped) === original;
}

/**
 * Reconcile original and swapped outcomes into a single verdict.
 * If consistent → keep original. If inconsistent → tie (A=B).
 */
export function reconcile(
  original: PairwiseOutcome,
  swapped: PairwiseOutcome,
): PairwiseOutcome {
  if (isConsistent(original, swapped)) return original;
  return "A=B";
}

// -- Length Bias --

/**
 * Calculate length ratio between two responses.
 */
export function lengthRatio(responseA: string, responseB: string): number {
  if (responseB.length === 0) return responseA.length === 0 ? 1.0 : Infinity;
  return responseA.length / responseB.length;
}

/**
 * Correct length bias in pairwise outcome (AlpacaEval LC methodology).
 * If length difference is extreme (>2x), downgrade strong outcomes to weak.
 */
export function correctLengthBias(
  outcome: PairwiseOutcome,
  ratio: number,
): PairwiseOutcome {
  const LENGTH_BIAS_THRESHOLD = 2.0;

  // If A is much longer and A wins strongly, downgrade
  if (ratio > LENGTH_BIAS_THRESHOLD && outcome === "A>>B") return "A>B";
  // If B is much longer and B wins strongly, downgrade
  if (ratio < 1 / LENGTH_BIAS_THRESHOLD && outcome === "B>>A") return "B>A";

  return outcome;
}

// -- Pairing Strategies --

/**
 * Generate anchor-based pairings: every model vs anchor model.
 */
export function anchorPairings(
  modelIds: string[],
  anchorId: string,
): Array<[string, string]> {
  return modelIds
    .filter((id) => id !== anchorId)
    .map((id) => [id, anchorId] as [string, string]);
}

/**
 * Generate full round-robin pairings.
 */
export function roundRobinPairings(
  modelIds: string[],
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < modelIds.length; i++) {
    for (let j = i + 1; j < modelIds.length; j++) {
      pairs.push([modelIds[i]!, modelIds[j]!]);
    }
  }
  return pairs;
}

// -- Pairwise Runner --

export interface PairwiseRunResult {
  original: PairwiseResult;
  swapped?: PairwiseResult;
  reconciled: PairwiseOutcome;
  consistent: boolean;
}

/**
 * Run a single pairwise comparison with optional position swap.
 */
export async function runPairwise(
  judge: PairwiseJudge,
  prompt: EvalPrompt,
  responseA: EvalResponse,
  responseB: EvalResponse,
  config: JudgeConfig,
  positionSwap: boolean,
): Promise<PairwiseRunResult> {
  const original = await judge.judge(prompt, responseA, responseB, config);

  if (!positionSwap) {
    return { original, reconciled: original.outcome, consistent: true };
  }

  // Position swap: B goes first
  const swappedRaw = await judge.judge(prompt, responseB, responseA, config);
  const swapped: PairwiseResult = { ...swappedRaw, swapped: true };

  const cons = isConsistent(original.outcome, swapped.outcome);
  const rec = reconcile(original.outcome, swapped.outcome);

  // Apply length bias correction if enabled
  let finalOutcome = rec;
  if (config.lengthBiasCorrection) {
    const ratio = lengthRatio(responseA.response, responseB.response);
    finalOutcome = correctLengthBias(rec, ratio);
  }

  return {
    original,
    swapped,
    reconciled: finalOutcome,
    consistent: cons,
  };
}
