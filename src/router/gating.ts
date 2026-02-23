/**
 * MoE Dimension Gating — ArmoRM-inspired Mixture of Experts for dimension weights.
 *
 * Instead of manually specifying dimension weights per task, a gating network
 * automatically determines optimal weights based on task characteristics.
 *
 * Approach:
 * 1. Expert lookup table: each "expert" is a task domain pattern with learned weights
 * 2. Gating: task features (taskType + domain) → soft routing to experts
 * 3. Final weights = weighted combination of expert weight vectors
 *
 * This replaces manual weight management in requiredCapabilities.
 */

import type { CapabilityDimension } from "../model/types";
import { ALL_DIMENSIONS } from "../model/types";

// -- Types --

/**
 * A dimension weight vector — weight per dimension.
 */
export type DimensionWeights = Partial<Record<CapabilityDimension, number>>;

/**
 * An expert specializing in a task pattern.
 */
export interface Expert {
  /** Unique expert identifier. */
  id: string;
  /** Task pattern this expert covers (e.g., "coding", "reasoning"). */
  pattern: string;
  /** Weight vector for this expert. */
  weights: DimensionWeights;
}

/**
 * Gating result — which experts were activated and the final weights.
 */
export interface GatingResult {
  /** Final combined dimension weights. */
  weights: DimensionWeights;
  /** Which experts contributed and their gate values. */
  activeExperts: Array<{ expertId: string; gateValue: number }>;
}

// -- Default Experts --

/**
 * Built-in experts based on common task patterns.
 * These serve as the initial expert table before fine-tuning.
 */
export const DEFAULT_EXPERTS: Expert[] = [
  {
    id: "coding",
    pattern: "coding",
    weights: {
      CODE_GENERATION: 0.35,
      CODE_UNDERSTANDING: 0.15,
      REASONING: 0.15,
      DEBUGGING: 0.10,
      SYSTEM_THINKING: 0.10,
      INSTRUCTION_FOLLOWING: 0.10,
      STRUCTURED_OUTPUT: 0.05,
    },
  },
  {
    id: "reasoning",
    pattern: "reasoning",
    weights: {
      REASONING: 0.30,
      MULTI_STEP_DEPTH: 0.20,
      ANALYSIS: 0.15,
      JUDGMENT: 0.15,
      MATH_REASONING: 0.10,
      HALLUCINATION_RESISTANCE: 0.10,
    },
  },
  {
    id: "creative",
    pattern: "creative",
    weights: {
      CREATIVITY: 0.35,
      INSTRUCTION_FOLLOWING: 0.20,
      REASONING: 0.15,
      MULTILINGUAL: 0.10,
      ANALYSIS: 0.10,
      LONG_CONTEXT: 0.10,
    },
  },
  {
    id: "translation",
    pattern: "translation",
    weights: {
      MULTILINGUAL: 0.40,
      INSTRUCTION_FOLLOWING: 0.20,
      LONG_CONTEXT: 0.15,
      HALLUCINATION_RESISTANCE: 0.15,
      SELF_CONSISTENCY: 0.10,
    },
  },
  {
    id: "analysis",
    pattern: "analysis",
    weights: {
      ANALYSIS: 0.25,
      REASONING: 0.20,
      JUDGMENT: 0.15,
      MULTI_STEP_DEPTH: 0.15,
      LONG_CONTEXT: 0.15,
      HALLUCINATION_RESISTANCE: 0.10,
    },
  },
  {
    id: "math",
    pattern: "math",
    weights: {
      MATH_REASONING: 0.35,
      REASONING: 0.25,
      MULTI_STEP_DEPTH: 0.15,
      SELF_CONSISTENCY: 0.10,
      STRUCTURED_OUTPUT: 0.10,
      HALLUCINATION_RESISTANCE: 0.05,
    },
  },
  {
    id: "tool_use",
    pattern: "tool",
    weights: {
      TOOL_USE: 0.35,
      INSTRUCTION_FOLLOWING: 0.20,
      STRUCTURED_OUTPUT: 0.20,
      REASONING: 0.15,
      CODE_GENERATION: 0.10,
    },
  },
];

// -- Gating --

/**
 * Compute similarity between a query string and a pattern.
 * Simple substring match with case-insensitive comparison.
 */
export function patternSimilarity(query: string, pattern: string): number {
  const q = query.toLowerCase();
  const p = pattern.toLowerCase();

  if (q === p) return 1.0;
  if (q.includes(p) || p.includes(q)) return 0.8;

  // Partial word overlap
  const qWords = new Set(q.split(/[_\s-]+/));
  const pWords = new Set(p.split(/[_\s-]+/));
  const intersection = [...qWords].filter((w) => pWords.has(w));
  if (intersection.length > 0) return 0.5 * (intersection.length / Math.max(qWords.size, pWords.size));

  return 0.0;
}

/**
 * Softmax over an array of values.
 */
export function softmax(values: number[], temperature: number = 1.0): number[] {
  if (values.length === 0) return [];
  const scaled = values.map((v) => v / temperature);
  const maxVal = Math.max(...scaled);
  const exps = scaled.map((v) => Math.exp(v - maxVal));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/**
 * Run the gating network: task features → expert activation → combined weights.
 */
export function gate(
  taskType: string,
  domain: string,
  experts: Expert[] = DEFAULT_EXPERTS,
  temperature: number = 0.5,
): GatingResult {
  // Compute similarity to each expert
  const query = `${taskType} ${domain}`;
  const similarities = experts.map((e) => patternSimilarity(query, e.pattern));

  // If all similarities are 0, use uniform distribution
  const hasMatch = similarities.some((s) => s > 0);
  const gateValues = hasMatch
    ? softmax(similarities, temperature)
    : experts.map(() => 1 / experts.length);

  // Combine expert weights using gate values
  const combined: DimensionWeights = {};
  for (let i = 0; i < experts.length; i++) {
    const gateVal = gateValues[i]!;
    if (gateVal < 0.01) continue; // skip negligible contributions

    for (const [dim, weight] of Object.entries(experts[i]!.weights)) {
      const d = dim as CapabilityDimension;
      combined[d] = (combined[d] ?? 0) + gateVal * weight;
    }
  }

  // Normalize to sum to 1.0
  const total = Object.values(combined).reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (const dim of Object.keys(combined) as CapabilityDimension[]) {
      combined[dim] = combined[dim]! / total;
    }
  }

  const activeExperts = experts
    .map((e, i) => ({ expertId: e.id, gateValue: gateValues[i]! }))
    .filter((e) => e.gateValue >= 0.01)
    .sort((a, b) => b.gateValue - a.gateValue);

  return { weights: combined, activeExperts };
}

/**
 * Convert gating result to CapabilityRequirement-style array.
 * Filters out dimensions with negligible weight.
 */
export function toCapabilityRequirements(
  result: GatingResult,
  minWeight: number = 0.05,
): Array<{ dimension: CapabilityDimension; weight: number }> {
  return Object.entries(result.weights)
    .filter(([, w]) => w >= minWeight)
    .map(([dim, w]) => ({
      dimension: dim as CapabilityDimension,
      weight: w,
    }))
    .sort((a, b) => b.weight - a.weight);
}
