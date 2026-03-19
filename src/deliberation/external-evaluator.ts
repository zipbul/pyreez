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
    const evaluatorModel = this.selectEvaluator(teamProviders);
    if (!evaluatorModel) {
      throw new Error("No evaluator model available outside team providers");
    }

    const messages = buildEvalPrompt(task, responseContent);
    const result = await this.deps.chat(
      evaluatorModel.id,
      messages,
      { temperature: 0, max_tokens: 512 },
    );

    const parsed = parseEvalResponse(result.content);
    if (!parsed) {
      throw new Error(`Failed to parse evaluator response: ${result.content.slice(0, 200)}`);
    }

    this.lastEvaluatorProvider = evaluatorModel.provider;

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
  }

  /** Select cheapest evaluator model from a different provider than team + last evaluator. */
  private selectEvaluator(teamProviders: Set<string>): ModelInfo | null {
    const available = this.deps.getAvailableModels();

    // Prefer: different provider from team AND different from last evaluator
    const candidates = available.filter(
      (m) => !teamProviders.has(m.provider) && m.provider !== this.lastEvaluatorProvider,
    );

    if (candidates.length > 0) {
      // Pick cheapest
      return candidates.sort((a, b) => this.modelCost(a) - this.modelCost(b))[0]!;
    }

    // Relax: different from team only (allow same as last evaluator)
    const relaxed = available.filter((m) => !teamProviders.has(m.provider));
    if (relaxed.length > 0) {
      return relaxed.sort((a, b) => this.modelCost(a) - this.modelCost(b))[0]!;
    }

    // Last resort: any available model (provider constraint fully relaxed)
    if (available.length > 0) {
      return available.sort((a, b) => this.modelCost(a) - this.modelCost(b))[0]!;
    }

    return null;
  }

  private modelCost(model: ModelInfo): number {
    return (model.cost.inputPer1M ?? 0) + (model.cost.outputPer1M ?? 0);
  }
}
