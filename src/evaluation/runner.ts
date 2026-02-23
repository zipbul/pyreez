/**
 * Evaluation runner — orchestrates model inference for evaluation prompts.
 */

import type {
  EvalPrompt,
  EvalResponse,
  ModelRunner,
} from "./types";

/**
 * Progress callback for evaluation runs.
 */
export type ProgressCallback = (completed: number, total: number) => void;

/**
 * Run a single model against a single prompt.
 */
export async function runSingle(
  runner: ModelRunner,
  prompt: EvalPrompt,
  modelId: string,
): Promise<EvalResponse> {
  const response = await runner.generate(modelId, prompt.text);
  return { ...response, promptId: prompt.id, modelId };
}

/**
 * Run multiple models against a single prompt.
 */
export async function runPromptAcrossModels(
  runner: ModelRunner,
  prompt: EvalPrompt,
  modelIds: string[],
  concurrency: number = 3,
): Promise<EvalResponse[]> {
  if (modelIds.length === 0) throw new Error("modelIds must not be empty");

  const results: EvalResponse[] = [];
  const queue = [...modelIds];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const modelId = queue.shift()!;
      const response = await runSingle(runner, prompt, modelId);
      results.push(response);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, modelIds.length) },
    () => processNext(),
  );
  await Promise.all(workers);

  return results;
}

/**
 * Run a full evaluation matrix: all prompts × all models.
 */
export async function runMatrix(
  runner: ModelRunner,
  prompts: EvalPrompt[],
  modelIds: string[],
  concurrency: number = 3,
  onProgress?: ProgressCallback,
): Promise<EvalResponse[]> {
  if (prompts.length === 0) throw new Error("prompts must not be empty");
  if (modelIds.length === 0) throw new Error("modelIds must not be empty");

  const results: EvalResponse[] = [];
  const total = prompts.length * modelIds.length;
  let completed = 0;

  for (const prompt of prompts) {
    const responses = await runPromptAcrossModels(
      runner,
      prompt,
      modelIds,
      concurrency,
    );
    results.push(...responses);
    completed += modelIds.length;
    onProgress?.(completed, total);
  }

  return results;
}
