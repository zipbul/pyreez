/**
 * Evaluation Suite types — 4-Layer benchmark system.
 *
 * Layer 1: Public benchmark anchor collection (F2 integration)
 * Layer 2: Domain-specific prompt sets (Arena-Hard BenchBuilder methodology)
 * Layer 3: Pairwise comparison-based BT update (Arena-Hard + Chatbot Arena)
 * Layer 4: Dynamic refresh (LiveBench + WildBench methodology)
 */

import type { CapabilityDimension, DimensionRating } from "../model/types";

// -- Difficulty & Domain --

export type EvalDifficulty = "simple" | "moderate" | "complex";

/**
 * 12 evaluation domains mapped to pyreez usage scenarios.
 */
export type EvalDomain =
  | "coding"
  | "debugging"
  | "architecture"
  | "math"
  | "reasoning"
  | "creative_writing"
  | "translation"
  | "summarization"
  | "instruction_following"
  | "domain_knowledge"
  | "tool_use"
  | "long_context";

export const ALL_EVAL_DOMAINS: readonly EvalDomain[] = [
  "coding",
  "debugging",
  "architecture",
  "math",
  "reasoning",
  "creative_writing",
  "translation",
  "summarization",
  "instruction_following",
  "domain_knowledge",
  "tool_use",
  "long_context",
] as const;

// -- Arena-Hard 7 Key Criteria --

/**
 * Arena-Hard 7 Key Criteria scores (0-7 each).
 */
export interface CriteriaScores {
  specificity: number;
  domainKnowledge: number;
  complexity: number;
  problemSolving: number;
  creativity: number;
  technicalAccuracy: number;
  realWorldApplication: number;
}

export const CRITERIA_KEYS: readonly (keyof CriteriaScores)[] = [
  "specificity",
  "domainKnowledge",
  "complexity",
  "problemSolving",
  "creativity",
  "technicalAccuracy",
  "realWorldApplication",
] as const;

// -- Eval Prompt --

/**
 * An evaluation prompt definition.
 */
export interface EvalPrompt {
  /** Unique identifier (e.g., "coding-complex-001"). */
  id: string;
  /** Evaluation domain. */
  domain: EvalDomain;
  /** Difficulty level. */
  difficulty: EvalDifficulty;
  /** Prompt text sent to the model. */
  text: string;
  /** Which capability dimensions this prompt measures. */
  expectedDimensions: CapabilityDimension[];
  /** Arena-Hard 7 Key Criteria scores. */
  criteria: CriteriaScores;
  /** WildBench task-specific checklist for evaluation. */
  checklist?: string[];
  /** Reference answer for verifiable prompts (coding/math). */
  referenceAnswer?: string;
  /** Whether this prompt can be auto-verified (not needing LLM judge). */
  verifiable: boolean;
}

// -- Eval Response --

/**
 * A model's response to an eval prompt.
 */
export interface EvalResponse {
  /** Which prompt was used. */
  promptId: string;
  /** Which model responded. */
  modelId: string;
  /** The model's response text. */
  response: string;
  /** Response latency in milliseconds. */
  latencyMs: number;
  /** Token usage for this response. */
  tokenUsage: { input: number; output: number };
}

// -- Pairwise Comparison --

/**
 * 5-outcome pairwise comparison result.
 * A≫B (strong A), A>B (weak A), A≈B (tie), B>A (weak B), B≫B (strong B).
 */
export type PairwiseOutcome = "A>>B" | "A>B" | "A=B" | "B>A" | "B>>A";

export const ALL_OUTCOMES: readonly PairwiseOutcome[] = [
  "A>>B",
  "A>B",
  "A=B",
  "B>A",
  "B>>A",
] as const;

/**
 * Outcome signal strength for BT update.
 * Strong outcomes = larger BT rating change.
 */
export const OUTCOME_SIGNAL: Record<PairwiseOutcome, number> = {
  "A>>B": 3.0,
  "A>B": 1.0,
  "A=B": 0.0,
  "B>A": -1.0,
  "B>>A": -3.0,
};

/**
 * A single pairwise comparison result.
 */
export interface PairwiseResult {
  /** Which prompt was used. */
  promptId: string;
  /** Model whose response was shown as "A". */
  modelA: string;
  /** Model whose response was shown as "B". */
  modelB: string;
  /** Which model served as judge. */
  judge: string;
  /** The 5-outcome verdict. */
  outcome: PairwiseOutcome;
  /** Whether this was a position-swapped run. */
  swapped: boolean;
  /** Judge's reasoning text. */
  reasoning: string;
  /** Judge's confidence (0-1). */
  confidence: number;
}

// -- BT Update --

/**
 * Result of updating a model's BT rating from pairwise comparisons.
 */
export interface BTUpdate {
  modelId: string;
  dimension: CapabilityDimension;
  oldMu: number;
  newMu: number;
  oldSigma: number;
  newSigma: number;
  comparisons: number;
}

// -- Judge Config --

/**
 * Configuration for LLM-as-Judge.
 */
export interface JudgeConfig {
  /** Model to use as judge (e.g., "openai/o3"). */
  judgeModel: string;
  /** Temperature for judge (usually 0). */
  temperature: number;
  /** Max tokens for judge response. */
  maxTokens: number;
  /** Whether to apply length bias correction (AlpacaEval LC). */
  lengthBiasCorrection: boolean;
}

// -- Eval Runner --

/**
 * Abstract interface for running model inference.
 * Allows dependency injection for testing.
 */
export interface ModelRunner {
  /** Generate a response from a model for a prompt. */
  generate(modelId: string, prompt: string): Promise<EvalResponse>;
}

/**
 * Abstract interface for judging pairwise comparisons.
 */
export interface PairwiseJudge {
  /** Judge two responses to the same prompt. */
  judge(
    prompt: EvalPrompt,
    responseA: EvalResponse,
    responseB: EvalResponse,
    config: JudgeConfig,
  ): Promise<PairwiseResult>;
}

// -- Eval Suite Config --

/**
 * Configuration for running an evaluation suite.
 */
export interface EvalSuiteConfig {
  /** Models to evaluate. */
  modelIds: string[];
  /** Anchor model for pairwise (e.g., strongest model). */
  anchorModelId: string;
  /** Judge configuration. */
  judgeConfig: JudgeConfig;
  /** Maximum concurrent model calls. */
  concurrency: number;
  /** Which domains to include (all if empty). */
  domains?: EvalDomain[];
  /** Which difficulties to include (all if empty). */
  difficulties?: EvalDifficulty[];
  /** Whether to run position-swapped pairs. */
  positionSwap: boolean;
}

// -- Eval Suite Result --

/**
 * Summary result of an evaluation run.
 */
export interface EvalSuiteResult {
  /** Timestamp of the run. */
  timestamp: string;
  /** How many prompts were used. */
  promptCount: number;
  /** How many models were evaluated. */
  modelCount: number;
  /** All pairwise results. */
  pairwiseResults: PairwiseResult[];
  /** BT updates derived from pairwise results. */
  btUpdates: BTUpdate[];
  /** Consistency rate (position-swap agreement). */
  consistencyRate: number;
}

// -- Validation --

/**
 * Validate an EvalPrompt's structural integrity.
 * Returns null if valid, or an error message.
 */
export function validatePrompt(prompt: EvalPrompt): string | null {
  if (!prompt.id || prompt.id.trim() === "") return "id is required";
  if (!prompt.text || prompt.text.trim() === "") return "text is required";
  if (!ALL_EVAL_DOMAINS.includes(prompt.domain))
    return `invalid domain: ${prompt.domain}`;
  if (!["simple", "moderate", "complex"].includes(prompt.difficulty))
    return `invalid difficulty: ${prompt.difficulty}`;
  if (prompt.expectedDimensions.length === 0)
    return "expectedDimensions must not be empty";
  if (prompt.verifiable && !prompt.referenceAnswer)
    return "verifiable prompt requires referenceAnswer";

  // Criteria range check (0-7)
  for (const key of CRITERIA_KEYS) {
    const val = prompt.criteria[key];
    if (val < 0 || val > 7) return `criteria.${key} must be 0-7, got ${val}`;
  }

  return null;
}
