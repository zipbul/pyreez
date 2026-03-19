/**
 * External Evaluator — binary dimension evaluation of worker responses.
 *
 * Evaluates each worker response independently using a cheap external model.
 * Rotates evaluator across providers to prevent single-evaluator bias.
 *
 * @module External Evaluator
 */

import type { FeedbackRecord, BinaryDimensions, FailureFlags } from "../axis/types";
import type { ModelInfo } from "../model/types";
import type { ChatMessage } from "../llm/types";

// -- Public Interface --

export interface ExternalEvaluator {
  /** Evaluate a single worker response. Returns a FeedbackRecord. */
  evaluate(
    task: string,
    modelId: string,
    responseContent: string,
    domain: string,
    taskType: string,
    deliberationId: string,
    /** Models on the current team — evaluator must NOT be from the same provider. */
    teamProviders: Set<string>,
  ): Promise<FeedbackRecord>;
}

// -- Dependencies --

export interface EvaluatorDeps {
  /** Chat function for calling the evaluator model. */
  readonly chat: (model: string, messages: ChatMessage[], params?: { temperature?: number; max_tokens?: number }) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;
  /** Available models to use as evaluators. */
  readonly getAvailableModels: () => ModelInfo[];
}

// -- Implementation --

/** Build the evaluation prompt for binary judgment. */
function buildEvalPrompt(task: string, responseContent: string): ChatMessage[] {
  const system = `You are an evaluation judge. Assess the following response to a deliberation task.
For each dimension, answer true (pass) or false (fail). For each failure flag, answer true (present) or false (absent).
Respond ONLY with a JSON object, no other text.

JSON format:
{
  "dimensions": {
    "factually_correct": true/false,
    "addresses_task": true/false,
    "provides_evidence": true/false,
    "novel_perspective": true/false,
    "internally_consistent": true/false
  },
  "failures": {
    "hallucination": true/false,
    "refusal": true/false,
    "off_topic": true/false,
    "degenerate": true/false
  }
}`;

  const user = `## Task
${task}

## Response to evaluate
${responseContent}

Evaluate this response. Return ONLY the JSON object.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Parse evaluator JSON response into typed dimensions and failures. */
function parseEvalResponse(content: string): { dimensions: BinaryDimensions; failures: FailureFlags } | null {
  try {
    // Extract JSON from response (may have markdown fences)
    // Greedy match — JSON has nested braces (dimensions, failures), so we need first { to last }
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    const dimensions: BinaryDimensions = {
      factually_correct: Boolean(parsed.dimensions?.factually_correct),
      addresses_task: Boolean(parsed.dimensions?.addresses_task),
      provides_evidence: Boolean(parsed.dimensions?.provides_evidence),
      novel_perspective: Boolean(parsed.dimensions?.novel_perspective),
      internally_consistent: Boolean(parsed.dimensions?.internally_consistent),
    };

    const failures: FailureFlags = {
      hallucination: Boolean(parsed.failures?.hallucination),
      refusal: Boolean(parsed.failures?.refusal),
      off_topic: Boolean(parsed.failures?.off_topic),
      degenerate: Boolean(parsed.failures?.degenerate),
    };

    return { dimensions, failures };
  } catch {
    return null;
  }
}

export class LLMExternalEvaluator implements ExternalEvaluator {
  private readonly deps: EvaluatorDeps;
  /** Last evaluator provider used — for rotation. */
  private lastEvaluatorProvider: string | null = null;
  /** Track models that failed during this session to deprioritize them. */
  private failedModels = new Set<string>();

  constructor(deps: EvaluatorDeps) {
    this.deps = deps;
  }

  async evaluate(
    task: string,
    modelId: string,
    responseContent: string,
    domain: string,
    taskType: string,
    deliberationId: string,
    teamProviders: Set<string>,
  ): Promise<FeedbackRecord> {
    const candidates = this.rankEvaluatorCandidates(teamProviders);
    if (candidates.length === 0) {
      throw new Error("No evaluator model available outside team providers");
    }

    const messages = buildEvalPrompt(task, responseContent);

    // Try candidates in order — if one fails, try next
    let lastError: Error | null = null;
    for (const evaluatorModel of candidates) {
      try {
        const result = await this.deps.chat(
          evaluatorModel.id,
          messages,
          { temperature: 0, max_tokens: 512 },
        );

        const parsed = parseEvalResponse(result.content);
        if (!parsed) {
          lastError = new Error(`Failed to parse evaluator response from ${evaluatorModel.id}: ${result.content.slice(0, 200)}`);
          continue; // try next candidate
        }

        this.lastEvaluatorProvider = evaluatorModel.provider;
        // Mark failed models to avoid re-selecting them
        this.failedModels.add(evaluatorModel.id);
        // Clear on success — only track consecutive failures
        this.failedModels.clear();

        return {
          deliberation_id: deliberationId,
          model_id: modelId,
          domain,
          task_type: taskType,
          evaluator_id: evaluatorModel.id,
          dimensions: parsed.dimensions,
          failures: parsed.failures,
          timestamp: Date.now(),
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.failedModels.add(evaluatorModel.id);
        // Try next candidate
      }
    }

    throw lastError ?? new Error("All evaluator candidates failed");
  }

  /**
   * Rank evaluator candidates by preference: different provider > same provider > any.
   * Excludes previously failed models. Returns ordered list to try in sequence.
   */
  private rankEvaluatorCandidates(teamProviders: Set<string>): ModelInfo[] {
    const available = this.deps.getAvailableModels()
      .filter((m) => !this.failedModels.has(m.id));

    const byCost = (a: ModelInfo, b: ModelInfo) => this.modelCost(a) - this.modelCost(b);

    // Tier 1: different provider from team AND different from last evaluator
    const tier1 = available
      .filter((m) => !teamProviders.has(m.provider) && m.provider !== this.lastEvaluatorProvider)
      .sort(byCost);

    // Tier 2: different from team only
    const tier2 = available
      .filter((m) => !teamProviders.has(m.provider) && !tier1.includes(m))
      .sort(byCost);

    // Tier 3: any available (provider constraint relaxed)
    const tier3 = available
      .filter((m) => !tier1.includes(m) && !tier2.includes(m))
      .sort(byCost);

    return [...tier1, ...tier2, ...tier3];
  }

  private modelCost(model: ModelInfo): number {
    return (model.cost.inputPer1M ?? 0) + (model.cost.outputPer1M ?? 0);
  }
}
