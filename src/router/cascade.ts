/**
 * Adaptive Weight Cascade — FrugalGPT LLM Cascade.
 *
 * Instead of selecting one model, uses a cascade chain:
 * cheap model → confidence check → if low confidence → next (more expensive) model.
 *
 * Features:
 * - Cascade chain construction (models sorted by cost)
 * - Confidence gate (threshold-based escalation)
 * - Budget-aware cascade termination
 * - Cascade result aggregation
 */

import type { ModelInfo } from "../model/types";
import type { TaskRequirement } from "../profile/types";

// -- Types --

/**
 * Configuration for a cascade chain.
 */
export interface CascadeConfig {
  /** Confidence threshold for accepting a response (0-1). */
  confidenceThreshold: number;
  /** Maximum number of models to try before giving up. */
  maxSteps: number;
  /** Budget limit per request in USD. */
  budgetLimit: number;
}

/**
 * A single step in the cascade execution.
 */
export interface CascadeStep {
  /** Model used in this step. */
  modelId: string;
  /** Estimated cost for this step. */
  estimatedCost: number;
  /** Whether this model's response was accepted. */
  accepted: boolean;
  /** Confidence of the response (0-1). */
  confidence: number;
}

/**
 * Result of running a cascade.
 */
export interface CascadeResult {
  /** The final accepted model (or last model in chain). */
  selectedModelId: string;
  /** Total estimated cost across all steps. */
  totalCost: number;
  /** All steps taken. */
  steps: CascadeStep[];
  /** Whether the cascade completed (found acceptable response). */
  completed: boolean;
  /** Whether budget was exhausted. */
  budgetExhausted: boolean;
}

/**
 * Interface for checking response confidence.
 * In practice, this calls the LLM and evaluates the response.
 */
export interface ConfidenceChecker {
  /** Check the confidence of a model's response to a prompt. */
  checkConfidence(modelId: string, prompt: string): Promise<number>;
}

// -- Cascade Chain Building --

/**
 * Build a cascade chain from models, sorted by cost (cheapest first).
 */
export function buildCascadeChain(
  models: ModelInfo[],
  estimatedInputTokens: number,
  estimatedOutputTokens: number,
): Array<{ model: ModelInfo; estimatedCost: number }> {
  return models
    .map((model) => ({
      model,
      estimatedCost:
        (estimatedInputTokens * model.cost.inputPer1M +
          estimatedOutputTokens * model.cost.outputPer1M) /
        1_000_000,
    }))
    .sort((a, b) => a.estimatedCost - b.estimatedCost);
}

// -- Confidence Gate --

/**
 * Check if a confidence value passes the gate threshold.
 */
export function passesGate(
  confidence: number,
  threshold: number,
): boolean {
  return confidence >= threshold;
}

// -- Cascade Execution --

/**
 * Execute a cascade: try models in order until one passes the confidence gate
 * or budget/step limit is reached.
 */
export async function executeCascade(
  models: ModelInfo[],
  requirement: TaskRequirement,
  config: CascadeConfig,
  checker: ConfidenceChecker,
  prompt: string,
): Promise<CascadeResult> {
  const chain = buildCascadeChain(
    models,
    requirement.estimatedInputTokens,
    requirement.estimatedOutputTokens,
  );

  const steps: CascadeStep[] = [];
  let totalCost = 0;
  let completed = false;
  let selectedModelId = "";
  let budgetExhausted = false;

  for (const { model, estimatedCost } of chain) {
    if (steps.length >= config.maxSteps) break;
    if (totalCost + estimatedCost > config.budgetLimit) {
      budgetExhausted = true;
      break;
    }

    const confidence = await checker.checkConfidence(model.id, prompt);
    const accepted = passesGate(confidence, config.confidenceThreshold);

    steps.push({
      modelId: model.id,
      estimatedCost,
      accepted,
      confidence,
    });

    totalCost += estimatedCost;

    if (accepted) {
      selectedModelId = model.id;
      completed = true;
      break;
    }
  }

  // If no model passed, use the last tried model
  if (!completed && steps.length > 0) {
    selectedModelId = steps[steps.length - 1]!.modelId;
  }

  return {
    selectedModelId,
    totalCost,
    steps,
    completed,
    budgetExhausted,
  };
}

// -- Cost Savings Estimation --

/**
 * Estimate cost savings from cascade vs always using the best model.
 */
export function estimateSavings(
  cascadeResult: CascadeResult,
  bestModelCost: number,
): { saved: number; savingsPercent: number } {
  const saved = bestModelCost - cascadeResult.totalCost;
  const savingsPercent =
    bestModelCost > 0 ? (saved / bestModelCost) * 100 : 0;
  return { saved: Math.max(0, saved), savingsPercent: Math.max(0, savingsPercent) };
}
