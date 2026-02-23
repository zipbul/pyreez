/**
 * LLM-as-Judge Pipeline — MT-Bench/Arena-Hard methodology.
 *
 * Features:
 * - Judge prompt template (5-outcome pairwise)
 * - Response parser (outcome + reasoning + confidence extraction)
 * - Position swap execution
 * - Length bias correction (AlpacaEval LC)
 */

import type {
  EvalPrompt,
  EvalResponse,
  PairwiseResult,
  PairwiseOutcome,
  JudgeConfig,
  PairwiseJudge,
} from "./types";
import { ALL_OUTCOMES } from "./types";
import { lengthRatio, correctLengthBias } from "./pairwise";

// -- Judge Prompt Template --

/**
 * Build a pairwise judge prompt (MT-Bench style).
 */
export function buildJudgePrompt(
  prompt: EvalPrompt,
  responseA: string,
  responseB: string,
): string {
  return `You are an expert judge evaluating two AI assistant responses to the same prompt.

## Evaluation Task
Compare Response A and Response B to the given prompt. Evaluate based on:
- Correctness and accuracy
- Completeness and thoroughness
- Clarity and coherence
- Relevance to the prompt

${prompt.checklist ? `## Evaluation Checklist\n${prompt.checklist.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n` : ""}
## Prompt
${prompt.text}

## Response A
${responseA}

## Response B
${responseB}

## Instructions
Provide your verdict using EXACTLY one of these outcomes:
- A>>B (Response A is significantly better)
- A>B (Response A is slightly better)
- A=B (Responses are roughly equal)
- B>A (Response B is slightly better)
- B>>A (Response B is significantly better)

Format your response as:
REASONING: <your analysis>
CONFIDENCE: <0.0-1.0>
VERDICT: <one of A>>B, A>B, A=B, B>A, B>>A>`;
}

// -- Response Parser --

/**
 * Parse a judge's raw response into structured output.
 */
export function parseJudgeResponse(raw: string): {
  outcome: PairwiseOutcome;
  reasoning: string;
  confidence: number;
} {
  // Extract verdict
  const verdictMatch = raw.match(/VERDICT:\s*(A>>B|A>B|A=B|B>A|B>>A)/i);
  const outcome: PairwiseOutcome = verdictMatch
    ? (verdictMatch[1] as PairwiseOutcome)
    : "A=B"; // default to tie if parsing fails

  // Extract reasoning
  const reasoningMatch = raw.match(
    /REASONING:\s*([\s\S]*?)(?=CONFIDENCE:|VERDICT:|$)/i,
  );
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : raw.trim();

  // Extract confidence
  const confidenceMatch = raw.match(/CONFIDENCE:\s*(-?[\d.]+)/i);
  const confidence = confidenceMatch
    ? Math.max(0, Math.min(1, parseFloat(confidenceMatch[1])))
    : 0.5; // default to 0.5 if not found

  return { outcome, reasoning, confidence };
}

// -- LLM Judge Implementation --

/**
 * Create a PairwiseJudge backed by an LLM generator function.
 * The generator function should call the actual LLM and return the raw text.
 */
export function createLLMJudge(
  generate: (model: string, prompt: string, config: JudgeConfig) => Promise<string>,
): PairwiseJudge {
  return {
    judge: async (
      prompt: EvalPrompt,
      responseA: EvalResponse,
      responseB: EvalResponse,
      config: JudgeConfig,
    ): Promise<PairwiseResult> => {
      const judgePrompt = buildJudgePrompt(
        prompt,
        responseA.response,
        responseB.response,
      );

      const raw = await generate(config.judgeModel, judgePrompt, config);
      const parsed = parseJudgeResponse(raw);

      // Apply length bias correction if enabled
      let outcome = parsed.outcome;
      if (config.lengthBiasCorrection) {
        const ratio = lengthRatio(responseA.response, responseB.response);
        outcome = correctLengthBias(outcome, ratio);
      }

      return {
        promptId: prompt.id,
        modelA: responseA.modelId,
        modelB: responseB.modelId,
        judge: config.judgeModel,
        outcome,
        swapped: false,
        reasoning: parsed.reasoning,
        confidence: parsed.confidence,
      };
    },
  };
}

/**
 * Validate that a verdict string is a valid PairwiseOutcome.
 */
export function isValidOutcome(s: string): s is PairwiseOutcome {
  return ALL_OUTCOMES.includes(s as PairwiseOutcome);
}
